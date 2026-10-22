import { describe, it, expect } from 'vitest';
import { CALIBRATION, PREVIOUS_CALIBRATION, CATEGORIES } from '../src/engine/config.js';
import {
  categoryExposure, resilienceScore, directiveForScore, validateOverride,
  applyPartialCap, scoreAudit, scoreExcludingDismissed, individualEffects,
} from '../src/engine/score.js';
import { matchFindings, previouslyDismissed } from '../src/engine/compare.js';
import { evaluateAlerts, crossesBandEdge } from '../src/engine/alerts.js';
import { checkpoints, outcomeStatus, agreementRate, addMonths } from '../src/engine/outcomes.js';

let seq = 0;
const f = (category, severity, extra = {}) => ({ id: `f${++seq}`, agent: 1, category, severity, status: 'open', ...extra });
const flatExposure = (v) => Object.fromEntries(CATEGORIES.map((c) => [c, v]));

describe('category exposure', () => {
  it('sums severity weights per category and caps at 100', () => {
    const w = CALIBRATION.severityWeights;
    const exp = categoryExposure([f('Market', 'HIGH'), f('Market', 'LOW'), f('Financial', 'MEDIUM')]);
    expect(exp.Market).toBe(w.HIGH + w.LOW);
    expect(exp.Financial).toBe(w.MEDIUM);
    expect(exp.Regulatory).toBe(0);
    const many = Array.from({ length: 10 }, () => f('Competition', 'HIGH'));
    expect(categoryExposure(many).Competition).toBe(100);
  });
});

describe('resilience score', () => {
  it('is 100 minus the weighted average exposure', () => {
    expect(resilienceScore(flatExposure(0)).score).toBe(100);
    expect(resilienceScore(flatExposure(40)).score).toBe(60);
  });

  it('uses weights per venture type', () => {
    const exp = { ...flatExposure(20), 'Customer psychology': 80 };
    const startup = resilienceScore(exp, 'startup').score;
    const campaign = resilienceScore(exp, 'campaign').score;
    expect(campaign).toBeLessThan(startup);
  });

  it('rounds a .5 tie up regardless of float noise', () => {
    // Weighted exposure 54.5 sums to 54.500000000000001 in floats; the score must still be 46.
    const exp = { Market: 60, Financial: 66, Operational: 49, Competition: 64, 'Customer psychology': 51, Geographic: 44, Regulatory: 39 };
    expect(resilienceScore(exp).score).toBe(46);
  });

  it('applies the category cap when one category is catastrophic', () => {
    const exp = { ...flatExposure(5), Regulatory: CALIBRATION.cap.threshold + 5 };
    const r = resilienceScore(exp);
    expect(r.raw).toBeGreaterThan(CALIBRATION.cap.maxScore);
    expect(r.score).toBe(CALIBRATION.cap.maxScore);
    expect(r.cap.category).toBe('Regulatory');
  });

  it('does not apply the cap when the score is already below the limit', () => {
    const r = resilienceScore({ ...flatExposure(80), Regulatory: 95 });
    expect(r.cap).toBeNull();
  });
});

describe('directive bands (spec starting values)', () => {
  it.each([
    [0, 'KILL'], [34, 'KILL'], [35, 'PIVOT'], [44, 'PIVOT'],
    [45, 'HOLD'], [64, 'HOLD'], [65, 'PROCEED'], [100, 'PROCEED'],
  ])('%i maps to %s', (score, d) => expect(directiveForScore(score)).toBe(d));
});

describe('orchestrator override', () => {
  const ids = ['a', 'b'];
  it('accepts one band down with cited findings', () => {
    expect(validateOverride('HOLD', { to: 'PIVOT', findingIds: ['a'] }, ids).valid).toBe(true);
  });
  it('rejects moving up', () => {
    expect(validateOverride('PIVOT', { to: 'HOLD', findingIds: ['a'] }, ids)).toMatchObject({ valid: false, reason: 'Override moves the directive up' });
  });
  it('rejects more than one band', () => {
    expect(validateOverride('PROCEED', { to: 'PIVOT', findingIds: ['a'] }, ids).reason).toBe('Override moves more than one band');
  });
  it('rejects an override with no valid finding ids', () => {
    expect(validateOverride('HOLD', { to: 'PIVOT', findingIds: [] }, ids).valid).toBe(false);
    expect(validateOverride('HOLD', { to: 'PIVOT', findingIds: ['zzz'] }, ids).valid).toBe(false);
  });
});

describe('partial cap', () => {
  it('caps PROCEED at HOLD and never raises a lower directive', () => {
    expect(applyPartialCap('PROCEED', true)).toBe('HOLD');
    expect(applyPartialCap('HOLD', true)).toBe('HOLD');
    expect(applyPartialCap('PIVOT', true)).toBe('PIVOT');
    expect(applyPartialCap('KILL', true)).toBe('KILL');
    expect(applyPartialCap('PROCEED', false)).toBe('PROCEED');
  });
});

describe('scoreAudit order of operations', () => {
  it('applies override then partial cap and stores base and final', () => {
    const findings = [f('Market', 'LOW')];
    const r = scoreAudit({ findings, status: 'partial', override: { to: 'HOLD', findingIds: [findings[0].id] } });
    expect(r.baseDirective).toBe('PROCEED');
    expect(r.overridden).toBe(true);
    expect(r.finalDirective).toBe('HOLD');
  });

  it('logs a rejected override and keeps the base directive', () => {
    const findings = [f('Market', 'LOW')];
    const r = scoreAudit({ findings, override: { to: 'KILL', findingIds: [findings[0].id] } });
    expect(r.overridden).toBe(false);
    expect(r.overrideRejected).toBe('Override moves more than one band');
    expect(r.finalDirective).toBe(r.baseDirective);
  });

  it('a failed audit has no score or directive', () => {
    const r = scoreAudit({ findings: [], status: 'failed' });
    expect(r.score).toBeNull();
    expect(r.finalDirective).toBeNull();
  });
});

describe('verdict transparency', () => {
  it('dismissing a finding changes only the excluding-dismissed score', () => {
    const findings = [f('Financial', 'HIGH'), f('Financial', 'HIGH', { status: 'dismissed' })];
    const official = scoreAudit({ findings }).score;
    const excl = scoreExcludingDismissed(findings, 'startup');
    expect(excl.score).toBeGreaterThan(official);
    expect(scoreAudit({ findings }).score).toBe(official);
  });

  it('individual effects are computed one finding at a time', () => {
    const findings = [f('Financial', 'HIGH'), f('Market', 'LOW'), f('Regulatory', 'MEDIUM', { status: 'resolved' })];
    const effects = individualEffects(findings, 'startup');
    expect(effects.map((e) => e.finding.id)).not.toContain(findings[2].id);
    expect(effects[0].finding.id).toBe(findings[0].id);
    expect(effects[0].effect).toBeGreaterThan(effects[1].effect);
  });
});

describe('compare', () => {
  it('groups findings New, Resolved and Unchanged by match key', () => {
    const a = [f('Market', 'LOW', { matchKey: 'k1' }), f('Market', 'MEDIUM', { matchKey: 'k2' })];
    const b = [f('Market', 'HIGH', { matchKey: 'k2' }), f('Financial', 'HIGH', { matchKey: 'k3' })];
    const m = matchFindings(a, b);
    expect(m.added.map((x) => x.matchKey)).toEqual(['k3']);
    expect(m.resolved.map((x) => x.matchKey)).toEqual(['k1']);
    expect(m.unchanged[0].severityMove).toBe('up');
  });

  it('flags findings dismissed in an earlier audit', () => {
    const earlier = { findings: [f('Market', 'LOW', { matchKey: 'k9', status: 'dismissed', dismissReason: 'Out of date', auditId: 'old' })] };
    const now = [f('Market', 'LOW', { matchKey: 'k9' })];
    expect(previouslyDismissed(now, [earlier])[now[0].id].reason).toBe('Out of date');
  });
});

describe('alerts', () => {
  const audit = (over) => ({ id: 'x', companyId: 'c', status: 'complete', calibrationVersion: CALIBRATION.version, findings: [], overridden: false, ...over });

  it('score-driven directive change needs to cross the edge by 2 points', () => {
    const prev = audit({ id: 'p', score: 47, baseDirective: 'HOLD', finalDirective: 'HOLD' });
    expect(crossesBandEdge(prev, audit({ score: 44, baseDirective: 'PIVOT', finalDirective: 'PIVOT' }))).toBe(false);
    expect(crossesBandEdge(prev, audit({ score: 43, baseDirective: 'PIVOT', finalDirective: 'PIVOT' }))).toBe(true);
    const types = evaluateAlerts(prev, audit({ score: 41, baseDirective: 'PIVOT', finalDirective: 'PIVOT' })).map((a) => a.trigger);
    expect(types).toEqual(['directive', 'score']);
  });

  it('suppresses score and directive alerts across calibration versions', () => {
    const prev = audit({ id: 'p', score: 60, baseDirective: 'HOLD', finalDirective: 'HOLD', calibrationVersion: PREVIOUS_CALIBRATION.version });
    const next = audit({ score: 30, baseDirective: 'KILL', finalDirective: 'KILL' });
    expect(evaluateAlerts(prev, next)).toEqual([]);
  });

  it('override-driven change alerts only when anchored to a new or unchanged HIGH finding', () => {
    const prev = audit({ id: 'p', score: 50, baseDirective: 'HOLD', finalDirective: 'HOLD', findings: [{ id: 'o1', matchKey: 'm1', severity: 'MEDIUM' }] });
    const high = { id: 'n1', matchKey: 'm1', severity: 'HIGH' };
    const next = audit({ score: 50, baseDirective: 'HOLD', finalDirective: 'PIVOT', overridden: true, overrideCited: ['n1'], findings: [high] });
    // m1 moved MEDIUM -> HIGH: neither new nor unchanged, so no directive alert.
    expect(evaluateAlerts(prev, next, { rules: { directive: true } })).toEqual([]);
    const fresh = { id: 'n2', matchKey: 'm2', severity: 'HIGH' };
    const next2 = audit({ score: 50, baseDirective: 'HOLD', finalDirective: 'PIVOT', overridden: true, overrideCited: ['n2'], findings: [fresh] });
    const out = evaluateAlerts(prev, next2, { rules: { directive: true } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ causedByOverride: true, anchoringFindingIds: ['n2'] });
  });

  it('pauses directive alerts in hold mode', () => {
    const prev = audit({ id: 'p', score: 47, baseDirective: 'HOLD', finalDirective: 'HOLD' });
    const next = audit({ score: 30, baseDirective: 'KILL', finalDirective: 'KILL' });
    expect(evaluateAlerts(prev, next, { holdMode: true }).map((a) => a.trigger)).toEqual(['score']);
  });
});

describe('outcomes', () => {
  it('writes checkpoints from the window', () => {
    expect(checkpoints('2026-01-31')).toMatchObject({ firstCheckpoint: '2027-01-31', finalCheckpoint: '2028-01-31' });
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('reads status by time and terminal outcomes', () => {
    const a = { finalDirective: 'KILL', firstCheckpoint: '2026-01-01', finalCheckpoint: '2027-01-01' };
    expect(outcomeStatus(a, null, '2025-06-01')).toBe('too-early');
    expect(outcomeStatus(a, null, '2026-06-01')).toBe('awaiting');
    expect(outcomeStatus(a, { result: 'flat' }, '2026-06-01')).toBe('not-yet-resolved');
    expect(outcomeStatus(a, { result: 'flat' }, '2027-02-01')).toBe('disagrees');
    expect(outcomeStatus(a, { result: 'shutDown' }, '2025-06-01')).toBe('agrees');
  });

  it('agreement rate excludes unresolved statuses', () => {
    expect(agreementRate(['agrees', 'disagrees', 'too-early', 'not-yet-resolved', 'agrees'])).toEqual({ agreed: 2, counted: 3, rate: 2 / 3 });
  });
});
