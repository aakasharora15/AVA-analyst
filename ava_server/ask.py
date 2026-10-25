"""Ask AVA: questions about one report, answered from that report only.

The model sees the report as issued (company fields, score, directive,
findings, the sources they cite, the Orchestrator's rationale, any challenges
and the recent questions on this report) and must cite the findings it relies
on. It cannot change the score or the directive. Questions count against a
monthly allowance per plan (config/plans.json, "questions").
"""

from __future__ import annotations

import json

from . import db
from .agents import AgentError, AgentRunner, company_fields
from .config import PLANS, plan_id
from .plans import period_start

MAX_FINDINGS = 80
HISTORY = 6

SYSTEM = """You are AVA's report assistant. A member of the organisation is asking about one AVA audit report. Answer from the report supplied and nothing else.

Rules:
- Use only the report: its company fields, score, directive, findings, sources, rationale and challenges. Do not add facts, figures, competitors or market data that are not in it.
- If the report does not answer the question, say so in one sentence and suggest what would (a re-audit with more material, a document for the data room, a question for the founder).
- Cite the findings you rely on by listing their ids in finding_ids. Refer to them in the answer by their titles, never by id.
- You cannot change the Resilience Score or the directive. Code sets them from the findings. If asked to change them, explain that a finding can be challenged with evidence, or the venture re-audited after a change.
- When submitted_by is the founder or owner, favour what to fix and in what order. When it is an investor, favour what to ask the founder and what evidence would change the view.
- This is decision support, not investment, legal or financial advice. Say so only when the question asks for advice of that kind.
- Be direct and short: at most about 180 words. Plain sentences or a short list. UK English. No em dashes."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answer", "finding_ids"],
    "properties": {
        "answer": {"type": "string"},
        "finding_ids": {"type": "array", "items": {"type": "string"}},
    },
}


class QuestionLimit(PermissionError):
    """The organisation has used this month's question allowance."""


def allowance(org: dict) -> int | None:
    return PLANS[plan_id(org.get("plan"))].get("questions")


def used(c, org: dict) -> int:
    return c.execute("select count(*) as n from report_questions where org_id = %s and status = 'answered' and created_at >= %s",
                     (org["id"], period_start(org))).fetchone()["n"]


def check(c, org: dict) -> None:
    limit = allowance(org)
    if limit is not None and used(c, org) >= limit:
        raise QuestionLimit(f"Your plan includes {limit} questions to AVA a month and they are used up. They reset next month, or upgrade for more.")


def report_context(c, audit_id: str) -> tuple[str, set[str]]:
    a = c.execute("select a.*, co.title, co.description, co.industry, co.country, co.city, co.model, co.target, co.type, co.budget, co.stage, co.extra "
                  "from audits a join companies co on co.id = a.company_id where a.id = %s", (audit_id,)).fetchone()
    findings = c.execute("select id, title, text, severity, category, section, status, dismiss_reason, sources from findings "
                         "where audit_id = %s order by position limit %s", (audit_id, MAX_FINDINGS)).fetchall()
    cited = sorted({s for f in findings for s in (f["sources"] or [])})
    sources = c.execute("select id, title, url, type from sources where id = any(%s)", (cited,)).fetchall() if cited else []
    challenges = c.execute("select finding_id, claim, evidence, status, response from finding_challenges where audit_id = %s order by created_at",
                           (audit_id,)).fetchall()
    orch = a["orchestrator"] or {}
    report = {
        "company": company_fields(a),
        "resilience_score": a["score"],
        "directive": a["final_directive"],
        "score_maps_to": a["base_directive"],
        "category_exposure": a["exposure"],
        "status": a["status"],
        "rationale": orch.get("rationale"),
        "investor_perspective": orch.get("investor"),
        "roadmap": orch.get("roadmap"),
        "findings": [{"id": f["id"], "title": f["title"], "text": f["text"], "severity": f["severity"], "category": f["category"],
                      "status": f["status"], "dismissed_because": f["dismiss_reason"], "source_ids": f["sources"] or []} for f in findings],
        "sources": [{"id": s["id"], "title": s["title"], "url": s["url"], "type": s["type"]} for s in sources],
        "challenges": [dict(ch) for ch in challenges],
    }
    return json.dumps(report, ensure_ascii=False, default=str), {f["id"] for f in findings}


def answer(c, audit_id: str, question: str, history: list[dict], runner: AgentRunner | None = None) -> dict:
    """Returns {answer, finding_ids, usage}. Raises AgentError when the model fails."""
    runner = runner or AgentRunner()
    report, ids = report_context(c, audit_id)
    messages = []
    for h in history[-HISTORY:]:
        messages += [{"role": "user", "content": h["question"]}, {"role": "assistant", "content": h["answer"]}]
    messages.append({"role": "user", "content": question})
    messages[0] = {"role": "user", "content": f"<report>\n{report}\n</report>\n\n{messages[0]['content']}"}
    try:
        resp = runner._create(
            model=runner.cfg.model, max_tokens=2000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
    except Exception as exc:  # noqa: BLE001 - every provider failure is the same to the person asking
        raise AgentError("AVA could not answer just now. Try again in a minute.") from exc
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    if resp.stop_reason == "refusal" or not text:
        raise AgentError("AVA could not answer that question.")
    try:
        out = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentError("AVA could not answer just now. Try again in a minute.") from exc
    usage = {k: getattr(resp.usage, k, None) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
    return {"answer": str(out.get("answer", "")).strip(), "finding_ids": [i for i in out.get("finding_ids", []) if i in ids], "usage": usage}
