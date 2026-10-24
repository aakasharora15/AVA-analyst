"""Spec 4.8 permission matrix, enforced by row-level security.

One test per row of the matrix, each run for every role, asserting both the
allowed and the denied cases against a real Postgres.
"""

import psycopg
import pytest

from ava_server import db

ALL = ["Owner", "Admin", "Analyst", "Viewer", "Guest"]


def attempt(world, role, fn):
    """Run fn(conn) as the role's user. True if it succeeded and changed a row."""
    try:
        with db.as_user(world["users"][role]) as c:
            return bool(fn(c))
    except psycopg.Error:
        return False


def rows(cur):
    return cur.rowcount > 0


@pytest.mark.parametrize("role", ALL)
def test_billing_contact_owner_only(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute("update organisations set billing_contact = 'ap@fund.example' where id = %s", (world["org"],))))
    assert ok == (role == "Owner")


@pytest.mark.parametrize("role", ALL)
def test_plan_changes_only_through_billing(world, role):
    """The plan is a paid entitlement: no user, not even the Owner, can upgrade it."""
    ok = attempt(world, role, lambda c: rows(c.execute("update organisations set plan = 'enterprise' where id = %s", (world["org"],))))
    assert ok is False


@pytest.mark.parametrize("role", ALL)
def test_delete_organisation_owner_only(world, role):
    try:
        with db.as_user(world["users"][role]) as c:
            n = c.execute("delete from organisations where id = %s", (world["org"],)).rowcount
            c.rollback()
            deleted = n > 0
    except psycopg.Error:
        deleted = False
    assert deleted == (role == "Owner")


@pytest.mark.parametrize("role", ALL)
def test_manage_members_owner_admin(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "update memberships set role = 'Analyst' where org_id = %s and user_id = %s", (world["org"], world["users"]["Viewer"]))))
    assert ok == (role in ("Owner", "Admin"))


@pytest.mark.parametrize("role", ALL)
def test_nobody_but_transfer_changes_the_owner(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "update memberships set role = 'Admin' where org_id = %s and user_id = %s", (world["org"], world["users"]["Owner"]))))
    assert ok is False


@pytest.mark.parametrize("role", ALL)
def test_alert_rules_and_cadence_owner_admin(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "update organisations set alert_rules = alert_rules || '{\"evidence\": true}', default_cadence = '{\"mode\": \"monthly\", \"day\": 3}' where id = %s",
        (world["org"],))))
    assert ok == (role in ("Owner", "Admin"))


@pytest.mark.parametrize("role", ALL)
def test_create_companies_import_run_audits(world, role):
    allowed = role in ("Owner", "Admin", "Analyst")
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into companies (org_id, title, industry, country) values (%s, %s, 'Education', 'United Kingdom')",
        (world["org"], f"New {role} {world['tag']}"))))
    assert ok == allowed
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into import_jobs (org_id, file, rows_valid) values (%s, 'x.csv', 1)", (world["org"],))))
    assert ok == allowed
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into audits (org_id, company_id) values (%s, %s)", (world["org"], world["company"]))))
    assert ok == allowed


@pytest.mark.parametrize("role", ALL)
def test_users_cannot_write_scores(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into audits (org_id, company_id, status, score) values (%s, %s, 'complete', 99)", (world["org"], world["company"]))))
    assert ok is False
    ok = attempt(world, role, lambda c: rows(c.execute("update audits set score = 99 where id = %s", (world["audit"],))))
    assert ok is False


@pytest.mark.parametrize("role", ALL)
def test_upload_to_data_room(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into sources (org_id, company_id, type, title) values (%s, %s, 'uploaded', 'Deck')", (world["org"], world["company"]))))
    assert ok == (role in ("Owner", "Admin", "Analyst"))


@pytest.mark.parametrize("role", ALL)
def test_change_finding_status_and_owner(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "update findings set status = 'accepted', owner = 'Someone' where id = %s", (world["finding"],))))
    assert ok == (role in ("Owner", "Admin", "Analyst"))


@pytest.mark.parametrize("role", ["Owner", "Admin", "Analyst"])
def test_finding_content_is_system_owned(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute("update findings set severity = 'LOW' where id = %s", (world["finding"],))))
    assert ok is False


def test_dismiss_needs_a_reason(world):
    assert attempt(world, "Analyst", lambda c: rows(c.execute("update findings set status = 'dismissed' where id = %s", (world["finding"],)))) is False
    assert attempt(world, "Analyst", lambda c: rows(c.execute(
        "update findings set status = 'dismissed', dismiss_reason = 'Fixed by new contract' where id = %s", (world["finding"],)))) is True


@pytest.mark.parametrize("role", ALL)
def test_comment_on_findings(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into comments (finding_id, org_id, author_id, text) values (%s, %s, %s, 'Agree')",
        (world["finding"], world["org"], world["users"][role]))))
    assert ok == (role != "Guest")


@pytest.mark.parametrize("role", ALL)
def test_export_and_share(world, role):
    ok = attempt(world, role, lambda c: rows(c.execute(
        "insert into share_links (org_id, audit_id, recipient_email, created_by) values (%s, %s, 'lp@example.com', %s)",
        (world["org"], world["audit"], world["users"][role]))))
    assert ok == (role != "Guest")


@pytest.mark.parametrize("role", ALL)
def test_view_reports(world, role):
    def fn(c):
        return c.execute("select id from audits where id = %s", (world["audit"],)).fetchone() is not None
    assert attempt(world, role, fn) == (role != "Guest")


def test_guest_cannot_see_other_organisations(world, database_url):
    # A member of one organisation sees nothing of another.
    with db.system() as c:
        other = c.execute("insert into organisations (name) values ('Other fund') returning id").fetchone()["id"]
        c.execute("insert into companies (org_id, title, industry, country) values (%s, 'Hidden Ltd', 'Other', 'United Kingdom')", (other,))
    with db.as_user(world["users"]["Owner"]) as c:
        titles = [r["title"] for r in c.execute("select title from companies").fetchall()]
    assert "Hidden Ltd" not in titles


def test_every_change_is_logged(world):
    with db.as_user(world["users"]["Analyst"]) as c:
        c.execute("update findings set status = 'accepted' where id = %s", (world["finding"],))
    with db.system() as c:
        log = c.execute("select who, action, detail from audit_log where object_id = %s order by id desc limit 1", (world["finding"],)).fetchone()
    assert log["action"] == "findings.update"
    assert log["who"].startswith("Analyst")
    assert "Accepted" in log["detail"]


def test_checkpoints_are_immutable(world):
    with db.system() as c:
        c.execute("update audits set first_checkpoint = '2027-10-01', final_checkpoint = '2028-10-01', outcome_window_version = 'ow-1' where id = %s", (world["audit"],))
    with pytest.raises(psycopg.Error):
        with db.system() as c:
            c.execute("update audits set first_checkpoint = '2030-01-01' where id = %s", (world["audit"],))
