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


def test_emails_are_sent_as_branded_html_with_text_fallback(api, monkeypatch):
    from ava_server import email_html, emailer
    page = email_html.render("Aakash invited you to DZ on AVA", "Aakash invited you to join DZ on AVA as Viewer <script>.\n\n"
                             "Accept: https://avaverdict.com/invite/abc\n\nThe invitation expires in 7 days.\n\n--\n"
                             "Manage alert settings: https://avaverdict.com/alerts\n")
    assert 'href="https://avaverdict.com/invite/abc"' in page and "Accept invitation" in page
    assert "&lt;script&gt;" in page and "<script>" not in page
    assert "/icons/email/hero.png" in page and "/icons/email/icon-report.png" in page and "Manage alert settings" in page
    invite = email_html.render("Aakash invited you to DZ on AVA", "Accept: https://avaverdict.com/invite/abc", "invite")
    assert "icon-invite.png" in invite and "INVITATION" in invite and "Sign in with Google" in invite
    report = email_html.render("Acme: audit complete, HOLD 47", "Open the report: https://x.example/r", "audit-complete")
    assert "RESILIENCE SCORE" in report and ">47<" in report and 'width="47%"' in report and "#F2C46A" in report
    alert = email_html.render("Acme: directive changed from PROCEED to PIVOT", "Score 70 to 41.", "alert-immediate")
    assert "&rarr;" in alert and ">PROCEED<" in alert and ">PIVOT<" in alert and "RESILIENCE SCORE" not in alert
    # Light by default; dark-mode clients swap palette and images.
    assert "hero-light.png" in report and "prefers-color-scheme: dark" in report and 'class="vHOLD"' in report
    assert "#A16207" in report and "[data-ogsc] .card" in report
    plain = email_html.render("Update Acme's March numbers", "KILL 3 items", "metrics")
    assert "RESILIENCE SCORE" not in plain and "MONTHLY NUMBERS" in plain
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    with db.system() as c:
        c.execute("delete from email_outbox where sent_at is null")
        c.execute("insert into email_outbox (to_email, subject, body, kind) values ('a@b.example', 'Hello', 'Body\n\nOpen: https://x.example', 'test')")
    sent = {}
    monkeypatch.setattr(httpx, "post", lambda url, json=None, **k: sent.update(json) or httpx.Response(200, json={}, request=httpx.Request("POST", url)))
    emailer.send_pending()
    assert sent["text"].startswith("Body") and "<html" in sent["html"]
