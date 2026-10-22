// Re-audit compare (spec 4.3).
//
// Finding matching across audits: each finding carries a `matchKey` built from
// agent + category + a stable topic slug. In production the slug comes from
// semantic similarity against earlier findings; in this prototype the mock
// data supplies it. Two findings with the same key are the same finding.

import { CATEGORIES } from './config.js';

const SEV_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export function matchKey(f) {
  return f.matchKey || `${f.agent}:${f.category}:${f.topic || f.id}`;
}

/** Group findings New, Resolved and Unchanged (with severity movement noted). */
export function matchFindings(before, after) {
  const prev = new Map(before.map((f) => [matchKey(f), f]));
  const next = new Map(after.map((f) => [matchKey(f), f]));
  const added = [];
  const unchanged = [];
  for (const [key, f] of next) {
    const p = prev.get(key);
    if (!p) { added.push(f); continue; }
    const move = SEV_RANK[f.severity] - SEV_RANK[p.severity];
    unchanged.push({ before: p, after: f, severityMove: move > 0 ? 'up' : move < 0 ? 'down' : 'same' });
  }
  const resolved = [...prev].filter(([key]) => !next.has(key)).map(([, f]) => f);
  return { added, resolved, unchanged };
}

export function categoryMovement(beforeExposure, afterExposure) {
  return CATEGORIES.map((c) => ({
    category: c,
    before: beforeExposure[c],
    after: afterExposure[c],
    delta: afterExposure[c] - beforeExposure[c],
  }));
}

export function sourcesAdded(beforeIds, afterSources) {
  const had = new Set(beforeIds);
  return afterSources.filter((s) => !had.has(s.id));
}

/** Findings in `current` whose key was dismissed in an earlier audit. */
export function previouslyDismissed(current, earlierAudits) {
  const dismissed = new Map();
  for (const audit of earlierAudits) {
    for (const f of audit.findings || []) {
      if (f.status === 'dismissed') dismissed.set(matchKey(f), f);
    }
  }
  const flags = {};
  for (const f of current) {
    const hit = dismissed.get(matchKey(f));
    if (hit && f.status !== 'dismissed') flags[f.id] = { reason: hit.dismissReason, auditId: hit.auditId };
  }
  return flags;
}
