// Prints engine results for every mock audit plus synthetic edge cases, as
// JSON on stdout. tests_py/test_engine_parity.py compares the Python engine
// against this output, so the two engines cannot drift apart.

import { readFileSync } from 'node:fs';
import { CALIBRATIONS } from '../src/engine/config.js';
import { scoreAudit, scoreExcludingDismissed, individualEffects } from '../src/engine/score.js';
import { evaluateAlerts } from '../src/engine/alerts.js';
import { outcomeStatus, checkpoints } from '../src/engine/outcomes.js';

const audits = JSON.parse(readFileSync(new URL('../src/data/mock/audits.json', import.meta.url)));
const companies = JSON.parse(readFileSync(new URL('../src/data/mock/companies.json', import.meta.url)));
const typeOf = (id) => companies.find((c) => c.id === id).type;

const f = (id, category, severity, extra = {}) => ({ id, agent: 1, category, severity, status: 'open', ...extra });
const synthetic = [
  { name: 'cap', type: 'startup', status: 'complete', findings: [f('a', 'Regulatory', 'HIGH'), f('b', 'Regulatory', 'HIGH'), f('c', 'Regulatory', 'HIGH'), f('d', 'Regulatory', 'HIGH'), f('e', 'Market', 'LOW')] },
  { name: 'override-valid-partial', type: 'startup', status: 'partial', override: { to: 'HOLD', findingIds: ['x'] }, findings: [f('x', 'Market', 'LOW')] },
  { name: 'override-two-bands', type: 'startup', status: 'complete', override: { to: 'PIVOT', findingIds: ['x'] }, findings: [f('x', 'Market', 'LOW')] },
  { name: 'override-up', type: 'startup', status: 'complete', override: { to: 'PROCEED', findingIds: ['x'] }, findings: [f('x', 'Financial', 'HIGH'), f('y', 'Financial', 'HIGH'), f('z', 'Competition', 'HIGH'), f('w', 'Competition', 'HIGH'), f('v', 'Market', 'HIGH')] },
  { name: 'campaign-weights', type: 'campaign', status: 'complete', findings: [f('p', 'Customer psychology', 'HIGH'), f('q', 'Customer psychology', 'MEDIUM'), f('r', 'Geographic', 'LOW')] },
  { name: 'half-rounding', type: 'startup', status: 'complete', findings: [f('h', 'Geographic', 'LOW')] },
  { name: 'failed', type: 'startup', status: 'failed', findings: [f('k', 'Market', 'LOW')] },
];

const repeats = [
  // The same risk written up three times, and a pile of MEDIUMs: the decay method must not let volume dominate.
  { name: 'repeat-topic', type: 'startup', status: 'complete', findings: [f('r1', 'Financial', 'HIGH', { matchKey: '1:Financial:runway' }), f('r2', 'Financial', 'MEDIUM', { matchKey: '4:Financial:runway' }), f('r3', 'Financial', 'HIGH', { matchKey: '5:Financial:runway' })] },
  { name: 'many-medium', type: 'startup', status: 'complete', findings: Array.from({ length: 9 }, (_, i) => f(`m${i}`, 'Regulatory', 'MEDIUM', { matchKey: `5:Regulatory:t${i}` })) },
  { name: 'three-high-cap', type: 'startup', status: 'complete', findings: [0, 1, 2].map((i) => f(`h${i}`, 'Competition', 'HIGH', { matchKey: `2:Competition:h${i}` })) },
];
const scoreCases = [
  ...audits.map((a) => ({ name: a.id, type: typeOf(a.companyId), status: a.status, override: a.override, calibration: a.calibrationVersion, findings: a.findings })),
  ...synthetic.map((s) => ({ calibration: 'cal-2026.2', ...s })),
  // Every case again under the proposed decay calibration.
  ...audits.map((a) => ({ name: `${a.id}@decay`, type: typeOf(a.companyId), status: a.status, override: a.override, calibration: 'cal-2026.3', findings: a.findings })),
  ...[...synthetic, ...repeats].map((s) => ({ ...s, name: `${s.name}@decay`, calibration: 'cal-2026.3' })),
].map((c) => {
  const cal = CALIBRATIONS[c.calibration];
  return {
    ...c,
    expect: {
      score: scoreAudit({ findings: c.findings, type: c.type, status: c.status, override: c.override || null }, cal),
      excluding: c.status === 'failed' ? null : scoreExcludingDismissed(c.findings, c.type, cal),
      effects: c.status === 'failed' ? null : individualEffects(c.findings, c.type, cal).map((e) => ({ findingId: e.finding.id, score: e.score, effect: e.effect, directive: e.directive, movesUpBand: e.movesUpBand })),
    },
  };
});

const byCompany = {};
audits.filter((a) => a.status !== 'failed').forEach((a) => { (byCompany[a.companyId] ||= []).push(a); });
const alertCases = [];
Object.values(byCompany).forEach((list) => {
  list.sort((x, y) => x.date.localeCompare(y.date));
  for (let i = 1; i < list.length; i += 1) {
    for (const hold of [false, true]) {
      alertCases.push({ prev: list[i - 1].id, next: list[i].id, hold, expect: evaluateAlerts(list[i - 1], list[i], { holdMode: hold }) });
    }
  }
});

const outcomeCases = [];
for (const d of ['2024-02-29', '2026-01-31', '2026-10-14']) outcomeCases.push({ kind: 'checkpoints', date: d, expect: checkpoints(d) });
const a = { finalDirective: 'KILL', firstCheckpoint: '2026-01-01', finalCheckpoint: '2027-01-01' };
for (const [o, today] of [[null, '2025-06-01'], [null, '2026-06-01'], [{ result: 'flat' }, '2026-06-01'], [{ result: 'flat' }, '2027-02-01'], [{ result: 'shutDown' }, '2025-06-01'], [{ result: 'exited' }, '2025-06-01']]) {
  outcomeCases.push({ kind: 'status', audit: a, outcome: o, today, expect: outcomeStatus(a, o, today) });
}

process.stdout.write(JSON.stringify({ scoreCases, alertCases, outcomeCases }));
