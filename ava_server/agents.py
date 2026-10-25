"""Agent contract (spec 4.0, prompt 0a).

Agents 1 to 5 return findings, skipped sections and a summary. The
Orchestrator returns rationale, top risks and an optional one-band-down
override. Every output is requested as structured JSON and validated again
against the same schema; malformed output counts as an agent failure.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import logging

import anthropic
import jsonschema

from .config import SUBJECTS, AGENTS, CATEGORIES, DIRECTIVES, FALLBACK_MODEL_PREFIXES, SECTIONS, Settings, settings

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
MAX_PAUSE_CONTINUATIONS = 3


log = logging.getLogger("ava.agents")

class AgentError(Exception):
    """An agent attempt failed. Retried once by the lifecycle."""

    def __init__(self, reason: str, schema_result: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.schema_result = schema_result


@dataclass
class AgentResult:
    output: dict
    served_model: str
    fallback_used: bool
    usage: dict = field(default_factory=dict)
    duration_s: float = 0.0
    research_sources: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Prompts (versioned files, held server-side)


def load_prompt(version: str, name: str) -> str:
    path = PROMPTS_DIR / version / f"{name}.md"
    if not path.exists():
        raise RuntimeError(f"Prompt {name} missing for version {version}")
    return path.read_text(encoding="utf-8")


def system_prompt(version: str, agent_n: int | None = None) -> str:
    """The rules every agent shares. Identical for all six agents, so the
    model provider caches it once per audit; each agent's own brief goes in
    the message (see build_context)."""
    return load_prompt(version, "_shared")


def agent_brief(version: str, agent_n: int) -> str:
    return load_prompt(version, AGENTS[agent_n - 1]["id"])


# ---------------------------------------------------------------------------
# Output schemas


def agent_schema(agent_n: int) -> dict:
    if agent_n == 6:
        return {
            "type": "object",
            "properties": {
                "rationale": {"type": "string"},
                "investor_perspective": {"type": "string"},
                "roadmap": {"type": "string"},
                "top_risks": {"type": "array", "items": {"type": "string"}},
                "assessable": {"type": "boolean"},
                "assessable_reason": {"type": "string"},
                "override": {
                    "type": "object",
                    "properties": {
                        "apply": {"type": "boolean"},
                        "to": {"type": "string", "enum": DIRECTIVES},
                        "finding_ids": {"type": "array", "items": {"type": "string"}},
                        "reason": {"type": "string"},
                    },
                    "required": ["apply", "to", "finding_ids", "reason"],
                    "additionalProperties": False,
                },
            },
            "required": ["rationale", "investor_perspective", "roadmap", "top_risks", "assessable", "assessable_reason", "override"],
            "additionalProperties": False,
        }
    sections = [s["id"] for s in SECTIONS if s["agent"] == agent_n]
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "section": {"type": "string", "enum": sections},
                        "severity": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
                        "category": {"type": "string", "enum": CATEGORIES},
                        "topic": {"type": "string"},
                        "title": {"type": "string"},
                        "text": {"type": "string"},
                        "source_ids": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["section", "severity", "category", "topic", "title", "text", "source_ids"],
                    "additionalProperties": False,
                },
            },
            "skipped_sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"section": {"type": "string", "enum": sections}, "reason": {"type": "string"}},
                    "required": ["section", "reason"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "findings", "skipped_sections"],
        "additionalProperties": False,
    }


def validate_output(agent_n: int, output: dict) -> None:
    try:
        jsonschema.validate(output, agent_schema(agent_n))
    except jsonschema.ValidationError as exc:
        raise AgentError(f"Output failed schema validation: {exc.message}", "malformed") from exc
    if agent_n != 6:
        for f in output["findings"]:
            if not f["title"].strip() or not f["text"].strip():
                raise AgentError("A finding has an empty title or text", "malformed")
        for s in output["skipped_sections"]:
            if not s["reason"].strip():
                raise AgentError("A skipped section has no reason", "malformed")


# ---------------------------------------------------------------------------
# Context (the user message). Stable parts first so prompt caching can help.


# Optional form fields kept in companies.extra, sent under these names.
EXTRA_FIELDS = (("price", "price_range"), ("delivery", "delivery_mode"), ("competitors", "known_competitors"),
                *((f["key"], f["agentName"]) for f in SUBJECTS["operatingFields"]))
# Chosen from a list: the agents read the label, not the key.
LABELLED = (("subject", "what_is_analysed", "subjects"), ("decision", "decision_this_audit_supports", "decisions"),
            ("relationship", "submitted_by", "relationships"))


def company_fields(company: dict) -> dict:
    """Everything the person told us about the venture, as the agents see it."""
    out = {k: company.get(k) for k in ("title", "description", "industry", "country", "city", "model", "target", "type", "budget", "stage")}
    extra = company.get("extra") or {}
    for key, name, options in LABELLED:
        label = next((o["label"] for o in SUBJECTS[options] if o["key"] == extra.get(key)), None)
        if label:
            out[name] = label
    for key, name in EXTRA_FIELDS:
        value = str(extra.get(key) or "").strip()
        if value:
            out[name] = value[:2000]
    return out


CACHE = {"type": "ephemeral"}


def _source_line(s: dict) -> str:
    return json.dumps({"id": s["id"], "type": s["type"], "title": s["title"], "kind": s.get("kind"),
                       "date": str(s.get("date") or ""), "url": s.get("url"),
                       "extract": (s.get("extract") or s.get("note") or "")[:6000]}, ensure_ascii=False)


def build_context(company: dict, sources: list[dict], prior: list[dict], extra: str = "", brief: str = "") -> list[dict]:
    """The agent's message, as content blocks ordered from most to least stable
    so all six agents share a cached prefix: the company and its data room,
    then sources found during this audit, then this agent's brief and the
    reports before it."""
    stable = [s for s in sources if not s.get("audit_id")]
    found = [s for s in sources if s.get("audit_id")]
    head = ["<company>", json.dumps(company_fields(company), ensure_ascii=False, indent=1), "</company>", "<sources>"]
    head += [_source_line(s) for s in stable] or ([] if found else ["No sources supplied."])
    blocks = [{"type": "text", "text": "\n".join(head), "cache_control": CACHE}]
    if found:
        blocks.append({"type": "text", "text": "\n".join(_source_line(s) for s in found), "cache_control": CACHE})
    tail = ["</sources>"]
    if brief:
        tail += ["<your_brief>", brief.strip(), "</your_brief>"]
    for p in prior:
        tail += [f"<report agent=\"{p['name']}\">", json.dumps(p["output"], ensure_ascii=False), "</report>"]
    if extra:
        tail.append(extra)
    tail.append("Return your report as JSON matching the schema.")
    blocks.append({"type": "text", "text": "\n".join(tail)})
    return blocks


def context_text(blocks: list[dict] | str) -> str:
    return blocks if isinstance(blocks, str) else "\n".join(b["text"] for b in blocks)


# ---------------------------------------------------------------------------
# Runner


class AgentRunner:
    def __init__(self, client: anthropic.Anthropic | None = None, cfg: Settings | None = None):
        self.cfg = cfg or settings()
        self.client = client or anthropic.Anthropic(max_retries=2, timeout=240.0)

    def _create(self, **kwargs):
        if self.cfg.refusal_fallback == "default" and str(kwargs.get("model", "")).startswith(FALLBACK_MODEL_PREFIXES):
            return self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        return self.client.messages.create(**kwargs)

    def run(self, agent_n: int, context: list[dict] | str, model: str | None = None) -> AgentResult:
        started = time.monotonic()
        schema = agent_schema(agent_n)
        try:
            resp = self._create(
                model=model or self.cfg.model,
                max_tokens=16000,
                system=[{"type": "text", "text": system_prompt(self.cfg.prompt_version, agent_n),
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": context}],
                output_config={"effort": self.cfg.effort, "format": {"type": "json_schema", "schema": schema}},
            )
        except anthropic.BadRequestError as exc:
            # Provider detail (which can name the model) goes to the server log, not to users.
            log.warning("Agent request rejected: %s", exc.message)
            raise AgentError("The AI provider rejected the request") from exc
        except anthropic.RateLimitError as exc:
            raise AgentError("Rate limited by the model provider") from exc
        except anthropic.APIStatusError as exc:
            raise AgentError(f"Model provider error {exc.status_code}") from exc
        except anthropic.APIConnectionError as exc:
            raise AgentError("Could not reach the model provider") from exc

        if resp.stop_reason == "refusal":
            details = getattr(resp, "stop_details", None)
            raise AgentError("The AI declined this request")
        if resp.stop_reason == "max_tokens":
            raise AgentError("Output was cut off at the token limit", "malformed")
        text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
        if text is None:
            raise AgentError("No output returned", "malformed")
        try:
            output = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AgentError("Output was not valid JSON", "malformed") from exc
        validate_output(agent_n, output)

        iterations = getattr(resp.usage, "iterations", None) or []
        fallback_used = any(getattr(e, "type", None) == "fallback_message" for e in iterations)
        usage = {k: getattr(resp.usage, k, None) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
        return AgentResult(output=output, served_model=resp.model, fallback_used=fallback_used,
                           usage=usage, duration_s=round(time.monotonic() - started, 1))

    def research(self, agent_n: int, company: dict, model: str | None = None, searches: int = 4) -> list[dict]:
        """Live public research before an agent runs. Every result becomes a
        registered public Source before any finding may cite it (spec 4.2)."""
        agent = AGENTS[agent_n - 1]
        prompt = (
            f"Research public information that {agent['name']} needs: {agent['mandate']}\n"
            f"Venture: {company.get('title')}. {company.get('description')} Industry: {company.get('industry')}. "
            f"Country: {company.get('country')} {company.get('city') or ''}.\n"
            "Search for competitors, regulation and market evidence relevant to that angle. Summarise what you found in a few sentences."
        )
        messages = [{"role": "user", "content": prompt}]
        found: dict[str, dict] = {}
        for _ in range(MAX_PAUSE_CONTINUATIONS + 1):
            try:
                resp = self.client.messages.create(
                    model=model or self.cfg.model, max_tokens=8000,
                    tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": searches}],
                    messages=messages, output_config={"effort": "low"},
                )
            except anthropic.APIError:
                return []  # research is best effort; the agent still runs on supplied material
            for block in resp.content:
                if getattr(block, "type", None) != "web_search_tool_result":
                    continue
                results = block.content if isinstance(block.content, list) else []
                for r in results:
                    url = getattr(r, "url", None)
                    if url and url not in found:
                        title = getattr(r, "title", None) or url
                        page_age = getattr(r, "page_age", None) or ""
                        found[url] = {
                            "type": "public", "title": title[:300], "kind": "Web page", "url": url,
                            "retrieval_date": date.today().isoformat(), "date": date.today().isoformat(),
                            "content_hash": hashlib.sha256(f"{url}|{title}|{page_age}".encode()).hexdigest(),
                            "note": f"Retrieved by {agent['name']} during the audit.", "reliability": "Unrated",
                        }
            if resp.stop_reason != "pause_turn":
                break
            messages = [{"role": "user", "content": prompt}, {"role": "assistant", "content": resp.content}]
        return list(found.values())
