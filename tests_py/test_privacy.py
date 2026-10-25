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
