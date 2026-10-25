"""Branded HTML for every AVA email, built from its plain-text body.

Emails are written once, as plain text (emailer.queue). This turns that text
into the site's look: deep navy, the AVA wordmark, a lavender button for the
main action. The plain text is still sent alongside as the fallback.

Layout rules, read from the text:
* the subject is the heading;
* blank lines separate paragraphs;
* a line "Label: https://..." becomes a button (the first one primary);
* a bare URL line becomes a button labelled "Open in AVA";
* everything after the "--" footer marker becomes small footer links.

Email clients ignore stylesheets and most modern CSS, so everything is inline
and laid out with tables. Images are limited to the hosted wordmark PNG.
"""

from __future__ import annotations

import html
import re

from .config import settings

GROUND = "#05071A"
SURFACE = "#0D1226"
LINE = "#232A45"
TEXT = "#F2F4FA"
MUTED = "#A6AEC2"
ACCENT = "#A99FFF"
BUTTON = "#E4DCFF"
BUTTON_INK = "#05071A"
FONT = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif"

_LINK_LINE = re.compile(r"^(?P<label>[^:\n]{1,60}):\s*(?P<url>https?://\S+)$")
_URL_LINE = re.compile(r"^https?://\S+$")
_URL = re.compile(r"(https?://[^\s<]+)")

# Friendlier button text for the labels the emails use.
BUTTON_LABELS = {
    "accept": "Accept invitation",
    "open the report": "Open the report",
    "compare the audits": "Compare the audits",
    "review and confirm": "Review and confirm",
    "see plans": "See plans",
}


def _inline(text: str) -> str:
    """Escape text and turn any stray URL into a link."""
    out = html.escape(text)
    return _URL.sub(lambda m: f'<a href="{m.group(1)}" style="color:{ACCENT};text-decoration:underline;">{m.group(1)}</a>', out)


def _button(label: str, url: str, primary: bool) -> str:
    u = html.escape(url, quote=True)
    t = html.escape(label)
    if primary:
        return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr>'
                f'<td bgcolor="{BUTTON}" style="border-radius:999px;background:{BUTTON};">'
                f'<a href="{u}" style="display:inline-block;padding:14px 28px;font-family:{FONT};font-size:15px;font-weight:700;'
                f'color:{BUTTON_INK};text-decoration:none;border-radius:999px;">{t}</a></td></tr></table>')
    return (f'<p style="margin:10px 0 0;font-family:{FONT};font-size:14px;line-height:22px;">'
            f'<a href="{u}" style="color:{ACCENT};font-weight:600;text-decoration:none;">{t} &rarr;</a></p>')


def _blocks(body: str) -> str:
    parts: list[str] = []
    primary_done = False
    for para in re.split(r"\n\s*\n", body.strip()):
        lines = [ln.rstrip() for ln in para.split("\n") if ln.strip()]
        text_lines: list[str] = []

        def flush():
            if text_lines:
                parts.append(f'<p style="margin:0 0 16px;font-family:{FONT};font-size:15px;line-height:24px;color:{TEXT};">'
                             + "<br>".join(_inline(t) for t in text_lines) + "</p>")
                text_lines.clear()

        for ln in lines:
            m = _LINK_LINE.match(ln.strip())
            if m or _URL_LINE.match(ln.strip()):
                flush()
                url = m.group("url") if m else ln.strip()
                label = m.group("label").strip() if m else "Open in AVA"
                label = BUTTON_LABELS.get(label.lower(), label)
                parts.append(_button(label, url, not primary_done))
                primary_done = True
            else:
                text_lines.append(ln)
        flush()
    return "\n".join(parts)


def _footer(text: str) -> str:
    rows = []
    for ln in (x.strip() for x in text.split("\n") if x.strip()):
        m = _LINK_LINE.match(ln)
        if m:
            rows.append(f'<a href="{html.escape(m.group("url"), quote=True)}" style="color:{MUTED};text-decoration:underline;">'
                        f'{html.escape(m.group("label"))}</a>')
        else:
            rows.append(_inline(ln))
    return " &nbsp;&middot;&nbsp; ".join(rows)


def render(subject: str, body: str) -> str:
    app = settings().app_url.rstrip("/")
    main, _, foot = body.partition("\n\n--\n")
    footer = _footer(foot) if foot.strip() else ""
    # Internal reference tags such as "[3f9c…]" stay in the subject line only.
    title = html.escape(re.sub(r"\s*\[[0-9a-f-]{8,}\]$", "", subject))
    preheader = html.escape(re.sub(r"\s+", " ", _URL.sub("", main)).strip()[:140])
    return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>{title}</title></head>
<body style="margin:0;padding:0;background:{GROUND};" bgcolor="{GROUND}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{GROUND};">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{GROUND}" style="background:{GROUND};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 24px;">
      <a href="{app}" style="text-decoration:none;"><img src="{app}/icons/email-wordmark.png" width="72" height="29" alt="AVA" style="display:block;border:0;width:72px;height:auto;"></a>
    </td></tr>
    <tr><td bgcolor="{SURFACE}" style="background:{SURFACE};border:1px solid {LINE};border-radius:24px;padding:36px 32px;">
      <h1 style="margin:0 0 20px;font-family:{FONT};font-size:22px;line-height:30px;font-weight:700;color:{TEXT};letter-spacing:-0.01em;">{title}</h1>
      {_blocks(main)}
    </td></tr>
    <tr><td style="padding:24px 8px 0;font-family:{FONT};font-size:12px;line-height:20px;color:{MUTED};">
      {footer + "<br>" if footer else ""}AVA Verdict &middot; <a href="{app}" style="color:{MUTED};text-decoration:underline;">{html.escape(app.split("//")[-1])}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""
