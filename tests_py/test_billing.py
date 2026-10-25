"""Billing: Stripe signature, webhook -> plan, idempotency, lapse, guards."""

import hashlib
import hmac
import json
import time

import psycopg
import pytest

from ava_server import billing, db
from tests_py.test_api import api, as_  # noqa: F401  (fixture re-export)

WHSEC = "whsec_test"


@pytest.fixture()
def stripe_env(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WHSEC)
    monkeypatch.setenv("STRIPE_PRICE_BASIC", "price_basic")
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_pro")
    monkeypatch.setenv("STRIPE_PRICE_PRO_MAX", "price_promax")


def signed(event: dict, secret: str = WHSEC, ts: int | None = None):
    body = json.dumps(event).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"stripe-signature": f"t={ts},v1={sig}", "content-type": "application/json"}


def sub_event(eid, org, status="active", price="price_pro", etype="customer.subscription.updated", **extra):
    obj = {"id": "sub_1", "customer": "cus_1", "status": status, "metadata": {"org_id": org}, "cancel_at_period_end": False,
           "items": {"data": [{"price": {"id": price}, "current_period_end": int(time.time()) + 30 * 86400}]}, **extra}
    return {"id": eid, "type": etype, "data": {"object": obj}}


def org_row(org):
    with db.system() as c:
        return c.execute("select * from organisations where id = %s", (org,)).fetchone()


def test_signature_is_required_and_checked(api, stripe_env):
    client, w = api
    body, headers = signed(sub_event("evt_sig", w["org"]), secret="whsec_wrong")
    assert client.post("/api/stripe/webhook", content=body, headers=headers).status_code == 400
    body, headers = signed(sub_event("evt_old", w["org"]), ts=int(time.time()) - 3600)
    assert client.post("/api/stripe/webhook", content=body, headers=headers).status_code == 400


def test_subscription_sets_plan_once_and_lapse_blocks_audits(api, stripe_env):
    client, w = api
    with db.system() as c:
        c.execute("update organisations set plan = 'trial', trial_ends_at = now() + interval '5 days' where id = %s", (w["org"],))
    body, headers = signed(sub_event("evt_1", w["org"], price="price_basic"))
    assert client.post("/api/stripe/webhook", content=body, headers=headers).json()["result"] == "updated"
    o = org_row(w["org"])
    assert (o["plan"], o["seat_limit"], o["subscription_status"], o["stripe_customer_id"]) == ("basic", 1, "active", "cus_1")
    assert o["renewal_date"] is not None
    # The same event again is ignored.
    assert client.post("/api/stripe/webhook", content=body, headers=headers).json()["result"] == "duplicate"

    body, headers = signed(sub_event("evt_2", w["org"], etype="customer.subscription.deleted", status="canceled"))
    assert client.post("/api/stripe/webhook", content=body, headers=headers).json()["result"] == "ended"
    o = org_row(w["org"])
    assert o["plan"] == "trial" and o["subscription_status"] == "canceled"
    r = client.post("/api/audits", json={"companyId": w["company"]}, headers=as_(w, "Owner"))
    assert r.status_code == 402 and "subscription has ended" in r.json()["error"]


def test_unknown_price_does_not_change_plan(api, stripe_env):
    client, w = api
    before = org_row(w["org"])["plan"]
    body, headers = signed(sub_event("evt_x", w["org"], price="price_other"))
    client.post("/api/stripe/webhook", content=body, headers=headers)
    assert org_row(w["org"])["plan"] == before


def test_checkout_owner_only_and_off_without_keys(api, monkeypatch, stripe_env):
    client, w = api
    calls = []
    monkeypatch.setattr(billing, "_stripe", lambda m, p, d=None: calls.append((p, d)) or {"url": "https://checkout.stripe.test/s"})
    assert client.post(f"/api/billing/{w['org']}/checkout", json={"plan": "pro"}, headers=as_(w, "Admin")).status_code == 403
    r = client.post(f"/api/billing/{w['org']}/checkout", json={"plan": "pro"}, headers=as_(w, "Owner"))
    assert r.status_code == 200 and r.json()["url"].startswith("https://checkout.stripe.test")
    path, data = calls[-1]
    assert path == "/checkout/sessions" and data["line_items[0][price]"] == "price_pro" and data["metadata[org_id]"] == w["org"]
    st = client.get(f"/api/billing/{w['org']}", headers=as_(w, "Viewer")).json()
    assert st["online"] is True and st["usage"]["seats"] == 4 and st["usage"]["companies"] == 1 and st["usage"]["auditLimit"] == 499
    monkeypatch.delenv("STRIPE_SECRET_KEY")
    assert client.post(f"/api/billing/{w['org']}/checkout", json={"plan": "pro"}, headers=as_(w, "Owner")).status_code == 503
    assert client.get(f"/api/billing/{w['org']}", headers=as_(w, "Owner")).json()["online"] is False


def test_owner_cannot_extend_trial_or_edit_subscription(api):
    _, w = api
    for col, val in (("trial_ends_at", "2099-01-01"), ("subscription_status", "active"), ("stripe_customer_id", "cus_fake")):
        with pytest.raises(psycopg.Error):
            with db.as_user(w["users"]["Owner"]) as c:
                c.execute(f"update organisations set {col} = %s where id = %s", (val, w["org"]))
