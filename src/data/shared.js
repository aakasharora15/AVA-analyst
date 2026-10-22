// Logic shared by the mock and live data layers, so both return the same
// shapes and enforce the same rules in the UI.

import { CALIBRATION, CALIBRATIONS, SECTIONS } from '../engine/config.js';
import { scoreExcludingDismissed, individualEffects, traceByCategory } from '../engine/score.js';
import { previouslyDismissed } from '../engine/compare.js';

// Permissions (spec 4.8). The UI checks these; the backend enforces them with
// row-level security.
export const MATRIX = {
  billing: ['Owner'],
  members: ['Owner', 'Admin'],
  settings: ['Owner', 'Admin'],
  runAudits: ['Owner', 'Admin', 'Analyst'],
  upload: ['Owner', 'Admin', 'Analyst'],
  findingStatus: ['Owner', 'Admin', 'Analyst'],
  comment: ['Owner', 'Admin', 'Analyst', 'Viewer'],
  share: ['Owner', 'Admin', 'Analyst', 'Viewer'],
};

export const roleCan = (permission, role) => (MATRIX[permission] || []).includes(role);

export const FREE_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com'];

/** Format and free-domain check. The one-per-domain-per-month rule is checked where the records live. */
export function checkEmailFormat(email) {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(String(email).trim().toLowerCase());
  if (!m) return { ok: false, reason: 'Enter a valid work email.' };
  if (FREE_DOMAINS.includes(m[1])) return { ok: false, reason: 'Use your work email. Free email addresses cannot run a free audit.' };
  return { ok: true, domain: m[1] };
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeNextRun(c, org) {
  const mode = c.cadence.mode === 'inherit' ? org.cadence.mode : c.cadence.mode;
  if (mode === 'off' || c.cadence.paused) return null;
  const months = mode === 'monthly' ? 1 : 3;
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, Math.min(28, org.cadence.day || 1));
  return d.toISOString().slice(0, 10);
}

export function kindOf(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { pdf: 'PDF', xlsx: 'Spreadsheet', xls: 'Spreadsheet', csv: 'Spreadsheet', ppt: 'Slides', pptx: 'Slides', key: 'Slides', doc: 'Document', docx: 'Document', txt: 'Document' }[ext] || 'File';
}

export function pickAudit(a) {
  return {
    id: a.id, date: a.date, status: a.status, score: a.score, baseDirective: a.baseDirective, finalDirective: a.finalDirective,
    exposure: a.exposure, overridden: a.overridden, calibrationVersion: a.calibrationVersion, underReview: a.underReview,
  };
}

// Number sources in order of first citation across the report.
export function citationOrder(a, sourcesById) {
  const order = [];
  const rank = (f) => SECTIONS.findIndex((s) => s.id === f.section);
  const reading = a.findings.map((f, i) => [f, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([f]) => f);
  for (const f of reading) for (const s of f.sources) if (sourcesById[s] && !order.includes(s)) order.push(s);
  return order;
}

/**
 * Everything the Report derives on read from an audit in the shared shape.
 * `issued` is the company's complete and partial audits in date order.
 */
export function enrichAudit(a, { company, sources, issued }) {
  const earlier = issued.filter((x) => x.date < a.date);
  const out = { ...a, company };
  out.sourcesById = Object.fromEntries(sources.map((s) => [s.id, s]));
  out.citationOrder = citationOrder(a, out.sourcesById);
  out.auditNumber = issued.findIndex((x) => x.id === a.id) + 1;
  out.auditTotal = issued.length;
  out.previous = earlier.length ? pickAudit(earlier[earlier.length - 1]) : null;
  if (a.score != null) {
    const cal = CALIBRATIONS[a.calibrationVersion] || CALIBRATION;
    out.excludingDismissed = scoreExcludingDismissed(a.findings, company.type, cal);
    out.effects = individualEffects(a.findings, company.type, cal).map((e) => ({ findingId: e.finding.id, score: e.score, effect: e.effect, directive: e.directive, movesUpBand: e.movesUpBand }));
    out.trace = Object.fromEntries(Object.entries(traceByCategory(a.findings, cal)).map(([k, v]) => [k, v.map((f) => f.id)]));
    out.severityWeights = cal.severityWeights;
    out.categoryWeights = cal.categoryWeights[company.type];
    out.bands = cal.bands;
  }
  out.previouslyDismissed = previouslyDismissed(a.findings, earlier);
  return out;
}

/** Free audit result: top three findings in full, the rest locked with counts by severity. */
const SEV_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
export function lockFindings(findings) {
  const sorted = findings.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const locked = sorted.slice(3);
  return { top: sorted.slice(0, 3), locked: { total: locked.length, HIGH: 0, MEDIUM: 0, LOW: 0, ...Object.fromEntries(['HIGH', 'MEDIUM', 'LOW'].map((s) => [s, locked.filter((f) => f.severity === s).length])) } };
}
