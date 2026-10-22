"""Compare, alert and outcome rules. Python port of src/engine/{compare,alerts,outcomes}.js."""

from __future__ import annotations

import calendar
from datetime import date

from .config import ALERT_RULES, CALIBRATION, CATEGORIES, OUTCOME_WINDOW
from .engine import band_lower_edge, directive_rank

SEV_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}

# --- Compare (spec 4.3) -----------------------------------------------------


def match_key(f: dict) -> str:
    return f.get("matchKey") or f"{f['agent']}:{f['category']}:{f.get('topic') or f['id']}"


def match_findings(before: list[dict], after: list[dict]) -> dict:
    prev = {match_key(f): f for f in before}
    nxt = {match_key(f): f for f in after}
    added, unchanged = [], []
    for key, f in nxt.items():
        p = prev.get(key)
        if not p:
            added.append(f)
            continue
        move = SEV_RANK[f["severity"]] - SEV_RANK[p["severity"]]
        unchanged.append({"before": p, "after": f, "severityMove": "up" if move > 0 else "down" if move < 0 else "same"})
    resolved = [f for key, f in prev.items() if key not in nxt]
    return {"added": added, "resolved": resolved, "unchanged": unchanged}


def category_movement(before: dict, after: dict) -> list[dict]:
    return [{"category": c, "before": before[c], "after": after[c], "delta": after[c] - before[c]} for c in CATEGORIES]


def previously_dismissed(current: list[dict], earlier_audits: list[dict]) -> dict:
    dismissed = {}
    for audit in earlier_audits:
        for f in audit.get("findings") or []:
            if f.get("status") == "dismissed":
                dismissed[match_key(f)] = f
    flags = {}
    for f in current:
        hit = dismissed.get(match_key(f))
        if hit and f.get("status") != "dismissed":
            flags[f["id"]] = {"reason": hit.get("dismissReason"), "auditId": hit.get("auditId")}
    return flags


# --- Alerts (spec 4.0, 4.7) -------------------------------------------------


def crosses_band_edge(prev: dict, nxt: dict, cal: dict = CALIBRATION, margin: int = ALERT_RULES["bandCrossMargin"]) -> bool:
    if prev["finalDirective"] == nxt["finalDirective"]:
        return False
    down = directive_rank(nxt["baseDirective"]) < directive_rank(prev["baseDirective"])
    if down:
        return band_lower_edge(prev["baseDirective"], cal) - nxt["score"] >= margin
    return nxt["score"] - band_lower_edge(nxt["baseDirective"], cal) >= margin


def override_anchors(prev: dict, nxt: dict) -> list[str]:
    """Cited HIGH findings that are new, or unchanged (already HIGH) since the last audit."""
    prev_by_key = {match_key(f): f for f in prev.get("findings") or []}
    out = []
    for fid in nxt.get("overrideCited") or []:
        f = next((x for x in nxt["findings"] if x["id"] == fid), None)
        if not f or f["severity"] != "HIGH":
            continue
        before = prev_by_key.get(match_key(f))
        if not before or before["severity"] == "HIGH":
            out.append(fid)
    return out


def evaluate_alerts(prev: dict, nxt: dict, rules: dict | None = None, hold_mode: bool = False) -> list[dict]:
    rules = rules or {"directive": True, "score": True, "high": True}
    alerts: list[dict] = []
    if not prev or not nxt or nxt.get("status") == "failed" or nxt.get("score") is None:
        return alerts
    same_cal = prev.get("calibrationVersion") == nxt.get("calibrationVersion")
    base = {"companyId": nxt.get("companyId"), "auditId": nxt.get("id"), "previousAuditId": prev.get("id"),
            "fromScore": prev["score"], "toScore": nxt["score"],
            "fromDirective": prev["finalDirective"], "toDirective": nxt["finalDirective"]}

    if rules.get("directive") and same_cal and not hold_mode and prev["finalDirective"] != nxt["finalDirective"]:
        by_override = bool(nxt.get("overridden")) and nxt["baseDirective"] == prev["finalDirective"]
        if by_override:
            anchors = override_anchors(prev, nxt)
            if anchors:
                alerts.append({**base, "trigger": "directive", "causedByOverride": True, "anchoringFindingIds": anchors})
        elif crosses_band_edge(prev, nxt):
            alerts.append({**base, "trigger": "directive", "causedByOverride": False, "anchoringFindingIds": []})

    if rules.get("score") and same_cal and abs(nxt["score"] - prev["score"]) >= ALERT_RULES["scoreMove"]:
        alerts.append({**base, "trigger": "score", "causedByOverride": False, "anchoringFindingIds": []})

    if rules.get("high"):
        m = match_findings(prev.get("findings") or [], nxt.get("findings") or [])
        new_high = [f for f in m["added"] if f["severity"] == "HIGH"]
        new_high += [u["after"] for u in m["unchanged"] if u["after"]["severity"] == "HIGH" and u["before"]["severity"] != "HIGH"]
        for f in new_high:
            alerts.append({**base, "trigger": "high", "findingId": f["id"], "causedByOverride": False, "anchoringFindingIds": []})
    return alerts


# --- Outcomes (spec 4.16) ---------------------------------------------------

OUTCOMES = {
    "grew": {"label": "Grew"},
    "flat": {"label": "Stayed flat"},
    "changed": {"label": "Changed direction"},
    "exited": {"label": "Exited", "terminal": True},
    "writtenDown": {"label": "Written down or distressed sale", "terminal": True},
    "shutDown": {"label": "Shut down", "terminal": True},
}

AGREES_WITH = {
    "PROCEED": ["grew", "exited"],
    "HOLD": ["flat"],
    "PIVOT": ["changed"],
    "KILL": ["shutDown", "writtenDown"],
}


def add_months(iso: str, months: int) -> str:
    d = date.fromisoformat(iso)
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day).isoformat()


def checkpoints(audit_date: str, window: dict = OUTCOME_WINDOW) -> dict:
    return {
        "outcomeWindowVersion": window["version"],
        "firstCheckpoint": add_months(audit_date, window["firstMonths"]),
        "finalCheckpoint": add_months(audit_date, window["finalMonths"]),
    }


def outcome_status(audit: dict, outcome: dict | None, today: str) -> str:
    agrees = bool(outcome) and outcome["result"] in AGREES_WITH.get(audit["finalDirective"], [])
    terminal = bool(outcome) and OUTCOMES.get(outcome["result"], {}).get("terminal", False)
    if terminal:
        return "agrees" if agrees else "disagrees"
    if today < audit["firstCheckpoint"]:
        return "too-early"
    if not outcome:
        return "awaiting"
    if today >= audit["finalCheckpoint"]:
        return "agrees" if agrees else "disagrees"
    return "agrees" if agrees else "not-yet-resolved"


def agreement_rate(statuses: list[str]) -> dict:
    agreed = sum(1 for s in statuses if s == "agrees")
    counted = sum(1 for s in statuses if s in ("agrees", "disagrees"))
    return {"agreed": agreed, "counted": counted, "rate": (agreed / counted) if counted else None}
