"""A stand-in for the Anthropic client: returns scripted JSON per agent."""

import json
from types import SimpleNamespace

from ava_server.config import AGENTS


def agent_of(system) -> int:
    text = system[0]["text"] if isinstance(system, list) else system
    for a in reversed(AGENTS):
        if f"You are {a['name']}" in text:
            return a["n"]
    raise AssertionError("unknown agent prompt")


def finding(section, category, severity, topic, sources=()):
    return {"section": section, "severity": severity, "category": category, "topic": topic,
            "title": f"{topic} title", "text": f"{topic} detail.", "source_ids": list(sources)}


DEFAULT = {
    1: {"summary": "s", "findings": [finding("fin", "Financial", "HIGH", "runway", ["S1", "bogus"]), finding("ops", "Operational", "MEDIUM", "single-depot")], "skipped_sections": []},
    2: {"summary": "s", "findings": [finding("comp", "Competition", "HIGH", "funded-entrant")], "skipped_sections": []},
    3: {"summary": "s", "findings": [finding("sat", "Market", "MEDIUM", "easy-clone")], "skipped_sections": []},
    4: {"summary": "s", "findings": [finding("psy", "Customer psychology", "LOW", "price-switching")], "skipped_sections": []},
    5: {"summary": "s", "findings": [finding("reg", "Regulatory", "LOW", "licence")], "skipped_sections": [{"section": "ip", "reason": "No legal material supplied."}]},
    6: {"rationale": "Real demand, broken economics.", "investor_perspective": "Not yet.", "roadmap": "Fix pricing.",
        "top_risks": [], "assessable": True, "assessable_reason": "", "override": {"apply": False, "to": "HOLD", "finding_ids": [], "reason": ""}},
}


class FakeClient:
    """script: {agent: [response, ...]} where response is a dict (output),
    the string 'malformed', 'refusal' or an Exception instance."""

    def __init__(self, script=None, model="claude-opus-5-5"):
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.model = model
        self.calls = []
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        if "tools" in kw:  # research call: no web results in tests
            return SimpleNamespace(content=[], stop_reason="end_turn", model=self.model, usage=SimpleNamespace(iterations=None))
        n = agent_of(kw["system"])
        self.calls.append({"agent": n, **kw})
        queue = self.script.get(n)
        resp = queue.pop(0) if queue else DEFAULT[n]
        if callable(resp):
            resp = resp(kw)
        if isinstance(resp, Exception):
            raise resp
        stop = "end_turn"
        text = json.dumps(resp)
        if resp == "malformed":
            text = '{"summary": 1}'
        if resp == "refusal":
            stop, text = "refusal", ""
        usage = SimpleNamespace(input_tokens=10, output_tokens=20, cache_read_input_tokens=0, cache_creation_input_tokens=0, iterations=None)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)] if text else [], stop_reason=stop,
                               model=self.model, usage=usage, stop_details=SimpleNamespace(category="cyber"))
