"""Plan allowances (config/plans.json). Checked before any audit starts, so no
model call is made once an organisation has used its allowance."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .config import PLANS, plan_id

FREE_ORG = "free-audits"  # holds free audits; limited separately (one per domain per month)


class AllowanceReached(PermissionError):
    """The organisation's plan does not allow another audit right now."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def trial_end(start: datetime | None = None) -> datetime:
    return (start or _now()) + timedelta(days=PLANS["trial"]["trialDays"])


def period_start(org: dict) -> datetime:
    """Start of the counting period: the whole trial, otherwise the calendar month."""
    if plan_id(org.get("plan")) == "trial":
        return org["created_at"]
    now = _now()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def audits_used(c, org: dict) -> int:
    """Audits that count: everything started in the period except failed or
    declined ones (they never count) and internal consistency re-runs."""
    return c.execute(
        "select count(*) as n from audits where org_id = %s and trigger <> 'shadow' and status <> 'failed' "
        "and counted_against_usage and created_at >= %s", (org["id"], period_start(org))).fetchone()["n"]


def check_allowance(c, org: dict) -> None:
    if org["id"] == FREE_ORG:
        return
    pid = plan_id(org.get("plan"))
    plan = PLANS[pid]
    if pid == "trial" and org.get("trial_ends_at") and _now() > org["trial_ends_at"]:
        if org.get("subscription_status") in ("canceled", "unpaid", "incomplete_expired"):
            raise AllowanceReached("Your subscription has ended. Choose a plan to keep running audits. Your reports are kept.")
        raise AllowanceReached("Your free trial has ended. Choose a plan to keep running audits.")
    limit = plan["audits"]
    if limit is not None and audits_used(c, org) >= limit:
        if pid == "trial":
            raise AllowanceReached(f"Your free trial includes {limit} audits and you have used them all. Choose a plan to keep going.")
        raise AllowanceReached(f"Your {plan['name']} plan includes {limit} audits a month and you have used them all. "
                               "Upgrade your plan, or wait until next month.")
