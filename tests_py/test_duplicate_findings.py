"""Phase 2: repeating a risk must not pile up. Under the proposed decay
calibration (cal-2026.3), findings on a topic the audit already covers count
once, so extra wording of the same issue barely moves the score. The live
additive calibration (cal-2026.2) is shown for contrast."""

from ava_server.config import CALIBRATIONS
from ava_server.engine import score_audit

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
