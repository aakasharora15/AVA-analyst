"""HTTP API (FastAPI, deployed as one Vercel Python function).

Identity: every user request carries the Supabase access token. User actions
run as that user (`db.as_user`), so row-level security makes the final
decision on who may do what (spec 4.8). Work only the system may do (scoring,
agents, guest views, scheduled jobs) runs as `db.system`, after an explicit
membership check where a user started it.

Reads the screens need (portfolio, reports, history, alerts) go straight to
Supabase from the browser under the same RLS policies; this API covers the
writes and the server-side work.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from datetime import date, timedelta

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import billing, db, drift, emailer, lifecycle, privacy, scheduling
from .plans import AllowanceReached, audits_used, period_start, trial_end
from .quality import input_problem
from .auth import cron_guard, current_user
from .config import DEEP_AUDIT_PLANS, PLANS, plan_id, settings

if settings().sentry_dsn:
    # Error reporting. Request bodies and personal data are never sent: they can
    # hold data-room text and client details.
    import sentry_sdk
    sentry_sdk.init(dsn=settings().sentry_dsn, send_default_pii=False, max_request_body_size="never",
                    traces_sample_rate=0.0, environment=os.environ.get("VERCEL_ENV", "development"))

app = FastAPI(title="AVA API", docs_url=None, redoc_url=None, openapi_url=None)

# Postgres errors become messages a person can act on.
_PG_STATUS = {"42501": 403, "23514": 422, "23505": 409, "P0001": 409, "23503": 404}


@app.exception_handler(psycopg.Error)
async def _pg_error(_: Request, exc: psycopg.Error):
    code = getattr(exc, "sqlstate", None) or ""
    status = _PG_STATUS.get(code, 500)
    msg = exc.diag.message_primary if getattr(exc, "diag", None) and exc.diag.message_primary else "Something went wrong"
    if code == "42501" and "row-level security" in msg:
        msg = "Your role does not allow this"
    if code == "23505":
        msg = "That already exists"
    return JSONResponse({"error": msg if status != 500 else "Something went wrong. Try again."}, status_code=status)


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(lifecycle.InsufficientInput)
async def _insufficient(_: Request, exc: lifecycle.InsufficientInput):
    return JSONResponse({"error": str(exc), "state": "insufficient"}, status_code=422)


@app.exception_handler(AllowanceReached)
async def _allowance(_: Request, exc: AllowanceReached):
    return JSONResponse({"error": str(exc), "state": "upgrade"}, status_code=402)


@app.exception_handler(PermissionError)
async def _perm_error(_: Request, exc: PermissionError):
    return JSONResponse({"error": str(exc) or "Not found"}, status_code=404)


def _role(user: str, org_id: str) -> str | None:
    with db.as_user(user) as c:
        r = c.execute("select app.member_role(%s) as role", (org_id,)).fetchone()
    return r["role"] if r else None


def _need(user: str, org_id: str, roles: tuple[str, ...]) -> str:
    role = _role(user, org_id)
    if role is None:
        raise HTTPException(404, "Not found")
    if role not in roles:
        raise HTTPException(403, "Your role does not allow this")
    return role


RUNNERS = ("Owner", "Admin", "Analyst")
MANAGERS = ("Owner", "Admin")
MEMBERS = ("Owner", "Admin", "Analyst", "Viewer")


def _audit_org(audit_id: str) -> dict:
    with db.system() as c:
        a = c.execute("select id, org_id, company_id, trigger from audits where id = %s", (audit_id,)).fetchone()
    if not a or a["trigger"] == "shadow":
        raise HTTPException(404, "Not found")
    return a


@app.get("/api/health")
def health():
    """Liveness plus configuration checks. Reports only yes/no, never values."""
    import os
    s = settings()
    checks = {
        "database": False,
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "auth_verification": bool(s.supabase_jwt_secret or s.supabase_url),
        "cron_secret": bool(s.cron_secret),
        "email_provider": bool(s.resend_api_key),
        "billing": billing.available(),
        "bot_check": bool(s.turnstile_secret),
        "error_reporting": bool(s.sentry_dsn),
    }
    try:
        with db.system() as c:
            checks["database"] = c.execute("select count(*) as n from calibration_versions").fetchone()["n"] > 0
    except Exception as exc:  # noqa: BLE001 - reported as a failed check
        checks["database"] = False
        db_error = _db_error_kind(exc)
    else:
        db_error = None
    required = ("database", "anthropic_key", "auth_verification", "cron_secret")
    out = {"ok": all(checks[k] for k in required), "checks": checks}  # the model in use is internal
    if s.cron_secret:
        # First 8 hex characters of SHA-256: enough to compare with the value in
        # Supabase Vault, useless for recovering a 40-character random secret.
        import hashlib
        out["cron_secret_fingerprint"] = hashlib.sha256(s.cron_secret.encode()).hexdigest()[:8]
    if db_error:
        out["database_error"] = db_error
    return out


def _db_error_kind(exc: Exception) -> str:
    """A category for the health check. Never echoes the connection string."""
    msg = str(exc).lower()
    if not settings().database_url:
        return "DATABASE_URL is not set"
    if "password authentication failed" in msg:
        return "wrong password in DATABASE_URL"
    if "tenant or user not found" in msg:
        return "wrong user or project in DATABASE_URL (should start postgresql://postgres.<project-ref>:)"
    if "could not translate host" in msg or "name or service not known" in msg or "nodename nor servname" in msg:
        return "host not found: check the part after @ in DATABASE_URL"
    if "invalid" in msg and ("dsn" in msg or "uri" in msg or "connection option" in msg or "integer" in msg):
        return "DATABASE_URL is malformed (leftover [ ] brackets, spaces, or a special character in the password)"
    if "timeout" in msg or "timed out" in msg:
        return "connection timed out"
    if "relation" in msg and "does not exist" in msg:
        return "connected, but the AVA tables are missing (migrations not applied to this project)"
    if "does not exist" in msg:
        return "wrong database name or user in DATABASE_URL (should end /postgres)"
    return type(exc).__name__


# ---------------------------------------------------------------------------
# Companies and audits (spec 4.1)


class CompanyIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    industry: str = Field(min_length=1)
    country: str = Field(min_length=1)
    city: str = ""
    model: str = ""
    target: str = ""
    type: str = "startup"
    dealLead: str = ""
    stage: str = ""
    fund: str = ""
    budget: str = ""


def _insert_company(c, org_id: str, user: str, co: CompanyIn) -> str:
    return c.execute(
        "insert into companies (org_id, title, description, industry, country, city, model, target, type, deal_lead, stage, fund, budget, created_by) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (org_id, co.title.strip(), co.description, co.industry, co.country, co.city, co.model, co.target, co.type, co.dealLead,
         co.stage, co.fund, co.budget, user)).fetchone()["id"]


class AuditIn(BaseModel):
    orgId: str | None = None
    companyId: str | None = None
    company: CompanyIn | None = None
    notify: bool = False
    depth: str = Field(default="standard", pattern="^(standard|deep)$")


@app.post("/api/audits")
def start_audit(body: AuditIn, user: str = Depends(current_user)):
    company_id = body.companyId
    if not company_id:
        if not body.company or not body.orgId:
            raise HTTPException(422, "Choose a company or add one")
        problem = input_problem(body.company.model_dump())
        if problem:
            raise lifecycle.InsufficientInput(problem)
        with db.as_user(user) as c:
            company_id = _insert_company(c, body.orgId, user, body.company)
    with db.system() as c:
        busy = c.execute("select id from audits where company_id = %s and status in ('queued', 'running') and trigger <> 'shadow'", (company_id,)).fetchone()
    if busy:
        return {"auditId": busy["id"], "companyId": company_id, "alreadyRunning": True}
    if body.depth == "deep":
        with db.system() as c:
            plan = c.execute("select o.plan from companies co join organisations o on o.id = co.org_id where co.id = %s", (company_id,)).fetchone()
        if not plan or plan_id(plan["plan"]) not in DEEP_AUDIT_PLANS:
            raise HTTPException(403, "Deep audit is part of the Pro Max plan")
    audit_id = lifecycle.create_audit(user, company_id, notify=body.notify, depth=body.depth)
    return {"auditId": audit_id, "companyId": company_id}


@app.post("/api/audits/{audit_id}/advance")
def advance_audit(audit_id: str, user: str = Depends(current_user)):
    """Called by the running screen while it is open. The cron does the same
    every minute, so closing the tab never stops an audit."""
    a = _audit_org(audit_id)
    _need(user, a["org_id"], MEMBERS)
    return lifecycle.advance(audit_id)


@app.get("/api/audits/{audit_id}/status")
def audit_status(audit_id: str, user: str = Depends(current_user)):
    a = _audit_org(audit_id)
    _need(user, a["org_id"], MEMBERS)
    return lifecycle.status(audit_id)


@app.post("/api/audits/{audit_id}/notify")
def audit_notify(audit_id: str, user: str = Depends(current_user)):
    a = _audit_org(audit_id)
    _need(user, a["org_id"], MEMBERS)
    with db.system() as c:
        c.execute("update audits set notify_on_complete = true where id = %s", (audit_id,))
    return {"ok": True}


@app.post("/api/audits/{audit_id}/rescore")
def rescore(audit_id: str, user: str = Depends(current_user)):
    """'Re-score on current version' from a compare across calibration versions (spec 4.3).
    Runs as a shadow re-run on the frozen snapshot; the original audit never changes."""
    a = _audit_org(audit_id)
    _need(user, a["org_id"], RUNNERS)
    return {"shadowId": drift.request_rescore(audit_id)}


@app.get("/api/audits/{audit_id}/rescore")
def rescore_result(audit_id: str, user: str = Depends(current_user)):
    a = _audit_org(audit_id)
    _need(user, a["org_id"], MEMBERS)
    with db.system() as c:
        r = c.execute("select shadow_score, shadow_directive, calibration_version, run_date from shadow_runs "
                      "where original_audit = %s and purpose = 're-score' order by id desc limit 1", (audit_id,)).fetchone()
        pending = c.execute("select id from audits where trigger = 'shadow' and status in ('queued', 'running') "
                            "and run_state ->> 'shadowOf' = %s", (audit_id,)).fetchone()
    return {"pending": bool(pending), "result": r}


class ExportIn(BaseModel):
    detail: str = Field(min_length=1, max_length=500)


@app.post("/api/audits/{audit_id}/export")
def record_export(audit_id: str, body: ExportIn, user: str = Depends(current_user)):
    """Exports are logged like every other action (spec 4.10)."""
    a = _audit_org(audit_id)
    _need(user, a["org_id"], MEMBERS)
    with db.system() as c:
        c.execute("insert into audit_log (org_id, user_id, who, action, object_type, object_id, detail) values (%s, %s, %s, 'export.pdf', 'audits', %s, %s)",
                  (a["org_id"], user, _profile_name(c, user), audit_id, body.detail))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Findings workflow (spec 4.2)


def _recompute_excluding(audit_id: str) -> int | None:
    from .engine import score_excluding_dismissed
    from .config import CALIBRATION, CALIBRATIONS
    findings = lifecycle._findings_for_engine(audit_id)
    with db.system() as c:
        a = c.execute("select a.calibration_version, a.status, c.type from audits a join companies c on c.id = a.company_id where a.id = %s",
                      (audit_id,)).fetchone()
        if a["status"] not in ("complete", "partial"):
            return None
        cal = CALIBRATIONS.get(a["calibration_version"]) or CALIBRATION
        excl = score_excluding_dismissed(findings, a["type"], cal)["score"]
        c.execute("update audits set score_excluding_dismissed = %s where id = %s", (excl, audit_id))
    return excl


def _profile_name(c, user: str) -> str:
    p = c.execute("select name, email from profiles where user_id = %s", (user,)).fetchone()
    return (p["name"] or p["email"]) if p else "Someone"


STATUS_LABEL = {"open": "Open", "accepted": "Accepted", "dismissed": "Dismissed", "resolved": "Resolved"}


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class StatusIn(BaseModel):
    status: str = Field(pattern="^(open|accepted|dismissed|resolved)$")
    reason: str | None = None


@app.post("/api/findings/{finding_id}/status")
def finding_status(finding_id: str, body: StatusIn, user: str = Depends(current_user)):
    if body.status == "dismissed" and not (body.reason or "").strip():
        raise HTTPException(422, "Give a reason for dismissing this finding")
    with db.as_user(user) as c:
        f = c.execute("select id, audit_id, status, history from findings where id = %s", (finding_id,)).fetchone()
        if not f:
            raise HTTPException(404, "Not found")
        who = _profile_name(c, user)
        # Same shape as the front end's finding history: {at, by, action, detail}.
        entry = {"at": _now_iso(), "by": who, "action": STATUS_LABEL[body.status],
                 "detail": body.reason.strip() if body.status == "dismissed" else ("Restored" if f["status"] == "dismissed" else None)}
        updated = c.execute(
            "update findings set status = %s, dismiss_reason = %s, history = history || %s::jsonb where id = %s returning id",
            (body.status, body.reason.strip() if body.status == "dismissed" and body.reason else None, db.jsonb([entry]), finding_id)).fetchone()
        if not updated:
            raise HTTPException(403, "Your role does not allow this")
    return {"ok": True, "scoreExcludingDismissed": _recompute_excluding(f["audit_id"])}


class OwnerIn(BaseModel):
    owner: str | None = None


@app.post("/api/findings/{finding_id}/owner")
def finding_owner(finding_id: str, body: OwnerIn, user: str = Depends(current_user)):
    owner = (body.owner or "").strip() or None
    with db.as_user(user) as c:
        entry = {"at": _now_iso(), "by": _profile_name(c, user), "action": f"Assigned to {owner}" if owner else "Unassigned"}
        updated = c.execute("update findings set owner = %s, history = history || %s::jsonb where id = %s returning id",
                            (owner, db.jsonb([entry]), finding_id)).fetchone()
    if not updated:
        raise HTTPException(403, "Your role does not allow this")
    return {"ok": True}


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@app.post("/api/findings/{finding_id}/comments")
def finding_comment(finding_id: str, body: CommentIn, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        f = c.execute("select org_id from findings where id = %s", (finding_id,)).fetchone()
        if not f:
            raise HTTPException(404, "Not found")
        row = c.execute("insert into comments (finding_id, org_id, author_id, author_name, text) values (%s, %s, %s, %s, %s) returning id, created_at",
                        (finding_id, f["org_id"], user, _profile_name(c, user), body.text.strip())).fetchone()
    return {"id": row["id"], "at": row["created_at"].isoformat()}


# ---------------------------------------------------------------------------
# Outcomes (spec 4.5)


class OutcomeIn(BaseModel):
    auditId: str
    result: str = Field(pattern="^(grew|flat|changed|exited|writtenDown|shutDown)$")
    checkpoint: str = Field(pattern="^(first|final)$")
    date: str
    evidence: dict


@app.post("/api/outcomes")
def log_outcome(body: OutcomeIn, user: str = Depends(current_user)):
    if not str(body.evidence.get("value", "")).strip():
        raise HTTPException(422, "Add the evidence for this outcome")
    with db.as_user(user) as c:
        a = c.execute("select org_id from audits where id = %s", (body.auditId,)).fetchone()
        if not a:
            raise HTTPException(404, "Not found")
        c.execute(
            "insert into outcomes (audit_id, org_id, result, checkpoint, outcome_date, evidence, logged_by, logged_by_id) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (audit_id) do update set result = excluded.result, checkpoint = excluded.checkpoint, "
            "outcome_date = excluded.outcome_date, evidence = excluded.evidence, logged_by = excluded.logged_by, logged_by_id = excluded.logged_by_id, logged_at = now()",
            (body.auditId, a["org_id"], body.result, body.checkpoint, body.date, db.jsonb(body.evidence), _profile_name(c, user), user))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sharing (spec 4.6): guests see one report, never comments, never anything else.


def _hash_password(pw: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return "pbkdf2$200000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def _check_password(pw: str, stored: str) -> bool:
    try:
        _, n, salt, dk = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt), int(n))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


class ShareIn(BaseModel):
    auditId: str
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    days: int = Field(default=14, ge=1, le=90)
    password: str | None = None


@app.post("/api/share")
def share(body: ShareIn, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        a = c.execute("select a.org_id, co.title from audits a join companies co on co.id = a.company_id where a.id = %s", (body.auditId,)).fetchone()
        if not a:
            raise HTTPException(404, "Not found")
        row = c.execute(
            "insert into share_links (org_id, audit_id, recipient_email, expires_at, password_hash, created_by) values (%s, %s, %s, %s, %s, %s) returning token, expires_at",
            (a["org_id"], body.auditId, body.email.strip().lower(), date.today() + timedelta(days=body.days),
             _hash_password(body.password) if body.password else None, user)).fetchone()
        sender = _profile_name(c, user)
    link = f"{settings().app_url}/shared/{row['token']}"
    with db.system() as c:
        emailer.queue(c, a["org_id"], body.email, f"{sender} shared an AVA report: {a['title']}",
                      f"{sender} shared the AVA report for {a['title']} with you.\n\nOpen it: {link}\n\nThe link expires on {row['expires_at'].isoformat()}."
                      + ("\nYou will need the password the sender gave you." if body.password else ""), "share")
    return {"token": row["token"], "url": link, "expiresAt": row["expires_at"].isoformat()}


@app.post("/api/share/{token}/revoke")
def revoke(token: str, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        r = c.execute("update share_links set revoked = true where token = %s returning token", (token,)).fetchone()
    if not r:
        raise HTTPException(404, "Not found")
    return {"ok": True}


class SharedIn(BaseModel):
    password: str | None = None


_SHARED_FINDING_COLS = "id, agent, section, category, severity, title, text, sources, status, position"


@app.post("/api/shared/{token}")
def shared_view(token: str, body: SharedIn | None = None):
    with db.system("Guest") as c:
        s = c.execute("select * from share_links where token = %s", (token,)).fetchone()
        if not s:
            return JSONResponse({"state": "missing", "error": "This link does not exist."}, status_code=404)
        if s["revoked"]:
            return JSONResponse({"state": "revoked", "error": "This link has been revoked. Ask the sender for a new one."}, status_code=410)
        if s["expires_at"] < date.today():
            return JSONResponse({"state": "expired", "error": "This link has expired. Ask the sender for a new one.",
                                 "link": {"expires": s["expires_at"].isoformat()}}, status_code=410)
        if s["password_hash"]:
            ok = bool(body and body.password) and _check_password(body.password, s["password_hash"])
            if not ok:
                if body and body.password:
                    time.sleep(0.5)
                return JSONResponse({"state": "password", "error": "This report is password protected", "link": {"email": s["recipient_email"]}},
                                    status_code=401)
        a = c.execute(
            "select id, date, status, score, base_directive, final_directive, overridden, override, coverage, skipped_sections, orchestrator, "
            "exposure, cap, prompt_version, calibration_version, under_review, company_id, org_id from audits where id = %s",
            (s["audit_id"],)).fetchone()
        co = c.execute("select title, description, industry, country, city, type from companies where id = %s", (a["company_id"],)).fetchone()
        org = c.execute("select name, branding, logo_url from organisations where id = %s", (a["org_id"],)).fetchone()
        findings = c.execute(f"select {_SHARED_FINDING_COLS} from findings where audit_id = %s order by position", (a["id"],)).fetchall()
        src_ids = sorted({x for f in findings for x in f["sources"]})
        sources = c.execute("select id, type, title, kind, date, reliability, url, retrieval_date from sources where id = any(%s)", (src_ids,)).fetchall()
        c.execute("insert into share_views (token) values (%s)", (token,))
    a = {k: v for k, v in a.items() if k not in ("org_id",)}
    return {"state": "ok", "audit": a, "company": co, "org": org, "findings": findings, "sources": sources,
            "link": {"email": s["recipient_email"], "expires": s["expires_at"].isoformat()}}


# ---------------------------------------------------------------------------
# Portfolio import (spec 4.9). The browser parses and maps; the server validates again.


class ImportIn(BaseModel):
    orgId: str
    file: str
    mapping: dict = {}
    rows: list[dict]
    auditAll: bool = False


REQUIRED = ("title", "industry", "country")


@app.post("/api/import")
def import_companies(body: ImportIn, user: str = Depends(current_user)):
    if len(body.rows) > 500:
        raise HTTPException(413, "Import up to 500 companies at a time")
    _need(user, body.orgId, RUNNERS)
    with db.as_user(user) as c:
        existing = {r["t"] for r in c.execute("select lower(title) as t from companies where org_id = %s", (body.orgId,)).fetchall()}
    valid, rejected, seen = [], [], set()
    for i, r in enumerate(body.rows, start=1):
        missing = [k for k in REQUIRED if not str(r.get(k, "")).strip()]
        t = str(r.get("title", "")).strip().lower()
        if missing:
            rejected.append({"row": i, "reason": "Missing " + ", ".join(missing)})
        elif t in existing or t in seen:
            rejected.append({"row": i, "reason": "Already in your portfolio"})
        else:
            seen.add(t)
            valid.append(r)
    created = []
    with db.as_user(user) as c:
        for r in valid:
            co = CompanyIn(**{k: str(v) for k, v in r.items() if k in CompanyIn.model_fields})
            created.append(_insert_company(c, body.orgId, user, co))
        c.execute("insert into import_jobs (org_id, file, mapping, rows_valid, rows_rejected, created_by) values (%s, %s, %s, %s, %s, %s)",
                  (body.orgId, body.file, db.jsonb(body.mapping), len(created), len(rejected), user))
    audits, not_audited = [], []
    if body.auditAll:
        for cid in created:
            try:
                audits.append(lifecycle.create_audit(user, cid, trigger="import"))
            except (lifecycle.InsufficientInput, AllowanceReached):
                not_audited.append(cid)  # added, but too thin to audit yet or over the plan's allowance
    return {"created": created, "rejected": rejected, "audits": audits, "notAudited": not_audited}


# ---------------------------------------------------------------------------
# Team (spec 4.8)


class InviteIn(BaseModel):
    orgId: str
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: str = Field(pattern="^(Admin|Analyst|Viewer)$")


@app.post("/api/invites")
def invite(body: InviteIn, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        row = c.execute("insert into invites (org_id, email, role, created_by) values (%s, %s, %s, %s) returning token, expires_at",
                        (body.orgId, body.email.strip().lower(), body.role, user)).fetchone()
        org = c.execute("select name from organisations where id = %s", (body.orgId,)).fetchone()
        sender = _profile_name(c, user)
    with db.system() as c:
        emailer.queue(c, body.orgId, body.email, f"{sender} invited you to {org['name']} on AVA",
                      f"{sender} invited you to join {org['name']} on AVA as {body.role}.\n\n"
                      f"Accept: {settings().app_url}/invite/{row['token']}\n\nThe invitation expires in 7 days.", "invite")
    return {"token": row["token"], "expiresAt": row["expires_at"].isoformat()}


@app.get("/api/invites/{token}")
def invite_info(token: str):
    with db.system() as c:
        i = c.execute("select i.email, i.role, i.expires_at, i.accepted_at, o.name as org from invites i join organisations o on o.id = i.org_id "
                      "where i.token = %s", (token,)).fetchone()
    if not i:
        raise HTTPException(404, "This invitation is not valid")
    return {"email": i["email"], "role": i["role"], "org": i["org"],
            "expired": i["expires_at"].timestamp() < time.time(), "accepted": i["accepted_at"] is not None}


@app.post("/api/invites/{token}/accept")
def accept_invite(token: str, user: str = Depends(current_user)):
    with db.system() as c:
        i = c.execute("select * from invites where token = %s for update", (token,)).fetchone()
        if not i or i["accepted_at"]:
            raise HTTPException(404, "This invitation is not valid")
        if i["expires_at"].timestamp() < time.time():
            raise HTTPException(410, "This invitation has expired. Ask for a new one.")
        p = c.execute("select email from auth.users where id = %s", (user,)).fetchone()
        if not p or (p["email"] or "").lower() != i["email"].lower():
            raise HTTPException(403, f"Sign in as {i['email']} to accept this invitation")
        c.execute("insert into profiles (user_id, email) values (%s, %s) on conflict (user_id) do nothing", (user, p["email"]))
        c.execute("insert into memberships (org_id, user_id, role, status) values (%s, %s, %s, 'active') "
                  "on conflict (org_id, user_id) do update set role = excluded.role, status = 'active'", (i["org_id"], user, i["role"]))
        c.execute("update invites set accepted_at = now() where id = %s", (i["id"],))
    return {"orgId": i["org_id"], "role": i["role"]}


class MemberIn(BaseModel):
    role: str = Field(pattern="^(Admin|Analyst|Viewer)$")


@app.patch("/api/orgs/{org_id}/members/{member_id}")
def change_role(org_id: str, member_id: str, body: MemberIn, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        r = c.execute("update memberships set role = %s where org_id = %s and user_id = %s returning user_id", (body.role, org_id, member_id)).fetchone()
    if not r:
        raise HTTPException(403, "Your role does not allow this")
    return {"ok": True}


@app.delete("/api/orgs/{org_id}/members/{member_id}")
def remove_member(org_id: str, member_id: str, user: str = Depends(current_user)):
    with db.as_user(user) as c:
        r = c.execute("update memberships set status = 'removed' where org_id = %s and user_id = %s returning user_id", (org_id, member_id)).fetchone()
    if not r:
        raise HTTPException(403, "Your role does not allow this")
    return {"ok": True}


class TransferIn(BaseModel):
    toUserId: str


@app.post("/api/orgs/{org_id}/transfer")
def transfer(org_id: str, body: TransferIn, user: str = Depends(current_user)):
    _need(user, org_id, ("Owner",))
    with db.system(_name(user)) as c:
        target = c.execute("select role from memberships where org_id = %s and user_id = %s and status = 'active'", (org_id, body.toUserId)).fetchone()
        if not target or body.toUserId == user:
            raise HTTPException(422, "Choose an active member of this organisation")
        c.execute("update memberships set role = 'Admin' where org_id = %s and user_id = %s", (org_id, user))
        c.execute("update memberships set role = 'Owner' where org_id = %s and user_id = %s", (org_id, body.toUserId))
    return {"ok": True}


def _name(user: str) -> str:
    with db.system() as c:
        return _profile_name(c, user)


class OrgIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = "VC fund"


@app.post("/api/orgs")
def create_org(body: OrgIn, user: str = Depends(current_user)):
    """Onboarding: the signed-in user creates their organisation and becomes its Owner."""
    with db.system(_name(user)) as c:
        email = c.execute("select email from auth.users where id = %s", (user,)).fetchone()
        if not email:
            raise HTTPException(401, "Sign in to continue")
        c.execute("insert into profiles (user_id, email) values (%s, %s) on conflict (user_id) do nothing", (user, email["email"]))
        # Every new organisation starts on the free trial (config/plans.json).
        org = c.execute("insert into organisations (name, kind, plan, trial_ends_at, seat_limit) values (%s, %s, 'trial', %s, %s) returning id",
                        (body.name.strip(), body.kind, trial_end(), PLANS["trial"]["seats"])).fetchone()["id"]
        c.execute("insert into memberships (org_id, user_id, role) values (%s, %s, 'Owner')", (org, user))
    return {"orgId": org}


# ---------------------------------------------------------------------------
# Billing (Stripe). Owners buy and manage plans; the signed webhook is the
# only thing that changes an organisation's plan.


def _billing_org(user: str, org_id: str) -> dict:
    _need(user, org_id, ("Owner",))
    with db.system() as c:
        return c.execute("select * from organisations where id = %s", (org_id,)).fetchone()


@app.get("/api/billing/{org_id}")
def billing_status(org_id: str, user: str = Depends(current_user)):
    _need(user, org_id, MEMBERS)
    with db.system() as c:
        o = c.execute("select * from organisations where id = %s", (org_id,)).fetchone()
        used = audits_used(c, o)
        seats = c.execute("select count(*) as n from memberships where org_id = %s and status = 'active'", (org_id,)).fetchone()["n"]
        companies = c.execute("select count(*) as n from companies where org_id = %s", (org_id,)).fetchone()["n"]
        not_counted = c.execute("select count(*) as n from audits where org_id = %s and trigger <> 'shadow' and status = 'failed' and created_at >= %s",
                                (org_id, period_start(o))).fetchone()["n"]
    pid = plan_id(o["plan"])
    return {"online": billing.available(), "plans": sorted(billing.prices()), "plan": pid,
            "status": o["subscription_status"], "periodEnd": o["current_period_end"].isoformat() if o["current_period_end"] else None,
            "cancelAtPeriodEnd": o["cancel_at_period_end"], "manageable": bool(o["stripe_customer_id"]),
            "trialEndsAt": o["trial_ends_at"].isoformat() if o["trial_ends_at"] else None,
            "usage": {"audits": used, "auditLimit": PLANS[pid]["audits"], "notCounted": not_counted,
                      "seats": seats, "seatLimit": o["seat_limit"], "companies": companies}}


class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(basic|pro|pro-max)$")


@app.post("/api/billing/{org_id}/checkout")
def billing_checkout(org_id: str, body: CheckoutIn, user: str = Depends(current_user)):
    if not billing.available():
        raise HTTPException(503, "Online checkout is not available yet. Contact us to choose a plan.")
    org = _billing_org(user, org_id)
    if org["subscription_status"] in billing.LIVE_STATUSES:
        # Changing plan on a live subscription happens in the portal, so proration is Stripe's.
        return {"url": billing.portal_url(org)}
    with db.system() as c:
        email = c.execute("select email from auth.users where id = %s", (user,)).fetchone()["email"]
    return {"url": billing.checkout_url(org, body.plan, email)}


@app.post("/api/billing/{org_id}/portal")
def billing_portal(org_id: str, user: str = Depends(current_user)):
    if not billing.available():
        raise HTTPException(503, "Online billing is not available yet. Contact us.")
    return {"url": billing.portal_url(_billing_org(user, org_id))}


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    secret = settings().stripe_webhook_secret
    if not secret:
        raise HTTPException(503, "Billing is not configured")
    payload = await request.body()
    try:
        billing.verify(payload, request.headers.get("stripe-signature", ""), secret)
    except billing.BillingError as exc:
        raise HTTPException(400, str(exc)) from exc
    import json
    return {"received": True, "result": billing.handle(json.loads(payload))}


@app.exception_handler(billing.BillingError)
async def _billing_error(_: Request, exc: billing.BillingError):
    return JSONResponse({"error": str(exc)}, status_code=502)


# ---------------------------------------------------------------------------
# Your data: export and deletion (privacy policy, UK GDPR).


@app.exception_handler(privacy.DeletionBlocked)
async def _deletion_blocked(_: Request, exc: privacy.DeletionBlocked):
    return JSONResponse({"error": str(exc)}, status_code=409)


@app.get("/api/orgs/{org_id}/export")
def export_org(org_id: str, user: str = Depends(current_user)):
    _need(user, org_id, MANAGERS)
    data = privacy.export_org(org_id)
    with db.system(_name(user)) as c:
        c.execute("insert into audit_log (org_id, user_id, who, action, object_type, object_id, detail) "
                  "values (%s, %s, %s, 'org.exported', 'organisations', %s, 'Full data export downloaded')",
                  (org_id, user, _name(user), org_id))
    return data


class ConfirmIn(BaseModel):
    confirm: str = ""


@app.delete("/api/orgs/{org_id}")
def delete_org(org_id: str, body: ConfirmIn, user: str = Depends(current_user)):
    _need(user, org_id, ("Owner",))
    with db.system() as c:
        name = c.execute("select name from organisations where id = %s", (org_id,)).fetchone()["name"]
    if body.confirm.strip().lower() != name.strip().lower():
        raise HTTPException(422, "Type the organisation's name exactly to confirm")
    return {"ok": True, "files": privacy.delete_org(org_id)}


@app.delete("/api/me")
def delete_me(body: ConfirmIn, user: str = Depends(current_user)):
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(422, "Type DELETE to confirm")
    privacy.delete_user(user)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Data room (spec 4.2). The browser uploads the file to Supabase Storage under
# {org_id}/{company_id}/..., extracts text where it can (PDF, DOCX, CSV, text),
# then registers it here as a source.


NO_TEXT_NOTE = ("Stored, but no text could be read. Save it as PDF, .docx, .pptx or .xlsx (scanned PDFs need a text layer) "
                "and upload again so the agents can cite it.")


class FileIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    kind: str = "File"
    storagePath: str | None = None
    extract: str = ""
    note: str = ""
    coverageTopic: str | None = None
    reaudit: bool = False


@app.post("/api/data-room/{company_id}/files")
def add_file(company_id: str, body: FileIn, user: str = Depends(current_user)):
    text = body.extract[:400_000]
    digest = hashlib.sha256((text or body.title).encode()).hexdigest()
    with db.as_user(user) as c:
        co = c.execute("select org_id from companies where id = %s", (company_id,)).fetchone()
        if not co:
            raise HTTPException(404, "Not found")
        if body.storagePath and not body.storagePath.startswith(f"{co['org_id']}/{company_id}/"):
            raise HTTPException(422, "Files must be stored under this company's folder")
        # A new version of the same document supersedes the old one.
        c.execute("update sources set status = 'superseded' where company_id = %s and type = 'uploaded' and lower(title) = lower(%s) and status <> 'superseded'",
                  (company_id, body.title.strip()))
        sid = c.execute(
            "insert into sources (org_id, company_id, type, title, kind, note, storage_path, content_hash, extract, added_by, coverage_topic, created_by) "
            "values (%s, %s, 'uploaded', %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (co["org_id"], company_id, body.title.strip(), body.kind, body.note or (text[:280] if text else NO_TEXT_NOTE), body.storagePath, digest, text,
             _profile_name(c, user), body.coverageTopic, user)).fetchone()["id"]
    with db.system() as c:
        # Evidence alert (spec 4.7), when the organisation has it switched on.
        org = c.execute("select alert_rules from organisations where id = %s", (co["org_id"],)).fetchone()
        if (org["alert_rules"] or {}).get("evidence"):
            c.execute("insert into alerts (org_id, company_id, trigger, detail) values (%s, %s, 'evidence', %s)",
                      (co["org_id"], company_id, f"New file added: {body.title.strip()}"))
    audit_id = lifecycle.create_audit(user, company_id, trigger="evidence") if body.reaudit else None
    return {"sourceId": sid, "auditId": audit_id, "extracted": bool(text)}


# ---------------------------------------------------------------------------
# Free audit (spec 4.11): work email, one per domain per month, top three
# findings shown, the rest locked with counts.

_EMAIL = re.compile(r"^[^@\s]+@([^@\s]+\.[^@\s]+)$")


class FreeIn(BaseModel):
    email: str
    company: CompanyIn
    turnstileToken: str = ""


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() or request.headers.get("x-real-ip", "") or (request.client.host if request.client else "")) or "unknown"


def _ip_hash(ip: str) -> str:
    """Salted, so the stored value cannot be reversed to an address."""
    return hmac.new((settings().cron_secret or "ava").encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def _human_check(token: str, ip: str) -> None:
    secret = settings().turnstile_secret
    if not secret:
        return
    if not token:
        raise HTTPException(422, "Complete the check that you are human, then try again.")
    import httpx
    try:
        r = httpx.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", timeout=10.0,
                       data={"secret": secret, "response": token, "remoteip": ip}).json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "We could not run the human check. Try again in a minute.") from None
    if not r.get("success"):
        raise HTTPException(422, "The human check did not pass. Refresh the page and try again.")


@app.post("/api/free-audit")
def free_audit(body: FreeIn, request: Request):
    ip = _client_ip(request)
    _human_check(body.turnstileToken, ip)
    ip_hash = _ip_hash(ip)
    s = settings()
    with db.system() as c:
        today = c.execute("select count(*) filter (where ip_hash = %s) as mine, count(*) as total from free_audits "
                          "where created_at > now() - interval '1 day'", (ip_hash,)).fetchone()
    if today["mine"] >= s.free_audits_per_ip_day:
        raise HTTPException(429, "You have reached today's free audit limit. Start a free trial to keep going.")
    if today["total"] >= s.free_audits_per_day:
        raise HTTPException(429, "Free audits are paused for the rest of today. Start a free trial instead.")
    m = _EMAIL.match(body.email.strip().lower())
    if not m:
        raise HTTPException(422, "Enter a valid work email")
    domain = m.group(1)
    if domain in settings().free_email_domains:
        raise HTTPException(422, "Use your work email. Personal email addresses are not eligible.")
    problem = input_problem(body.company.model_dump())
    if problem:
        raise lifecycle.InsufficientInput(problem)
    with db.system("Free audit") as c:
        # Audits that issued no score (failed or insufficient input) do not use up the month's free audit.
        recent = c.execute("select 1 from free_audits f join audits a on a.id = f.audit_id where f.domain = %s "
                           "and f.created_at > now() - interval '1 month' and a.status <> 'failed'", (domain,)).fetchone()
        if recent:
            raise HTTPException(429, "Your organisation has already used its free audit this month")
        co = body.company
        cid = c.execute(
            "insert into companies (org_id, title, description, industry, country, city, model, target, type) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (lifecycle.FREE_ORG, f"{co.title.strip()} ({domain}, {date.today().isoformat()}, {os.urandom(3).hex()})", co.description,
             co.industry, co.country, co.city, co.model, co.target, co.type)).fetchone()["id"]
    audit_id = lifecycle.create_audit(None, cid, trigger="manual")
    with db.system("Free audit") as c:
        fid = c.execute("insert into free_audits (email, domain, inputs, audit_id, ip_hash) values (%s, %s, %s, %s, %s) returning id",
                        (body.email.strip().lower(), domain, db.jsonb(body.company.model_dump()), audit_id, ip_hash)).fetchone()["id"]
    return {"id": fid}


def _free(fid: str) -> dict:
    with db.system() as c:
        f = c.execute("select * from free_audits where id = %s", (fid,)).fetchone()
    if not f:
        raise HTTPException(404, "Not found")
    return f


@app.post("/api/free-audit/{fid}/advance")
def free_advance(fid: str):
    f = _free(fid)
    return lifecycle.advance(f["audit_id"])


SEV_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


@app.get("/api/free-audit/{fid}")
def free_result(fid: str):
    f = _free(fid)
    st = lifecycle.status(f["audit_id"])
    out = {"id": fid, "status": st["audit"]["status"], "agents": st["agents"], "company": f["inputs"]}
    if st["audit"]["status"] == "failed":
        with db.system() as c:
            rs = c.execute("select run_state from audits where id = %s", (f["audit_id"],)).fetchone()["run_state"] or {}
        out["reason"] = rs.get("reason") if rs.get("outcome") == "insufficient_information" else None
    if st["audit"]["status"] in ("complete", "partial"):
        with db.system() as c:
            a = c.execute("select score, final_directive, coverage from audits where id = %s", (f["audit_id"],)).fetchone()
            fs = c.execute("select id, agent, section, category, severity, title, text from findings where audit_id = %s", (f["audit_id"],)).fetchall()
        fs.sort(key=lambda x: (SEV_ORDER[x["severity"]], x["title"]))
        locked = fs[3:]
        out.update({"score": a["score"], "directive": a["final_directive"], "coverage": a["coverage"], "top": fs[:3],
                    "locked": {"total": len(locked), **{s: sum(1 for x in locked if x["severity"] == s) for s in SEV_ORDER}}})
    return out


class FreeSendIn(BaseModel):
    to: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.post("/api/free-audit/{fid}/send")
def free_send(fid: str, body: FreeSendIn):
    """'Founder? Send this result to an investor.' Once per result."""
    f = _free(fid)
    r = free_result(fid)
    if r["status"] not in ("complete", "partial"):
        raise HTTPException(409, "The audit is still running")
    lines = [f"{x['severity']}: {x['title']}\n{x['text']}" for x in r["top"]]
    with db.system() as c:
        if c.execute("select 1 from email_outbox where kind = 'free-audit' and subject like %s", (f"%[{fid}]",)).fetchone():
            raise HTTPException(409, "This result has already been sent")
        emailer.queue(c, None, body.to, f"{f['email']} shared a free AVA audit: {r['company']['title']} [{fid}]",
                      f"{f['email']} ran a free AVA audit and shared the result with you.\n\n"
                      f"Resilience score {r['score']}. Directive {r['directive']}.\n\nTop findings:\n\n" + "\n\n".join(lines)
                      + f"\n\n{r['locked']['total']} more findings are in the full report.\nSee plans: {settings().app_url}/pricing", "free-audit")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Scheduled jobs (Vercel Cron sends Authorization: Bearer $CRON_SECRET)


@app.get("/api/cron/advance", dependencies=[Depends(cron_guard)])
def cron_advance():
    """Every minute: advance every unfinished audit by one step, within the time budget."""
    started = time.monotonic()
    with db.system() as c:
        ids = [r["id"] for r in c.execute("select id from audits where status in ('queued', 'running') order by created_at limit 50").fetchall()]
    done = []
    for aid in ids:
        if time.monotonic() - started > 240:
            break
        done.append({"id": aid, "status": lifecycle.advance(aid)["audit"]["status"]})
    return {"advanced": done}


@app.get("/api/cron/cadence", dependencies=[Depends(cron_guard)])
def cron_cadence():
    return {"queued": scheduling.queue_due()}


@app.get("/api/cron/digest", dependencies=[Depends(cron_guard)])
def cron_digest():
    """Weekly digest of the past week's alerts to members whose org delivers by weekly email."""
    sent = 0
    with db.system() as c:
        rows = c.execute(
            "select m.org_id, p.email, p.user_id from memberships m join profiles p on p.user_id = m.user_id join organisations o on o.id = m.org_id "
            "where m.status = 'active' and o.delivery ->> 'email' = 'weekly'").fetchall()
        for r in rows:
            alerts = c.execute(
                "select a.trigger, a.detail, a.from_score, a.to_score, a.from_directive, a.to_directive, co.title from alerts a "
                "join companies co on co.id = a.company_id where a.org_id = %s and a.date > current_date - 7 "
                "and not exists (select 1 from alert_snoozes s where s.user_id = %s and s.company_id = a.company_id and s.until >= current_date) "
                "order by a.date desc", (r["org_id"], r["user_id"])).fetchall()
            if not alerts:
                continue
            body = "\n".join(f"{a['title']}: {a['detail'] or a['trigger']}" for a in alerts)
            emailer.queue(c, r["org_id"], r["email"], f"AVA weekly digest: {len(alerts)} alert{'s' if len(alerts) != 1 else ''}",
                          f"This week across your portfolio:\n\n{body}\n\nOpen alerts: {settings().app_url}/alerts", "digest")
            sent += 1
    return {"queued": sent}


@app.get("/api/cron/email", dependencies=[Depends(cron_guard)])
def cron_email():
    return emailer.send_pending()


@app.get("/api/cron/shadow", dependencies=[Depends(cron_guard)])
def cron_shadow():
    """Daily. On the 1st, start the monthly shadow sample; every day, write the
    drift report once the sample has finished."""
    started = drift.start_monthly_sample() if date.today().day == 1 else []
    return {"started": started, "report": drift.drift_report()}
