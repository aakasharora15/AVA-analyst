"""Re-score audits under the live and the proposed calibration, side by side.

No model calls: scoring is pure code over findings already produced.

  python scripts/compare_formulas.py [audit.json ...]

Each audit.json is either a shared-report payload (POST /api/shared/<token>)
or {"type": ..., "findings": [...]} as exported by the SQL in
supabase/checks/export_findings.sql. With no arguments it re-scores the
demo audits only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ava_server.config import CALIBRATIONS  # noqa: E402
from ava_server.engine import score_audit  # noqa: E402

OLD, NEW = CALIBRATIONS["cal-2026.2"], CALIBRATIONS["cal-2026.3"]


def score(findings, vtype, cal, status="complete"):
    r = score_audit(findings, vtype, status, None, cal)
    return r["score"], r["finalDirective"], r["exposure"]


def norm(f):
    return {"id": f["id"], "agent": f.get("agent"), "category": f["category"], "severity": f["severity"],
            "status": f.get("status", "open"), "matchKey": f.get("matchKey") or f.get("match_key")}


def load(path):
    d = json.loads(Path(path).read_text())
    if "audit" in d:  # shared-report payload
        return {"name": d["company"]["title"][:48], "type": d["company"].get("type") or "startup", "status": d["audit"]["status"],
                "stored": d["audit"]["score"], "findings": [norm(f) for f in d["findings"]]}
    return {"name": d.get("name", Path(path).stem), "type": d.get("type", "startup"), "status": d.get("status", "complete"),
            "stored": d.get("score"), "findings": [norm(f) for f in d["findings"]]}


def variants(a):
    """The same venture written up with more or fewer findings."""
    fs = [dict(f, matchKey=f["matchKey"] or f"{f['agent']}:{f['category']}:{f['id']}") for f in a["findings"]]
    drop_low = [f for f in fs if f["severity"] != "LOW"]
    every_other = fs[::2]
    # Wordier: every MEDIUM restated once more by another agent, same topic.
    restated = fs + [dict(f, id=f["id"] + "-again", agent=(f["agent"] % 5) + 1) for f in fs if f["severity"] == "MEDIUM"]
    # Padded: 10 extra generic MEDIUM findings on new topics across categories.
    cats = ["Market", "Financial", "Operational", "Competition", "Customer psychology"]
    padded = fs + [{"id": f"pad{i}", "agent": 1, "category": cats[i % 5], "severity": "MEDIUM", "status": "open",
                    "matchKey": f"1:{cats[i % 5]}:padding-{i}"} for i in range(10)]
    return [("As produced", fs), ("Terser: LOW findings omitted", drop_low), ("Terser: half the findings", every_other),
            ("Wordier: each MEDIUM restated once", restated), ("Padded: 10 extra generic MEDIUMs", padded)]


def main(paths):
    real = [load(p) for p in paths]
    print("# Live formula (cal-2026.2) vs proposed (cal-2026.3)\n")
    for a in real:
        old = score(a["findings"], a["type"], OLD, a["status"])
        new = score(a["findings"], a["type"], NEW, a["status"])
        print(f"## {a['name']}\n")
        print(f"Stored score {a['stored']}. Findings: {len(a['findings'])}.\n")
        print("| Category | Live exposure | Proposed exposure |\n|---|---|---|")
        for c in old[2]:
            print(f"| {c} | {old[2][c]} | {new[2][c]} |")
        print("\n| Version of the same audit | Findings | Live score | Proposed score |\n|---|---|---|---|")
        for label, fs in variants(a):
            o, n = score(fs, a["type"], OLD, a["status"]), score(fs, a["type"], NEW, a["status"])
            print(f"| {label} | {len(fs)} | {o[0]} {o[1]} | {n[0]} {n[1]} |")
        print()
    demo = json.loads((ROOT / "src/data/mock/audits.json").read_text())
    types = {c["id"]: c["type"] for c in json.loads((ROOT / "src/data/mock/companies.json").read_text())}
    rows = []
    for a in demo:
        if a["status"] == "failed":
            continue
        fs = [norm(f) for f in a["findings"]]
        o, n = score(fs, types[a["companyId"]], OLD, a["status"]), score(fs, types[a["companyId"]], NEW, a["status"])
        rows.append((a["id"], len(fs), o, n))
    print("## Demo audits (synthetic sample findings, not real model output)\n")
    print("| Audit | Findings | Live | Proposed |\n|---|---|---|---|")
    for rid, n_f, o, n in rows:
        print(f"| {rid} | {n_f} | {o[0]} {o[1]} | {n[0]} {n[1]} |")
    same = sum(1 for _, _, o, n in rows if o[1] == n[1])
    print(f"\nSame directive under both: {same} of {len(rows)}.")


if __name__ == "__main__":
    main(sys.argv[1:])
