"""Enterprise metric tracking: monthly requests, founder link, team confirm,
AVA review, alerts on material moves, plan gating and reminders."""

from datetime import date, timedelta

import psycopg
import pytest

from ava_server import db, metrics
from tests_py.test_api import api, as_, token  # noqa: F401  (fixture re-export)


@pytest.fixture()
def ent(api):
    client, w = api
    with db.system() as c:
        c.execute("update organisations set plan = 'enterprise' where id = %s", (w["org"],))
        c.execute("update companies set founder_email = %s where id = %s", (f"founder-{w['tag']}@startup.example", w["company"]))
    return client, w


def founder_token(w, period):
    """Issue this month's request and capture the raw token from the email."""
    with db.system() as c:
        co = c.execute("select * from companies where id = %s", (w["company"],)).fetchone()
        c.execute("delete from metric_requests where company_id = %s", (w["company"],))
        return metrics.create_request(c, co, period, "Fund")


def test_plan_gating(api):
    client, w = api  # pro-max: not tracked
    r = client.post(f"/api/companies/{w['company']}/metrics", json={"revenue": 10}, headers=as_(w, "Analyst"))
    assert r.status_code == 403 and "Enterprise" in r.json()["error"]
    assert client.get(f"/api/companies/{w['company']}/tracking", headers=as_(w, "Viewer")).json() == {"tracked": False}


def test_founder_link_team_confirm_ava_verify(ent, monkeypatch):
    client, w = ent
    period = metrics.last_period()
    tok = founder_token(w, period)
    info = client.get(f"/api/metric-requests/{tok}").json()
    assert info["state"] == "open" and info["periodLabel"] == metrics.period_label(period)
    assert client.get("/api/metric-requests/not-a-token").status_code == 404
    assert client.post(f"/api/metric-requests/{tok}", json={"note": "hi"}).status_code == 422
    r = client.post(f"/api/metric-requests/{tok}", json={"revenue": 40000, "cash": 90000, "burn": 45000, "headcount": 8, "customers": 30})
    assert r.status_code == 200 and any("Runway under 3" in f for f in r.json()["flags"])
    t = client.get(f"/api/companies/{w['company']}/tracking", headers=as_(w, "Viewer")).json()
    row = t["rows"][0]
    assert row["source"] == "founder" and row["confirmedAt"] is None and row["runway"] == 2.0 and t["request"]["submittedAt"]
    # Viewers cannot confirm; analysts can. Confirming raises the runway alert.
    assert client.post(f"/api/metrics/{row['id']}/confirm", headers=as_(w, "Viewer")).status_code == 403
    out = client.post(f"/api/metrics/{row['id']}/confirm", headers=as_(w, "Analyst")).json()
    assert any("Runway fell" in m for m in out["alerts"])
    # The founder cannot overwrite confirmed numbers.
    assert client.post(f"/api/metric-requests/{tok}", json={"revenue": 1}).status_code == 409
    # AVA review: staff only, and only with two-factor.
    monkeypatch.setenv("AVA_STAFF_EMAILS", "reviewer@ava.example")
    with db.system() as c:
        staff = str(c.execute("insert into auth.users (email) values ('reviewer@ava.example') on conflict (email) do update set email = excluded.email returning id").fetchone()["id"])
    assert client.get("/api/staff/metrics", headers=as_(w, "Owner")).status_code == 404
    assert client.get("/api/staff/metrics", headers=token(staff, email="reviewer@ava.example")).status_code == 403
    sh = token(staff, email="reviewer@ava.example", aal="aal2")
    items = client.get("/api/staff/metrics", headers=sh).json()["items"]
    assert any(i["id"] == row["id"] and i["organisation"] for i in items)
    assert client.post(f"/api/staff/metrics/{row['id']}", json={"action": "query"}, headers=sh).status_code == 422
    assert client.post(f"/api/staff/metrics/{row['id']}", json={"action": "verify"}, headers=sh).json()["metric"]["avaStatus"] == "verified"
    # Verified numbers are locked for the client too.
    assert client.post(f"/api/companies/{w['company']}/metrics", json={"revenue": 5}, headers=as_(w, "Analyst")).status_code == 409
    with db.system() as c:
        assert c.execute("select 1 from alerts where company_id = %s and trigger = 'metrics'", (w["company"],)).fetchone()
        assert c.execute("select 1 from audit_log where org_id = %s and action = 'metrics.verified'", (w["org"],)).fetchone()


def test_team_entry_and_revenue_drop_alert(ent):
    client, w = ent
    h = as_(w, "Analyst")
    p2 = metrics.last_period()
    p1 = (p2 - timedelta(days=1)).replace(day=1)
    assert client.post(f"/api/companies/{w['company']}/metrics", json={"period": p1.isoformat(), "revenue": 100000, "cash": 2000000, "burn": 50000}, headers=h).status_code == 200
    out = client.post(f"/api/companies/{w['company']}/metrics", json={"period": p2.isoformat(), "revenue": 70000, "cash": 1950000, "burn": 50000}, headers=h).json()
    assert out["metric"]["confirmedBy"] and any("Revenue down 30%" in m for m in out["alerts"])
    future = (date.today().replace(day=1) + timedelta(days=40)).replace(day=1)
    assert client.post(f"/api/companies/{w['company']}/metrics", json={"period": future.isoformat(), "revenue": 1}, headers=h).status_code == 422


def test_monthly_requests_reminders_and_escalation(ent):
    client, w = ent
    today = date.today()
    with db.system() as c:
        c.execute("delete from metric_requests where company_id = %s", (w["company"],))
        c.execute("delete from company_metrics where company_id = %s", (w["company"],))
    first = metrics.run_daily(today)
    assert first["issued"] >= 1
    assert metrics.run_daily(today)["issued"] == 0  # once per month
    with db.system() as c:
        c.execute("update metric_requests set created_at = now() - interval '8 days' where company_id = %s", (w["company"],))
    assert metrics.run_daily(today)["reminded"] >= 1
    with db.system() as c:
        c.execute("update metric_requests set created_at = now() - interval '15 days' where company_id = %s", (w["company"],))
    assert metrics.run_daily(today)["escalated"] >= 1
    with db.system() as c:
        kinds = [r["subject"] for r in c.execute("select subject from email_outbox where kind = 'metrics' and org_id = %s order by id", (w["org"],)).fetchall()]
    assert any("Reminder" in k for k in kinds) and any("still missing" in k for k in kinds)


def test_set_tracking_validates(ent):
    client, w = ent
    url = f"/api/companies/{w['company']}/tracking"
    assert client.patch(url, json={"founderEmail": "nope"}, headers=as_(w, "Analyst")).status_code == 422
    assert client.patch(url, json={"ownerId": w["users"]["Guest"]}, headers=as_(w, "Analyst")).status_code == 422
    assert client.patch(url, json={"founderEmail": "ceo@co.example", "ownerId": w["users"]["Analyst"]}, headers=as_(w, "Analyst")).status_code == 200
    assert client.patch(url, json={"founderEmail": "x@co.example"}, headers=as_(w, "Viewer")).status_code == 403


def test_members_read_metrics_through_rls(ent):
    client, w = ent
    client.post(f"/api/companies/{w['company']}/metrics", json={"revenue": 1}, headers=as_(w, "Analyst"))
    with db.as_user(w["users"]["Viewer"]) as c:
        assert c.execute("select count(*) as n from company_metrics where org_id = %s", (w["org"],)).fetchone()["n"] >= 1
    with db.as_user(w["users"]["Guest"]) as c:
        assert c.execute("select count(*) as n from company_metrics where org_id = %s", (w["org"],)).fetchone()["n"] == 0
    # Founder links are never readable by members, not even their hashes.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with db.as_user(w["users"]["Owner"]) as c:
            c.execute("select * from metric_requests").fetchall()
