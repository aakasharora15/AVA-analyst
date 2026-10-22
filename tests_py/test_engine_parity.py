"""The Python engine must give exactly the JS engine's results."""

import json
import subprocess
from pathlib import Path

import pytest

from ava_server.config import CALIBRATIONS
from ava_server.engine import score_audit, score_excluding_dismissed, individual_effects
from ava_server.rules import evaluate_alerts, outcome_status, checkpoints

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def fixtures():
    out = subprocess.run(["node", "scripts/export-engine-fixtures.mjs"], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _norm(v):
    # JSON round-trip so floats and dict ordering compare like the JS output.
    return json.loads(json.dumps(v))


def test_score_cases(fixtures):
    assert len(fixtures["scoreCases"]) > 20
    for c in fixtures["scoreCases"]:
        cal = CALIBRATIONS[c["calibration"]]
        got = score_audit(c["findings"], c["type"], c["status"], c.get("override"), cal)
        exp = c["expect"]["score"]
        for key in ("score", "raw", "cap", "exposure", "baseDirective", "finalDirective", "overridden",
                    "overrideCited", "overrideRejected", "partialCapped", "failed"):
            if key in exp or key in got:
                assert _norm(got.get(key)) == _norm(exp.get(key)), (c["name"], key)
        if c["expect"]["excluding"] is not None:
            assert _norm(score_excluding_dismissed(c["findings"], c["type"], cal)) == _norm(c["expect"]["excluding"]), c["name"]
            assert _norm(individual_effects(c["findings"], c["type"], cal)) == _norm(c["expect"]["effects"]), c["name"]


def test_alert_cases(fixtures):
    audits = {a["id"]: a for a in json.loads((ROOT / "src/data/mock/audits.json").read_text())}
    assert fixtures["alertCases"]
    for c in fixtures["alertCases"]:
        got = evaluate_alerts(audits[c["prev"]], audits[c["next"]], hold_mode=c["hold"])
        assert _norm(got) == _norm(c["expect"]), (c["prev"], c["next"], c["hold"])


def test_outcome_cases(fixtures):
    for c in fixtures["outcomeCases"]:
        if c["kind"] == "checkpoints":
            assert checkpoints(c["date"]) == c["expect"]
        else:
            assert outcome_status(c["audit"], c["outcome"], c["today"]) == c["expect"]
