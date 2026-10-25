"""Talking back to a report: challenges to findings and Ask AVA. Neither
changes the issued score; questions are grounded in the report and limited
per plan."""

import json
from types import SimpleNamespace

from ava_server import ask, db
from tests_py.test_api import api, as_, finish  # noqa: F401 - fixture


def _audit(client, w):
    r = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()
    finish(client, as_(w, "Analyst"), r["auditId"])
    with db.system() as c:
        f = c.execute("select id from findings where audit_id = %s order by position limit 1", (r["auditId"],)).fetchone()["id"]
    return r["auditId"], f


def test_challenge_is_recorded_answered_by_someone_else_and_never_moves_the_score(api):
    client, w = api
    audit, f = _audit(client, w)
    with db.system() as c:
        before = c.execute("select score, final_directive from audits where id = %s", (audit,)).fetchone()
    r = client.post(f"/api/findings/{f}/challenges", json={"claim": "Runway is 20 months", "evidence": "Bank statement, October"}, headers=as_(w, "Viewer"))
    assert r.status_code == 200
    cid = r.json()["id"]
    # The Viewer cannot answer; nor can the author.
    assert client.post(f"/api/challenges/{cid}/answer", json={"status": "upheld", "response": "ok"}, headers=as_(w, "Viewer")).status_code == 403
    assert client.post(f"/api/challenges/{cid}/answer", json={"status": "upheld", "response": "Checked the statement."}, headers=as_(w, "Analyst")).status_code == 200
    with db.system() as c:
        ch = c.execute("select status, response from finding_challenges where id = %s", (cid,)).fetchone()
        after = c.execute("select score, final_directive from audits where id = %s", (audit,)).fetchone()
        logged = c.execute("select count(*) as n from audit_log where object_type = 'finding_challenges'").fetchone()["n"]
    assert ch["status"] == "upheld" and after == before and logged == 2
    # Guests cannot challenge.
    assert client.post(f"/api/findings/{f}/challenges", json={"claim": "x"}, headers=as_(w, "Guest")).status_code in (403, 404)


def _fake_answer(monkeypatch, seen):
    def answer(c, audit_id, question, history, runner=None):
        report, ids = ask.report_context(c, audit_id)
        seen.append({"report": json.loads(report), "question": question, "history": history})
        return {"answer": "Because of the runway finding.", "finding_ids": sorted(ids)[:1] + ["made-up"], "usage": {"input_tokens": 1}}
    monkeypatch.setattr(ask, "answer", answer)


def test_ask_answers_from_the_report_and_keeps_the_thread(api, monkeypatch):
    client, w = api
    audit, f = _audit(client, w)
    seen = []
    real = ask.answer
    _fake_answer(monkeypatch, seen)
    r = client.post(f"/api/audits/{audit}/questions", json={"question": "Why this directive?"}, headers=as_(w, "Viewer"))
    assert r.status_code == 200
    q = r.json()["question"]
    assert q["answer"].startswith("Because") and q["by"]
    assert seen[0]["report"]["findings"] and seen[0]["report"]["directive"]
    client.post(f"/api/audits/{audit}/questions", json={"question": "And then?"}, headers=as_(w, "Viewer"))
    assert seen[1]["history"][0]["question"] == "Why this directive?"
    listed = client.get(f"/api/audits/{audit}/questions", headers=as_(w, "Analyst")).json()
    assert [x["question"] for x in listed["questions"]] == ["Why this directive?", "And then?"]
    assert client.get(f"/api/audits/{audit}/questions", headers=as_(w, "Guest")).status_code == 404
    # Usage is internal: members cannot read it.
    with db.as_user(w["users"]["Viewer"]) as c:
        try:
            c.execute("select usage from report_questions")
            readable = True
        except Exception:  # noqa: BLE001
            readable = False
    assert not readable
    # The real answerer drops finding ids that are not in the report.
    fake = SimpleNamespace(content=[SimpleNamespace(type="text", text=json.dumps({"answer": "x", "finding_ids": [f, "invented"]}))],
                           stop_reason="end_turn", usage=SimpleNamespace(input_tokens=5, output_tokens=5))
    runner = SimpleNamespace(cfg=SimpleNamespace(model="m"), _create=lambda **kw: fake)
    with db.system() as c:
        out = real(c, audit, "q", [], runner=runner)
    assert out["finding_ids"] == [f]


def test_questions_stop_at_the_plan_allowance(api, monkeypatch):
    client, w = api
    audit, _ = _audit(client, w)
    _fake_answer(monkeypatch, [])
    monkeypatch.setattr(ask, "allowance", lambda org: 1)
    first = client.post(f"/api/audits/{audit}/questions", json={"question": "One?"}, headers=as_(w, "Viewer"))
    assert first.status_code == 200, first.text
    r = client.post(f"/api/audits/{audit}/questions", json={"question": "Two?"}, headers=as_(w, "Viewer"))
    assert r.status_code == 402 and r.json()["state"] == "question_limit"
