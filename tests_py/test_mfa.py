"""Two-factor: a user with a verified authenticator needs an aal2 session,
in the API and in the database. Users without one are unaffected."""

import pytest

from ava_server import db
from tests_py.test_api import api, as_, token  # noqa: F401  (fixture re-export)


@pytest.fixture()
def analyst_with_2fa(api):
    client, w = api
    uid = w["users"]["Analyst"]
    with db.system() as c:
        c.execute("insert into auth.mfa_factors (user_id, status) values (%s, 'verified')", (uid,))
    yield client, w, uid
    with db.system() as c:
        c.execute("delete from auth.mfa_factors where user_id = %s", (uid,))


def test_api_requires_second_factor_when_enrolled(analyst_with_2fa):
    client, w, uid = analyst_with_2fa
    path = f"/api/findings/{w['finding']}/comments"
    r = client.post(path, json={"text": "Check runway"}, headers=token(uid, aal="aal1"))
    assert r.status_code == 401 and "authenticator" in r.json()["error"]
    assert client.post(path, json={"text": "Check runway"}, headers=token(uid, aal="aal2")).status_code == 200
    # Someone without two-factor is not asked for it.
    assert client.post(path, json={"text": "Fine"}, headers=token(w["users"]["Viewer"], aal="aal1")).status_code == 200


def test_database_hides_data_from_an_aal1_session(analyst_with_2fa):
    _, w, uid = analyst_with_2fa
    with db.as_user(uid, aal="aal1") as c:
        assert c.execute("select count(*) as n from companies").fetchone()["n"] == 0
    with db.as_user(uid, aal="aal2") as c:
        assert c.execute("select count(*) as n from companies where org_id = %s", (w["org"],)).fetchone()["n"] == 1
    with db.as_user(w["users"]["Viewer"], aal="aal1") as c:
        assert c.execute("select count(*) as n from companies where org_id = %s", (w["org"],)).fetchone()["n"] == 1
