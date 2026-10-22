// Alert triggers (spec 4.0 and 4.7). Evaluated after every complete or
// partial audit against the company's previous audit.

import { ALERT_RULES, CALIBRATION } from './config.js';
import { directiveRank, bandLowerEdge } from './score.js';
import { matchFindings, matchKey } from './compare.js';

/**
 * Did a score-driven directive change cross the band edge by the margin?
 * Down: the old band's lower edge minus the new score. Up: the new score minus
 * the new band's lower edge.
 */
export function crossesBandEdge(prev, next, cal = CALIBRATION, margin = ALERT_RULES.bandCrossMargin) {
  if (prev.finalDirective === next.finalDirective) return false;
  const down = directiveRank(next.baseDirective) < directiveRank(prev.baseDirective);
  if (down) return bandLowerEdge(prev.baseDirective, cal) - next.score >= margin;
  return next.score - bandLowerEdge(next.baseDirective, cal) >= margin;
}

/**
 * Override-driven change alerts only when the override cites at least one
 * HIGH finding that is new or unchanged since the last audit.
 */
export function overrideAnchors(prev, next) {
  const prevByKey = new Map((prev.findings || []).map((f) => [matchKey(f), f]));
  return (next.overrideCited || [])
    .map((id) => next.findings.find((f) => f.id === id))
    .filter((f) => f && f.severity === 'HIGH')
    .filter((f) => {
      const before = prevByKey.get(matchKey(f));
      return !before || before.severity === 'HIGH'; // new, or unchanged
    })
    .map((f) => f.id);
}

/**
 * Returns the alerts this audit pair produces. `rules` switches triggers on
 * or off; `holdMode` pauses directive-change alerts.
 */
export function evaluateAlerts(prev, next, { rules = { directive: true, score: true, high: true }, holdMode = false } = {}) {
  const alerts = [];
  if (!prev || !next || next.status === 'failed' || next.score == null) return alerts;
  const sameCalibration = prev.calibrationVersion === next.calibrationVersion;
  const base = { companyId: next.companyId, auditId: next.id, previousAuditId: prev.id, fromScore: prev.score, toScore: next.score, fromDirective: prev.finalDirective, toDirective: next.finalDirective };

  // Directive change (final directives).
  if (rules.directive && sameCalibration && !holdMode && prev.finalDirective !== next.finalDirective) {
    const byOverride = next.overridden && next.baseDirective === prev.finalDirective;
    if (byOverride) {
      const anchors = overrideAnchors(prev, next);
      if (anchors.length) alerts.push({ ...base, trigger: 'directive', causedByOverride: true, anchoringFindingIds: anchors });
    } else if (crossesBandEdge(prev, next)) {
      alerts.push({ ...base, trigger: 'directive', causedByOverride: false, anchoringFindingIds: [] });
    }
  }

  // Score move.
  if (rules.score && sameCalibration && Math.abs(next.score - prev.score) >= ALERT_RULES.scoreMove) {
    alerts.push({ ...base, trigger: 'score', causedByOverride: false, anchoringFindingIds: [] });
  }

  // New HIGH findings (not present as HIGH in the previous audit).
  if (rules.high) {
    const { added, unchanged } = matchFindings(prev.findings || [], next.findings || []);
    const newHigh = [
      ...added.filter((f) => f.severity === 'HIGH'),
      ...unchanged.filter((u) => u.after.severity === 'HIGH' && u.before.severity !== 'HIGH').map((u) => u.after),
    ];
    for (const f of newHigh) alerts.push({ ...base, trigger: 'high', findingId: f.id, causedByOverride: false, anchoringFindingIds: [] });
  }

  return alerts;
}
