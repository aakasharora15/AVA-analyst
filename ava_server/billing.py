"""Billing through Stripe (Checkout, Customer Portal, webhooks).

Stripe is the only writer of an organisation's plan: the database guard
(migration 7) lets only the system role change plan, limits and subscription
state, and this module runs as the system role from the signed webhook.

Switched off until STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the price ids
are set; until then the site sends people to the contact route instead.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timezone

import httpx

from . import db
from .config import PLANS, settings

API = "https://api.stripe.com/v1"
TOLERANCE_S = 300
LIVE_STATUSES = {"active", "trialing", "past_due"}
ENDED_STATUSES = {"canceled", "unpaid", "incomplete_expired"}


class BillingError(Exception):
    """A request Stripe or the configuration cannot satisfy."""


def prices() -> dict[str, str]:
    """Plan id -> Stripe price id, for the self-serve plans that are configured."""
    s = settings()
    return {k: v for k, v in s.stripe_prices.items() if v}


def available() -> bool:
    s = settings()
    return bool(s.stripe_secret_key and s.stripe_webhook_secret and prices())


def _stripe(method: str, path: str, data: dict | None = None) -> dict:
    s = settings()
    try:
        res = httpx.request(method, f"{API}{path}", data=data, timeout=20.0,
                            headers={"Authorization": f"Bearer {s.stripe_secret_key}"})
    except httpx.HTTPError as exc:
        raise BillingError("Billing is unavailable right now. Try again in a minute.") from exc
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        # Stripe's own message is written for developers; log it, show a plain one.
        print(f"stripe {path} {res.status_code}: {(body.get('error') or {}).get('message')}")
        raise BillingError("Billing could not complete that request. Try again, or contact us.")
    return body


def checkout_url(org: dict, plan: str, email: str) -> str:
    price = prices().get(plan)
    if not price:
        raise BillingError("That plan cannot be bought online. Contact us.")
    app = settings().app_url
    data = {
        "mode": "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        "client_reference_id": org["id"],
        "metadata[org_id]": org["id"],
        "subscription_data[metadata][org_id]": org["id"],
        "allow_promotion_codes": "true",
        "billing_address_collection": "required",
        "tax_id_collection[enabled]": "true",
        "success_url": f"{app}/account?tab=billing&checkout=success",
        "cancel_url": f"{app}/account?tab=billing&checkout=cancelled",
    }
    if org.get("stripe_customer_id"):
        data["customer"] = org["stripe_customer_id"]
        data["customer_update[name]"] = "auto"
        data["customer_update[address]"] = "auto"
    else:
        data["customer_email"] = email
    return _stripe("POST", "/checkout/sessions", data)["url"]


def portal_url(org: dict) -> str:
    if not org.get("stripe_customer_id"):
        raise BillingError("There is no subscription to manage yet.")
    return _stripe("POST", "/billing_portal/sessions", {
        "customer": org["stripe_customer_id"],
        "return_url": f"{settings().app_url}/account?tab=billing",
    })["url"]


# ---------------------------------------------------------------------------
# Webhook


def verify(payload: bytes, header: str, secret: str, now: float | None = None) -> None:
    """Stripe's signature scheme: HMAC-SHA256 over "{t}.{payload}", within a time tolerance."""
    parts: dict[str, list[str]] = {}
    for item in (header or "").split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts["t"][0])
    except (KeyError, ValueError) as exc:
        raise BillingError("Bad signature") from exc
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", [])):
        raise BillingError("Bad signature")
    if abs((now or time.time()) - ts) > TOLERANCE_S:
        raise BillingError("Stale event")


def _plan_for_price(price_id: str | None) -> str | None:
    return next((plan for plan, p in prices().items() if p == price_id), None)


def _ts(value) -> datetime | None:
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None


def _org_for(c, obj: dict) -> str | None:
    oid = (obj.get("metadata") or {}).get("org_id") or obj.get("client_reference_id")
    if oid and c.execute("select 1 from organisations where id = %s", (oid,)).fetchone():
        return oid
    if obj.get("customer"):
        r = c.execute("select id from organisations where stripe_customer_id = %s", (obj["customer"],)).fetchone()
        return r["id"] if r else None
    return None


def _apply_subscription(c, org_id: str, sub: dict) -> None:
    status = sub.get("status")
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    period_end = _ts(item.get("current_period_end") or sub.get("current_period_end"))
    plan = _plan_for_price((item.get("price") or {}).get("id"))
    if status in LIVE_STATUSES and plan:
        c.execute(
            "update organisations set plan = %s, seat_limit = %s, stripe_customer_id = coalesce(stripe_customer_id, %s), "
            "stripe_subscription_id = %s, subscription_status = %s, current_period_end = %s, renewal_date = %s, "
            "cancel_at_period_end = %s where id = %s",
            (plan, PLANS[plan]["seats"], sub.get("customer"), sub.get("id"), status, period_end,
             period_end.date() if period_end else None, bool(sub.get("cancel_at_period_end")), org_id))
    elif status in ENDED_STATUSES:
        _lapse(c, org_id, status)
    else:  # incomplete: payment not yet confirmed, nothing changes but the status
        c.execute("update organisations set subscription_status = %s where id = %s", (status, org_id))


def _lapse(c, org_id: str, status: str = "canceled") -> None:
    """The subscription has ended: back to an expired trial (no new audits; data kept)."""
    c.execute(
        "update organisations set plan = 'trial', seat_limit = %s, subscription_status = %s, renewal_date = null, "
        "cancel_at_period_end = false, trial_ends_at = least(coalesce(trial_ends_at, now()), now()) where id = %s",
        (PLANS["trial"]["seats"], status, org_id))


def handle(event: dict) -> str:
    """Apply one verified event. Returns what happened, for the response and logs."""
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    with db.system("Billing") as c:
        org_id = _org_for(c, obj)
        fresh = c.execute("insert into billing_events (id, type, org_id) values (%s, %s, %s) on conflict (id) do nothing returning id",
                          (event.get("id"), etype, org_id)).fetchone()
        if not fresh:
            return "duplicate"
        if not org_id:
            return "no organisation"
        if etype == "checkout.session.completed":
            c.execute("update organisations set stripe_customer_id = coalesce(stripe_customer_id, %s), "
                      "stripe_subscription_id = coalesce(%s, stripe_subscription_id) where id = %s",
                      (obj.get("customer"), obj.get("subscription"), org_id))
            return "linked"
        if etype in ("customer.subscription.created", "customer.subscription.updated"):
            _apply_subscription(c, org_id, obj)
            return "updated"
        if etype == "customer.subscription.deleted":
            _lapse(c, org_id)
            return "ended"
        if etype == "invoice.payment_failed":
            owner = c.execute("select p.email from memberships m join profiles p on p.user_id = m.user_id "
                              "where m.org_id = %s and m.role = 'Owner' and m.status = 'active'", (org_id,)).fetchone()
            if owner:
                from . import emailer
                emailer.queue(c, org_id, owner["email"], "AVA: your payment did not go through",
                              "Your latest AVA payment failed. Your plan stays active while the card is retried.\n\n"
                              f"Update your payment details: {settings().app_url}/account?tab=billing", "billing")
            return "payment failed"
    return "ignored"
