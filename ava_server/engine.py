"""Scoring engine (spec 4.0), Python port of src/engine/score.js.

Pure functions. Must give identical results to the JS engine; the parity
test in tests_py/test_engine_parity.py runs both on the same fixtures.
"""

from __future__ import annotations

import math
from typing import Iterable

from .config import CALIBRATION, CATEGORIES, DIRECTIVES


def js_round(x: float) -> int:
    """Math.round semantics: halves round towards +infinity."""
    return int(math.floor(x + 0.5))


def snap(x: float) -> float:
    """Snap to 6 decimals so float noise can never decide a .5 rounding tie."""
    return js_round(x * 1e6) / 1e6


def _topic(f: dict) -> str:
    """The topic a finding is about, for merging repeats: the last part of its match key."""
    k = f.get("matchKey") or ""
    return k.rsplit(":", 1)[1] if ":" in k else (k or f.get("id"))


def _decay_exposure(findings: Iterable[dict], cal: dict) -> dict:
    """Each category is driven by its most severe distinct risks: findings on
    the same topic count once, at their highest severity; the worst counts in
    full and each further one half as much as the last."""
    by_category: dict[str, dict] = {c: {} for c in CATEGORIES}
    for f in findings:
        if f.get("category") not in by_category:
            continue
        w = cal["severityWeights"].get(f.get("severity"), 0)
        topics = by_category[f["category"]]
        t = _topic(f)
        if t not in topics or topics[t] < w:
            topics[t] = w
    exposure = {}
    for c in CATEGORIES:
        ws = sorted(by_category[c].values(), reverse=True)
        total = 0.0
        for i, w in enumerate(ws):  # same order and accumulation as the JS reduce
            total += w * cal["decay"] ** i
        exposure[c] = min(100, js_round(snap(total)))
    return exposure


def category_exposure(findings: Iterable[dict], cal: dict = CALIBRATION) -> dict:
    if cal.get("method") == "decay":
        return _decay_exposure(findings, cal)
    exposure = {c: 0 for c in CATEGORIES}
    for f in findings:
        if f.get("category") in exposure:
            exposure[f["category"]] += cal["severityWeights"].get(f.get("severity"), 0)
    return {c: min(100, v) for c, v in exposure.items()}


def resilience_score(exposure: dict, venture_type: str = "startup", cal: dict = CALIBRATION) -> dict:
    weights = cal["categoryWeights"].get(venture_type) or cal["categoryWeights"]["startup"]
    weighted = 0.0
    for c in CATEGORIES:  # same order and accumulation as the JS reduce
        weighted += weights[c] * exposure[c]
    weighted = snap(weighted)
    raw = js_round(100 - weighted)
    over = [c for c in CATEGORIES if exposure[c] > cal["cap"]["threshold"]]
    over.sort(key=lambda c: -exposure[c])
    cap = None
    if over and raw > cal["cap"]["maxScore"]:
        worst = over[0]
        cap = {"category": worst, "exposure": exposure[worst], "limit": cal["cap"]["maxScore"]}
    return {"weighted": weighted, "raw": raw, "cap": cap, "score": cap["limit"] if cap else raw}


def directive_for_score(score: int, cal: dict = CALIBRATION) -> str:
    b = cal["bands"]
    if score >= b["PROCEED"]:
        return "PROCEED"
    if score >= b["HOLD"]:
        return "HOLD"
    if score >= b["PIVOT"]:
        return "PIVOT"
    return "KILL"


def directive_rank(d: str) -> int:
    return DIRECTIVES.index(d) if d in DIRECTIVES else -1


def band_lower_edge(d: str, cal: dict = CALIBRATION) -> int:
    return cal["bands"][d]


def validate_override(base: str, override: dict | None, finding_ids: list[str]) -> dict:
    """Valid only when it moves exactly one band down and cites real findings."""
    if not override or not override.get("to"):
        return {"valid": False, "reason": None}
    frm = directive_rank(base)
    to = directive_rank(override["to"])
    if to < 0:
        return {"valid": False, "reason": "Unknown directive"}
    if to > frm:
        return {"valid": False, "reason": "Override moves the directive up"}
    if to == frm:
        return {"valid": False, "reason": "Override does not change the directive"}
    if frm - to > 1:
        return {"valid": False, "reason": "Override moves more than one band"}
    cited = [i for i in (override.get("findingIds") or []) if i in finding_ids]
    if not cited:
        return {"valid": False, "reason": "Override cites no valid finding ids"}
    return {"valid": True, "reason": None, "cited": cited}


def apply_partial_cap(directive: str, partial: bool) -> str:
    """A Partial audit is capped at HOLD; the cap never raises a lower directive."""
    if not partial:
        return directive
    return "HOLD" if directive_rank(directive) > directive_rank("HOLD") else directive


def score_audit(findings: list[dict], venture_type: str = "startup", status: str = "complete",
                override: dict | None = None, cal: dict = CALIBRATION) -> dict:
    """score -> base directive -> valid override -> Partial cap -> final directive."""
    if status == "failed":
        return {"failed": True, "exposure": None, "score": None, "baseDirective": None, "finalDirective": None}
    exposure = category_exposure(findings, cal)
    res = resilience_score(exposure, venture_type, cal)
    base = directive_for_score(res["score"], cal)
    check = validate_override(base, override, [f["id"] for f in findings])
    after_override = override["to"] if check["valid"] else base
    partial = status == "partial"
    final = apply_partial_cap(after_override, partial)
    return {
        "failed": False,
        "calibrationVersion": cal["version"],
        "exposure": exposure,
        "weighted": res["weighted"],
        "raw": res["raw"],
        "cap": res["cap"],
        "score": res["score"],
        "baseDirective": base,
        "overridden": check["valid"],
        "overrideCited": check.get("cited", []) if check["valid"] else [],
        "overrideRejected": check["reason"] if (override and not check["valid"]) else None,
        "partialCapped": partial and final != after_override,
        "finalDirective": final,
    }


def score_excluding_dismissed(findings: list[dict], venture_type: str, cal: dict = CALIBRATION) -> dict:
    kept = [f for f in findings if f.get("status") != "dismissed"]
    score = resilience_score(category_exposure(kept, cal), venture_type, cal)["score"]
    return {"score": score, "dismissed": len(findings) - len(kept), "directive": directive_for_score(score, cal)}


def individual_effects(findings: list[dict], venture_type: str, cal: dict = CALIBRATION) -> list[dict]:
    """Each open finding's effect on the score on its own. Not additive."""
    base = resilience_score(category_exposure(findings, cal), venture_type, cal)["score"]
    base_dir = directive_for_score(base, cal)
    out = []
    for f in findings:
        if f.get("status") in ("resolved", "dismissed"):
            continue
        without = [x for x in findings if x["id"] != f["id"]]
        score = resilience_score(category_exposure(without, cal), venture_type, cal)["score"]
        d = directive_for_score(score, cal)
        out.append({"findingId": f["id"], "score": score, "effect": score - base, "directive": d,
                    "movesUpBand": directive_rank(d) > directive_rank(base_dir)})
    out.sort(key=lambda e: -e["effect"])  # stable, like Array.prototype.sort
    return out
