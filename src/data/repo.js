// Data layer. Screens call only these async functions and never import the
// mock JSON directly, so this module can be swapped for Supabase later.
//
// State lives in memory, seeded from ./mock, and is mirrored to localStorage
// (guarded) so demo changes survive a refresh. Every state-changing action
// writes an AuditLogEvent, as the spec requires.

import companiesSeed from './mock/companies.json';
import auditsSeed from './mock/audits.json';
import sourcesSeed from './mock/sources.json';
import alertsSeed from './mock/alerts.json';
import outcomesSeed from './mock/outcomes.json';
import orgSeed from './mock/org.json';
import usersSeed from './mock/users.json';
import auditLogSeed from './mock/audit-log.json';
import { BANK, CATEGORY_HOME } from './bank.js';
import { load, save, remove } from '../lib/storage.js';
import { AGENTS, CALIBRATION, CALIBRATIONS, CATEGORIES, SECTIONS } from '../engine/config.js';
import { scoreAudit, scoreExcludingDismissed, individualEffects, traceByCategory } from '../engine/score.js';
import { evaluateAlerts } from '../engine/alerts.js';
import { previouslyDismissed } from '../engine/compare.js';
import { checkpoints, outcomeStatus } from '../engine/outcomes.js';

const STORE_KEY = 'db-v3';
const clone = (v) => JSON.parse(JSON.stringify(v));
const wait = (ms = 40) => new Promise((r) => { setTimeout(r, ms); });
const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

function seed() {
  return {
    companies: clone(companiesSeed),
    audits: clone(auditsSeed),
    sources: clone(sourcesSeed),
    alerts: clone(alertsSeed),
    outcomes: clone(outcomesSeed),
    org: clone(orgSeed),
    users: clone(usersSeed),
    auditLog: clone(auditLogSeed),
    shareLinks: [],
    importJobs: [],
    freeAudits: [],
    session: { userId: 'u1', signedIn: true, onboarded: true },
    todos: {},
    seq: 1,
  };
}

let db = load(STORE_KEY) || seed();
const persist = () => save(STORE_KEY, db);
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}${(db.seq++).toString(36)}`;

function currentUser() {
  return db.users.find((u) => u.id === db.session.userId) || db.users[0];
}

function log(action, object, objectId, detail, who = currentUser().name) {
  db.auditLog.unshift({ at: nowIso(), who, action, object, objectId, detail });
}

// ---------------------------------------------------------------------------
// Permissions (spec 4.8). The UI checks these; the real backend enforces them
// with row-level security.

const MATRIX = {
  billing: ['Owner'],
  members: ['Owner', 'Admin'],
  settings: ['Owner', 'Admin'],
  runAudits: ['Owner', 'Admin', 'Analyst'],
  upload: ['Owner', 'Admin', 'Analyst'],
  findingStatus: ['Owner', 'Admin', 'Analyst'],
  comment: ['Owner', 'Admin', 'Analyst', 'Viewer'],
  share: ['Owner', 'Admin', 'Analyst', 'Viewer'],
};

export function can(permission, user = currentUser()) {
  return (MATRIX[permission] || []).includes(user.role);
}

function guard(permission) {
  if (!can(permission)) {
    const err = new Error(`Your role (${currentUser().role}) cannot do this.`);
    err.code = 'forbidden';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Session, organisation, people

export async function getSession() { await wait(0); return { ...db.session, user: currentUser(), org: db.org }; }
export async function signIn(email) {
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) || db.users[0];
  db.session = { ...db.session, userId: user.id, signedIn: true };
  log('auth.sign_in', 'User', user.id, `${user.name} signed in`, user.name);
  persist();
  return user;
}
export async function signOut() { db.session.signedIn = false; persist(); }
export async function completeOnboarding(answers) {
  db.org = { ...db.org, name: answers.orgName || db.org.name, kind: answers.kind || db.org.kind };
  db.org.delivery = { ...db.org.delivery, email: answers.email || db.org.delivery.email };
  db.org.findingDisplay = answers.display;
  db.session.onboarded = true;
  log('org.onboard', 'Organisation', 'org', `Completed onboarding as ${db.org.kind}`);
  persist();
}

export async function getOrg() { await wait(0); return clone(db.org); }
export async function updateOrg(patch, detail = 'Updated organisation settings') {
  guard('settings');
  db.org = { ...db.org, ...patch };
  log('org.update', 'Organisation', 'org', detail);
  persist();
  return clone(db.org);
}

export async function getUsers() { await wait(0); return clone(db.users); }
export async function getCurrentUser() { return clone(currentUser()); }
export async function updateProfile(patch) {
  Object.assign(currentUser(), patch);
  log('user.update', 'User', currentUser().id, 'Updated profile');
  persist();
}
// Demo only: view the app as another role to check permissions.
export async function actAs(userId) { db.session.userId = userId; persist(); }

export async function inviteMember(email, role) {
  guard('members');
  const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const user = { id: nextId('u'), name, initials: name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(), email, role, title: role, status: 'invited', lastActive: null, inviteExpires: addDays(todayIso(), 7) };
  db.users.push(user);
  log('member.invite', 'User', user.id, `Invited ${email} as ${role}`);
  persist();
  return user;
}
export async function changeRole(userId, role) {
  guard('members');
  const u = db.users.find((x) => x.id === userId);
  if (u.role === 'Owner') throw new Error('Transfer ownership before changing the Owner\'s role.');
  const from = u.role;
  u.role = role;
  log('member.role', 'User', userId, `Changed ${u.name} from ${from} to ${role}`);
  persist();
}
export async function removeMember(userId) {
  guard('members');
  const u = db.users.find((x) => x.id === userId);
  if (u.role === 'Owner') throw new Error('The Owner cannot be removed.');
  u.status = 'removed';
  log('member.remove', 'User', userId, `Removed ${u.name}`);
  persist();
}

// ---------------------------------------------------------------------------
// Companies

function auditsFor(companyId, { includeFailed = false } = {}) {
  return db.audits
    .filter((a) => a.companyId === companyId && (includeFailed || a.status === 'complete' || a.status === 'partial'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function summarise(c) {
  const list = auditsFor(c.id);
  const latest = list[list.length - 1] || null;
  const previous = list[list.length - 2] || null;
  const all = auditsFor(c.id, { includeFailed: true });
  return {
    ...clone(c),
    auditCount: list.length,
    latest: latest && pickAudit(latest),
    previous: previous && pickAudit(previous),
    delta: latest && previous ? latest.score - previous.score : null,
    running: all.find((a) => a.status === 'running' || a.status === 'queued') || null,
    unreadAlerts: db.alerts.filter((al) => al.companyId === c.id && !al.read).length,
    sourceCount: db.sources.filter((s) => s.companyId === c.id).length,
    fileCount: db.sources.filter((s) => s.companyId === c.id && s.type === 'uploaded').length,
  };
}

function pickAudit(a) {
  return {
    id: a.id, date: a.date, status: a.status, score: a.score, baseDirective: a.baseDirective, finalDirective: a.finalDirective,
    exposure: a.exposure, overridden: a.overridden, calibrationVersion: a.calibrationVersion, underReview: a.underReview,
  };
}

export async function getCompanies() {
  await wait();
  return db.companies.map(summarise);
}

export async function getCompany(id) {
  await wait();
  const c = db.companies.find((x) => x.id === id);
  if (!c) return null;
  return { ...summarise(c), todos: (c.openItems || []).map((t) => ({ ...t, done: !!db.todos[`${id}:${t.id}`] })) };
}

export async function toggleTodo(companyId, todoId) {
  const key = `${companyId}:${todoId}`;
  db.todos[key] = !db.todos[key];
  persist();
}

export async function updateCompany(id, patch, detail) {
  guard('runAudits');
  const c = db.companies.find((x) => x.id === id);
  Object.assign(c, patch);
  if (patch.cadence) c.cadence = { ...c.cadence, nextRun: computeNextRun(c) };
  log('company.update', 'Company', id, detail || `Updated ${c.title}`);
  persist();
  return summarise(c);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function computeNextRun(c) {
  const mode = c.cadence.mode === 'inherit' ? db.org.cadence.mode : c.cadence.mode;
  if (mode === 'off' || c.cadence.paused) return null;
  const months = mode === 'monthly' ? 1 : 3;
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, Math.min(28, db.org.cadence.day || 1));
  return d.toISOString().slice(0, 10);
}

export function effectiveCadence(c, org = db.org) {
  return c.cadence.mode === 'inherit' ? org.cadence.mode : c.cadence.mode;
}

// ---------------------------------------------------------------------------
// Audits

export async function getAudits(companyId) {
  await wait();
  return clone(auditsFor(companyId, { includeFailed: true }));
}

/** Full audit with everything the Report needs, derived on read. */
export async function getAudit(id) {
  await wait();
  const a = db.audits.find((x) => x.id === id);
  if (!a) return null;
  const company = db.companies.find((c) => c.id === a.companyId);
  const sources = db.sources.filter((s) => s.companyId === a.companyId);
  const earlier = auditsFor(a.companyId).filter((x) => x.date < a.date);
  const out = clone(a);
  out.company = clone(company);
  out.sourcesById = Object.fromEntries(sources.map((s) => [s.id, clone(s)]));
  out.citationOrder = citationOrder(a, out.sourcesById);
  out.auditNumber = auditsFor(a.companyId).findIndex((x) => x.id === a.id) + 1;
  out.auditTotal = auditsFor(a.companyId).length;
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
  out.shareLinks = db.shareLinks.filter((l) => l.auditId === id);
  return out;
}

// Number sources in order of first citation across the report.
function citationOrder(a, sourcesById) {
  const order = [];
  const rank = (f) => SECTIONS.findIndex((s) => s.id === f.section);
  const reading = a.findings.map((f, i) => [f, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([f]) => f);
  for (const f of reading) for (const s of f.sources) if (sourcesById[s] && !order.includes(s)) order.push(s);
  return order;
}

export async function getLatestAuditId(companyId) {
  const list = auditsFor(companyId);
  return list.length ? list[list.length - 1].id : null;
}

// ---------------------------------------------------------------------------
// Running an audit. The run plan is stored with a start time so progress is
// derived from the clock: leaving the page does not stop the audit.

const DEMO_DURATIONS = [6, 7, 5, 6, 4, 5]; // seconds, shortened from real runs (about 45 s each)
const RETRY_SECONDS = 4;

export async function runAudit(input, { failAgent = null, failRetry = false } = {}) {
  guard('runAudits');
  let company = input.companyId ? db.companies.find((c) => c.id === input.companyId) : null;
  if (company && input.title) {
    const fields = ['title', 'description', 'industry', 'country', 'city', 'model', 'target', 'type'];
    const changed = fields.filter((k) => input[k] !== undefined && String(input[k]).trim() !== String(company[k] || ''));
    if (changed.length) {
      changed.forEach((k) => { company[k] = String(input[k]).trim(); });
      company.updatedAt = nowIso();
      log('company.update', 'Company', company.id, `Changed ${changed.join(', ')} on ${company.title} before re-audit`);
    }
  }
  if (!company) {
    company = {
      id: nextId('co'), title: input.title.trim(), description: input.description.trim(), industry: input.industry, country: input.country.trim(),
      city: (input.city || '').trim(), model: (input.model || '').trim(), target: (input.target || '').trim(), type: input.type || 'startup',
      dealLead: currentUser().name, stage: input.stage || '', fund: '', budget: input.budget || '', delivery: input.delivery || '', price: input.price || '', competitors: input.competitors || '',
      cadence: { mode: 'inherit', paused: false, resumeOn: null, nextRun: null },
      coverage: [{ topic: 'Financials', pct: input.files ? 40 : 0 }, { topic: 'Operations', pct: 0 }, { topic: 'Market and competitors', pct: 0 }, { topic: 'Legal and IP', pct: 0 }, { topic: 'Team', pct: 0 }],
      openItems: [],
    };
    db.companies.push(company);
    log('company.create', 'Company', company.id, `Created ${company.title}`);
  }
  if (input.files && input.files.length) {
    input.files.forEach((file) => db.sources.push({
      id: nextId(`${company.id}-s`), companyId: company.id, type: 'uploaded', title: file.name.replace(/\.[^.]+$/, ''), kind: kindOf(file.name),
      date: todayIso(), reliability: 'Unrated', note: 'Attached when the audit was started.', addedBy: currentUser().name, status: 'read', size: file.size || 0,
    }));
    log('file.upload', 'File', company.id, `Attached ${input.files.length} file${input.files.length === 1 ? '' : 's'} to ${company.title}`);
  }
  const id = nextId(`${company.id}-a`);
  const audit = {
    id, companyId: company.id, date: todayIso(), status: 'running', trigger: input.trigger || 'manual',
    calibrationVersion: CALIBRATION.version, findings: [], skippedSections: [], sourceIds: db.sources.filter((s) => s.companyId === company.id).map((s) => s.id),
    plan: { startedAt: Date.now(), durations: DEMO_DURATIONS, failAgent: failAgent ? Number(failAgent) : null, failRetry },
    agentRuns: [], score: null,
  };
  db.audits.push(audit);
  log('audit.start', 'Audit', id, `Started audit of ${company.title}`);
  persist();
  return { auditId: id, companyId: company.id };
}

function timeline(plan) {
  const steps = [];
  let t = 0;
  plan.durations.forEach((d, i) => {
    const agent = i + 1;
    const fails = plan.failAgent === agent;
    const first = { agent, start: t, end: t + d, attempt: 1, ok: !fails };
    t += d;
    steps.push(first);
    if (fails) {
      steps.push({ agent, start: t, end: t + RETRY_SECONDS, attempt: 2, ok: !plan.failRetry });
      t += RETRY_SECONDS;
    }
  });
  return { steps, total: t };
}

/** Debug: make an agent fail (and optionally fail its retry) if it has not started yet. */
export async function setRunDebug(id, { failAgent = null, failRetry = false }) {
  const a = db.audits.find((x) => x.id === id);
  if (!a || !a.plan) return false;
  const elapsed = (Date.now() - a.plan.startedAt) / 1000;
  const trial = { ...a.plan, failAgent: failAgent ? Number(failAgent) : null, failRetry };
  const { steps } = timeline(trial);
  const target = steps.find((st) => st.agent === trial.failAgent);
  if (target && target.start < elapsed) return false;
  // Agents already finished keep their timing because only later steps move.
  a.plan = trial;
  delete a._generated;
  persist();
  return true;
}

/** Live view of a running audit, derived from the clock. Finalises when done. */
export async function getRun(id) {
  await wait(0);
  const a = db.audits.find((x) => x.id === id);
  if (!a) return null;
  if (!a.plan) return { audit: clone(a), done: true, agents: [] };
  const elapsed = (Date.now() - a.plan.startedAt) / 1000;
  const { steps, total } = timeline(a.plan);
  const agents = AGENTS.map((ag) => {
    const mine = steps.filter((s) => s.agent === ag.n);
    const last = mine[mine.length - 1];
    if (elapsed < mine[0].start) return { n: ag.n, name: ag.name, state: 'queued' };
    const current = mine.find((s) => elapsed >= s.start && elapsed < s.end);
    if (current) {
      return { n: ag.n, name: ag.name, state: current.attempt === 2 ? 'retrying' : 'working', progress: (elapsed - current.start) / (current.end - current.start) };
    }
    if (last.ok) return { n: ag.n, name: ag.name, state: 'complete', duration: mine.reduce((s, x) => s + (x.end - x.start), 0), retried: mine.length > 1 };
    if (mine.length === 1 && elapsed < last.end + RETRY_SECONDS) return { n: ag.n, name: ag.name, state: 'retrying', progress: 0 };
    return { n: ag.n, name: ag.name, state: 'failed', error: 'Timed out on both attempts. No report returned.' };
  });
  const preview = previewFindings(a, agents);
  const done = elapsed >= total;
  if (done && a.status === 'running') finaliseRun(a);
  return { audit: clone(a), done, elapsed, total, agents, preview };
}

// Findings shown while the audit runs: those of agents already complete.
function previewFindings(a, agents) {
  const company = db.companies.find((c) => c.id === a.companyId);
  const all = generateFindings(a, company);
  const doneAgents = agents.filter((x) => x.state === 'complete').map((x) => x.n);
  return all.filter((f) => doneAgents.includes(f.agent)).sort((x, y) => sevRank(y) - sevRank(x)).slice(0, 6);
}
const sevRank = (f) => ({ HIGH: 3, MEDIUM: 2, LOW: 1 }[f.severity]);

function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function rng(seedNum) {
  let s = seedNum || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stand-in for the agents in this prototype. A re-audit evolves the previous
 * audit's findings (so compare can match them); a first audit draws from the
 * finding bank, seeded by the company fields.
 */
function generateFindings(a, company) {
  if (a._generated) return a._generated;
  const rand = rng(hashStr(`${company.title}|${company.description}|${a.id}`));
  const prev = auditsFor(company.id).filter((x) => x.id !== a.id).pop();
  const uploaded = db.sources.filter((s) => s.companyId === company.id);
  let rows;
  if (prev) {
    rows = prev.findings
      .filter((f) => f.status !== 'resolved' && rand() > 0.15)
      .map((f) => {
        const r = rand();
        const sev = r < 0.1 ? 'HIGH' : r > 0.92 ? 'LOW' : f.severity;
        return { ...f, severity: sev };
      });
    const have = new Set(rows.map((f) => f.matchKey));
    CATEGORIES.forEach((cat) => {
      if (rand() < 0.3) {
        const entry = BANK[cat].find(([topic]) => !have.has(`${CATEGORY_HOME[cat][0]}:${cat}:${topic}`));
        if (entry) rows.push(fromBank(cat, entry, rand() < 0.4 ? 'HIGH' : 'MEDIUM', uploaded, rand));
      }
    });
  } else {
    rows = [];
    CATEGORIES.forEach((cat) => {
      const h = Math.floor(rand() * 2.2);
      const m = 1 + Math.floor(rand() * 2);
      const l = Math.floor(rand() * 3);
      const sevs = [...Array(h).fill('HIGH'), ...Array(m).fill('MEDIUM'), ...Array(l).fill('LOW')];
      sevs.forEach((sev, i) => rows.push(fromBank(cat, BANK[cat][i], sev, uploaded, rand)));
    });
  }
  const findings = rows.map((f, i) => ({
    ...f, id: `${a.id}-f${i + 1}`, auditId: a.id, status: 'open', owner: null, dismissReason: null, comments: [], history: [],
    text: String(f.text).replaceAll('{city}', company.city || company.country),
  }));
  Object.defineProperty(a, '_generated', { value: findings, enumerable: false, configurable: true });
  return findings;
}

function fromBank(cat, [topic, title, text], severity, sources, rand) {
  const [agent, section] = CATEGORY_HOME[cat];
  const cite = sources.length && rand() < 0.55 ? [sources[Math.floor(rand() * sources.length)].id] : [];
  return { agent, section, category: cat, severity, topic, matchKey: `${agent}:${cat}:${topic}`, title, text, sources: cite };
}

function finaliseRun(a) {
  const company = db.companies.find((c) => c.id === a.companyId);
  const { steps } = timeline(a.plan);
  const failedAgents = AGENTS.filter((ag) => {
    const mine = steps.filter((s) => s.agent === ag.n);
    return !mine[mine.length - 1].ok;
  }).map((ag) => ag.n);
  const orchestratorFailed = failedAgents.includes(6);
  let findings = generateFindings(a, company).filter((f) => !failedAgents.includes(f.agent));
  const skipped = db.sources.some((s) => s.companyId === company.id && /licen|contract|legal/i.test(s.title))
    ? []
    : [{ section: 'ip', reason: 'No legal or IP material was supplied, so legal and IP exposure was not assessed.' }];
  const status = orchestratorFailed ? 'failed' : failedAgents.length ? 'partial' : 'complete';
  a.findings = findings;
  a.skippedSections = skipped;
  a.agentRuns = AGENTS.map((ag) => {
    const mine = steps.filter((s) => s.agent === ag.n);
    const ok = mine[mine.length - 1].ok;
    return {
      agent: ag.n,
      status: ok ? 'complete' : 'failed',
      duration: mine.reduce((s, x) => s + (x.end - x.start), 0),
      retries: mine.length - 1,
      findings: findings.filter((f) => f.agent === ag.n).length,
      error: ok ? null : (ag.n === 6 ? 'Returned malformed output on both attempts.' : 'Timed out on both attempts. No report returned.'),
      schema: ok ? 'valid' : 'malformed',
    };
  });
  const result = scoreAudit({ findings, type: company.type, status });
  const high = findings.filter((f) => f.severity === 'HIGH');
  const notRun = failedAgents.filter((n) => n !== 6).flatMap((n) => SECTIONS.filter((s) => s.agent === n).map((s) => s.id));
  Object.assign(a, {
    status,
    exposure: result.exposure,
    raw: result.raw ?? null,
    cap: result.cap ?? null,
    score: result.score,
    baseDirective: result.baseDirective,
    finalDirective: result.finalDirective,
    overridden: false,
    override: null,
    overrideCited: [],
    overrideRejected: null,
    orchestrator: orchestratorFailed ? null : {
      rationale: `${company.title}: ${high[0] ? high[0].title.toLowerCase() : 'no single dominant risk'}${high[1] ? ', and ' + high[1].title.toLowerCase() : ''}.`,
      investor: null, roadmap: null, topRisks: high.slice(0, 3).map((f) => f.id),
    },
    coverage: { agentsRun: a.agentRuns.filter((r) => r.status === 'complete').length, agentsTotal: 6, sectionsSkipped: skipped.length, sectionsNotRun: notRun, sourcesCited: new Set(findings.flatMap((f) => f.sources)).size },
    countedAgainstUsage: status !== 'failed',
    modelVersion: '[PINNED MODEL VERSION]',
    promptVersion: 'prompts-2026.09',
    snapshotHash: hashStr(JSON.stringify([company.title, company.description, company.industry, company.country, company.type, [...a.sourceIds].sort()])).toString(16),
    underReview: !!db.org.holdMode,
    driftFlag: false,
    runSeconds: Math.round(steps[steps.length - 1].end),
    ...checkpoints(a.date),
  });
  delete a.plan;
  // Drift flag: same snapshot hash as an earlier audit but a different score.
  const twin = auditsFor(company.id).find((x) => x.id !== a.id && x.snapshotHash === a.snapshotHash && x.score !== a.score);
  if (twin && a.score != null) {
    a.driftFlag = true;
    log('audit.drift', 'Audit', a.id, `Drift flag: score ${a.score} differs from ${twin.score} on an identical input snapshot`, 'AVA');
  }
  log(status === 'failed' ? 'audit.failed' : 'audit.complete', 'Audit', a.id,
    status === 'failed' ? `Audit of ${company.title} failed: the Orchestrator returned no valid output. Not counted against usage.`
      : `Completed audit of ${company.title}. Score ${a.score}, directive ${a.finalDirective}${status === 'partial' ? ' (Partial)' : ''}.`, 'AVA');
  // Alerts against the previous audit.
  const prev = auditsFor(company.id).filter((x) => x.id !== a.id).pop();
  if (prev && status !== 'failed') {
    const fresh = evaluateAlerts(prev, a, { rules: db.org.alertRules, holdMode: db.org.holdMode });
    fresh.forEach((al) => db.alerts.unshift({ id: nextId('al'), ...al, date: a.date, read: false, snoozedUntil: null, emailedAt: null }));
  }
  company.cadence.nextRun = computeNextRun(company);
  persist();
}

// ---------------------------------------------------------------------------
// Finding workflow (spec 4.6)

function findFinding(auditId, findingId) {
  const a = db.audits.find((x) => x.id === auditId);
  return { audit: a, finding: a.findings.find((f) => f.id === findingId) };
}

const STATUS_LABEL = { open: 'Open', accepted: 'Accepted', dismissed: 'Dismissed', resolved: 'Resolved' };

export async function setFindingStatus(auditId, findingId, status, reason = '') {
  guard('findingStatus');
  const { finding } = findFinding(auditId, findingId);
  if (status === 'dismissed' && !reason.trim()) throw new Error('A reason is required to dismiss a finding.');
  const from = finding.status;
  finding.status = status;
  finding.dismissReason = status === 'dismissed' ? reason.trim() : null;
  const entry = { at: nowIso(), by: currentUser().name, action: STATUS_LABEL[status], detail: status === 'dismissed' ? reason.trim() : (from === 'dismissed' ? 'Restored' : null) };
  finding.history.push(entry);
  log(status === 'dismissed' ? 'finding.dismiss' : 'finding.status', 'Finding', findingId,
    status === 'dismissed' ? `Dismissed "${finding.title}": ${reason.trim()}` : `Marked "${finding.title}" as ${STATUS_LABEL[status]}${from === 'dismissed' ? ' (restored)' : ''}`);
  persist();
}

export async function setFindingOwner(auditId, findingId, owner) {
  guard('findingStatus');
  const { finding } = findFinding(auditId, findingId);
  finding.owner = owner || null;
  finding.history.push({ at: nowIso(), by: currentUser().name, action: owner ? `Assigned to ${owner}` : 'Unassigned' });
  log('finding.owner', 'Finding', findingId, owner ? `Assigned "${finding.title}" to ${owner}` : `Unassigned "${finding.title}"`);
  persist();
}

export async function addComment(auditId, findingId, text) {
  guard('comment');
  const { finding } = findFinding(auditId, findingId);
  finding.comments.push({ at: nowIso(), by: currentUser().name, text: text.trim() });
  log('finding.comment', 'Finding', findingId, `Commented on "${finding.title}"`);
  persist();
}

// ---------------------------------------------------------------------------
// Sources and data room

export async function getSources(companyId) {
  await wait();
  const audits = auditsFor(companyId);
  return db.sources.filter((s) => s.companyId === companyId).map((s) => ({
    ...clone(s),
    citedBy: audits.flatMap((a) => a.findings.filter((f) => f.sources.includes(s.id)).map((f) => ({ auditId: a.id, auditDate: a.date, id: f.id, title: f.title, severity: f.severity, agent: f.agent, section: f.section, latest: a === audits[audits.length - 1] }))),
  }));
}

export async function uploadFiles(companyId, files) {
  guard('upload');
  const company = db.companies.find((c) => c.id === companyId);
  const added = files.map((file) => {
    const s = {
      id: nextId(`${companyId}-s`), companyId, type: 'uploaded', title: file.name.replace(/\.[^.]+$/, ''), kind: kindOf(file.name),
      date: todayIso(), reliability: 'Unrated', note: 'Uploaded to the data room. Read before the next audit.', addedBy: currentUser().name, status: 'reading', size: file.size || 0,
    };
    db.sources.push(s);
    return s;
  });
  log('file.upload', 'File', added[0]?.id, `Uploaded ${added.map((s) => s.title).join(', ')} to ${company.title}`);
  if (db.org.alertRules.evidence) {
    db.alerts.unshift({ id: nextId('al'), companyId, auditId: null, trigger: 'evidence', date: todayIso(), read: false, detail: `${added.length} new file${added.length === 1 ? '' : 's'} added`, causedByOverride: false, anchoringFindingIds: [] });
  }
  persist();
  setTimeout(() => { added.forEach((s) => { s.status = 'read'; }); persist(); }, 2500);
  return clone(added);
}

function kindOf(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { pdf: 'PDF', xlsx: 'Spreadsheet', xls: 'Spreadsheet', csv: 'Spreadsheet', ppt: 'Slides', pptx: 'Slides', key: 'Slides', doc: 'Document', docx: 'Document', txt: 'Document' }[ext] || 'File';
}

// ---------------------------------------------------------------------------
// Alerts (spec 4.7)

export async function getAlerts() {
  await wait();
  const today = todayIso();
  return db.alerts
    .map((al) => {
      const audit = al.auditId ? db.audits.find((a) => a.id === al.auditId) : null;
      const finding = audit && al.findingId ? audit.findings.find((f) => f.id === al.findingId) : null;
      const anchors = audit ? (al.anchoringFindingIds || []).map((id) => audit.findings.find((f) => f.id === id)?.title).filter(Boolean) : [];
      return { ...clone(al), company: db.companies.find((c) => c.id === al.companyId)?.title, snoozed: !!(al.snoozedUntil && al.snoozedUntil > today), findingTitle: finding?.title || null, findingCategory: finding?.category || null, anchors };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
export async function markAlertRead(id, read = true) { const al = db.alerts.find((x) => x.id === id); if (al) al.read = read; persist(); }
export async function markAllAlertsRead() { db.alerts.forEach((al) => { al.read = true; }); log('alert.read_all', 'Alert', '*', 'Marked all alerts as read'); persist(); }
export async function snoozeCompany(companyId, days = 7) {
  const until = addDays(todayIso(), days);
  db.alerts.filter((al) => al.companyId === companyId).forEach((al) => { al.snoozedUntil = until; });
  log('alert.snooze', 'Company', companyId, `Snoozed alerts for ${db.companies.find((c) => c.id === companyId).title} until ${until}`);
  persist();
}
export async function unsnoozeCompany(companyId) {
  db.alerts.filter((al) => al.companyId === companyId).forEach((al) => { al.snoozedUntil = null; });
  persist();
}
export async function unreadAlertCount() {
  const today = todayIso();
  return db.alerts.filter((al) => !al.read && !(al.snoozedUntil && al.snoozedUntil > today)).length;
}

// ---------------------------------------------------------------------------
// Outcomes (spec 4.16)

export async function getOutcomeRows() {
  await wait();
  const today = todayIso();
  return db.audits
    .filter((a) => a.status === 'complete' || a.status === 'partial')
    .map((a) => {
      const outcome = db.outcomes.find((o) => o.auditId === a.id) || null;
      const company = db.companies.find((c) => c.id === a.companyId);
      return {
        auditId: a.id, companyId: a.companyId, company: company.title, type: company.type, date: a.date, score: a.score, finalDirective: a.finalDirective,
        firstCheckpoint: a.firstCheckpoint, finalCheckpoint: a.finalCheckpoint, outcomeWindowVersion: a.outcomeWindowVersion,
        outcome: clone(outcome), status: outcomeStatus(a, outcome, today),
      };
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

export async function logOutcome(auditId, { result, date, evidence }) {
  guard('findingStatus');
  if (result === 'exited' && evidence?.belowLastValuation) throw new Error('An acquisition below the last valuation is logged as Written down or distressed sale.');
  const a = db.audits.find((x) => x.id === auditId);
  const prev = db.outcomes.find((o) => o.auditId === auditId);
  const record = { auditId, result, date, evidence, checkpoint: date >= a.finalCheckpoint ? 'final' : 'first', loggedBy: currentUser().name, loggedAt: nowIso() };
  db.outcomes = db.outcomes.filter((o) => o.auditId !== auditId).concat(record);
  const company = db.companies.find((c) => c.id === a.companyId).title;
  log(prev ? 'outcome.change' : 'outcome.log', 'Outcome', auditId, prev ? `Changed outcome for ${company} (${a.date}) from ${prev.result} to ${result}` : `Logged outcome ${result} for ${company} (${a.date})`);
  persist();
}

// ---------------------------------------------------------------------------
// Sharing (spec 4.9)

export async function createShareLink(auditId, { email, expiryDays = 14, password = '' }) {
  guard('share');
  const link = { token: nextId('sh'), auditId, email, expires: addDays(todayIso(), Number(expiryDays)), passwordSet: !!password, password, revoked: false, views: [], createdBy: currentUser().name, createdAt: nowIso() };
  db.shareLinks.push(link);
  log('share.create', 'ShareLink', link.token, `Shared ${auditId} with ${email}, expires ${link.expires}`);
  persist();
  return clone(link);
}
export async function revokeShareLink(token) {
  const l = db.shareLinks.find((x) => x.token === token);
  l.revoked = true;
  log('share.revoke', 'ShareLink', token, `Revoked link for ${l.email}`);
  persist();
}
export async function openSharedReport(token, password = '') {
  await wait();
  const l = db.shareLinks.find((x) => x.token === token);
  if (!l) return { state: 'missing' };
  if (l.revoked) return { state: 'revoked' };
  if (l.expires < todayIso()) return { state: 'expired', link: clone(l) };
  if (l.passwordSet && password !== l.password) return { state: 'password', link: { email: l.email } };
  l.views.push({ at: nowIso() });
  log('share.view', 'ShareLink', token, `Shared report viewed by ${l.email}`, l.email);
  persist();
  return { state: 'ok', link: clone(l), audit: await getAudit(l.auditId) };
}

// ---------------------------------------------------------------------------
// Import (spec 4.5)

export async function existingTitles() { return db.companies.map((c) => c.title.toLowerCase()); }

export async function importCompanies(rows, { fileName, cadence = null, auditAll = false }) {
  guard('runAudits');
  const created = rows.map((r) => {
    const c = {
      id: nextId('co'), title: r.title, description: r.description || '', industry: r.industry, country: r.country, city: r.city || '', model: '', target: '',
      type: r.type || 'startup', dealLead: currentUser().name, stage: r.stage || '', fund: '',
      cadence: { mode: cadence || 'inherit', paused: false, resumeOn: null, nextRun: null },
      coverage: ['Financials', 'Operations', 'Market and competitors', 'Legal and IP', 'Team'].map((topic) => ({ topic, pct: 0 })),
      openItems: [],
    };
    db.companies.push(c);
    c.cadence.nextRun = computeNextRun(c);
    return c;
  });
  const job = { id: nextId('imp'), file: fileName, rowsValid: rows.length, createdBy: currentUser().name, createdAt: nowIso(), auditAll };
  db.importJobs.push(job);
  log('import.run', 'ImportJob', job.id, `Imported ${rows.length} companies from ${fileName}`);
  persist();
  if (auditAll) for (const c of created) await runAudit({ companyId: c.id, trigger: 'manual' });
  return { job, created: clone(created) };
}

// ---------------------------------------------------------------------------
// Free audit (spec 4.11)

const FREE_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com'];

export function checkWorkEmail(email) {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(String(email).trim().toLowerCase());
  if (!m) return { ok: false, reason: 'Enter a valid work email.' };
  if (FREE_DOMAINS.includes(m[1])) return { ok: false, reason: 'Use your work email. Free email addresses cannot run a free audit.' };
  const month = todayIso().slice(0, 7);
  if (db.freeAudits.some((f) => f.domain === m[1] && f.createdAt.slice(0, 7) === month)) {
    return { ok: false, reason: `A free audit has already been run for ${m[1]} this month. Book a walkthrough to see the full product.` };
  }
  return { ok: true, domain: m[1] };
}

export async function runFreeAudit(input) {
  const check = checkWorkEmail(input.email);
  if (!check.ok) throw new Error(check.reason);
  const company = { id: 'free', title: input.title.trim(), description: input.description.trim(), city: input.country.trim(), country: input.country.trim(), type: 'startup' };
  const a = { id: nextId('free') };
  const findings = generateFindings(a, company).map((f) => ({ ...f, sources: [] }));
  const result = scoreAudit({ findings, type: 'startup' });
  const record = { id: a.id, email: input.email.trim(), domain: check.domain, inputs: { ...input }, createdAt: nowIso(), score: result.score, directive: result.finalDirective, findings, exposure: result.exposure };
  db.freeAudits.push(record);
  persist();
  return clone(record);
}

// ---------------------------------------------------------------------------
// Audit log (spec 4.10)

export async function getAuditLog() { await wait(); return clone(db.auditLog); }
export async function recordExport(auditId, detail) { log('export.pdf', 'Audit', auditId, detail); persist(); }

// ---------------------------------------------------------------------------
// Demo helpers

export async function resetDemo() { remove(STORE_KEY); db = seed(); }
export const SAMPLE = { companyId: 'northline', auditId: 'northline-4' };
export { AGENTS, SECTIONS, CATEGORIES };
