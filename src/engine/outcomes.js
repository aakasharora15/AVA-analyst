// Outcomes and agreement (spec 4.16). Windows are fixed at issue and stored on
// the audit; this module only reads them.

import { OUTCOME_WINDOW } from './config.js';

export const OUTCOMES = {
  grew: { label: 'Grew', definition: '[DEFINE: for example revenue, headcount or valuation up beyond a set threshold]' },
  flat: { label: 'Stayed flat', definition: '[DEFINE: for example the same measures within a set band]' },
  changed: { label: 'Changed direction', definition: 'Material change to product, market or business model, recorded with what changed.' },
  exited: { label: 'Exited', definition: 'Acquisition, IPO or sale at or above the last valuation. Terms [DEFINE].', terminal: true },
  writtenDown: { label: 'Written down or distressed sale', definition: 'Valuation written down beyond [DEFINE], or acquired, acqui-hired or sold below the last valuation.', terminal: true },
  shutDown: { label: 'Shut down', definition: 'Ceased trading, entered administration or liquidation.', terminal: true },
};

// Agreement mapping against the final directive (proposed).
export const AGREES_WITH = {
  PROCEED: ['grew', 'exited'],
  HOLD: ['flat'],
  PIVOT: ['changed'],
  KILL: ['shutDown', 'writtenDown'],
};

export function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Checkpoint dates written once, at issue. */
export function checkpoints(auditDate, window = OUTCOME_WINDOW) {
  return {
    outcomeWindowVersion: window.version,
    firstCheckpoint: addMonths(auditDate, window.firstMonths),
    finalCheckpoint: addMonths(auditDate, window.finalMonths),
  };
}

/**
 * Status of one audit's outcome on `today` (ISO date):
 * too-early | awaiting | agrees | not-yet-resolved | disagrees
 */
export function outcomeStatus(audit, outcome, today) {
  const agrees = outcome ? (AGREES_WITH[audit.finalDirective] || []).includes(outcome.result) : false;
  const terminal = outcome && OUTCOMES[outcome.result]?.terminal;
  if (terminal) return agrees ? 'agrees' : 'disagrees';
  if (today < audit.firstCheckpoint) return 'too-early';
  if (!outcome) return 'awaiting';
  if (today >= audit.finalCheckpoint) return agrees ? 'agrees' : 'disagrees';
  return agrees ? 'agrees' : 'not-yet-resolved';
}

/** Agreement rate excludes Too early, Awaiting and Not yet resolved. */
export function agreementRate(statuses) {
  const agreed = statuses.filter((s) => s === 'agrees').length;
  const counted = statuses.filter((s) => s === 'agrees' || s === 'disagrees').length;
  return { agreed, counted, rate: counted ? agreed / counted : null };
}
