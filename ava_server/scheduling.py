"""Monitoring cadence (spec 4.4): organisation default, per-company override,
pause with optional resume date, and the scheduled job that queues due audits."""

from __future__ import annotations

import calendar
from datetime import date

from . import db


def effective_mode(company: dict, org: dict) -> str:
    mode = (company.get("cadence") or {}).get("mode", "inherit")
    return (org.get("default_cadence") or {}).get("mode", "quarterly") if mode == "inherit" else mode


def next_run_for(company: dict, org: dict, today: date | None = None) -> str | None:
    today = today or date.today()
    cad = company.get("cadence") or {}
    if cad.get("paused"):
        resume = cad.get("resumeOn")
        if not resume or date.fromisoformat(resume) > today:
            return None
    mode = effective_mode(company, org)
    if mode == "off":
        return None
    months = 1 if mode == "monthly" else 3
    day = max(1, min(28, int((org.get("default_cadence") or {}).get("day", 1))))
    m = today.month - 1 + months
    y = today.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(day, calendar.monthrange(y, m)[1])).isoformat()


def queue_due(today: date | None = None) -> list[str]:
    """Queue scheduled and due audits. Run daily by the cron."""
    from .lifecycle import create_audit

    today = today or date.today()
    queued = []
    with db.system() as c:
        due = c.execute(
            "select c.*, o.default_cadence, o.id as oid from companies c join organisations o on o.id = c.org_id "
            "where (c.next_run is not null and c.next_run <= %s) or (c.scheduled_audit is not null and c.scheduled_audit <= %s)",
            (today, today)).fetchall()
        # Lift pauses whose resume date has arrived.
        c.execute("update companies set cadence = cadence || '{\"paused\": false, \"resumeOn\": null}' "
                  "where (cadence ->> 'paused')::boolean and (cadence ->> 'resumeOn') is not null and (cadence ->> 'resumeOn')::date <= %s", (today,))
    for row in due:
        if (row["cadence"] or {}).get("paused") and not row["scheduled_audit"]:
            continue
        running = None
        with db.system() as c:
            running = c.execute("select 1 from audits where company_id = %s and status in ('queued', 'running')", (row["id"],)).fetchone()
        if running:
            continue
        from .lifecycle import InsufficientInput
        from .plans import AllowanceReached
        try:
            queued.append(create_audit(None, row["id"], trigger="scheduled"))
        except (InsufficientInput, AllowanceReached):
            pass  # too thin to audit, or the plan's allowance is used; next_run still moves on below
        with db.system() as c:
            org = {"default_cadence": row["default_cadence"]}
            c.execute("update companies set scheduled_audit = null, next_run = %s where id = %s",
                      (next_run_for(row, org, today), row["id"]))
    return queued
