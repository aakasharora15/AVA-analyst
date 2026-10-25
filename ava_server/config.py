"""Engine configuration, read from config/engine.json (shared with the JS engine)."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=1)
def engine_config() -> dict:
    with open(ROOT / "config" / "engine.json", encoding="utf-8") as fh:
        return json.load(fh)


CFG = engine_config()
AGENTS = CFG["agents"]
SECTIONS = CFG["sections"]
CATEGORIES = CFG["categories"]
SEVERITIES = CFG["severities"]
DIRECTIVES = CFG["directives"]  # low to high
VENTURE_TYPES = CFG["ventureTypes"]
CALIBRATIONS = CFG["calibrations"]
CURRENT_CALIBRATION = CFG["currentCalibration"]
CALIBRATION = CALIBRATIONS[CURRENT_CALIBRATION]
ALERT_RULES = CFG["alertRules"]
OUTCOME_WINDOW = CFG["outcomeWindow"]
DRIFT = CFG["drift"]


class Settings:
    """Runtime settings from the environment. Nothing secret has a default."""

    def __init__(self) -> None:
        env = os.environ.get
        # Exact model ID. Model IDs without a date suffix are exact versions,
        # not aliases, so this satisfies "pin exact model versions".
        # Standard engine: every plan's audits run on this model, so the same
        # venture gets the same verdict whatever the customer pays.
        self.model = env("AVA_MODEL", "claude-sonnet-5-5")
        # Deep audit (Pro Max and Enterprise): extended analysis on a larger model.
        self.deep_model = env("AVA_DEEP_MODEL", "claude-opus-5-5")
        self.effort = env("AVA_EFFORT", "high")
        self.prompt_version = env("AVA_PROMPT_VERSION", "prompts-2026.10")
        # Server-side refusal fallback. The served model is recorded on every
        # agent run; see DEPLOY.md before turning this off.
        self.refusal_fallback = env("AVA_REFUSAL_FALLBACK", "default")  # "default" | "off"
        self.database_url = env("DATABASE_URL", "")
        self.supabase_url = env("SUPABASE_URL", "")
        self.supabase_jwt_secret = env("SUPABASE_JWT_SECRET", "")
        # Optional: lets account deletion remove data-room files directly.
        self.supabase_service_key = env("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.cron_secret = env("CRON_SECRET", "").strip()  # copied values often carry a stray newline
        self.app_url = env("APP_URL", "http://localhost:5173")
        self.email_from = env("EMAIL_FROM", "AVA <alerts@example.com>")
        self.resend_api_key = env("RESEND_API_KEY", "")
        # Billing (Stripe). Off until the key, webhook secret and prices are set.
        self.stripe_secret_key = env("STRIPE_SECRET_KEY", "").strip()
        self.stripe_webhook_secret = env("STRIPE_WEBHOOK_SECRET", "").strip()
        self.stripe_prices = {
            "basic": env("STRIPE_PRICE_BASIC", "").strip(),
            "pro": env("STRIPE_PRICE_PRO", "").strip(),
            "pro-max": env("STRIPE_PRICE_PRO_MAX", "").strip(),
        }
        # Bot check on public forms (Cloudflare Turnstile). Off until set.
        self.turnstile_secret = env("TURNSTILE_SECRET_KEY", "").strip()
        # Free audit spend limits: per network address per day, and in total per day.
        self.free_audits_per_ip_day = int(env("AVA_FREE_AUDITS_PER_IP_DAY", "2"))
        self.free_audits_per_day = int(env("AVA_FREE_AUDITS_PER_DAY", "50"))
        # Error reporting (Sentry) and where operational alerts go.
        self.sentry_dsn = env("SENTRY_DSN", "").strip()
        self.ops_email = env("AVA_OPS_EMAIL", "").strip()
        self.free_email_domains = set(
            d.strip() for d in env(
                "AVA_FREE_EMAIL_DOMAINS",
                "gmail.com,googlemail.com,yahoo.com,yahoo.co.uk,hotmail.com,hotmail.co.uk,outlook.com,live.com,icloud.com,me.com,aol.com,proton.me,protonmail.com,gmx.com,mail.com",
            ).split(",") if d.strip()
        )


# Plan entitlements (config/plans.json, shared with the website).
with open(ROOT / "config" / "plans.json", encoding="utf-8") as _fh:
    PLANS_CFG = json.load(_fh)
PLANS = PLANS_CFG["plans"]
DEFAULT_PLAN = PLANS_CFG["default"]
DEEP_AUDIT_PLANS = {k for k, v in PLANS.items() if v["deep"]}


def plan_id(plan: str | None) -> str:
    """Normalise an organisation's stored plan name ("Pro Max", "pro-max") to its id."""
    pid = str(plan or DEFAULT_PLAN).strip().lower().replace(" ", "-")
    return pid if pid in PLANS else DEFAULT_PLAN


def model_for(depth: str, cfg: "Settings | None" = None) -> str:
    cfg = cfg or settings()
    return cfg.deep_model if depth == "deep" else cfg.model


# The server-side refusal fallback is only requested for models that support it.
FALLBACK_MODEL_PREFIXES = ("claude-opus-5", "claude-fable-5")


def settings() -> Settings:
    return Settings()
