"""Audit lifecycle (spec 4.1) and the audit record (prompt 0a).

An audit is advanced one agent attempt at a time so each serverless call
stays well inside its time limit. A step claims the next agent in a short
transaction, calls the model with no database lock held, then writes the
result. A claim older than STALE_MINUTES is treated as a failed attempt.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone

from . import db, emailer
from .agents import AgentError, AgentRunner, build_context
from .config import AGENTS, CALIBRATION, CALIBRATIONS, SECTIONS, model_for, settings
from .engine import score_audit, score_excluding_dismissed
from .quality import input_problem
from .rules import checkpoints, evaluate_alerts

STALE_MINUTES = 10
RESEARCH_AGENTS = (2, 4, 5)
FREE_ORG = "free-audits"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Creating an audit


def snapshot(company: dict, sources: list[dict]) -> tuple[dict, str]:
    """Immutable input snapshot and its hash: company fields, data room
    extracts and every source hash (spec 4.0, Drift in production)."""
    fields = {k: company.get(k) for k in ("title", "description", "industry", "country", "city", "model", "target", "type")}
    src = sorted(
        ({"id": s["id"], "hash": s.get("content_hash") or hashlib.sha256((s.get("extract") or s.get("note") or s["title"]).encode()).hexdigest()}
         for s in sources),
        key=lambda x: x["id"])
    snap = {"company": fields, "sources": src}
    digest = hashlib.sha256(json.dumps(snap, sort_keys=True).encode()).hexdigest()
    return snap, digest


class InsufficientInput(ValueError):
    """The venture inputs cannot support an audit (see quality.py)."""


def create_audit(user_id: str | None, company_id: str, trigger: str = "manual", notify: bool = False, depth: str = "standard") -> str:
    """Queue an audit. The insert runs as the user so RLS enforces who may run audits.
    Refuses inputs AVA cannot assess, before any model call is made."""
    with db.system() as c:
        co = c.execute("select title, description from companies where id = %s", (company_id,)).fetchone()
    if co:
        problem = input_problem(co)
        if problem:
            raise InsufficientInput(problem)
    if user_id:
        with db.as_user(user_id) as c:
            row = c.execute("select org_id from companies where id = %s", (company_id,)).fetchone()
            if not row:
                raise PermissionError("Company not found")
            audit_id = c.execute(
                "insert into audits (org_id, company_id, trigger, notify_on_complete, created_by) values (%s, %s, %s, %s, %s) returning id",
                (row["org_id"], company_id, trigger, notify, user_id)).fetchone()["id"]
    else:
        with db.system() as c:
            row = c.execute("select org_id from companies where id = %s", (company_id,)).fetchone()
            audit_id = c.execute("insert into audits (org_id, company_id, trigger) values (%s, %s, %s) returning id",
                                 (row["org_id"], company_id, trigger)).fetchone()["id"]
    s = settings()
    with db.system() as c:
        company = c.execute("select * from companies where id = %s", (company_id,)).fetchone()
        sources = c.execute("select * from sources where company_id = %s and status <> 'superseded'", (company_id,)).fetchall()
        snap, digest = snapshot(company, sources)
        c.execute(
            "update audits set depth = %s, input_snapshot = %s, snapshot_hash = %s, source_ids = %s, model_version = %s, prompt_version = %s, "
            "calibration_version = %s where id = %s",
            (depth, db.jsonb(snap), digest, [x["id"] for x in sources], model_for(depth, s), s.prompt_version, CALIBRATION["version"], audit_id))
        for a in AGENTS:
            c.execute("insert into agent_runs (audit_id, org_id, agent) values (%s, %s, %s)", (audit_id, company["org_id"], a["n"]))
    return audit_id


# ---------------------------------------------------------------------------
# Advancing an audit


def _claim(audit_id: str) -> dict | None:
    with db.system() as c:
        a = c.execute("select * from audits where id = %s for update skip locked", (audit_id,)).fetchone()
        if not a or a["status"] not in ("queued", "running"):
            return None
        # Reclaim an attempt abandoned by a crashed or timed-out call.
        c.execute("update agent_runs set status = 'queued', retry_count = retry_count + 1, "
                  "error_reason = 'The attempt did not finish in time' "
                  "where audit_id = %s and status = 'working' and started_at < now() - make_interval(mins => %s) and retry_count = 0",
                  (audit_id, STALE_MINUTES))
        c.execute("update agent_runs set status = 'failed', error_reason = 'The retry did not finish in time' "
                  "where audit_id = %s and status = 'working' and started_at < now() - make_interval(mins => %s)",
                  (audit_id, STALE_MINUTES))
        if c.execute("select 1 from agent_runs where audit_id = %s and status = 'working'", (audit_id,)).fetchone():
            return None  # another call is running an agent for this audit
        run = c.execute("select * from agent_runs where audit_id = %s and status = 'queued' order by agent limit 1", (audit_id,)).fetchone()
        if a["status"] == "queued":
            c.execute("update audits set status = 'running', started_at = coalesce(started_at, now()) where id = %s", (audit_id,))
        if not run:
            return {"audit": a, "run": None}
        c.execute("update agent_runs set status = 'working', started_at = now() where id = %s", (run["id"],))
        return {"audit": a, "run": run}


def _context(audit: dict, agent_n: int, extra_sources: list[dict]) -> tuple[str, dict, list[dict]]:
    with db.system() as c:
        company = c.execute("select * from companies where id = %s", (audit["company_id"],)).fetchone()
        if audit["trigger"] == "shadow":
            # Frozen snapshot: exactly the sources the original audit saw, no live retrieval.
            sources = c.execute("select * from sources where id = any(%s) order by created_at", (audit["source_ids"],)).fetchall()
        else:
            sources = c.execute("select * from sources where company_id = %s and (audit_id is null or audit_id = %s) and status <> 'superseded' order by created_at",
                                (audit["company_id"], audit["id"])).fetchall()
        prior_runs = c.execute("select agent, output from agent_runs where audit_id = %s and status = 'complete' and agent < %s order by agent",
                               (audit["id"], agent_n)).fetchall()
        findings = c.execute("select id, agent, severity, category, title from findings where audit_id = %s order by position", (audit["id"],)).fetchall()
    prior = [{"name": AGENTS[r["agent"] - 1]["name"], "output": r["output"]} for r in prior_runs]
    extra = ""
    if agent_n == 6:
        status = "partial" if _failed_agents(audit["id"]) else "complete"
        scored = score_audit(_findings_for_engine(audit["id"]), company["type"], status, None, CALIBRATION)
        extra = ("<findings>\n" + "\n".join(json.dumps(dict(f), ensure_ascii=False) for f in findings) + "\n</findings>\n"
                 f"<score>Resilience Score {scored['score']} of 100. Base directive {scored['baseDirective']}.</score>")
    return build_context(company, sources, prior, extra), company, sources


def _failed_agents(audit_id: str) -> list[int]:
    with db.system() as c:
        return [r["agent"] for r in c.execute("select agent from agent_runs where audit_id = %s and status = 'failed'", (audit_id,)).fetchall()]


def _findings_for_engine(audit_id: str) -> list[dict]:
    with db.system() as c:
        rows = c.execute("select id, agent, category, severity, status, match_key, title, dismiss_reason, audit_id from findings where audit_id = %s order by position", (audit_id,)).fetchall()
    return [{"id": r["id"], "agent": r["agent"], "category": r["category"], "severity": r["severity"], "status": r["status"],
             "matchKey": r["match_key"], "title": r["title"], "dismissReason": r["dismiss_reason"], "auditId": r["audit_id"]} for r in rows]


def advance(audit_id: str, runner: AgentRunner | None = None, live_research: bool = True) -> dict:
    """Run one agent attempt (or finalise). Returns the audit's status."""
    claim = _claim(audit_id)
    if claim is None:
        return status(audit_id)
    audit, run = claim["audit"], claim["run"]
    if run is None:
        finalise(audit_id)
        return status(audit_id)

    agent_n = run["agent"]
    runner = runner or AgentRunner()
    research = []
    try:
        if live_research and agent_n in RESEARCH_AGENTS and audit["trigger"] != "shadow":
            with db.system() as c:
                company = c.execute("select * from companies where id = %s", (audit["company_id"],)).fetchone()
            research = runner.research(agent_n, company, model=audit["model_version"])
            _register_public_sources(audit, research)
        context, company, sources = _context(audit, agent_n, research)
        result = runner.run(agent_n, context, model=audit["model_version"])
    except AgentError as err:
        _record_failure(run, err)
    else:
        _record_success(audit, run, result, sources)

    with db.system() as c:
        r6 = c.execute("select status from agent_runs where audit_id = %s and agent = 6", (audit_id,)).fetchone()
        pending = c.execute("select 1 from agent_runs where audit_id = %s and status in ('queued', 'working')", (audit_id,)).fetchone()
    if r6["status"] == "failed" or not pending:
        finalise(audit_id)
    return status(audit_id)


def _register_public_sources(audit: dict, found: list[dict]) -> None:
    with db.system() as c:
        for s in found:
            exists = c.execute("select 1 from sources where company_id = %s and url = %s", (audit["company_id"], s["url"])).fetchone()
            if exists:
                continue
            c.execute(
                "insert into sources (org_id, company_id, audit_id, type, title, kind, date, reliability, note, url, retrieval_date, content_hash, added_by) "
                "values (%s, %s, %s, 'public', %s, %s, %s, %s, %s, %s, %s, %s, 'Found by AVA')",
                (audit["org_id"], audit["company_id"], audit["id"], s["title"], s["kind"], s["date"], s["reliability"], s["note"],
                 s["url"], s["retrieval_date"], s["content_hash"]))


def _record_failure(run: dict, err: AgentError) -> None:
    with db.system() as c:
        if run["retry_count"] == 0:
            c.execute("update agent_runs set status = 'queued', retry_count = 1, error_reason = %s, schema_result = %s where id = %s",
                      (err.reason, err.schema_result, run["id"]))
        else:
            c.execute("update agent_runs set status = 'failed', error_reason = %s, schema_result = %s, finished_at = now(), "
                      "duration_s = extract(epoch from now() - started_at) where id = %s", (err.reason, err.schema_result, run["id"]))


def _record_success(audit: dict, run: dict, result, sources: list[dict]) -> None:
    agent_n = run["agent"]
    out = result.output
    with db.system() as c:
        if agent_n != 6:
            # Only sources registered for this company or audit may be cited (spec 4.2).
            valid = {r["id"] for r in c.execute(
                "select id from sources where company_id = %s and (audit_id is null or audit_id = %s)", (audit["company_id"], audit["id"])).fetchall()}
            base = c.execute("select coalesce(max(position), 0) as p from findings where audit_id = %s", (audit["id"],)).fetchone()["p"]
            for i, f in enumerate(out["findings"]):
                cited = [s for s in f["source_ids"] if s in valid]
                dropped = [s for s in f["source_ids"] if s not in valid]
                topic = (f["topic"] or f["title"]).strip().lower().replace(" ", "-")[:60]
                key = f"{agent_n}:{f['category']}:{topic}"
                first = c.execute(
                    "select f.audit_id from findings f join audits a on a.id = f.audit_id where f.company_id = %s and f.match_key = %s "
                    "order by a.date, a.created_at limit 1", (audit["company_id"], key)).fetchone()
                c.execute(
                    "insert into findings (audit_id, org_id, company_id, agent, section, category, severity, topic, match_key, title, text, sources, "
                    "dropped_citations, first_seen_audit, position) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (audit["id"], audit["org_id"], audit["company_id"], agent_n, f["section"], f["category"], f["severity"], topic, key,
                     f["title"].strip(), f["text"].strip(), cited, dropped, first["audit_id"] if first else audit["id"], base + i + 1))
            if out["skipped_sections"]:
                c.execute("update audits set skipped_sections = skipped_sections || %s where id = %s",
                          (db.jsonb([{"section": s["section"], "reason": s["reason"].strip()} for s in out["skipped_sections"]]), audit["id"]))
        c.execute(
            "update agent_runs set status = 'complete', output = %s, served_model = %s, fallback_used = %s, usage = %s, "
            "schema_result = 'valid', finished_at = now(), duration_s = %s where id = %s",
            (db.jsonb(out), result.served_model, result.fallback_used, db.jsonb(result.usage), result.duration_s, run["id"]))


# ---------------------------------------------------------------------------
# Finalising: scoring, the audit record, alerts


def finalise(audit_id: str) -> None:
    with db.system() as c:
        a = c.execute("select * from audits where id = %s for update", (audit_id,)).fetchone()
        if a["status"] in ("complete", "partial", "failed"):
            return
        company = c.execute("select * from companies where id = %s", (a["company_id"],)).fetchone()
        org = c.execute("select * from organisations where id = %s", (a["org_id"],)).fetchone()
        runs = {r["agent"]: r for r in c.execute("select * from agent_runs where audit_id = %s", (audit_id,)).fetchall()}

    findings = _findings_for_engine(audit_id)
    failed = [n for n, r in runs.items() if r["status"] == "failed"]
    orchestrator_failed = 6 in failed
    st = "failed" if orchestrator_failed else ("partial" if failed else "complete")
    o6 = (runs.get(6) or {}).get("output") or {}
    # The Orchestrator judged the inputs too thin, vague or nonsensical to score:
    # no score, no directive, not counted against usage.
    insufficient = not orchestrator_failed and o6.get("assessable") is False
    if insufficient:
        st = "failed"
    cal = CALIBRATIONS.get(a["calibration_version"]) or CALIBRATION
    o = (runs.get(6) or {}).get("output") or {}
    override = None
    if o.get("override", {}).get("apply"):
        override = {"to": o["override"]["to"], "findingIds": o["override"]["finding_ids"], "reason": o["override"]["reason"]}
    result = score_audit(findings, company["type"], st, override, cal)
    today = date.today().isoformat()
    not_run = [s["id"] for s in SECTIONS if s["agent"] in failed and s["agent"] != 6]

    with db.system() as c:
        cited = c.execute("select count(distinct s) as n from findings, unnest(sources) s where audit_id = %s", (audit_id,)).fetchone()["n"]
        coverage = {"agentsRun": sum(1 for r in runs.values() if r["status"] == "complete"), "agentsTotal": 6,
                    "sectionsSkipped": len(a["skipped_sections"] or []), "sectionsNotRun": not_run, "sourcesCited": cited}
        update = {
            "status": st, "finished_at": _now(), "counted_against_usage": st != "failed",
            "coverage": db.jsonb(coverage),
            "run_seconds": int((_now() - a["started_at"]).total_seconds()) if a["started_at"] else None,
            "under_review": bool(org["hold_mode"]),
        }
        if insufficient:
            update["run_state"] = db.jsonb({**(a["run_state"] or {}), "outcome": "insufficient_information",
                                            "reason": o6.get("assessable_reason") or "The inputs were too thin to assess."})
        if st != "failed":
            excl = score_excluding_dismissed(findings, company["type"], cal)
            cp = checkpoints(today)
            update.update({
                "date": today, "score": result["score"], "raw_score": result["raw"], "exposure": db.jsonb(result["exposure"]),
                "cap": db.jsonb(result["cap"]), "base_directive": result["baseDirective"], "final_directive": result["finalDirective"],
                "overridden": result["overridden"], "override": db.jsonb({**override, "findingIds": result["overrideCited"]}) if result["overridden"] else None,
                "override_cited": result["overrideCited"], "override_rejected": result["overrideRejected"],
                "score_excluding_dismissed": excl["score"],
                "orchestrator": db.jsonb({"rationale": o.get("rationale"), "investor": o.get("investor_perspective"),
                                          "roadmap": o.get("roadmap"), "topRisks": o.get("top_risks", [])}),
                "first_checkpoint": cp["firstCheckpoint"], "final_checkpoint": cp["finalCheckpoint"],
                "outcome_window_version": cp["outcomeWindowVersion"],
            })
            # Drift flag: same input snapshot as an earlier audit but a different score.
            twin = c.execute("select id, score from audits where company_id = %s and id <> %s and snapshot_hash = %s and score is not null "
                             "and calibration_version = %s and trigger <> 'shadow' order by created_at desc limit 1",
                             (a["company_id"], audit_id, a["snapshot_hash"], a["calibration_version"])).fetchone()
            if twin and twin["score"] != result["score"] and a["trigger"] != "shadow":
                update["drift_flag"] = True
        cols = ", ".join(f"{k} = %s" for k in update)
        c.execute(f"update audits set {cols} where id = %s", (*update.values(), audit_id))
        if insufficient:
            c.execute("insert into audit_log (org_id, who, action, object_type, object_id, detail) values (%s, 'AVA', 'audit.insufficient', 'audits', %s, %s)",
                      (a["org_id"], audit_id, f"No score issued: {update['run_state'].obj['reason']}"))
        if result.get("overrideRejected"):
            c.execute("insert into audit_log (org_id, who, action, object_type, object_id, detail) values (%s, 'AVA', 'audit.override_rejected', 'audits', %s, %s)",
                      (a["org_id"], audit_id, f"Orchestrator override rejected: {result['overrideRejected']}"))
        if update.get("drift_flag"):
            c.execute("insert into audit_log (org_id, who, action, object_type, object_id, detail) values (%s, 'AVA', 'audit.drift', 'audits', %s, %s)",
                      (a["org_id"], audit_id, "Drift flag: score differs from an earlier audit with an identical input snapshot"))

    if a["trigger"] == "shadow":
        from .drift import record_shadow_result
        record_shadow_result(audit_id)
        return
    if st != "failed":
        _alerts(audit_id, a, org, company)
    _notify(audit_id, a, company, st, result)
    _after(a, company, org, st, result)


def _audit_for_rules(c, audit_id: str) -> dict:
    a = c.execute("select * from audits where id = %s", (audit_id,)).fetchone()
    fs = c.execute("select id, agent, category, severity, status, match_key from findings where audit_id = %s", (audit_id,)).fetchall()
    return {"id": a["id"], "companyId": a["company_id"], "status": a["status"], "score": a["score"],
            "baseDirective": a["base_directive"], "finalDirective": a["final_directive"], "overridden": a["overridden"],
            "overrideCited": a["override_cited"], "calibrationVersion": a["calibration_version"],
            "findings": [{"id": f["id"], "agent": f["agent"], "category": f["category"], "severity": f["severity"],
                          "status": f["status"], "matchKey": f["match_key"]} for f in fs]}


def _alerts(audit_id: str, a: dict, org: dict, company: dict) -> None:
    with db.system() as c:
        prev = c.execute("select id from audits where company_id = %s and id <> %s and status in ('complete', 'partial') and trigger <> 'shadow' "
                         "order by date desc, created_at desc limit 1", (a["company_id"], audit_id)).fetchone()
        if not prev:
            return
        nxt = _audit_for_rules(c, audit_id)
        before = _audit_for_rules(c, prev["id"])
        alerts = evaluate_alerts(before, nxt, org["alert_rules"], bool(org["hold_mode"]))
        members = c.execute("select p.email from memberships m join profiles p on p.user_id = m.user_id "
                            "where m.org_id = %s and m.status = 'active'", (a["org_id"],)).fetchall()
        for al in alerts:
            c.execute(
                "insert into alerts (org_id, company_id, audit_id, previous_audit_id, trigger, from_score, to_score, from_directive, to_directive, "
                "caused_by_override, anchoring_finding_ids, finding_id) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (a["org_id"], a["company_id"], audit_id, prev["id"], al["trigger"], al["fromScore"], al["toScore"], al["fromDirective"],
                 al["toDirective"], al["causedByOverride"], al["anchoringFindingIds"], al.get("findingId")))
            if al["trigger"] in ("directive", "high") and org["delivery"].get("immediate", True):
                subject = (f"{company['title']}: directive changed from {al['fromDirective']} to {al['toDirective']}" if al["trigger"] == "directive"
                           else f"{company['title']}: new HIGH finding")
                body = (f"{subject}.\nScore {al['fromScore']} to {al['toScore']}.\n"
                        f"Compare the audits: {settings().app_url}/history/{a['company_id']}?a={prev['id']}&b={audit_id}")
                for m in members:
                    emailer.queue(c, a["org_id"], m["email"], subject, body, "alert-immediate")
        if alerts:
            c.execute("update alerts set emailed_at = now() where audit_id = %s and trigger in ('directive', 'high')", (audit_id,))


def _notify(audit_id: str, a: dict, company: dict, st: str, result: dict) -> None:
    if not a["notify_on_complete"] or not a["created_by"]:
        return
    with db.system() as c:
        p = c.execute("select email from profiles where user_id = %s", (a["created_by"],)).fetchone()
        if not p:
            return
        if st == "failed":
            subject = f"{company['title']}: audit failed"
            body = "The Orchestrator returned no valid output after one retry. No score was issued and the audit does not count against usage."
        else:
            subject = f"{company['title']}: audit {st}, {result['finalDirective']} {result['score']}"
            body = f"Open the report: {settings().app_url}/report/{audit_id}"
        emailer.queue(c, a["org_id"], p["email"], subject, body, "audit-complete")


def _after(a: dict, company: dict, org: dict, st: str, result: dict) -> None:
    from .scheduling import next_run_for
    with db.system() as c:
        c.execute("update companies set next_run = %s where id = %s", (next_run_for(company, org), company["id"]))
        if a["org_id"] == FREE_ORG:
            c.execute("update free_audits set status = %s where audit_id = %s", (st, a["id"]))


def status(audit_id: str) -> dict:
    with db.system() as c:
        a = c.execute("select id, status, score, final_directive from audits where id = %s", (audit_id,)).fetchone()
        runs = c.execute("select agent, status, retry_count, error_reason, duration_s from agent_runs where audit_id = %s order by agent", (audit_id,)).fetchall()
    return {"audit": dict(a) if a else None, "agents": [dict(r) for r in runs]}
