"""Phase 2: repeating a risk must not pile up. Under the proposed decay
calibration (cal-2026.3), findings on a topic the audit already covers count
once, so extra wording of the same issue barely moves the score. The live
additive calibration (cal-2026.2) is shown for contrast."""

from ava_server.config import CALIBRATIONS
from ava_server.engine import score_audit
from tests_py.test_api import api  # noqa: F401 - fixture

DECAY = CALIBRATIONS["cal-2026.3"]
ADDITIVE = CALIBRATIONS["cal-2026.2"]


def f(i, category, severity, topic):
    return {"id": f"f{i}", "category": category, "severity": severity, "matchKey": f"{category.lower()}:{topic}"}


BASE = [
    f(1, "Financial", "HIGH", "runway"),
    f(2, "Financial", "MEDIUM", "unit-economics"),
    f(3, "Competition", "HIGH", "funded-entrant"),
    f(4, "Market", "MEDIUM", "small-niche"),
    f(5, "Operational", "LOW", "single-depot"),
    f(6, "Regulatory", "LOW", "licence"),
]

# The same three issues, said again by other agents in other words.
REPEATS = [
    f(7, "Financial", "HIGH", "runway"),
    f(8, "Financial", "MEDIUM", "runway"),
    f(9, "Competition", "MEDIUM", "funded-entrant"),
    f(10, "Market", "LOW", "small-niche"),
]


def score(findings, cal):
    return score_audit(findings, "startup", cal=cal)["score"]


def test_repeating_existing_topics_barely_moves_the_decay_score():
    before, after = score(BASE, DECAY), score(BASE + REPEATS, DECAY)
    assert abs(after - before) <= 2, (before, after)


def test_repeats_change_nothing_when_no_more_severe_than_the_original():
    assert score(BASE + REPEATS, DECAY) == score(BASE, DECAY)


def test_a_new_topic_still_counts():
    new = [f(11, "Financial", "HIGH", "customer-concentration")]
    assert score(BASE + new, DECAY) < score(BASE, DECAY) - 2


def test_the_live_additive_formula_is_moved_by_repeats():
    # Why Phase 2 exists: the same issues said twice lower the live score materially.
    assert score(BASE, ADDITIVE) - score(BASE + REPEATS, ADDITIVE) > 2


def test_a_repeat_run_sees_the_public_sources_the_original_found(api):  # noqa: F811
    from ava_server import db, drift
    from tests_py.test_api import as_, finish
    client, w = api
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), aid)
    with db.system() as c:
        sid = c.execute("insert into sources (org_id, company_id, audit_id, type, title, note) values (%s, %s, %s, 'public', 'Found', 'x') returning id",
                        (w["org"], w["company"], aid)).fetchone()["id"]
    shadow = drift.create_shadow(aid, "recalibration")
    with db.system() as c:
        assert sid in c.execute("select source_ids from audits where id = %s", (shadow,)).fetchone()["source_ids"]


def test_repeat_sql_queues_repeats_that_finish_and_report(api):  # noqa: F811
    from pathlib import Path

    from ava_server import db, lifecycle
    from tests_py.test_api import as_, finish
    client, w = api
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), aid)
    root = Path(__file__).resolve().parent.parent / "supabase" / "checks"
    start = (root / "repeat_start.sql").read_text().replace("'AVA Verdict%'", "'%'").replace("1 as repeats", "2 as repeats")
    with db.system() as c:
        c.execute(start)
        ids = [r["id"] for r in c.execute("select id from audits where trigger = 'shadow' and run_state ->> 'shadowOf' = %s", (aid,)).fetchall()]
    assert len(ids) == 2
    for sid in ids:
        for _ in range(20):
            if lifecycle.advance(sid)["audit"]["status"] in ("complete", "partial", "failed"):
                break
    with db.system() as c:
        rows = c.execute((root / "repeat_results.sql").read_text()).fetchall()
    assert [r["run"] for r in rows if r["status"] == "complete"].count("repeat") == 2
    assert any(r["run"] == "original" for r in rows)
