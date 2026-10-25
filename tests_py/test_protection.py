"""Free audit spend protection: bot check and daily limits; ops alert on failure."""

import httpx

from ava_server import db
from tests_py.conftest import DESC
from tests_py.test_api import api  # noqa: F401  (fixture re-export)

CO = {"title": "Freeco", "description": DESC, "industry": "Fintech", "country": "United Kingdom"}


def test_free_audit_limit_per_address(api, monkeypatch):
    client, w = api
    monkeypatch.setenv("AVA_FREE_AUDITS_PER_IP_DAY", "1")
    ip = {"x-forwarded-for": f"203.0.113.{int(w['tag'], 16) % 250}"}
    assert client.post("/api/free-audit", json={"email": f"a@one{w['tag']}.example", "company": CO}, headers=ip).status_code == 200
    r = client.post("/api/free-audit", json={"email": f"a@two{w['tag']}.example", "company": CO}, headers=ip)
    assert r.status_code == 429 and "today" in r.json()["error"]
    with db.system() as c:
        stored = c.execute("select ip_hash from free_audits where email = %s", (f"a@one{w['tag']}.example",)).fetchone()["ip_hash"]
    assert stored and "203.0.113" not in stored


def test_free_audit_human_check(api, monkeypatch):
    client, w = api
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "ts-secret")
    body = {"email": f"a@ts{w['tag']}.example", "company": CO}
    assert client.post("/api/free-audit", json=body).status_code == 422
    seen = {}

    def fake_post(url, data=None, **_):
        seen.update(data)
        return httpx.Response(200, json={"success": data["response"] == "good"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    assert client.post("/api/free-audit", json={**body, "turnstileToken": "bad"}).status_code == 422
    assert client.post("/api/free-audit", json={**body, "turnstileToken": "good"}).status_code == 200
    assert seen["secret"] == "ts-secret"


def test_health_lists_optional_services(api):
    client, _ = api
    checks = client.get("/api/health").json()["checks"]
    assert {"billing", "bot_check", "error_reporting"} <= set(checks)


def test_free_audit_result_goes_by_email_when_email_is_on(api, monkeypatch):
    client, w = api
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    email = f"founder@mail{w['tag']}.example"
    r = client.post("/api/free-audit", json={"email": email, "company": CO})
    assert r.status_code == 200 and r.json() == {"emailed": True, "to": email}  # no id for the browser
    with db.system() as c:
        fid = c.execute("select id from free_audits where email = %s", (email,)).fetchone()["id"]
    for _ in range(20):
        if client.post(f"/api/free-audit/{fid}/advance").json()["audit"]["status"] in ("complete", "partial", "failed"):
            break
    with db.system() as c:
        mail = c.execute("select subject, body from email_outbox where kind = 'free-audit-result' and to_email = %s", (email,)).fetchone()
    assert mail and "score" in mail["subject"] and f"/free-audit/result/{fid}" in mail["body"]


def test_failed_email_is_retried(api, monkeypatch):
    """A send that fails (say, domain not yet verified) is retried on the next run."""
    from ava_server import emailer
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    with db.system() as c:
        c.execute("delete from email_outbox where sent_at is null")
        c.execute("insert into email_outbox (to_email, subject, body, kind) values ('a@b.example', 'Hi', 'Body', 'test')")
    fail = lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("domain not verified"))
    monkeypatch.setattr(httpx, "post", fail)
    assert emailer.send_pending()["failed"] == 1
    ok = lambda url, **k: httpx.Response(200, json={"id": "x"}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", ok)
    assert emailer.send_pending()["sent"] == 1
    with db.system() as c:
        assert c.execute("select sent_at, error from email_outbox where subject = 'Hi'").fetchone()["error"] is None
