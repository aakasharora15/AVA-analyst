"""Data export and deletion (UK GDPR rights of access, portability and erasure).

Export: everything an organisation has put into AVA or received from it, as
JSON. Internal engine detail (which model ran, raw model output, token usage)
and secrets (share and invite tokens, password hashes) are left out.

Deletion: an Owner deletes the organisation; any user deletes their own
account. Data-room files are removed through the Storage API when
SUPABASE_SERVICE_ROLE_KEY is set; otherwise the operations inbox is told which
folder to purge, so nothing is silently left behind.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import httpx

from . import db, emailer
from .config import settings

# Table -> columns never exported.
HIDDEN = {
    "organisations": {"stripe_customer_id", "stripe_subscription_id"},
    "audits": {"model_version", "served_model", "usage", "output", "snapshot", "snapshot_hash"},
    "invites": {"token"},
    "share_links": {"token", "password_hash"},
    "report_questions": {"usage"},
}
TABLES = ("companies", "audits", "findings", "sources", "comments", "alerts", "outcomes", "share_links", "invites", "import_jobs", "finding_challenges", "report_questions", "audit_log")
LIVE_SUBSCRIPTION = ("active", "trialing", "past_due")


class DeletionBlocked(Exception):
    """Something must happen first (transfer ownership, cancel a subscription)."""


def _plain(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _clean(table: str, rows: list[dict]) -> list[dict]:
    hide = HIDDEN.get(table, set())
    out = [{k: _plain(v) for k, v in r.items() if k not in hide} for r in rows]
    if table == "audit_log":
        # Share-link and invite log entries use the link's token as their id: never export a working link.
        for r in out:
            if r.get("object_type") in ("share_links", "invites") and r.get("object_id"):
                r["object_id"] = str(r["object_id"])[:4] + "…"
    return out


def export_org(org_id: str) -> dict:
    with db.system() as c:
        org = c.execute("select * from organisations where id = %s", (org_id,)).fetchone()
        members = c.execute("select m.role, m.status, m.last_active, m.created_at as joined, p.name, p.email, p.title "
                            "from memberships m left join profiles p on p.user_id = m.user_id where m.org_id = %s", (org_id,)).fetchall()
        out = {"exportedAt": datetime.now(timezone.utc).isoformat(), "format": "AVA export v1",
               "organisation": _clean("organisations", [org])[0], "members": _clean("members", members)}
        for t in TABLES:
            out[t] = _clean(t, c.execute(f"select * from {t} where org_id = %s", (org_id,)).fetchall())  # noqa: S608 - fixed table names
    return out


def _owned(c, user: str) -> list[dict]:
    return c.execute("select o.id, o.name, o.subscription_status, "
                     "(select count(*) from memberships x where x.org_id = o.id and x.status = 'active' and x.user_id <> %s) as others "
                     "from memberships m join organisations o on o.id = m.org_id "
                     "where m.user_id = %s and m.role = 'Owner' and m.status = 'active'", (user, user)).fetchall()


def _purge_files(org_id: str, org_name: str) -> str:
    """Remove the organisation's data-room folder. Returns how it was handled."""
    s = settings()
    with db.system() as c:
        if not c.execute("select to_regclass('storage.objects') as t").fetchone()["t"]:
            return "no storage"
        names = [r["name"] for r in c.execute("select name from storage.objects where bucket_id = 'data-room' and name like %s",
                                              (f"{org_id}/%",)).fetchall()]
    if not names:
        return "no files"
    key = s.supabase_service_key
    if key and s.supabase_url:
        try:
            for i in range(0, len(names), 500):
                httpx.request("DELETE", f"{s.supabase_url.rstrip('/')}/storage/v1/object/data-room", timeout=30.0,
                              headers={"Authorization": f"Bearer {key}", "apikey": key}, json={"prefixes": names[i:i + 500]}).raise_for_status()
            return f"{len(names)} files deleted"
        except httpx.HTTPError as exc:
            print(f"storage purge failed for {org_id}: {exc}")
    if s.ops_email:
        with db.system() as c:
            emailer.queue(c, None, s.ops_email, f"AVA ops: purge data-room files for deleted organisation {org_name}",
                          f"Organisation {org_id} ({org_name}) was deleted. Remove the folder data-room/{org_id}/ "
                          f"({len(names)} files) in Supabase Storage.", "ops")
    return f"{len(names)} files queued for removal"


def delete_org(org_id: str) -> str:
    with db.system("Account deletion") as c:
        o = c.execute("select name, subscription_status from organisations where id = %s for update", (org_id,)).fetchone()
        if not o:
            return "gone"
        if o["subscription_status"] in LIVE_SUBSCRIPTION:
            raise DeletionBlocked("Cancel the subscription in Manage billing first, then delete the organisation.")
    files = _purge_files(org_id, o["name"])
    with db.system("Account deletion") as c:
        c.execute("delete from organisations where id = %s", (org_id,))
        c.execute("insert into audit_log (org_id, who, action, object_type, object_id, detail) values (%s, 'AVA', 'org.deleted', 'organisations', %s, %s)",
                  (org_id, org_id, f"Organisation deleted by its Owner. Data-room files: {files}."))
    return files


def delete_user(user: str) -> None:
    with db.system("Account deletion") as c:
        owned = _owned(c, user)
    shared = [o["name"] for o in owned if o["others"]]
    if shared:
        raise DeletionBlocked(f"Transfer ownership of {', '.join(shared)} to a colleague first, or remove its other members.")
    for o in owned:
        delete_org(o["id"])
    with db.system("Account deletion") as c:
        c.execute("delete from auth.users where id = %s", (user,))


FREE_AUDIT_RETENTION_MONTHS = 12


def purge_expired_free_audits() -> int:
    """Privacy policy: free audit data is deleted 12 months after the audit,
    unless the organisation signed up and kept it. Runs daily."""
    with db.system("Retention") as c:
        rows = c.execute(
            "select f.id, a.company_id from free_audits f left join audits a on a.id = f.audit_id "
            "where f.converted_org is null and f.created_at < now() - make_interval(months => %s)", (FREE_AUDIT_RETENTION_MONTHS,)).fetchall()
        companies = [r["company_id"] for r in rows if r["company_id"]]
        if companies:
            # Deleting the company removes its audit, findings, sources and agent runs (cascade).
            c.execute("delete from companies where id = any(%s) and org_id = 'free-audits'", (companies,))
        if rows:
            c.execute("delete from free_audits where id = any(%s)", ([r["id"] for r in rows],))
    return len(rows)
