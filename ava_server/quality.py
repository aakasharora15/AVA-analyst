"""Input quality gate. AVA refuses to score what it cannot assess.

Two layers:
* `input_problem` (here, mirrored in src/data/shared.js): cheap checks before
  any model call. Blocks empty, too-short and keyboard-mash descriptions so
  they never spend credit.
* The Orchestrator's `assessable` verdict (prompts, lifecycle.finalise): when
  the agents found the inputs too vague, contradictory or nonsensical to
  support a verdict, the audit ends with no score and does not count.
"""

from __future__ import annotations

import re

MIN_DESCRIPTION_CHARS = 80
MIN_WORDS = 12
MIN_DISTINCT_LONG_WORDS = 6

_WORD = re.compile(r"[A-Za-zÀ-ÿ']+")
_VOWELS = set("aeiouyàáâäèéêëìíîïòóôöùúûü")


def _gibberish_share(words: list[str]) -> float:
    """Share of 3+ letter words that look like keyboard mashing: no vowel, or a
    letter repeated four times in a row."""
    long_words = [w.lower() for w in words if len(w) >= 3]
    if not long_words:
        return 1.0
    bad = sum(1 for w in long_words if not (set(w) & _VOWELS) or re.search(r"(.)\1{3,}", w))
    return bad / len(long_words)


def input_problem(company: dict) -> str | None:
    """A message for the person when the venture inputs cannot support an audit, else None."""
    title = str(company.get("title") or "").strip()
    desc = str(company.get("description") or "").strip()
    if len(_WORD.findall(title)) == 0:
        return "Give the venture a real name."
    words = _WORD.findall(desc)
    if len(desc) < MIN_DESCRIPTION_CHARS or len(words) < MIN_WORDS:
        return (f"Describe the venture in at least {MIN_DESCRIPTION_CHARS} characters: what it does, who pays, "
                "how it makes money and what exists today. AVA cannot score a venture it cannot assess.")
    if len({w.lower() for w in words if len(w) >= 4}) < MIN_DISTINCT_LONG_WORDS or _gibberish_share(words) > 0.3:
        return ("The description does not read as a real business. Describe what it does, who pays and how it makes money. "
                "AVA cannot score a venture it cannot assess.")
    return None
