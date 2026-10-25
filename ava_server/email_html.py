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


VERDICT = {"PROCEED": "#4ADE9A", "HOLD": "#F2C46A", "PIVOT": "#FFA566", "KILL": "#FF8F8F"}

# Email kind -> (eyebrow label, icon badge). Kinds come from emailer.queue.
KINDS = {
    "invite": ("Invitation", "invite"),
    "audit-complete": ("Audit complete", "report"),
    "free-audit-result": ("Free audit result", "report"),
    "free-audit": ("Shared audit", "share"),
    "share": ("Shared report", "share"),
    "alert-immediate": ("Risk alert", "alert"),
    "digest": ("Weekly digest", "alert"),
    "metrics": ("Monthly numbers", "metrics"),
    "billing": ("Billing", "billing"),
    "drift": ("Scoring review", "shield"),
    "hold": ("Scoring review", "shield"),
    "hold-start": ("Scoring review", "shield"),
    "hold-end": ("Scoring review", "shield"),
    "ops": ("Operations", "shield"),
    "auth": ("Your account", "lock"),
}

_SCORE = re.compile(r"(?:Resilience Score (?P<s1>\d{1,3})(?: of 100)?\.\s*Directive (?P<d1>PROCEED|HOLD|PIVOT|KILL))"
                    r"|(?:(?P<d2>PROCEED|HOLD|PIVOT|KILL),? (?:score )?(?P<s2>\d{1,3})\b)")
_CHANGE = re.compile(r"from (PROCEED|HOLD|PIVOT|KILL) to (PROCEED|HOLD|PIVOT|KILL)")


def _pill(directive: str) -> str:
    c = VERDICT[directive]
    return (f'<span style="display:inline-block;padding:5px 12px;border-radius:999px;border:1px solid {c};color:{c};'
            f'font-family:{FONT};font-size:12px;font-weight:700;letter-spacing:.08em;">{directive}</span>')


def _score_card(score: int, directive: str) -> str:
    c = VERDICT[directive]
    pct = max(2, min(100, score))
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{GROUND}" style="background:{GROUND};border:1px solid {LINE};border-radius:18px;margin:0 0 24px;">
<tr><td style="padding:20px 22px 8px;font-family:{FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-family:{FONT};"><div style="font-size:11px;letter-spacing:.14em;color:{MUTED};font-weight:600;">RESILIENCE SCORE</div>
      <div style="font-size:44px;line-height:52px;font-weight:800;color:{TEXT};">{score}<span style="font-size:16px;font-weight:600;color:{MUTED};"> / 100</span></div></td>
    <td align="right" valign="middle">{_pill(directive)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:0 22px 22px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:999px;"><tr>
    <td width="{pct}%" height="8" bgcolor="{c}" style="background:{c};height:8px;line-height:8px;font-size:0;border-radius:999px 0 0 999px;">&nbsp;</td>
    <td height="8" bgcolor="{LINE}" style="background:{LINE};height:8px;line-height:8px;font-size:0;border-radius:0 999px 999px 0;">&nbsp;</td>
  </tr></table>
</td></tr></table>"""


def _change_card(frm: str, to: str) -> str:
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr>'
            f'<td>{_pill(frm)}</td><td style="padding:0 12px;font-family:{FONT};font-size:18px;color:{MUTED};">&rarr;</td><td>{_pill(to)}</td>'
            f'</tr></table>')


def _steps(items: list[str]) -> str:
    cells = "".join(
        f'<td valign="top" width="33%" style="padding:0 6px;font-family:{FONT};">'
        f'<div style="width:26px;height:26px;line-height:26px;border-radius:50%;background:#1E2450;color:{BUTTON};text-align:center;font-size:12px;font-weight:700;">{i + 1}</div>'
        f'<div style="margin-top:10px;font-size:13px;line-height:19px;color:{MUTED};">{html.escape(t)}</div></td>'
        for i, t in enumerate(items))
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:8px 0 4px;border-top:1px solid {LINE};padding-top:20px;"><tr>{cells}</tr></table>')


SCORED = ("audit-complete", "free-audit-result", "free-audit", "share", None)

EXTRAS = {
    "invite": lambda subject, body: _steps(["Accept the invitation", "Sign in with Google or your work email", "Open the shared portfolio"]),
}


def render(subject: str, body: str, kind: str | None = None) -> str:
    app = settings().app_url.rstrip("/")
    main, _, foot = body.partition("\n\n--\n")
    footer = _footer(foot) if foot.strip() else ""
    # Internal reference tags such as "[3f9c…]" stay in the subject line only.
    clean = re.sub(r"\s*\[[0-9a-f-]{8,}\]$", "", subject)
    title = html.escape(clean)
    preheader = html.escape(re.sub(r"\s+", " ", _URL.sub("", main)).strip()[:140])
    if main.startswith(clean):
        main = main[len(clean):].lstrip(". \n")  # the heading already says it
    label, icon = KINDS.get(kind or "", ("AVA", "report"))
    visual = ""
    change = _CHANGE.search(clean) if kind in ("alert-immediate", None) else None
    m = (_SCORE.search(main) or _SCORE.search(clean)) if kind in SCORED else None
    if change:
        visual = _change_card(*change.groups())
    elif m:
        visual = _score_card(int(m.group("s1") or m.group("s2")), m.group("d1") or m.group("d2"))
        if m.group("s1"):
            # The card shows the score line; the plain-text version keeps it.
            main = re.sub(r"\n*" + re.escape(m.group(0)) + r"\.?", "", main, count=1)
    extra = EXTRAS[kind](clean, main) if kind in EXTRAS else ""
    return f"""<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>{title}</title></head>
<body style="margin:0;padding:0;background:{GROUND};" bgcolor="{GROUND}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{GROUND};">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{GROUND}" style="background:{GROUND};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td style="line-height:0;font-size:0;">
      <a href="{app}" style="text-decoration:none;"><img src="{app}/icons/email/hero.png" width="560" alt="AVA: find the risk before the capital goes in" style="display:block;border:0;width:100%;max-width:560px;height:auto;border-radius:24px 24px 0 0;"></a>
    </td></tr>
    <tr><td bgcolor="{SURFACE}" style="background:{SURFACE};border:1px solid {LINE};border-top:0;border-radius:0 0 24px 24px;padding:28px 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
        <td valign="middle"><img src="{app}/icons/email/icon-{icon}.png" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px;"></td>
        <td valign="middle" style="padding-left:12px;font-family:{FONT};font-size:11px;font-weight:700;letter-spacing:.16em;color:{ACCENT};">{html.escape(label.upper())}</td>
      </tr></table>
      <h1 style="margin:0 0 20px;font-family:{FONT};font-size:24px;line-height:32px;font-weight:800;color:{TEXT};letter-spacing:-0.01em;">{title}</h1>
      {visual}
      {_blocks(main)}
      {extra}
    </td></tr>
    <tr><td style="padding:22px 12px 0;font-family:{FONT};font-size:12px;line-height:20px;color:{MUTED};">
      {footer + "<br>" if footer else ""}AVA Verdict &middot; <a href="{app}" style="color:{MUTED};text-decoration:underline;">{html.escape(app.split("//")[-1])}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""
