import os
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ROLES = ["Owner", "Admin", "Analyst", "Viewer"]
DESC = "Clinic software that books physiotherapy appointments for private practices in the UK, paid monthly per clinician, with 40 paying clinics today."


def _apply(conn, path: Path):
    conn.execute(path.read_text())


@pytest.fixture(scope="session")
def database_url():
    """A fresh database with the shim and every migration applied.

    Needs AVA_TEST_DATABASE_URL (see scripts/test-db.sh). Tests that use it are
    skipped when it is not set.
    """
    base = os.environ.get("AVA_TEST_DATABASE_URL")
    if not base:
        pytest.skip("AVA_TEST_DATABASE_URL is not set; run: eval \"$(scripts/test-db.sh)\"")
    import psycopg

    name = f"ava_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    url = base.rsplit("/", 1)[0] + "/" + name
    with psycopg.connect(url, autocommit=True) as conn:
        _apply(conn, ROOT / "tests_py/sql/supabase_shim.sql")
        for m in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            _apply(conn, m)
    from ava_server import db
    db.configure(url)
    yield url
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(f'drop database "{name}" with (force)')


@pytest.fixture()
def world(database_url):
    """One organisation with a user per role, a guest, a company, an audit and a finding."""
    from ava_server import db

    tag = uuid.uuid4().hex[:6]
    users = {}
    with db.system() as c:
        org = c.execute("insert into organisations (name, plan) values (%s, 'pro-max') returning id", (f"Fund {tag}",)).fetchone()["id"]
        for role in ROLES + ["Guest"]:
            uid = c.execute("insert into auth.users (email) values (%s) returning id", (f"{role.lower()}-{tag}@fund.example",)).fetchone()["id"]
            c.execute("insert into profiles (user_id, name, email) values (%s, %s, %s)", (uid, f"{role} {tag}", f"{role.lower()}-{tag}@fund.example"))
            if role != "Guest":
                c.execute("insert into memberships (org_id, user_id, role) values (%s, %s, %s)", (org, uid, role))
            users[role] = str(uid)
        company = c.execute("insert into companies (org_id, title, description, industry, country) values (%s, %s, %s, 'Healthcare', 'United Kingdom') returning id", (org, f"Co {tag}", DESC)).fetchone()["id"]
        audit = c.execute("insert into audits (org_id, company_id, status, score, final_directive) values (%s, %s, 'complete', 50, 'HOLD') returning id", (org, company)).fetchone()["id"]
        finding = c.execute(
            "insert into findings (audit_id, org_id, company_id, agent, section, category, severity, match_key, title, text) "
            "values (%s, %s, %s, 1, 'fin', 'Financial', 'HIGH', 'k', 'Runway is short', 'Cash lasts six months.') returning id",
            (audit, org, company)).fetchone()["id"]
    return {"org": org, "users": users, "company": company, "audit": audit, "finding": finding, "tag": tag}
