"""Builds the Supabase Auth email templates (supabase/email-templates/*.html)
from the same renderer as AVA's own emails. Paste each file into Supabase:
Authentication > Emails > Templates.

    APP_URL=https://avaverdict.com python3 scripts/build_auth_templates.py
"""

from __future__ import annotations

import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("APP_URL", "https://avaverdict.com")

from ava_server import email_html  # noqa: E402

URL = "https://confirm.invalid/x"
TEMPLATES = {
    "confirm-signup": ("Confirm your email for AVA",
                       "Welcome to AVA. Confirm this email address to finish creating your account.\n\n"
                       f"Confirm email: {URL}\n\nIf you did not sign up for AVA, ignore this email."),
    "reset-password": ("Reset your AVA password",
                       "Someone asked to reset the password for this AVA account. If it was you, choose a new password below. "
                       f"The link expires in 1 hour.\n\nChoose a new password: {URL}\n\n"
                       "If you did not ask for this, ignore this email; your password stays the same."),
    "change-email": ("Confirm your new email for AVA",
                     "Confirm this address to make it your AVA sign-in email.\n\n"
                     f"Confirm new email: {URL}\n\nIf you did not ask for this change, ignore this email."),
}

out = pathlib.Path(__file__).resolve().parents[1] / "supabase" / "email-templates"
for name, (subject, body) in TEMPLATES.items():
    (out / f"{name}.html").write_text(email_html.render(subject, body, "auth").replace(URL, "{{ .ConfirmationURL }}"))
    print(f"wrote {name}.html")
