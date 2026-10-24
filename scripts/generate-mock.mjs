// Generates the prototype's mock data into src/data/mock/*.json.
// Run with `npm run mock`. Deterministic: the same input always gives the
// same output. Every audit is scored by the real engine, so stored scores can
// never disagree with the code.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALIBRATIONS, CALIBRATION, CATEGORIES, SECTIONS, AGENTS } from '../src/engine/config.js';
import { scoreAudit, categoryExposure, resilienceScore } from '../src/engine/score.js';
import { evaluateAlerts } from '../src/engine/alerts.js';
import { checkpoints } from '../src/engine/outcomes.js';
import * as northline from './mock/northline.mjs';
import { BANK, CATEGORY_HOME, SOURCE_TEMPLATES, CITE_BY_CATEGORY } from '../src/data/bank.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'mock');
const MODEL_VERSION = '[PINNED MODEL VERSION]';
const PROMPT_VERSION = 'prompts-2026.09';
const TODAY = '2026-10-22';

const hash = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const SEVS = ['HIGH', 'MEDIUM', 'LOW'];

// ---------------------------------------------------------------------------
// Companies other than Northline. `base` is a target exposure per category
// (Market, Financial, Operational, Competition, Customer psychology,
// Geographic, Regulatory); audits are tuned to hit `score` exactly.
const OTHERS = [
  {
    id: 'halden', title: 'Halden Biosystems', industry: 'Healthcare', city: 'Cambridge', type: 'startup', stage: 'Series A', dealLead: 'Priya Nair',
    description: 'Point-of-care diagnostic tests for respiratory infections, sold to GP practices and urgent care centres.',
    model: 'Device sale plus per-test cartridges', target: 'GP practices and urgent care centres',
    audits: [
      { date: '2025-03-03', score: 65, base: [40, 38, 40, 46, 34, 36, 62], trigger: 'manual', calibration: 'cal-2026.1' },
      { date: '2026-10-02', score: 68, base: [40, 35, 38, 45, 32, 36, 55], trigger: 'evidence' },
    ],
    coverage: [90, 70, 60, 40, 30],
  },
  {
    id: 'quillpay', title: 'Quillpay', industry: 'Finance / Fintech', city: 'London', type: 'startup', stage: 'Seed', dealLead: 'Alex Morgan',
    description: 'Invoice financing for freelancers, paid out within a day of an approved invoice.',
    model: 'Fee per financed invoice', target: 'UK freelancers and sole traders',
    audits: [
      { date: '2025-02-20', score: 51, base: [50, 54, 44, 55, 41, 40, 60], trigger: 'manual', calibration: 'cal-2026.1' },
      { date: '2026-09-29', score: 52, base: [50, 52, 44, 55, 41, 40, 58], trigger: 'scheduled' },
    ],
    coverage: [85, 60, 70, 55, 40],
  },
  {
    id: 'marrow', title: 'Marrow and Co', industry: 'Food and Beverage', city: 'Bristol', type: 'startup', stage: 'Seed', dealLead: 'Priya Nair',
    description: 'Premium frozen ready meals sold direct to consumers and through independent delis.',
    model: 'Direct-to-consumer subscription and wholesale', target: 'Urban households and independent delis',
    audits: [
      { date: '2026-02-12', score: 42, base: [60, 66, 62, 64, 52, 44, 40], trigger: 'manual' },
      { date: '2026-09-21', score: 33, base: [66, 78, 70, 72, 60, 48, 42], trigger: 'scheduled' },
    ],
    coverage: [80, 75, 50, 20, 10],
  },
  {
    id: 'tessel', title: 'Tessel Learning', industry: 'Education', city: 'Manchester', type: 'startup', stage: 'Pre-seed', dealLead: 'Daniel Okoye',
    description: 'Adaptive maths practice for secondary schools, licensed per pupil.',
    model: 'Annual school licence per pupil', target: 'Secondary schools and multi-academy trusts',
    audits: [
      { date: '2026-09-14', score: 57, base: [45, 50, 42, 48, 40, 38, 35], trigger: 'manual', failed: true },
      { date: '2026-09-15', score: 57, base: [45, 50, 42, 48, 40, 38, 35], trigger: 'manual' },
    ],
    coverage: [60, 50, 40, 30, 0],
  },
  {
    id: 'brightwell', title: 'Brightwell Homes', industry: 'Real Estate', city: 'Birmingham', type: 'startup', stage: 'Series A', dealLead: 'Alex Morgan',
    description: 'Modular retrofit packages that bring older rental homes up to current energy standards.',
    model: 'Fixed-price retrofit packages', target: 'Private landlords with five or more properties',
    audits: [
      { date: '2024-09-09', score: 41, base: [55, 64, 56, 60, 48, 52, 46], trigger: 'manual', calibration: 'cal-2026.1' },
      { date: '2026-09-09', score: 46, base: [55, 60, 52, 58, 46, 50, 44], trigger: 'scheduled', override: { to: 'PIVOT', reason: 'Two HIGH findings on financing and a funded competitor make the HOLD reading optimistic. Treat as PIVOT until landlord financing is secured.' } },
    ],
    coverage: [75, 65, 55, 45, 30],
  },
  {
    id: 'ostra', title: 'Ostra Media', industry: 'Media / Entertainment', city: 'Glasgow', type: 'startup', stage: 'Seed', dealLead: 'Daniel Okoye',
    description: 'Short-form documentary studio producing branded series for streaming platforms.',
    model: 'Commissioned series and licensing', target: 'Streaming platforms and consumer brands',
    audits: [
      { date: '2025-01-17', score: 68, base: [42, 40, 40, 44, 36, 34, 38], trigger: 'manual', calibration: 'cal-2026.1' },
      { date: '2026-09-02', score: 66, base: [42, 44, 40, 46, 38, 36, 40], trigger: 'scheduled', partialAgent: 3 },
    ],
    coverage: [70, 60, 65, 40, 35],
  },
  {
    id: 'kelvin', title: 'Kelvin Freight', industry: 'Logistics / Supply Chain', city: 'Felixstowe', type: 'startup', stage: 'Series A', dealLead: 'Priya Nair',
    description: 'Digital freight brokerage for container haulage from east coast ports.',
    model: 'Commission on each booked load', target: 'Importers and freight forwarders',
    audits: [
      { date: '2024-08-28', score: 42, base: [58, 62, 60, 66, 48, 52, 40], trigger: 'manual', calibration: 'cal-2026.1' },
      { date: '2026-08-28', score: 38, base: [60, 66, 62, 70, 50, 54, 40], trigger: 'scheduled' },
    ],
    coverage: [80, 70, 60, 50, 20],
    cadence: { mode: 'monthly', paused: true, resumeOn: '2026-12-01' },
  },
  {
    id: 'atlas', title: 'Atlas Home Retail: own-label expansion', industry: 'E-Commerce / Retail', city: 'Nottingham', type: 'strategy', stage: 'Corporate', dealLead: 'Alex Morgan',
    description: 'Strategy to launch an own-label homeware range across 40 stores and online.',
    model: 'Higher-margin own-label lines replacing branded stock', target: 'Existing store and online customers',
    audits: [{ date: '2026-10-06', score: 55, base: [46, 48, 50, 46, 40, 30, 32], trigger: 'manual' }],
    coverage: [70, 60, 50, 30, 20],
  },
  {
    id: 'verde', title: 'Verde Energy switching campaign', industry: 'Other', city: 'Cardiff', type: 'campaign', stage: 'Corporate', dealLead: 'Priya Nair',
    description: 'Winter campaign to move customers onto a fixed green tariff through price-comparison partners.',
    model: 'Customer acquisition through partner channels', target: 'Households coming off fixed tariffs',
    audits: [{ date: '2026-09-18', score: 48, base: [50, 40, 38, 56, 58, 30, 44], trigger: 'manual' }],
    coverage: [50, 40, 30, 20, 10],
  },
];

const COVERAGE_TOPICS = ['Financials', 'Operations', 'Market and competitors', 'Legal and IP', 'Team'];

// ---------------------------------------------------------------------------
// Profile tuning: counts of HIGH, MEDIUM, LOW per category.

function nearestCounts(target, w) {
  let best = null;
  for (let h = 0; h <= 4; h += 1) for (let m = 0; m <= 5; m += 1) for (let l = 0; l <= 6; l += 1) {
    const n = h + m + l;
    if (n < 2 || n > 6) continue;
    const e = Math.min(100, h * w.HIGH + m * w.MEDIUM + l * w.LOW);
    const d = Math.abs(e - target) + n * 0.01;
    if (!best || d < best.d) best = { d, counts: [h, m, l] };
  }
  return best.counts;
}

function profileFindings(profile, prefix) {
  const out = [];
  CATEGORIES.forEach((cat, ci) => {
    const [h, m, l] = profile[ci];
    const sevs = [...Array(h).fill('HIGH'), ...Array(m).fill('MEDIUM'), ...Array(l).fill('LOW')];
    sevs.forEach((sev, i) => out.push({ cat, sev, idx: i, ci, prefix }));
  });
  return out;
}

function exposureOf(profile, w) {
  return Object.fromEntries(CATEGORIES.map((c, i) => {
    const [h, m, l] = profile[i];
    return [c, Math.min(100, h * w.HIGH + m * w.MEDIUM + l * w.LOW)];
  }));
}

function tune(base, target, type, cal, frozen = []) {
  const w = cal.severityWeights;
  let profile = base.map((t, i) => (frozen.includes(i) ? [0, 0, 0] : nearestCounts(t, w)));
  const scoreOf = (p) => resilienceScore(exposureOf(p, w), type, cal).score;
  for (let step = 0; step < 80; step += 1) {
    const s = scoreOf(profile);
    if (s === target) break;
    let best = null;
    profile.forEach((cnt, i) => {
      if (frozen.includes(i)) return;
      const moves = [[0, 0, 1], [0, 0, -1], [0, 1, -1], [0, -1, 1], [1, -1, 0], [-1, 1, 0], [0, 1, 0], [0, -1, 0]];
      for (const mv of moves) {
        const next = cnt.map((v, k) => v + mv[k]);
        const n = next[0] + next[1] + next[2];
        if (next.some((v) => v < 0) || n < 2 || n > 6) continue;
        const p = profile.map((c, k) => (k === i ? next : c));
        const ns = scoreOf(p);
        const drift = Math.abs(exposureOf(p, w)[CATEGORIES[i]] - base[i]);
        const cost = Math.abs(ns - target) * 100 + drift;
        if (!best || cost < best.cost) best = { cost, p };
      }
    });
    if (!best) break;
    profile = best.p;
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Builders

const sources = [];
const audits = [];
const companies = [];

function sectionTitle(id) {
  return SECTIONS.find((s) => s.id === id).title;
}

function agentRuns({ partialAgent = null, failedOrchestrator = false, skipped = [], findings }) {
  const durations = [48, 51, 39, 44, 33, 37];
  return AGENTS.map((a) => {
    const count = findings.filter((f) => f.agent === a.n).length;
    if (a.n === partialAgent) {
      return { agent: a.n, status: 'failed', duration: 90, retries: 1, error: 'Timed out after 90 s on both attempts. No report returned.', schema: 'n/a' };
    }
    if (a.n === 6 && failedOrchestrator) {
      return { agent: a.n, status: 'failed', duration: 0, retries: 1, error: 'Returned malformed output on both attempts.', schema: 'malformed' };
    }
    const sk = skipped.filter((s) => SECTIONS.find((x) => x.id === s.section).agent === a.n);
    return { agent: a.n, status: 'complete', duration: durations[a.n - 1], retries: 0, findings: count, skipped: sk.length, schema: 'valid' };
  });
}

function finalise(audit, company, { override = null, status = 'complete' } = {}) {
  const cal = CALIBRATIONS[audit.calibrationVersion];
  const result = scoreAudit({ findings: audit.findings, type: company.type, status, override }, cal);
  const cited = new Set(audit.findings.flatMap((f) => f.sources));
  const skippedSections = audit.skippedSections || [];
  const notRun = audit.agentRuns.filter((r) => r.status === 'failed' && r.agent !== 6)
    .flatMap((r) => SECTIONS.filter((s) => s.agent === r.agent).map((s) => s.id));
  Object.assign(audit, {
    status,
    exposure: result.exposure,
    raw: result.raw ?? null,
    cap: result.cap ?? null,
    score: result.score,
    baseDirective: result.baseDirective,
    finalDirective: result.finalDirective,
    overridden: result.overridden || false,
    override: override && result.overridden ? { ...override, findingIds: result.overrideCited } : null,
    overrideCited: result.overrideCited || [],
    overrideRejected: result.overrideRejected || null,
    coverage: {
      agentsRun: audit.agentRuns.filter((r) => r.status === 'complete').length,
      agentsTotal: 6,
      sectionsSkipped: skippedSections.length,
      sectionsNotRun: notRun,
      sourcesCited: cited.size,
    },
    countedAgainstUsage: status !== 'failed',
    snapshotHash: hash(JSON.stringify([company.title, company.description, company.industry, company.country, company.type, [...(audit.sourceIds || [])].sort()])),
    modelVersion: MODEL_VERSION,
    promptVersion: PROMPT_VERSION,
    underReview: false,
    driftFlag: false,
    ...checkpoints(audit.date),
  });
  return audit;
}

// ---- Northline -------------------------------------------------------------

{
  const c = { ...northline.company, country: 'United Kingdom' };
  companies.push(c);
  northline.sources.forEach((s) => sources.push({ ...s, companyId: c.id, addedBy: s.type === 'uploaded' ? 'Priya Nair' : 'Found by AVA' }));

  const mk = (auditId, rows) => rows.map(([agent, section, category, severity, topic, title, text, src], i) => ({
    id: `${auditId}-f${i + 1}`, auditId, agent, section, category, severity, topic,
    matchKey: `${agent}:${category}:${topic}`, title, text, sources: src, status: 'open', owner: null,
    dismissReason: null, comments: [], history: [],
  }));

  const skippedIp = [{ section: 'ip', reason: 'No proprietary technology or brand claims are made in the submitted material.' }];

  for (const h of northline.history) {
    const rows = northline.latestFindings
      .filter(([, , , , topic]) => h.change[topic] !== null)
      .map((r) => (h.change[r[4]] ? [r[0], r[1], r[2], h.change[r[4]], ...r.slice(4)] : r))
      .concat(h.extra);
    const findings = mk(h.id, rows);
    const a = {
      id: h.id, companyId: c.id, date: h.date, trigger: h.trigger, calibrationVersion: h.calibration,
      findings, skippedSections: skippedIp, sourceIds: h.sources,
      agentRuns: agentRuns({ findings, skipped: skippedIp }),
      orchestrator: { rationale: h.rationale, investor: null, roadmap: null, topRisks: findings.filter((f) => f.severity === 'HIGH').slice(0, 3).map((f) => f.id) },
      runSeconds: 240,
    };
    audits.push(finalise(a, c));
  }

  const id = 'northline-4';
  const findings = mk(id, northline.latestFindings);
  // Sample workflow state on the latest audit.
  const byTopic = (t) => findings.find((f) => f.topic === t);
  Object.assign(byTopic('drop-economics'), { status: 'accepted', owner: 'Priya Nair', history: [{ at: '2026-10-15T09:12:00Z', by: 'Priya Nair', action: 'Accepted' }], comments: [{ at: '2026-10-15T09:14:00Z', by: 'Priya Nair', text: 'Agreed. Asked the founder for route-level P&L before the IC.' }] });
  Object.assign(byTopic('congestion'), { status: 'dismissed', owner: 'Alex Morgan', dismissReason: 'Deliveries run before 7am, outside the restricted windows.', history: [{ at: '2026-10-16T11:02:00Z', by: 'Alex Morgan', action: 'Dismissed', detail: 'Deliveries run before 7am, outside the restricted windows.' }] });
  Object.assign(byTopic('licensing'), { status: 'resolved', owner: 'Alex Morgan', history: [{ at: '2026-10-16T11:05:00Z', by: 'Alex Morgan', action: 'Resolved' }] });
  const a = {
    id, companyId: c.id, date: '2026-10-14', trigger: 'scheduled', calibrationVersion: CALIBRATION.version,
    findings, skippedSections: skippedIp, sourceIds: ['nl-s1', 'nl-s2', 'nl-s3', 'nl-s4', 'nl-s5', 'nl-s6', 'nl-s7', 'nl-s8'],
    agentRuns: agentRuns({ findings, skipped: skippedIp }),
    orchestrator: {
      rationale: northline.latestOrchestrator.rationale,
      investor: northline.latestOrchestrator.investor,
      roadmap: northline.latestOrchestrator.roadmap,
      topRisks: northline.latestOrchestrator.topRiskTopics.map((t) => byTopic(t).id),
    },
    runSeconds: 252,
  };
  audits.push(finalise(a, c));
}

// ---- Generated companies --------------------------------------------------

for (const spec of OTHERS) {
  const c = {
    id: spec.id, title: spec.title, description: spec.description, industry: spec.industry, country: 'United Kingdom', city: spec.city,
    model: spec.model, target: spec.target, type: spec.type, dealLead: spec.dealLead, stage: spec.stage, fund: spec.type === 'startup' ? 'Fund II' : 'Corporate programme',
    cadence: spec.cadence || { mode: 'inherit', paused: false, resumeOn: null },
    coverage: spec.coverage,
  };
  companies.push(c);
  const srcIds = {};
  SOURCE_TEMPLATES.forEach((t, i) => {
    const sid = `${c.id}-s${i + 1}`;
    srcIds[t.key] = sid;
    sources.push({ id: sid, companyId: c.id, type: t.type, title: t.type === 'uploaded' ? `${c.title} ${t.title.toLowerCase()}` : t.title, kind: t.kind, date: spec.audits[spec.audits.length - 1].date, reliability: t.reliability, url: t.url, note: t.note, addedBy: t.type === 'uploaded' ? spec.dealLead : 'Found by AVA' });
  });

  spec.audits.forEach((as, n) => {
    const id = `${c.id}-${n + 1}`;
    const cal = CALIBRATIONS[as.calibration || CALIBRATION.version];
    const frozen = as.partialAgent === 3 ? [0] : [];
    const profile = tune(as.base, as.score, c.type, cal, frozen);
    const findings = profileFindings(profile).map((p, i) => {
      const [topic, title, text] = BANK[p.cat][p.idx];
      const [agent, section] = CATEGORY_HOME[p.cat];
      const citeKey = CITE_BY_CATEGORY[p.cat][p.idx % 2];
      return {
        id: `${id}-f${i + 1}`, auditId: id, agent, section, category: p.cat, severity: p.sev, topic,
        matchKey: `${agent}:${p.cat}:${topic}`, title, text: text.replaceAll('{city}', c.city),
        sources: citeKey ? [srcIds[citeKey]] : [], status: 'open', owner: null, dismissReason: null, comments: [], history: [],
      };
    });
    const skipped = c.type !== 'startup' ? [{ section: 'ip', reason: 'Not applicable to an internal ' + c.type + '.' }] : [];
    const runs = agentRuns({ findings, skipped, partialAgent: as.partialAgent || null, failedOrchestrator: !!as.failed });
    const high = findings.filter((f) => f.severity === 'HIGH');
    const audit = {
      id, companyId: c.id, date: as.date, trigger: as.trigger, calibrationVersion: cal.version,
      findings, skippedSections: skipped, sourceIds: Object.values(srcIds),
      agentRuns: runs,
      orchestrator: as.failed ? null : {
        rationale: `${c.title}: ${high.length ? high[0].title.toLowerCase() : 'no single dominant risk'}${high[1] ? ', and ' + high[1].title.toLowerCase() : ''}.`,
        investor: null, roadmap: null, topRisks: high.slice(0, 3).map((f) => f.id),
      },
      runSeconds: 230 + n * 7,
    };
    let override = null;
    if (as.override) {
      override = { ...as.override, findingIds: high.filter((f) => ['Financial', 'Competition'].includes(f.category)).slice(0, 2).map((f) => f.id) };
    }
    const status = as.failed ? 'failed' : as.partialAgent ? 'partial' : 'complete';
    audits.push(finalise(audit, c, { override, status }));
  });
}

// ---- Company roll-ups ------------------------------------------------------

function nextRun(lastDate, mode) {
  const months = mode === 'monthly' ? 1 : 3;
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, 1);
  while (d.toISOString().slice(0, 10) <= TODAY) d.setUTCMonth(d.getUTCMonth() + months, 1);
  return d.toISOString().slice(0, 10);
}

for (const c of companies) {
  const list = audits.filter((a) => a.companyId === c.id && a.status !== 'failed').sort((a, b) => a.date.localeCompare(b.date));
  const mode = c.cadence.mode === 'inherit' ? 'quarterly' : c.cadence.mode;
  c.cadence.nextRun = mode === 'off' || c.cadence.paused ? null : nextRun(list[list.length - 1].date, mode);
  if (!c.coverage) c.coverage = [90, 80, 55, 20, 0];
  c.coverage = COVERAGE_TOPICS.map((topic, i) => ({ topic, pct: c.coverage[i] }));
  c.openItems = c.id === 'northline' ? [
    { id: 'a', head: 'Upload the operator licence', why: 'The Sentinel skipped legal and IP exposure for lack of it.' },
    { id: 'b', head: 'Confirm the Leeds route density', why: 'The 11-stop figure comes from one cost model.' },
    { id: 'c', head: 'Log what happened after the April PIVOT', why: 'Builds your outcome record.' },
  ] : [];
}

// ---- Alerts ----------------------------------------------------------------

const alerts = [];
for (const c of companies) {
  const list = audits.filter((a) => a.companyId === c.id && a.status !== 'failed').sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < list.length; i += 1) {
    for (const al of evaluateAlerts(list[i - 1], list[i])) {
      alerts.push({ id: `al-${alerts.length + 1}`, ...al, date: list[i].date, read: list[i].date < '2026-09-25', snoozedUntil: null, emailedAt: al.trigger === 'directive' || al.trigger === 'high' ? `${list[i].date}T15:00:00Z` : null });
    }
  }
}
alerts.sort((a, b) => b.date.localeCompare(a.date));

// ---- Outcomes ---------------------------------------------------------------

const firstAudit = (cid) => audits.filter((a) => a.companyId === cid && a.status !== 'failed').sort((a, b) => a.date.localeCompare(b.date))[0];
const outcomes = [
  { auditId: firstAudit('halden').id, result: 'grew', checkpoint: 'first', date: '2026-03-20', evidence: { kind: 'note', value: 'Revenue up 64% year on year per the FY25 accounts.' }, loggedBy: 'Priya Nair', loggedAt: '2026-03-24T10:00:00Z' },
  { auditId: firstAudit('quillpay').id, result: 'flat', checkpoint: 'first', date: '2026-02-28', evidence: { kind: 'link', value: 'https://example.com/quillpay-q4-update' }, loggedBy: 'Alex Morgan', loggedAt: '2026-03-02T10:00:00Z' },
  { auditId: firstAudit('ostra').id, result: 'flat', checkpoint: 'first', date: '2026-01-30', evidence: { kind: 'note', value: 'Commissions steady; no new platform deals.' }, loggedBy: 'Daniel Okoye', loggedAt: '2026-02-03T10:00:00Z' },
  { auditId: firstAudit('kelvin').id, result: 'changed', checkpoint: 'final', date: '2026-09-01', evidence: { kind: 'note', value: 'Moved from spot brokerage to contracted lanes with three importers.' }, loggedBy: 'Priya Nair', loggedAt: '2026-09-04T10:00:00Z' },
  { auditId: firstAudit('brightwell').id, result: 'grew', checkpoint: 'final', date: '2026-09-15', evidence: { kind: 'note', value: 'Retrofit volume doubled after a landlord financing partnership.' }, loggedBy: 'Alex Morgan', loggedAt: '2026-09-18T10:00:00Z' },
];

// ---- Organisation, people, log ---------------------------------------------

const org = {
  name: 'AVA Demo Fund', kind: 'VC fund', plan: 'Pro Max', renewal: null, limit: null, seats: null,
  cadence: { mode: 'quarterly', day: 1 }, alertThreshold: 5, currency: 'GBP', retention: 'Deleted within 90 days of the account closing', region: 'United Kingdom',
  branding: { coverName: 'AVA Demo Fund', footer: 'Confidential. Prepared for the investment committee.', attribution: true },
  alertRules: { directive: true, score: true, high: true, evidence: false },
  delivery: { inApp: true, email: 'weekly', immediate: true },
  ownerId: 'u1', holdMode: false,
};

const users = [
  { id: 'u1', name: 'Alex Morgan', initials: 'AM', email: 'alex@yourfund.example', role: 'Owner', title: 'Investment associate', status: 'active', lastActive: '2026-10-22' },
  { id: 'u2', name: 'Jordan Lee', initials: 'JL', email: 'jordan@yourfund.example', role: 'Admin', title: 'Operating partner', status: 'active', lastActive: '2026-10-20' },
  { id: 'u3', name: 'Priya Nair', initials: 'PN', email: 'priya@yourfund.example', role: 'Analyst', title: 'Analyst', status: 'active', lastActive: '2026-10-21' },
  { id: 'u4', name: 'Daniel Okoye', initials: 'DO', email: 'daniel@yourfund.example', role: 'Viewer', title: 'Partner', status: 'active', lastActive: '2026-10-18' },
  { id: 'u5', name: 'Sam Brooks', initials: 'SB', email: 'sam@yourfund.example', role: 'Analyst', title: 'Analyst', status: 'invited', lastActive: null },
];

const auditLog = [
  { at: '2026-10-16T11:05:00Z', who: 'Alex Morgan', action: 'finding.status', object: 'Finding', objectId: audits.find((a) => a.id === 'northline-4').findings.find((f) => f.topic === 'licensing').id, detail: 'Marked "Licensing path is clear" as Resolved' },
  { at: '2026-10-16T11:02:00Z', who: 'Alex Morgan', action: 'finding.dismiss', object: 'Finding', objectId: audits.find((a) => a.id === 'northline-4').findings.find((f) => f.topic === 'congestion').id, detail: 'Dismissed "City-centre congestion windows": Deliveries run before 7am, outside the restricted windows.' },
  { at: '2026-10-15T09:12:00Z', who: 'Priya Nair', action: 'finding.status', object: 'Finding', objectId: 'northline-4-f5', detail: 'Accepted "Every drop below 14 stops loses money" and took ownership' },
  { at: '2026-10-14T14:06:00Z', who: 'AVA', action: 'audit.complete', object: 'Audit', objectId: 'northline-4', detail: 'Completed audit 4 of 4 for Northline Cold Chain. Directive PIVOT.' },
  { at: '2026-10-14T14:02:00Z', who: 'AVA', action: 'audit.start', object: 'Audit', objectId: 'northline-4', detail: 'Started scheduled audit of Northline Cold Chain' },
  { at: '2026-10-12T09:41:00Z', who: 'Alex Morgan', action: 'member.invite', object: 'User', objectId: 'u5', detail: 'Invited Sam Brooks as Analyst' },
  { at: '2026-10-02T16:20:00Z', who: 'Priya Nair', action: 'file.upload', object: 'File', objectId: 'nl-s1', detail: 'Uploaded Deck v3 and Unit economics model to Northline Cold Chain' },
  { at: '2026-10-01T11:05:00Z', who: 'Alex Morgan', action: 'org.update', object: 'Organisation', objectId: 'org', detail: 'Changed alert threshold from 8 to 5 points' },
  { at: '2026-09-28T15:12:00Z', who: 'Priya Nair', action: 'export.pdf', object: 'Audit', objectId: 'marrow-2', detail: 'Exported PDF for Marrow and Co' },
];

// ---- Write -----------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const write = (name, data) => writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(data, null, name === 'audits' ? 0 : 1)}\n`);
write('companies', companies);
write('audits', audits);
write('sources', sources);
write('alerts', alerts);
write('outcomes', outcomes);
write('org', org);
write('users', users);
write('audit-log', auditLog);

// Summary for the console.
for (const c of companies) {
  const list = audits.filter((a) => a.companyId === c.id);
  console.log(c.title.padEnd(42), list.map((a) => `${a.date} ${a.status.padEnd(8)} ${String(a.score).padStart(4)} ${a.baseDirective || '-'}→${a.finalDirective || '-'} [${a.findings.length}]`).join(' | '));
}
console.log(`alerts ${alerts.length}, sources ${sources.length}`);
