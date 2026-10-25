"""Request authentication: verifies the Supabase access token.

Supports the legacy shared secret (SUPABASE_JWT_SECRET, HS256) and the
asymmetric signing keys published at the project's JWKS endpoint.
"""

from __future__ import annotations

import hmac
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException

from .config import settings


@lru_cache(maxsize=1)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True)


def verify_token(token: str) -> str:
    return verify_claims(token)["sub"]


def verify_claims(token: str) -> dict:
    s = settings()
    try:
        if s.supabase_jwt_secret:
            claims = jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        elif s.supabase_url:
            key = _jwks_client(s.supabase_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated")
        else:
            raise HTTPException(500, "Authentication is not configured")
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Your session has expired. Sign in again.") from exc
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "Invalid session")
    if claims.get("aal") != "aal2" and _has_second_factor(sub):
        raise HTTPException(401, "Enter the code from your authenticator app to continue.")
    return claims


def _has_second_factor(user_id: str) -> bool:
    from . import db
    with db.system() as c:
        if not c.execute("select to_regclass('auth.mfa_factors') as t").fetchone()["t"]:
            return False
        return bool(c.execute("select 1 from auth.mfa_factors where user_id = %s and status::text = 'verified'", (user_id,)).fetchone())


def current_user(authorization: str = Header(default="")) -> str:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue")
    return verify_token(authorization.split(" ", 1)[1])


def staff_user(authorization: str = Header(default="")) -> str:
    """An AVA team member (AVA_STAFF_EMAILS), signed in with two-factor."""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue")
    claims = verify_claims(authorization.split(" ", 1)[1])
    if str(claims.get("email", "")).lower() not in settings().staff_emails:
        raise HTTPException(404, "Not found")
    if claims.get("aal") != "aal2":
        raise HTTPException(403, "AVA review needs two-factor sign-in. Turn it on under Account, then Security.")
    return claims["sub"]


def cron_guard(authorization: str = Header(default="")) -> None:
    """Vercel sends `Authorization: Bearer <CRON_SECRET>` to scheduled jobs."""
    secret = settings().cron_secret
    if not secret or not hmac.compare_digest(authorization.strip(), f"Bearer {secret}"):
        raise HTTPException(401, "Not allowed")
