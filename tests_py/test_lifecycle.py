"""Audit lifecycle (spec 4.1) end to end against Postgres, with a scripted model."""

import pytest

from ava_server import db
from ava_server.agents import AgentRunner
from ava_server.config import Settings
from ava_server.lifecycle import advance, create_audit
from tests_py.fakes import DEFAULT, FakeClient, finding


def runner(script=None, fallback="off"):
    cfg = Settings()
    cfg.refusal_fallback = fallback
    return AgentRunner(client=FakeClient(script), cfg=cfg)


def run_to_end(audit_id, r, limit=20):
    for _ in range(limit):
        st = advance(audit_id, r, live_research=False)
        if st["audit"]["status"] in ("complete", "partial", "failed"):
            return st
    raise AssertionError("audit did not finish")


@pytest.fixture()
def company(world):
    with db.system() as c:
        c.execute("delete from sources where id = 'S1'")
        c.execute("insert into sources (id, org_id, company_id, type, title, note) values (%s, %s, %s, 'uploaded', 'Deck', 'Deck text')",
                  ("S1", world["org"], world["company"]))
    return world


def audit_row(audit_id):
    with db.system() as c:
        return c.execute("select * from audits where id = %s", (audit_id,)).fetchone()


def test_complete_run_writes_the_audit_record(company):
    aid = create_audit(company["users"]["Analyst"], company["company"])
    st = run_to_end(aid, runner())
    a = audit_row(aid)
    assert st["audit"]["status"] == "complete"
    assert a["score"] is not None and a["final_directive"] == a["base_directive"]
    assert a["first_checkpoint"] and a["final_checkpoint"] and a["outcome_window_version"] == "ow-1"
    assert a["model_version"] == "claude-sonnet-5-5" and a["prompt_version"] and a["calibration_version"] == "cal-2026.2"
    assert a["snapshot_hash"] and a["input_snapshot"]["company"]["title"]
    assert a["coverage"]["agentsRun"] == 6 and a["coverage"]["sectionsSkipped"] == 1
    assert a["score_excluding_dismissed"] == a["score"]
    with db.system() as c:
        f = c.execute("select sources, dropped_citations, match_key from findings where audit_id = %s and topic = 'runway'", (aid,)).fetchone()
    # A citation to an unregistered source is dropped and flagged (spec 4.2).
    assert f["sources"] == ["S1"] and f["dropped_citations"] == ["bogus"]
    assert f["match_key"] == "1:Financial:runway"


def test_users_without_the_role_cannot_start_audits(company):
    with pytest.raises(Exception):
        create_audit(company["users"]["Viewer"], company["company"])


def test_malformed_output_is_retried_once(company):
    aid = create_audit(company["users"]["Analyst"], company["company"])
    st = run_to_end(aid, runner({2: ["malformed"]}))
    assert st["audit"]["status"] == "complete"
    assert [a["retry_count"] for a in st["agents"] if a["agent"] == 2] == [1]


def test_agent_failing_twice_gives_partial_capped_at_hold(company):
    low = {n: [{"summary": "s", "findings": [finding({1: "fin", 2: "comp", 3: "sat", 4: "dem", 5: "reg"}[n], "Market", "LOW", f"t{n}")], "skipped_sections": []}] for n in (1, 2, 4, 5)}
    aid = create_audit(company["users"]["Analyst"], company["company"])
    st = run_to_end(aid, runner({**low, 3: ["refusal", "malformed"]}))
    a = audit_row(aid)
    assert st["audit"]["status"] == "partial"
    assert a["base_directive"] == "PROCEED" and a["final_directive"] == "HOLD"
    assert a["coverage"]["sectionsNotRun"] == ["sat"]
    assert a["counted_against_usage"] is True


def test_orchestrator_failure_fails_the_audit(company, monkeypatch):
    monkeypatch.setenv("AVA_OPS_EMAIL", "ops@ava.example")
    aid = create_audit(company["users"]["Analyst"], company["company"])
    st = run_to_end(aid, runner({6: ["malformed", "malformed"]}))
    a = audit_row(aid)
    assert st["audit"]["status"] == "failed"
    assert a["score"] is None and a["final_directive"] is None
    assert a["counted_against_usage"] is False
    with db.system() as c:
        ops = c.execute("select subject, body from email_outbox where kind = 'ops' and body like %s", (f"%{aid}%",)).fetchone()
    assert ops and "failed" in ops["subject"] and "agent 6" in ops["body"]


def _override(to):
    def build(kw):
        # Cite the first HIGH finding the Orchestrator was shown.
        text = kw["messages"][0]["content"]
        import json, re
        block = text.split("<findings>")[1].split("</findings>")[0]
        ids = [json.loads(l)["id"] for l in block.strip().splitlines() if '"severity": "HIGH"' in l]
        return {**DEFAULT[6], "override": {"apply": True, "to": to, "finding_ids": ids[:1], "reason": "Understated."}}
    return build


def test_valid_override_moves_one_band_down(company):
    aid = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(aid, runner())
    base = audit_row(aid)["base_directive"]
    order = ["KILL", "PIVOT", "HOLD", "PROCEED"]
    target = order[order.index(base) - 1]
    aid2 = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(aid2, runner({6: [_override(target)]}))
    a = audit_row(aid2)
    assert a["overridden"] is True and a["final_directive"] == target and a["override_cited"]


def test_invalid_override_is_rejected_and_logged(company):
    aid = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(aid, runner({6: [_override("PROCEED")]}))
    a = audit_row(aid)
    assert a["overridden"] is False and a["override_rejected"]
    with db.system() as c:
        assert c.execute("select 1 from audit_log where action = 'audit.override_rejected' and object_id = %s", (aid,)).fetchone()


def test_second_audit_raises_alerts_and_emails(company):
    first = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(first, runner())
    heavy = {n: [{"summary": "s", "findings": [finding(sec, cat, "HIGH", f"new-{n}-{i}") for i, (sec, cat) in enumerate(pairs)], "skipped_sections": []}]
             for n, pairs in {1: [("fin", "Financial"), ("ops", "Operational"), ("fin", "Financial")], 2: [("comp", "Competition"), ("geo", "Geographic")],
                              4: [("dem", "Market"), ("psy", "Customer psychology")], 5: [("reg", "Regulatory")]}.items()}
    second = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(second, runner(heavy))
    with db.system() as c:
        triggers = sorted(r["trigger"] for r in c.execute("select trigger from alerts where audit_id = %s", (second,)).fetchall())
        emails = c.execute("select count(*) as n from email_outbox where kind = 'alert-immediate'").fetchone()["n"]
    assert "score" in triggers and "high" in triggers
    assert emails > 0


def test_drift_flag_on_identical_snapshot_with_different_score(company):
    first = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(first, runner())
    second = create_audit(company["users"]["Analyst"], company["company"])
    run_to_end(second, runner({1: [{"summary": "s", "findings": [], "skipped_sections": []}]}))
    assert audit_row(first)["snapshot_hash"] == audit_row(second)["snapshot_hash"]
    assert audit_row(second)["drift_flag"] is True


def test_agents_run_on_the_audits_recorded_model(company):
    """Each agent call uses the model recorded on the audit, and the refusal
    fallback is only requested where the model supports it."""
    aid = create_audit(company["users"]["Analyst"], company["company"], depth="deep")
    client = FakeClient()
    cfg = Settings()
    cfg.refusal_fallback = "default"
    r = AgentRunner(client=client, cfg=cfg)
    run_to_end(aid, r)
    assert {c["model"] for c in client.calls} == {"claude-opus-5-5"}
    assert all(c.get("fallbacks") == "default" for c in client.calls)
    std = create_audit(company["users"]["Analyst"], company["company"])
    client2 = FakeClient()
    run_to_end(std, AgentRunner(client=client2, cfg=cfg))
    assert {c["model"] for c in client2.calls} == {"claude-sonnet-5-5"}
    assert not any("fallbacks" in c for c in client2.calls)
