"""HTTP API against Postgres: tokens, RLS-enforced writes, sharing, import,
team, free audit, crons and drift, with a scripted model."""

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from ava_server import db, lifecycle
from ava_server.agents import AgentRunner
from ava_server.config import Settings
from tests_py.conftest import DESC
from tests_py.fakes import DEFAULT, FakeClient

SECRET = "test-secret-at-least-32-bytes-long-000"


@pytest.fixture()
def api(world, monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("CRON_SECRET", "cron-secret")
    monkeypatch.setenv("AVA_FREE_EMAIL_DOMAINS", "gmail.com")
    monkeypatch.setenv("AVA_FREE_AUDITS_PER_IP_DAY", "1000")
    monkeypatch.setenv("AVA_FREE_AUDITS_PER_DAY", "1000")

    def fake_runner(*_a, **_k):
        cfg = Settings()
        cfg.refusal_fallback = "off"
        return AgentRunner(client=FakeClient(), cfg=cfg)

    monkeypatch.setattr(lifecycle, "AgentRunner", fake_runner)
    from ava_server.app import app
    with db.system() as c:
        c.execute("delete from sources where id = 'S1'")
        c.execute("insert into sources (id, org_id, company_id, type, title, note) values ('S1', %s, %s, 'uploaded', 'Deck', 'Deck text')",
                  (world["org"], world["company"]))
    return TestClient(app), world


def token(uid, **kw):
    claims = {"sub": uid, "aud": "authenticated", "exp": int(time.time()) + 600, **kw}
    return {"Authorization": "Bearer " + jwt.encode(claims, SECRET, algorithm="HS256")}


def as_(world, role):
    return token(world["users"][role])


def finish(client, headers, audit_id, path="/api/audits/{}/advance"):
    for _ in range(20):
        st = client.post(path.format(audit_id), headers=headers).json()
        if st["audit"]["status"] in ("complete", "partial", "failed"):
            return st
    raise AssertionError("audit did not finish")


def test_health_reports_configuration_without_values(api, monkeypatch):
    client, _ = api
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    r = client.get("/api/health").json()
    assert r["ok"] is True and r["checks"]["database"] is True
    assert "sk-test" not in str(r) and "cron-secret" not in str(r)
    import hashlib
    assert r["cron_secret_fingerprint"] == hashlib.sha256(b"cron-secret").hexdigest()[:8]
    assert "model" not in r and "claude" not in str(r).lower()
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    assert client.get("/api/health").json()["ok"] is False


def test_requests_need_a_valid_token(api):
    client, w = api
    assert client.post("/api/audits", json={"companyId": w["company"]}).status_code == 401
    bad = {"Authorization": "Bearer " + jwt.encode({"sub": "x", "aud": "authenticated"}, "wrong-secret-wrong-secret-wrong-00", algorithm="HS256")}
    assert client.post("/api/audits", json={"companyId": w["company"]}, headers=bad).status_code == 401
    expired = token(w["users"]["Analyst"], exp=int(time.time()) - 10)
    assert client.post("/api/audits", json={"companyId": w["company"]}, headers=expired).status_code == 401


def test_analyst_runs_an_audit_end_to_end_and_viewer_cannot(api):
    client, w = api
    assert client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Viewer")).status_code == 403
    r = client.post("/api/audits", json={"companyId": w["company"], "notify": True}, headers=as_(w, "Analyst")).json()
    again = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()
    assert again["alreadyRunning"] and again["auditId"] == r["auditId"]
    st = finish(client, as_(w, "Viewer"), r["auditId"])
    assert st["audit"]["status"] == "complete" and st["audit"]["final_directive"]
    with db.system() as c:
        assert c.execute("select 1 from email_outbox where kind = 'audit-complete'").fetchone()
    # Guests (not members) cannot see the audit at all.
    assert client.get(f"/api/audits/{r['auditId']}/status", headers=as_(w, "Guest")).status_code == 404


def test_new_company_and_audit_in_one_call(api):
    client, w = api
    body = {"orgId": w["org"], "company": {"title": "Newco", "description": DESC, "industry": "Fintech", "country": "United Kingdom"}}
    r = client.post("/api/audits", json=body, headers=as_(w, "Analyst"))
    assert r.status_code == 200 and r.json()["companyId"]
    assert client.post("/api/audits", json=body, headers=as_(w, "Analyst")).status_code == 409


def test_finding_status_dismiss_needs_reason_and_recomputes(api):
    client, w = api
    r = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()
    finish(client, as_(w, "Analyst"), r["auditId"])
    with db.system() as c:
        f = c.execute("select id from findings where audit_id = %s and severity = 'HIGH' limit 1", (r["auditId"],)).fetchone()["id"]
        before = c.execute("select score, score_excluding_dismissed from audits where id = %s", (r["auditId"],)).fetchone()
    assert client.post(f"/api/findings/{f}/status", json={"status": "dismissed"}, headers=as_(w, "Analyst")).status_code == 422
    assert client.post(f"/api/findings/{f}/status", json={"status": "accepted"}, headers=as_(w, "Viewer")).status_code == 403
    res = client.post(f"/api/findings/{f}/status", json={"status": "dismissed", "reason": "Fixed in Q3"}, headers=as_(w, "Analyst")).json()
    assert res["scoreExcludingDismissed"] > before["score"]
    with db.system() as c:
        row = c.execute("select status, history from findings where id = %s", (f,)).fetchone()
        a = c.execute("select score from audits where id = %s", (r["auditId"],)).fetchone()
    assert row["status"] == "dismissed" and row["history"][-1]["detail"] == "Fixed in Q3" and row["history"][-1]["action"] == "Dismissed"
    assert a["score"] == before["score"]  # the issued score never changes
    assert client.post(f"/api/findings/{f}/comments", json={"text": "Agreed"}, headers=as_(w, "Viewer")).status_code == 200
    assert client.post(f"/api/findings/{f}/owner", json={"owner": "Sam"}, headers=as_(w, "Analyst")).status_code == 200


def test_share_link_guest_view_password_expiry_and_revoke(api):
    client, w = api
    r = client.post("/api/share", json={"auditId": w["audit"], "email": "lp@partner.example", "password": "pa55word"}, headers=as_(w, "Viewer")).json()
    tok = r["token"]
    assert client.post(f"/api/shared/{tok}").json()["state"] == "password"
    assert client.post(f"/api/shared/{tok}", json={"password": "nope"}).status_code == 401
    view = client.post(f"/api/shared/{tok}", json={"password": "pa55word"}).json()
    assert view["audit"]["id"] == w["audit"] and view["findings"] and "comments" not in view
    assert "org_id" not in view["audit"]
    # Members can tell a link has a password but cannot read its hash.
    with db.as_user(w["users"]["Viewer"]) as c:
        assert c.execute("select has_password from share_links where token = %s", (tok,)).fetchone()["has_password"] is True
    with pytest.raises(Exception, match="permission denied"):
        with db.as_user(w["users"]["Viewer"]) as c:
            c.execute("select password_hash from share_links")
    assert client.post(f"/api/share/{tok}/revoke", headers=as_(w, "Admin")).status_code == 200
    assert client.post(f"/api/shared/{tok}", json={"password": "pa55word"}).json()["state"] == "revoked"
    with db.system() as c:
        assert c.execute("select count(*) as n from share_views where token = %s", (tok,)).fetchone()["n"] == 1
        c.execute("update share_links set revoked = false, expires_at = current_date - 1 where token = %s", (tok,))
    assert client.post(f"/api/shared/{tok}", json={"password": "pa55word"}).json()["state"] == "expired"
    assert client.post("/api/shared/nope").json()["state"] == "missing"


def test_import_validates_server_side_and_can_audit_all(api):
    client, w = api
    rows = [{"title": "Alpha", "description": DESC, "industry": "Fintech", "country": "UK"}, {"title": "alpha", "industry": "Fintech", "country": "UK"},
            {"title": "Beta", "industry": "", "country": "UK"}, {"title": f"Co {w['tag']}", "industry": "X", "country": "UK"}]
    assert client.post("/api/import", json={"orgId": w["org"], "file": "p.csv", "rows": rows}, headers=as_(w, "Viewer")).status_code == 403
    r = client.post("/api/import", json={"orgId": w["org"], "file": "p.csv", "rows": rows, "auditAll": True}, headers=as_(w, "Analyst")).json()
    assert len(r["created"]) == 1 and len(r["audits"]) == 1
    assert [x["reason"] for x in r["rejected"]] == ["Already in your portfolio", "Missing industry", "Already in your portfolio"]


def test_invite_accept_roles_and_transfer(api):
    client, w = api
    assert client.post("/api/invites", json={"orgId": w["org"], "email": "x@y.example", "role": "Analyst"}, headers=as_(w, "Analyst")).status_code == 403
    guest_email = f"guest-{w['tag']}@fund.example"
    inv = client.post("/api/invites", json={"orgId": w["org"], "email": guest_email, "role": "Viewer"}, headers=as_(w, "Admin")).json()
    assert client.get(f"/api/invites/{inv['token']}").json()["role"] == "Viewer"
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=as_(w, "Analyst")).status_code == 403
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=as_(w, "Guest")).json()["role"] == "Viewer"
    assert client.post(f"/api/invites/{inv['token']}/accept", headers=as_(w, "Guest")).status_code == 404
    g = w["users"]["Guest"]
    assert client.patch(f"/api/orgs/{w['org']}/members/{g}", json={"role": "Analyst"}, headers=as_(w, "Analyst")).status_code == 403
    assert client.patch(f"/api/orgs/{w['org']}/members/{g}", json={"role": "Analyst"}, headers=as_(w, "Admin")).status_code == 200
    owner = w["users"]["Owner"]
    assert client.patch(f"/api/orgs/{w['org']}/members/{owner}", json={"role": "Viewer"}, headers=as_(w, "Admin")).status_code == 403
    assert client.post(f"/api/orgs/{w['org']}/transfer", json={"toUserId": g}, headers=as_(w, "Admin")).status_code == 403
    assert client.post(f"/api/orgs/{w['org']}/transfer", json={"toUserId": g}, headers=as_(w, "Owner")).status_code == 200
    with db.system() as c:
        roles = {str(r["user_id"]): r["role"] for r in c.execute("select user_id, role from memberships where org_id = %s", (w["org"],)).fetchall()}
    assert roles[g] == "Owner" and roles[owner] == "Admin"
    assert client.delete(f"/api/orgs/{w['org']}/members/{w['users']['Viewer']}", headers=as_(w, "Admin")).status_code == 200


def test_onboarding_creates_org_with_owner(api):
    client, w = api
    with db.system() as c:
        uid = str(c.execute("insert into auth.users (email) values (%s) returning id", (f"new-{w['tag']}@fund.example",)).fetchone()["id"])
    org = client.post("/api/orgs", json={"name": "New Fund"}, headers=token(uid)).json()["orgId"]
    with db.system() as c:
        assert c.execute("select role from memberships where org_id = %s and user_id = %s", (org, uid)).fetchone()["role"] == "Owner"


def test_free_audit_work_email_once_per_domain_and_locking(api):
    client, w = api
    co = {"title": "Freeco", "description": DESC, "industry": "Fintech", "country": "United Kingdom"}
    assert client.post("/api/free-audit", json={"email": "me@gmail.com", "company": co}).status_code == 422
    dom = f"acme{w['tag']}.example"
    fid = client.post("/api/free-audit", json={"email": f"me@{dom}", "company": co}).json()["id"]
    assert client.post("/api/free-audit", json={"email": f"you@{dom}", "company": co}).status_code == 429
    finish(client, {}, fid, "/api/free-audit/{}/advance")
    r = client.get(f"/api/free-audit/{fid}").json()
    assert r["status"] == "complete" and len(r["top"]) == 3 and r["top"][0]["severity"] == "HIGH"
    assert r["locked"]["total"] == 3 and "text" not in str(r["locked"])
    assert client.post(f"/api/free-audit/{fid}/send", json={"to": "vc@fund.example"}).status_code == 200
    assert client.post(f"/api/free-audit/{fid}/send", json={"to": "vc@fund.example"}).status_code == 409
    with db.system() as c:
        assert c.execute("select status from free_audits where id = %s", (fid,)).fetchone()["status"] == "complete"


def test_data_room_registers_supersedes_and_reaudits(api):
    client, w = api
    body = {"title": "Board pack", "extract": "Revenue grew.", "storagePath": f"{w['org']}/{w['company']}/pack.pdf"}
    assert client.post(f"/api/data-room/{w['company']}/files", json=body, headers=as_(w, "Viewer")).status_code == 403
    with db.system() as c:
        c.execute("update organisations set alert_rules = alert_rules || '{\"evidence\": true}' where id = %s", (w["org"],))
    assert client.post(f"/api/data-room/{w['company']}/files", json={**body, "storagePath": "other/x.pdf"}, headers=as_(w, "Analyst")).status_code == 422
    first = client.post(f"/api/data-room/{w['company']}/files", json=body, headers=as_(w, "Analyst")).json()
    second = client.post(f"/api/data-room/{w['company']}/files", json={**body, "extract": "Revenue fell.", "reaudit": True}, headers=as_(w, "Analyst")).json()
    assert second["auditId"]
    with db.system() as c:
        assert c.execute("select status from sources where id = %s", (first["sourceId"],)).fetchone()["status"] == "superseded"
        assert c.execute("select trigger from audits where id = %s", (second["auditId"],)).fetchone()["trigger"] == "evidence"
        assert c.execute("select count(*) as n from alerts where company_id = %s and trigger = 'evidence'", (w["company"],)).fetchone()["n"] == 2
    assert client.post(f"/api/audits/{w['audit']}/export", json={"detail": "Exported PDF"}, headers=as_(w, "Viewer")).status_code == 200


def test_outcome_logging_and_guard(api):
    client, w = api
    ok = {"auditId": w["audit"], "result": "grew", "checkpoint": "first", "date": "2027-10-01", "evidence": {"value": "ARR doubled"}}
    assert client.post("/api/outcomes", json=ok, headers=as_(w, "Viewer")).status_code == 403
    assert client.post("/api/outcomes", json={**ok, "evidence": {"value": " "}}, headers=as_(w, "Analyst")).status_code == 422
    bad = {**ok, "result": "exited", "evidence": {"value": "Sold", "belowLastValuation": True}}
    assert client.post("/api/outcomes", json=bad, headers=as_(w, "Analyst")).status_code == 422
    assert client.post("/api/outcomes", json=ok, headers=as_(w, "Analyst")).status_code == 200


def test_crons_need_the_secret_and_advance_audits(api, monkeypatch):
    client, w = api
    assert client.get("/api/cron/advance").status_code == 401
    monkeypatch.setenv("CRON_SECRET", "cron-secret\n")  # trailing newline from a copy-paste
    assert client.get("/api/cron/email", headers={"Authorization": "Bearer cron-secret"}).status_code == 200
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    cron = {"Authorization": "Bearer cron-secret"}
    for _ in range(10):
        client.get("/api/cron/advance", headers=cron)
    assert lifecycle.status(aid)["audit"]["status"] == "complete"
    assert client.get("/api/cron/email", headers=cron).json()["failed"] >= 1  # no provider configured in tests
    assert client.get("/api/cron/cadence", headers=cron).status_code == 200
    assert client.get("/api/cron/digest", headers=cron).status_code == 200


def test_rescore_runs_on_frozen_snapshot_without_touching_the_original(api):
    client, w = api
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), aid)
    with db.system() as c:
        before = c.execute("select score, final_directive from audits where id = %s", (aid,)).fetchone()
        alerts_before = c.execute("select count(*) as n from alerts").fetchone()["n"]
    sid = client.post(f"/api/audits/{aid}/rescore", headers=as_(w, "Analyst")).json()["shadowId"]
    # Shadow audits are invisible to users and to the user-facing endpoints.
    assert client.get(f"/api/audits/{sid}/status", headers=as_(w, "Analyst")).status_code == 404
    for _ in range(10):
        lifecycle.advance(sid)
    r = client.get(f"/api/audits/{aid}/rescore", headers=as_(w, "Viewer")).json()
    assert r["pending"] is False and r["result"]["shadow_score"] == before["score"]
    with db.system() as c:
        assert c.execute("select score, final_directive from audits where id = %s", (aid,)).fetchone() == before
        assert c.execute("select count(*) as n from alerts").fetchone()["n"] == alerts_before
    with db.as_user(w["users"]["Owner"]) as c:
        assert c.execute("select 1 from audits where id = %s", (sid,)).fetchone() is None


def test_drift_report_hold_mode_and_manual_lift(api):
    from ava_server import drift
    client, w = api
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), aid)
    with db.system() as c:
        c.execute("delete from drift_reports"); c.execute("delete from hold_events"); c.execute("delete from shadow_runs")
        c.execute("update audits set status = 'failed' where trigger = 'shadow' and status in ('queued', 'running')")
        score = c.execute("select score from audits where id = %s", (aid,)).fetchone()["score"]
        for change in (8, 9, 10):
            c.execute("insert into shadow_runs (original_audit, snapshot_hash, model_version, prompt_version, calibration_version, purpose, "
                      "original_score, shadow_score, score_change, original_directive, shadow_directive, flipped) "
                      "values (%s, 'h', 'm', 'p', 'cal-2026.2', 'monthly', %s, %s, %s, 'HOLD', 'HOLD', false)", (aid, score, score + change, change))
    rep = drift.drift_report()
    assert rep["level"] == "hold"
    with db.system() as c:
        assert c.execute("select hold_mode from organisations where id = %s", (w["org"],)).fetchone()["hold_mode"] is True
    second = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), second)
    with db.system() as c:
        assert c.execute("select under_review from audits where id = %s", (second,)).fetchone()["under_review"] is True
    with pytest.raises(ValueError):
        drift.lift_hold("Checked", "Ops lead", "Ops lead")
    drift.lift_hold("Prompt regression found and reverted", "Ops lead", "Risk reviewer")
    with db.system() as c:
        assert c.execute("select hold_mode from organisations where id = %s", (w["org"],)).fetchone()["hold_mode"] is False
        a = c.execute("select under_review, hold_resolution from audits where id = %s", (second,)).fetchone()
        ev = c.execute("select lift_reason, second_reviewer, affected_audits from hold_events order by started_at desc limit 1").fetchone()
    assert a["under_review"] is False and a["hold_resolution"] == "confirmed"
    assert ev["second_reviewer"] == "Risk reviewer" and ev["affected_audits"]


def test_thin_or_nonsense_input_is_refused_before_any_model_call(api):
    client, w = api
    for desc in ("Facebook App Instagram App", "asdf qwrt zxcv bnmm hjkl asdf qwrt zxcv bnmm hjkl asdf qwrt zxcv bnmm hjkl"):
        body = {"orgId": w["org"], "company": {"title": "Meta", "description": desc, "industry": "SaaS", "country": "GB"}}
        r = client.post("/api/audits", json=body, headers=as_(w, "Analyst"))
        assert r.status_code == 422 and r.json()["state"] == "insufficient"
        free = client.post("/api/free-audit", json={"email": f"x@thin{w['tag']}.example", "company": body["company"]})
        assert free.status_code == 422
    with db.system() as c:
        assert c.execute("select count(*) as n from companies where title = 'Meta'").fetchone()["n"] == 0


def test_orchestrator_can_refuse_to_score(api, monkeypatch):
    client, w = api
    refusal = {**DEFAULT[6], "assessable": False, "assessable_reason": "The description names products but no customers, revenue or plan."}

    def runner(*_a, **_k):
        from ava_server.agents import AgentRunner
        from ava_server.config import Settings
        cfg = Settings(); cfg.refusal_fallback = "off"
        return AgentRunner(client=FakeClient({6: [refusal]}), cfg=cfg)

    monkeypatch.setattr(lifecycle, "AgentRunner", runner)
    dom = f"refuse{w['tag']}.example"
    co = {"title": "Vagueco", "description": DESC, "industry": "Fintech", "country": "United Kingdom"}
    fid = client.post("/api/free-audit", json={"email": f"me@{dom}", "company": co}).json()["id"]
    finish(client, {}, fid, "/api/free-audit/{}/advance")
    r = client.get(f"/api/free-audit/{fid}").json()
    assert r["status"] == "failed" and "customers" in r["reason"] and "score" not in r
    with db.system() as c:
        a = c.execute("select a.score, a.final_directive, a.counted_against_usage from audits a join free_audits f on f.audit_id = a.id where f.id = %s", (fid,)).fetchone()
    assert a["score"] is None and a["final_directive"] is None and a["counted_against_usage"] is False
    # A refused audit does not use up the domain's free audit for the month.
    assert client.post("/api/free-audit", json={"email": f"you@{dom}", "company": co}).status_code == 200


def test_users_cannot_see_which_ai_model_ran(api):
    client, w = api
    aid = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Owner")).json()["auditId"]
    finish(client, as_(w, "Owner"), aid)
    with db.system() as c:
        assert c.execute("select model_version from audits where id = %s", (aid,)).fetchone()["model_version"]  # still recorded
    for sql in ("select model_version from audits", "select served_model from agent_runs", "select output from agent_runs", "select * from audits"):
        with pytest.raises(Exception, match="permission denied"):
            with db.as_user(w["users"]["Owner"]) as c:
                c.execute(sql)
    with db.as_user(w["users"]["Owner"]) as c:
        assert c.execute("select score, prompt_version from audits where id = %s", (aid,)).fetchone()["prompt_version"]
    tok = client.post("/api/share", json={"auditId": aid, "email": "lp@partner.example"}, headers=as_(w, "Owner")).json()["token"]
    view = client.post(f"/api/shared/{tok}").json()
    assert "model_version" not in view["audit"] and "claude" not in str(view).lower()


def test_every_plan_runs_the_standard_engine_and_pro_max_can_go_deep(api):
    client, w = api
    with db.system() as c:
        c.execute("update organisations set plan = 'pro' where id = %s", (w["org"],))
    r = client.post("/api/audits", json={"companyId": w["company"], "depth": "deep"}, headers=as_(w, "Analyst"))
    assert r.status_code == 403 and "Pro Max" in r.json()["error"]
    std = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), std)
    with db.system() as c:
        c.execute("update organisations set plan = 'Pro Max' where id = %s", (w["org"],))
    deep = client.post("/api/audits", json={"companyId": w["company"], "depth": "deep"}, headers=as_(w, "Analyst")).json()["auditId"]
    finish(client, as_(w, "Analyst"), deep)
    with db.system() as c:
        rows = {r["id"]: r for r in c.execute("select id, depth, model_version from audits where id = any(%s)", ([std, deep],)).fetchall()}
    assert rows[std]["depth"] == "standard" and rows[std]["model_version"] == "claude-sonnet-5-5"
    assert rows[deep]["depth"] == "deep" and rows[deep]["model_version"] == "claude-opus-5-5"
    # Users see the depth, never the model.
    with db.as_user(w["users"]["Viewer"]) as c:
        assert c.execute("select depth from audits where id = %s", (deep,)).fetchone()["depth"] == "deep"


def test_new_organisations_start_on_a_capped_free_trial(api):
    client, w = api
    with db.system() as c:
        uid = str(c.execute("insert into auth.users (email) values (%s) returning id", (f"trial-{w['tag']}@fund.example",)).fetchone()["id"])
    org = client.post("/api/orgs", json={"name": "Trial Fund"}, headers=token(uid)).json()["orgId"]
    with db.system() as c:
        o = c.execute("select plan, trial_ends_at, seat_limit, created_at from organisations where id = %s", (org,)).fetchone()
        assert o["plan"] == "trial" and o["seat_limit"] == 3
        assert 6 <= (o["trial_ends_at"] - o["created_at"]).days <= 7
        cos = [c.execute("insert into companies (org_id, title, description, industry, country) values (%s, %s, %s, 'Fintech', 'UK') returning id",
                         (org, f"T{i}", DESC)).fetchone()["id"] for i in range(10)]
    # One audit a day.
    first = client.post("/api/audits", json={"companyId": cos[0]}, headers=token(uid))
    assert first.status_code == 200
    again = client.post("/api/audits", json={"companyId": cos[1]}, headers=token(uid))
    assert again.status_code == 402 and again.json()["state"] == "upgrade" and "tomorrow" in again.json()["error"]
    # A failed or declined audit never counts, so it can be run again the same day.
    with db.system() as c:
        c.execute("update audits set status = 'failed', counted_against_usage = false where id = %s", (first.json()["auditId"],))
    assert client.post("/api/audits", json={"companyId": cos[1]}, headers=token(uid)).status_code == 200
    # Seven in total: earlier days' audits count towards the trial cap.
    with db.system() as c:
        c.execute("update organisations set created_at = now() - interval '4 days' where id = %s", (org,))
        c.execute("update audits set created_at = now() - interval '2 days' where org_id = %s", (org,))
        for i in range(6):
            c.execute("insert into audits (org_id, company_id, status, created_at) values (%s, %s, 'complete', now() - interval '3 days')", (org, cos[2 + i]))
    total = client.post("/api/audits", json={"companyId": cos[8]}, headers=token(uid))
    assert total.status_code == 402 and "7 audits" in total.json()["error"]
    # Once the trial period ends, no more audits until a plan is chosen.
    with db.system() as c:
        c.execute("update organisations set trial_ends_at = now() - interval '1 day' where id = %s", (org,))
    ended = client.post("/api/audits", json={"companyId": cos[9]}, headers=token(uid))
    assert ended.status_code == 402 and "trial has ended" in ended.json()["error"]


def test_paid_plan_monthly_allowance(api):
    client, w = api
    with db.system() as c:
        c.execute("update organisations set plan = 'basic' where id = %s", (w["org"],))
        for _ in range(20):
            c.execute("insert into audits (org_id, company_id, status) values (%s, %s, 'complete')", (w["org"], w["company"]))
    r = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Analyst"))
    assert r.status_code == 402 and "Basic plan includes 20 audits a month" in r.json()["error"]
