"""Drift monitoring, re-scoring and hold mode (spec 4.0, prompt 0c).

* Monthly shadow sample: re-run a fixed-size sample of past audits on their
  stored snapshots, within the current calibration version. Shadow results
  never change the original audit.
* Drift report: median absolute score change and directive flip rate, at
  level normal, warning (median above 3 or flips above baseline) or hold
  (median above 6). [CALIBRATE]
* Hold mode starts automatically at hold. Lifting it is manual, needs a
  written reason and a second reviewer, and is logged.
"""

from __future__ import annotations

import statistics
from datetime import date

from . import db, emailer
from .config import AGENTS, CALIBRATION, DRIFT, model_for, settings


def create_shadow(original_id: str, purpose: str) -> str:
    s = settings()
    with db.system() as c:
        o = c.execute("select * from audits where id = %s", (original_id,)).fetchone()
        # The frozen evidence is what the original saw: its snapshot sources plus
        # the public sources its agents found during the run.
        found = [r["id"] for r in c.execute("select id from sources where audit_id = %s order by created_at", (original_id,)).fetchall()]
        source_ids = list(dict.fromkeys([*(o["source_ids"] or []), *found]))
        sid = c.execute(
            "insert into audits (org_id, company_id, trigger, depth, status, input_snapshot, snapshot_hash, source_ids, model_version, prompt_version, "
            "calibration_version, run_state) values (%s, %s, 'shadow', %s, 'queued', %s, %s, %s, %s, %s, %s, %s) returning id",
            (o["org_id"], o["company_id"], o["depth"], db.jsonb(o["input_snapshot"]), o["snapshot_hash"], source_ids, model_for(o["depth"], s), s.prompt_version,
             CALIBRATION["version"], db.jsonb({"shadowOf": original_id, "purpose": purpose}))).fetchone()["id"]
        for a in AGENTS:
            c.execute("insert into agent_runs (audit_id, org_id, agent) values (%s, %s, %s)", (sid, o["org_id"], a["n"]))
    return sid


def start_monthly_sample(size: int | None = None) -> list[str]:
    size = size or DRIFT["shadowSampleSize"]
    with db.system() as c:
        picks = c.execute(
            "select id from audits where status in ('complete', 'partial') and trigger <> 'shadow' and calibration_version = %s "
            "and input_snapshot is not null order by random() limit %s", (CALIBRATION["version"], size)).fetchall()
    return [create_shadow(p["id"], "monthly") for p in picks]


def request_rescore(original_id: str) -> str:
    """'Re-score on current version' from a compare (spec 4.3)."""
    return create_shadow(original_id, "re-score")


def record_shadow_result(shadow_id: str) -> None:
    with db.system() as c:
        sh = c.execute("select * from audits where id = %s", (shadow_id,)).fetchone()
        o = c.execute("select * from audits where id = %s", (sh["run_state"]["shadowOf"],)).fetchone()
        change = None if sh["score"] is None or o["score"] is None else sh["score"] - o["score"]
        c.execute(
            "insert into shadow_runs (original_audit, snapshot_hash, model_version, prompt_version, calibration_version, purpose, original_score, "
            "shadow_score, score_change, original_directive, shadow_directive, flipped) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (o["id"], o["snapshot_hash"], sh["model_version"], sh["prompt_version"], sh["calibration_version"], sh["run_state"]["purpose"],
             o["score"], sh["score"], change, o["final_directive"], sh["final_directive"], o["final_directive"] != sh["final_directive"]))


def drift_report(period: str | None = None, baseline_flip_rate: float = 0.1) -> dict | None:
    """Summarise this month's monthly shadow runs once none are still running."""
    period = period or date.today().strftime("%Y-%m")
    with db.system() as c:
        running = c.execute("select 1 from audits where trigger = 'shadow' and status in ('queued', 'running') "
                            "and run_state ->> 'purpose' = 'monthly'").fetchone()
        if running:
            return None
        if c.execute("select 1 from drift_reports where period = %s", (period,)).fetchone():
            return None
        rows = c.execute("select score_change, flipped from shadow_runs where purpose = 'monthly' and to_char(run_date, 'YYYY-MM') = %s "
                         "and score_change is not null", (period,)).fetchall()
        if not rows:
            return None
        median = statistics.median(abs(r["score_change"]) for r in rows)
        flips = sum(1 for r in rows if r["flipped"]) / len(rows)
        level = "hold" if median > DRIFT["holdMedianChange"] else "warning" if (median > DRIFT["warningMedianChange"] or flips > baseline_flip_rate) else "normal"
        rid = c.execute("insert into drift_reports (period, sample_size, median_change, flip_rate, level) values (%s, %s, %s, %s, %s) returning id",
                        (period, len(rows), median, flips, level)).fetchone()["id"]
        owner = settings_owner_email()
        if level in ("warning", "hold") and owner:
            emailer.queue(c, None, owner, f"AVA drift {level}: median change {median}, flip rate {flips:.0%}",
                          f"Drift report {period}: {len(rows)} shadow runs, median score change {median}, flip rate {flips:.0%}. Level: {level}.", "drift")
    if level == "hold":
        start_hold(rid)
    return {"id": rid, "level": level, "median": median, "flipRate": flips, "sample": len(rows)}


def settings_owner_email() -> str:
    import os
    return os.environ.get("AVA_DRIFT_OWNER_EMAIL", "")


def _owners_admins(c) -> list[dict]:
    return c.execute("select distinct p.email, m.org_id from memberships m join profiles p on p.user_id = m.user_id "
                     "where m.role in ('Owner', 'Admin') and m.status = 'active'").fetchall()


def start_hold(report_id: str) -> None:
    """Automatic, never discretionary. New audits are marked Under review and
    directive-change alerts pause while it is on."""
    with db.system() as c:
        if c.execute("select 1 from hold_events where lifted_at is null").fetchone():
            return
        c.execute("insert into hold_events (trigger_report) values (%s)", (report_id,))
        c.execute("update organisations set hold_mode = true")
        for r in _owners_admins(c):
            emailer.queue(c, r["org_id"], r["email"], "AVA verdicts are under review",
                          "This verdict is under review after a change in scoring consistency. Do not act on it until the review is complete. "
                          "New audits will carry an Under review label until the hold is lifted.", "hold-start")
        c.execute("insert into audit_log (org_id, who, action, object_type, detail) values (null, 'AVA', 'hold.start', 'hold_events', 'Hold mode started by drift report')")


def lift_hold(reason: str, lifted_by: str, second_reviewer: str, resolutions: dict[str, str] | None = None) -> None:
    """Manual: written reason, second reviewer with no sales role, logged. Each
    affected audit is confirmed or re-scored."""
    if not reason.strip() or not second_reviewer.strip() or second_reviewer.strip() == lifted_by.strip():
        raise ValueError("Lifting a hold needs a written reason and a different second reviewer")
    with db.system() as c:
        ev = c.execute("select * from hold_events where lifted_at is null order by started_at desc limit 1").fetchone()
        if not ev:
            raise ValueError("No hold is active")
        affected = c.execute("select id from audits where under_review and trigger <> 'shadow'").fetchall()
        out = []
        for a in affected:
            res = (resolutions or {}).get(a["id"], "confirmed")
            if res == "re-scored":
                create_shadow(a["id"], "re-score")
            c.execute("update audits set under_review = false, hold_resolution = %s where id = %s", (res, a["id"]))
            out.append({"audit": a["id"], "resolution": res})
        c.execute("update hold_events set lifted_at = now(), lift_reason = %s, lifted_by = %s, second_reviewer = %s, affected_audits = %s where id = %s",
                  (reason, lifted_by, second_reviewer, db.jsonb(out), ev["id"]))
        c.execute("update organisations set hold_mode = false")
        for r in _owners_admins(c):
            emailer.queue(c, r["org_id"], r["email"], "AVA review complete", f"The scoring review is complete. {reason}", "hold-end")
        c.execute("insert into audit_log (org_id, who, action, object_type, detail) values (null, %s, 'hold.lift', 'hold_events', %s)",
                  (lifted_by, f"Hold lifted. Reason: {reason}. Second reviewer: {second_reviewer}."))
