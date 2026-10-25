"""Verified company metrics (plans with "tracking" in config/plans.json).

The monthly loop, run by the daily cadence job:
  1st of the month  each tracked company gets a request for last month's
                    numbers: a private link to the founder, or a task for the
                    company owner when no founder email is set.
  day 7             one reminder.
  day 14            the company owner (or organisation Owner) is told the
                    numbers have not arrived.
Founders submit through the link; the client's team confirms (or enters the
numbers themselves); an AVA reviewer then verifies or queries them. Confirmed
numbers that move materially raise an alert, the same way a score move does.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone

from . import db, emailer
from .config import PLANS, plan_id, settings

STATUSES = ("operating", "raising", "acquired", "shut_down", "paused")
FIELDS = ("revenue", "cash", "burn", "headcount", "customers")
LINK_DAYS = 30
REMIND_AFTER = timedelta(days=7)
ESCALATE_AFTER = timedelta(days=14)
RUNWAY_ALERT_MONTHS = 6
REVENUE_DROP_ALERT = 0.2

TRACKING_PLANS = {k for k, v in PLANS.items() if v.get("tracking")}


def tracked(plan: str | None) -> bool:
    return plan_id(plan) in TRACKING_PLANS


def last_period(today: date | None = None) -> date:
    """The month being reported: the one that has just ended."""
    first = (today or date.today()).replace(day=1)
    return (first - timedelta(days=1)).replace(day=1)


def period_label(p: date) -> str:
    return p.strftime("%B %Y")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def runway(row: dict | None) -> float | None:
    if not row or not row.get("burn") or row.get("cash") is None:
        return None
    return round(float(row["cash"]) / float(row["burn"]), 1)


def sanity(values: dict, previous: dict | None) -> list[str]:
    """Things a reviewer should look at. Never blocks a submission."""
    flags = []
    rw = runway(values)
    if rw is not None and rw < 3:
        flags.append(f"Runway under 3 months ({rw})")
    if previous:
        for f, label in (("revenue", "Revenue"), ("cash", "Cash"), ("headcount", "Headcount"), ("customers", "Customers")):
            a, b = previous.get(f), values.get(f)
            if a and b is not None and float(a) > 0:
                change = (float(b) - float(a)) / float(a)
                if abs(change) >= 0.5:
                    flags.append(f"{label} {'up' if change > 0 else 'down'} {abs(round(change * 100))}% on last month")
        if previous.get("cash") is not None and values.get("cash") is not None and values.get("burn"):
            expected = float(previous["cash"]) - float(values["burn"])
            if float(values["cash"]) > expected * 1.5 + 1 and values.get("status") != "raising":
                flags.append("Cash rose more than burn explains: new funding?")
    if values.get("burn") and values.get("revenue") is not None and float(values["revenue"]) > float(values["burn"]) * 20:
        flags.append("Revenue is over 20 times burn: check units")
    return flags


def _previous(c, company_id: str, period: date) -> dict | None:
    return c.execute("select * from company_metrics where company_id = %s and period < %s order by period desc limit 1",
                     (company_id, period)).fetchone()


def _owner_email(c, company: dict) -> str | None:
    if company.get("owner_id"):
        r = c.execute("select p.email from profiles p join memberships m on m.user_id = p.user_id and m.org_id = %s and m.status = 'active' "
                      "where p.user_id = %s", (company["org_id"], company["owner_id"])).fetchone()
        if r:
            return r["email"]
    r = c.execute("select p.email from memberships m join profiles p on p.user_id = m.user_id "
                  "where m.org_id = %s and m.role = 'Owner' and m.status = 'active'", (company["org_id"],)).fetchone()
    return r["email"] if r else None


def create_request(c, company: dict, period: date, org_name: str) -> str | None:
    """Create and email this month's request. Returns the link token (founder kind) or None."""
    app = settings().app_url
    label = period_label(period)
    if company.get("founder_email"):
        token = secrets.token_urlsafe(24)
        c.execute("insert into metric_requests (org_id, company_id, period, kind, email, token_hash, expires_at) "
                  "values (%s, %s, %s, 'founder', %s, %s, %s) on conflict (company_id, period) do nothing",
                  (company["org_id"], company["id"], period, company["founder_email"], hash_token(token),
                   datetime.now(timezone.utc) + timedelta(days=LINK_DAYS)))
        emailer.queue(c, company["org_id"], company["founder_email"], f"{org_name}: your {label} numbers for {company['title']}",
                      f"{org_name} tracks {company['title']} with AVA. Please share your numbers for {label}: revenue, cash, "
                      f"monthly burn, headcount and customers. It takes about two minutes and needs no account.\n\n"
                      f"{app}/update/{token}\n\nThe link is private to you and expires in {LINK_DAYS} days.", "metrics")
        return token
    owner = _owner_email(c, company)
    if not owner:
        return None
    c.execute("insert into metric_requests (org_id, company_id, period, kind, email, token_hash, expires_at) "
              "values (%s, %s, %s, 'team', %s, %s, %s) on conflict (company_id, period) do nothing",
              (company["org_id"], company["id"], period, owner, hash_token(secrets.token_urlsafe(24)),
               datetime.now(timezone.utc) + timedelta(days=LINK_DAYS)))
    emailer.queue(c, company["org_id"], owner, f"Update {company['title']}'s {label} numbers",
                  f"It is time to record {company['title']}'s numbers for {label}.\n\n{app}/company/{company['id']}#metrics\n\n"
                  "Tip: add the founder's email on the company page and AVA will ask them directly each month.", "metrics")
    return None


def run_daily(today: date | None = None) -> dict:
    """Issue this month's requests, then reminders and escalations."""
    today = today or date.today()
    period = last_period(today)
    now = datetime.now(timezone.utc)
    issued = reminded = escalated = 0
    with db.system("AVA") as c:
        orgs = [o for o in c.execute("select id, name, plan from organisations").fetchall() if tracked(o["plan"])]
        for o in orgs:
            companies = c.execute(
                "select co.* from companies co where co.org_id = %s and not exists "
                "(select 1 from metric_requests r where r.company_id = co.id and r.period = %s) and not exists "
                "(select 1 from company_metrics m where m.company_id = co.id and m.period = %s)", (o["id"], period, period)).fetchall()
            for co in companies:
                create_request(c, co, period, o["name"])
                issued += 1
        open_reqs = c.execute(
            "select r.*, co.title, co.owner_id, co.org_id, o.name as org_name from metric_requests r "
            "join companies co on co.id = r.company_id join organisations o on o.id = r.org_id "
            "where r.submitted_at is null and r.expires_at > now() and (r.reminded_at is null or r.escalated_at is null)").fetchall()
        for r in open_reqs:
            if not tracked(c.execute("select plan from organisations where id = %s", (r["org_id"],)).fetchone()["plan"]):
                continue
            age = now - r["created_at"]
            label = period_label(r["period"])
            if r["reminded_at"] is None and age >= REMIND_AFTER:
                c.execute("update metric_requests set reminded_at = now() where id = %s", (r["id"],))
                emailer.queue(c, r["org_id"], r["email"], f"Reminder: {r['title']} numbers for {label}",
                              f"A reminder that {r['title']}'s numbers for {label} have not arrived yet. "
                              "Please use the link in the earlier email" + (" (it stays valid for the rest of the month)." if r["kind"] == "founder"
                                                                            else f": {settings().app_url}/company/{r['company_id']}#metrics"), "metrics")
                reminded += 1
            elif r["escalated_at"] is None and age >= ESCALATE_AFTER:
                c.execute("update metric_requests set escalated_at = now() where id = %s", (r["id"],))
                owner = _owner_email(c, {"org_id": r["org_id"], "owner_id": r["owner_id"]})
                if owner:
                    emailer.queue(c, r["org_id"], owner, f"{r['title']}: {label} numbers still missing",
                                  f"{r['title']}'s numbers for {label} were requested from {r['email']} two weeks ago and have not arrived.\n\n"
                                  f"Enter them yourself or follow up: {settings().app_url}/company/{r['company_id']}#metrics", "metrics")
                escalated += 1
    return {"issued": issued, "reminded": reminded, "escalated": escalated}


def material_moves(row: dict, previous: dict | None) -> list[str]:
    """Moves worth an alert once numbers are confirmed."""
    out = []
    rw, prw = runway(row), runway(previous)
    if rw is not None and rw < RUNWAY_ALERT_MONTHS and (prw is None or prw >= RUNWAY_ALERT_MONTHS):
        out.append(f"Runway fell to {rw} months")
    if previous and previous.get("revenue") and row.get("revenue") is not None:
        change = (float(row["revenue"]) - float(previous["revenue"])) / float(previous["revenue"])
        if change <= -REVENUE_DROP_ALERT:
            out.append(f"Revenue down {abs(round(change * 100))}% on the last report")
    if row.get("status") in ("shut_down", "acquired") and (not previous or previous.get("status") != row["status"]):
        out.append("Reported " + ("shut down" if row["status"] == "shut_down" else "acquired") + ": log the outcome")
    return out


def after_confirm(c, row: dict) -> list[str]:
    moves = material_moves(row, _previous(c, row["company_id"], row["period"]))
    if moves:
        c.execute("insert into alerts (org_id, company_id, trigger, detail) values (%s, %s, 'metrics', %s)",
                  (row["org_id"], row["company_id"], f"{period_label(row['period'])}: " + "; ".join(moves) + ". Consider a re-audit."))
    return moves


def upsert(c, company: dict, period: date, values: dict, source: str, who: str, confirm_user: str | None = None) -> dict:
    """Store a month's numbers. A team entry is confirmed by the person entering it."""
    prev = _previous(c, company["id"], period)
    flags = sanity(values, prev)
    existing = c.execute("select * from company_metrics where company_id = %s and period = %s for update", (company["id"], period)).fetchone()
    if existing and existing["ava_status"] == "verified":
        raise ValueError("These numbers are already verified by AVA. Contact AVA to correct them.")
    cols = {f: values.get(f) for f in FIELDS}
    cols.update({"status": values.get("status") or "operating", "note": (values.get("note") or "")[:2000],
                 "flags": db.jsonb(flags), "source": source if not existing else existing["source"]})
    if existing and source == "founder" and existing["confirmed_at"]:
        raise ValueError("Your numbers for this month have already been confirmed. Contact the team if something needs correcting.")
    if confirm_user:
        cols.update({"confirmed_by": confirm_user, "confirmed_by_name": who, "confirmed_at": datetime.now(timezone.utc),
                     "ava_status": "pending", "ava_reviewer": None, "ava_reviewed_at": None})
    if existing:
        sets = ", ".join(f"{k} = %s" for k in cols)
        row = c.execute(f"update company_metrics set {sets} where id = %s returning *", (*cols.values(), existing["id"])).fetchone()  # noqa: S608
    else:
        cols.update({"org_id": company["org_id"], "company_id": company["id"], "period": period, "submitted_by": who})
        names = ", ".join(cols)
        row = c.execute(f"insert into company_metrics ({names}) values ({', '.join(['%s'] * len(cols))}) returning *",  # noqa: S608
                        tuple(cols.values())).fetchone()
    c.execute("insert into audit_log (org_id, who, action, object_type, object_id, detail) values (%s, %s, %s, 'company_metrics', %s, %s)",
              (company["org_id"], who, "metrics.confirmed" if confirm_user else "metrics.submitted", row["id"],
               f"{'Confirmed' if confirm_user else 'Submitted'} {period_label(period)} numbers for {company['title']}"))
    return row
