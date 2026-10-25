"""Email (spec 4.7, 4.12). Every message goes through email_outbox first, so
nothing is lost when the provider is down and every send is auditable.
Provider: Resend over HTTPS when RESEND_API_KEY is set; otherwise messages
stay queued with an error noting that no provider is configured."""

from __future__ import annotations

import httpx

from . import db
from .config import settings


def footer() -> str:
    s = settings()
    return (f"\n\n--\nManage alert settings: {s.app_url}/alerts\n"
            f"Unsubscribe: {s.app_url}/account?tab=profile&unsubscribe=1\n")


def queue(conn, org_id: str | None, to_email: str, subject: str, body: str, kind: str) -> None:
    conn.execute("insert into email_outbox (org_id, to_email, subject, body, kind) values (%s, %s, %s, %s, %s)",
                 (org_id, to_email, subject, body + footer(), kind))


def send_pending(limit: int = 50) -> dict:
    s = settings()
    sent = failed = 0
    with db.system() as c:
        # A failed send is stored as "retry: <reason>" and tried again on later
        # runs for two days (for example while a sending domain is still being
        # verified). Rows queued while no provider was configured stay as they are.
        rows = c.execute("select * from email_outbox where sent_at is null and (error is null or "
                         "(error like 'retry:%%' and created_at > now() - interval '2 days')) "
                         "order by id limit %s for update skip locked", (limit,)).fetchall()
        for r in rows:
            if not s.resend_api_key:
                c.execute("update email_outbox set error = 'No email provider configured (set RESEND_API_KEY)' where id = %s", (r["id"],))
                failed += 1
                continue
            try:
                res = httpx.post("https://api.resend.com/emails", timeout=15.0,
                                 headers={"Authorization": f"Bearer {s.resend_api_key}"},
                                 json={"from": s.email_from, "to": [r["to_email"]], "subject": r["subject"], "text": r["body"]})
                res.raise_for_status()
                c.execute("update email_outbox set sent_at = now(), error = null where id = %s", (r["id"],))
                sent += 1
            except httpx.HTTPError as exc:
                c.execute("update email_outbox set error = %s where id = %s", (f"retry: {exc}"[:500], r["id"]))
                failed += 1
    return {"sent": sent, "failed": failed}
