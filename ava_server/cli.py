"""Operator commands. Run with DATABASE_URL and ANTHROPIC_API_KEY set:

    python -m ava_server.cli calibrate --audits ID [ID ...] --runs 5 --venture-set pilot-2026
    python -m ava_server.cli drift-report
    python -m ava_server.cli lift-hold --reason "..." --by "Name" --second-reviewer "Name" [--rescore ID ...]
    python -m ava_server.cli send-email

`calibrate` is the calibration harness (prompt 0b): it re-runs each audit's
frozen input snapshot several times under the current model, prompts and
calibration, then reports run-to-run variance and directive flips against the
threshold in config/engine.json. Shadow runs never change the originals.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys

from . import db, drift, emailer, lifecycle
from .config import CALIBRATION, DRIFT, settings


def calibrate(audit_ids: list[str], runs: int, venture_set: str) -> dict:
    report = []
    for aid in audit_ids:
        shadows = [drift.create_shadow(aid, "recalibration") for _ in range(runs)]
        for sid in shadows:
            for _ in range(40):
                if lifecycle.advance(sid)["audit"]["status"] in ("complete", "partial", "failed"):
                    break
        with db.system() as c:
            o = c.execute("select a.snapshot_hash, a.final_directive, c.type from audits a join companies c on c.id = a.company_id where a.id = %s",
                          (aid,)).fetchone()
            rows = c.execute("select score, final_directive from audits where id = any(%s)", (shadows,)).fetchall()
            scores = [r["score"] for r in rows if r["score"] is not None]
            spread = (max(scores) - min(scores)) if scores else None
            flips = sum(1 for r in rows if r["final_directive"] != o["final_directive"]) / len(rows) if rows else None
            c.execute("insert into calibration_runs (venture_type, venture_set, frozen_source_set, prompt_version, calibration_version, scores, variance, flip_rate) "
                      "values (%s, %s, %s, %s, %s, %s, %s, %s)",
                      (o["type"], venture_set, o["snapshot_hash"], settings().prompt_version, CALIBRATION["version"], db.jsonb(scores), spread, flips))
        report.append({"audit": aid, "scores": scores, "spread": spread, "median": statistics.median(scores) if scores else None,
                       "flipRate": flips, "pass": spread is not None and spread <= DRIFT["maxRunVariance"]})
    return {"maxRunVariance": DRIFT["maxRunVariance"], "results": report, "pass": all(r["pass"] for r in report)}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ava")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("calibrate")
    c.add_argument("--audits", nargs="+", required=True)
    c.add_argument("--runs", type=int, default=5)
    c.add_argument("--venture-set", default="pilot")
    sub.add_parser("drift-report")
    lh = sub.add_parser("lift-hold")
    lh.add_argument("--reason", required=True)
    lh.add_argument("--by", required=True)
    lh.add_argument("--second-reviewer", required=True)
    lh.add_argument("--rescore", nargs="*", default=[])
    sub.add_parser("send-email")
    a = p.parse_args(argv)
    if a.cmd == "calibrate":
        out = calibrate(a.audits, a.runs, a.venture_set)
    elif a.cmd == "drift-report":
        out = drift.drift_report()
    elif a.cmd == "lift-hold":
        drift.lift_hold(a.reason, a.by, a.second_reviewer, {x: "re-scored" for x in a.rescore})
        out = {"ok": True}
    else:
        out = emailer.send_pending()
    print(json.dumps(out, indent=2, default=str))
    return 0 if not isinstance(out, dict) or out.get("pass", True) else 1


if __name__ == "__main__":
    sys.exit(main())
