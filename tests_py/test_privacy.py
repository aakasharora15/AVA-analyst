"""Data export and deletion: who may, what is left out, what blocks it."""

from ava_server import db
from tests_py.test_api import api, as_, token  # noqa: F401  (fixture re-export)


def test_export_managers_only_and_hides_internals(api):
    client, w = api
    with db.system() as c:
        c.execute("insert into share_links (token, org_id, audit_id, password_hash, recipient_email, created_by) "
                  "values ('tok-secret', %s, %s, 'hash', 'lp@x.example', %s)", (w["org"], w["audit"], w["users"]["Owner"]))
    assert client.get(f"/api/orgs/{w['org']}/export", headers=as_(w, "Analyst")).status_code == 403
    data = client.get(f"/api/orgs/{w['org']}/export", headers=as_(w, "Admin")).json()
    assert data["organisation"]["id"] == w["org"] and len(data["members"]) == 4
    assert data["companies"][0]["id"] == w["company"] and data["findings"][0]["title"] == "Runway is short"
    assert "model_version" not in data["audits"][0] and "output" not in data["audits"][0]
    text = str(data)
    assert "tok-secret" not in text and "'password_hash'" not in text
    with db.system() as c:
        assert c.execute("select 1 from audit_log where org_id = %s and action = 'org.exported'", (w["org"],)).fetchone()


def test_delete_org_needs_owner_name_and_no_live_subscription(api):
    client, w = api
    url = f"/api/orgs/{w['org']}"
    with db.system() as c:
        name = c.execute("select name from organisations where id = %s", (w["org"],)).fetchone()["name"]
        c.execute("update organisations set subscription_status = 'active' where id = %s", (w["org"],))
    assert client.request("DELETE", url, json={"confirm": name}, headers=as_(w, "Admin")).status_code == 403
    assert client.request("DELETE", url, json={"confirm": "wrong"}, headers=as_(w, "Owner")).status_code == 422
    r = client.request("DELETE", url, json={"confirm": name}, headers=as_(w, "Owner"))
    assert r.status_code == 409 and "Cancel the subscription" in r.json()["error"]
    with db.system() as c:
        c.execute("update organisations set subscription_status = 'canceled' where id = %s", (w["org"],))
    assert client.request("DELETE", url, json={"confirm": name.upper()}, headers=as_(w, "Owner")).status_code == 200
    with db.system() as c:
        assert not c.execute("select 1 from organisations where id = %s", (w["org"],)).fetchone()
        assert not c.execute("select 1 from companies where org_id = %s", (w["org"],)).fetchone()
        assert c.execute("select 1 from audit_log where org_id = %s and action = 'org.deleted'", (w["org"],)).fetchone()


def test_delete_account(api):
    client, w = api
    # An Owner with colleagues must hand over first.
    r = client.request("DELETE", "/api/me", json={"confirm": "DELETE"}, headers=as_(w, "Owner"))
    assert r.status_code == 409 and "Transfer ownership" in r.json()["error"]
    assert client.request("DELETE", "/api/me", json={"confirm": "nope"}, headers=as_(w, "Viewer")).status_code == 422
    assert client.request("DELETE", "/api/me", json={"confirm": "delete"}, headers=as_(w, "Viewer")).status_code == 200
    with db.system() as c:
        assert not c.execute("select 1 from auth.users where id = %s", (w["users"]["Viewer"],)).fetchone()
        assert c.execute("select 1 from organisations where id = %s", (w["org"],)).fetchone()


def test_sole_owner_deleting_account_removes_their_organisation(api):
    client, w = api
    with db.system() as c:
        c.execute("delete from memberships where org_id = %s and role <> 'Owner'", (w["org"],))
    assert client.request("DELETE", "/api/me", json={"confirm": "DELETE"}, headers=as_(w, "Owner")).status_code == 200
    with db.system() as c:
        assert not c.execute("select 1 from organisations where id = %s", (w["org"],)).fetchone()


def test_free_audits_are_deleted_after_twelve_months(api):
    client, w = api
    from ava_server import privacy
    co = {"title": "Oldco", "description": "Clinic software that books physiotherapy appointments for private practices in the UK, paid monthly per clinician, with 40 paying clinics today.", "industry": "Healthcare", "country": "United Kingdom"}
    old = client.post("/api/free-audit", json={"email": f"a@old{w['tag']}.example", "company": co}).json()["id"]
    kept = client.post("/api/free-audit", json={"email": f"a@kept{w['tag']}.example", "company": co}).json()["id"]
    new = client.post("/api/free-audit", json={"email": f"a@new{w['tag']}.example", "company": co}).json()["id"]
    with db.system() as c:
        c.execute("update free_audits set created_at = now() - interval '13 months' where id = any(%s)", ([old, kept],))
        c.execute("update free_audits set converted_org = %s where id = %s", (w["org"], kept))
        old_company = c.execute("select a.company_id from free_audits f join audits a on a.id = f.audit_id where f.id = %s", (old,)).fetchone()["company_id"]
    assert privacy.purge_expired_free_audits() >= 1
    with db.system() as c:
        left = {r["id"] for r in c.execute("select id from free_audits where id = any(%s)", ([old, kept, new],)).fetchall()}
        assert left == {kept, new}
        assert not c.execute("select 1 from companies where id = %s", (old_company,)).fetchone()
        assert not c.execute("select 1 from audits where company_id = %s", (old_company,)).fetchone()
