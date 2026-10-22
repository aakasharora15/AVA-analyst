// Scoring engine (spec 4.0). Pure functions: no I/O, no randomness.
// Agents classify findings; code computes exposure, score and directive.

import { CALIBRATION, CATEGORIES, DIRECTIVES } from './config.js';

const round = (n) => Math.round(n);
// Snap to 6 decimals so float noise can never decide a .5 rounding tie.
const snap = (n) => Math.round(n * 1e6) / 1e6;

/** Exposure per category, 0 to 100, higher is worse. */
export function categoryExposure(findings, cal = CALIBRATION) {
  const exposure = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const f of findings) {
    if (!(f.category in exposure)) continue;
    exposure[f.category] += cal.severityWeights[f.severity] || 0;
  }
  for (const c of CATEGORIES) exposure[c] = Math.min(100, exposure[c]);
  return exposure;
}

/** Resilience Score = 100 minus the weighted average exposure, then the cap rule. */
export function resilienceScore(exposure, type = 'startup', cal = CALIBRATION) {
  const weights = cal.categoryWeights[type] || cal.categoryWeights.startup;
  const weighted = snap(CATEGORIES.reduce((sum, c) => sum + weights[c] * exposure[c], 0));
  const raw = round(100 - weighted);
  const worst = CATEGORIES
    .filter((c) => exposure[c] > cal.cap.threshold)
    .sort((a, b) => exposure[b] - exposure[a])[0];
  const cap = worst && raw > cal.cap.maxScore
    ? { category: worst, exposure: exposure[worst], limit: cal.cap.maxScore }
    : null;
  return { weighted, raw, cap, score: cap ? cap.limit : raw };
}

export function directiveForScore(score, cal = CALIBRATION) {
  const { bands } = cal;
  if (score >= bands.PROCEED) return 'PROCEED';
  if (score >= bands.HOLD) return 'HOLD';
  if (score >= bands.PIVOT) return 'PIVOT';
  return 'KILL';
}

export const directiveRank = (d) => DIRECTIVES.indexOf(d);
export const bandLowerEdge = (d, cal = CALIBRATION) => cal.bands[d];

/**
 * Validate an Orchestrator override against the base directive.
 * Valid only when it moves exactly one band down and cites finding ids that
 * exist in this audit. Anything else is rejected with a reason to log.
 */
export function validateOverride(base, override, findingIds = []) {
  if (!override || !override.to) return { valid: false, reason: null };
  const from = directiveRank(base);
  const to = directiveRank(override.to);
  if (to < 0) return { valid: false, reason: 'Unknown directive' };
  if (to > from) return { valid: false, reason: 'Override moves the directive up' };
  if (to === from) return { valid: false, reason: 'Override does not change the directive' };
  if (from - to > 1) return { valid: false, reason: 'Override moves more than one band' };
  const cited = (override.findingIds || []).filter((id) => findingIds.includes(id));
  if (!cited.length) return { valid: false, reason: 'Override cites no valid finding ids' };
  return { valid: true, reason: null, cited };
}

/** A Partial audit is capped at HOLD. The cap never raises a lower directive. */
export function applyPartialCap(directive, partial) {
  if (!partial) return directive;
  return directiveRank(directive) > directiveRank('HOLD') ? 'HOLD' : directive;
}

/**
 * Score a whole audit. Order of operations per spec 4.0:
 * score -> base directive -> valid override -> Partial cap -> final directive.
 */
export function scoreAudit({ findings, type = 'startup', status = 'complete', override = null }, cal = CALIBRATION) {
  if (status === 'failed') {
    return { failed: true, exposure: null, score: null, baseDirective: null, finalDirective: null };
  }
  const exposure = categoryExposure(findings, cal);
  const { raw, cap, score, weighted } = resilienceScore(exposure, type, cal);
  const baseDirective = directiveForScore(score, cal);
  const check = validateOverride(baseDirective, override, findings.map((f) => f.id));
  const afterOverride = check.valid ? override.to : baseDirective;
  const partial = status === 'partial';
  const finalDirective = applyPartialCap(afterOverride, partial);
  return {
    failed: false,
    calibrationVersion: cal.version,
    exposure,
    weighted,
    raw,
    cap,
    score,
    baseDirective,
    overridden: check.valid,
    overrideCited: check.valid ? check.cited : [],
    overrideRejected: override && !check.valid ? check.reason : null,
    partialCapped: partial && finalDirective !== afterOverride,
    finalDirective,
  };
}

/** Score excluding dismissed findings. The official score never changes. */
export function scoreExcludingDismissed(findings, type, cal = CALIBRATION) {
  const kept = findings.filter((f) => f.status !== 'dismissed');
  const { score } = resilienceScore(categoryExposure(kept, cal), type, cal);
  return { score, dismissed: findings.length - kept.length, directive: directiveForScore(score, cal) };
}

/**
 * "What would change this verdict": each open finding's effect on the score
 * on its own. Effects are not additive because of averaging and the cap.
 */
export function individualEffects(findings, type, cal = CALIBRATION) {
  const base = resilienceScore(categoryExposure(findings, cal), type, cal).score;
  const baseDirective = directiveForScore(base, cal);
  return findings
    .filter((f) => f.status !== 'resolved' && f.status !== 'dismissed')
    .map((f) => {
      const without = findings.filter((x) => x.id !== f.id);
      const score = resilienceScore(categoryExposure(without, cal), type, cal).score;
      const directive = directiveForScore(score, cal);
      return {
        finding: f,
        score,
        effect: score - base,
        directive,
        movesUpBand: directiveRank(directive) > directiveRank(baseDirective),
      };
    })
    .sort((a, b) => b.effect - a.effect);
}

/** Findings that drive each category, strongest first (for the score trace). */
export function traceByCategory(findings, cal = CALIBRATION) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const f of findings) if (out[f.category]) out[f.category].push(f);
  for (const c of CATEGORIES) {
    out[c].sort((a, b) => (cal.severityWeights[b.severity] || 0) - (cal.severityWeights[a.severity] || 0));
  }
  return out;
}
