// Live data layer (VITE_AVA_DATA=live). Same exports and shapes as
// repo.mock.js.
//
// Reads go straight to Supabase under row-level security. Writes that only
// touch a user's own workflow columns (settings, cadence, alert reads) also go
// to Supabase; everything with side effects (audits, findings, sharing,
// import, team, uploads) goes through the AVA API, which runs the write as the
// signed-in user so the same policies decide.

import { createClient } from '@supabase/supabase-js';
import { AGENTS, ALERT_RULES, CATEGORIES, SECTIONS } from '../engine/config.js';
import { outcomeStatus } from '../engine/outcomes.js';
import { roleCan, checkEmailFormat, passwordProblem, PASSWORD_RULE, todayIso, addDays, computeNextRun, kindOf, pickAudit, enrichAudit, lockFindings } from './shared.js';
import { load, save } from '../lib/storage.js';

export const MODE = 'live';

const env = import.meta.env;
const sb = createClient(env.VITE_SUPABASE_URL || 'http://localhost:54321', env.VITE_SUPABASE_ANON_KEY || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// A failed Google or SSO return carries its reason in the URL. Capture it
// before the route guard redirects and the address bar loses it.
let returnError = (() => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  new URLSearchParams(window.location.hash.slice(1)).forEach((v, k) => params.set(k, v));
  let msg = params.get('error_description') || params.get('error');
  if (!msg) return null;
  try { msg = decodeURIComponent(msg.replace(/\+/g, ' ')); } catch { /* already plain */ }
  // Never echo provider codes or tokens back onto the page.
  if (/exchange external code/i.test(msg)) return 'Google did not accept the sign-in. Try again in a minute.';
  return msg.split(':')[0].trim();
})();

/** The sign-in error returned by the provider, once. */
export function takeAuthError() { const e = returnError; returnError = null; return e; }
const API = (env.VITE_API_URL || '').replace(/\/$/, '');
const ORG_KEY = 'live-org';

// ---------------------------------------------------------------------------
// Plumbing

function fail(error, fallback = 'Something went wrong. Try again.') {
  const msg = error?.message || fallback;
  const e = new Error(/row-level security|permission denied/i.test(msg) ? 'Your role does not allow this.' : msg);
  e.code = error?.code;
  throw e;
}

const rows = async (q) => { const { data, error } = await q; if (error) fail(error); return data || []; };
const row = async (q) => { const { data, error } = await q; if (error) fail(error); return data || null; };

async function api(path, { method = 'POST', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const { data } = await sb.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch(`${API}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let out = null;
  try { out = await res.json(); } catch { /* empty body */ }
  if (!res.ok && !(out && out.state)) {
    const e = new Error(out?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Session context: the signed-in user, their organisation and role.

let ctx = null; // { user, org, members }

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') ctx = null;
});

const initials = (name, email) => (name || email || '?').split(/[\s@.]+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

function mapOrg(o, ownerId) {
  return {
    id: o.id, name: o.name, kind: o.kind, plan: o.plan,
    renewal: o.renewal_date || null, limit: o.company_limit ?? null, seats: o.seat_limit ?? null,
    cadence: o.default_cadence, alertThreshold: ALERT_RULES.scoreMove, currency: o.currency,
    retention: o.retention_period || 'Deleted within 90 days of the account closing', region: o.storage_region, branding: o.branding,
    alertRules: o.alert_rules, delivery: o.delivery, findingDisplay: o.finding_display, integrations: o.integrations,
    holdMode: o.hold_mode, logoUrl: o.logo_url, ownerId, trialEndsAt: o.trial_ends_at || null,
    subscriptionStatus: o.subscription_status || null, cancelAtPeriodEnd: !!o.cancel_at_period_end, periodEnd: o.current_period_end || null,
  };
}

async function loadContext() {
  if (ctx) return ctx;
  const { data } = await sb.auth.getSession();
  const authUser = data.session?.user;
  if (!authUser) return null;
  const mine = await rows(sb.from('memberships').select('org_id, role, status').eq('user_id', authUser.id).eq('status', 'active'));
  const profile = await row(sb.from('profiles').select('*').eq('user_id', authUser.id).maybeSingle());
  const meta = authUser.user_metadata || {};
  const name = profile?.name || meta.name || '';
  const base = { id: authUser.id, name: name || authUser.email, initials: profile?.initials || initials(name, authUser.email), email: authUser.email, title: profile?.title || '', status: 'active', lastActive: todayIso() };
  if (!mine.length) {
    ctx = { user: { ...base, role: null }, org: null, members: [], meta };
    return ctx;
  }
  const saved = load(ORG_KEY);
  const m = mine.find((x) => x.org_id === saved) || mine[0];
  const org = await row(sb.from('organisations').select('*').eq('id', m.org_id).single());
  const members = await loadMembers(m.org_id);
  const owner = members.find((u) => u.role === 'Owner');
  ctx = { user: { ...base, role: m.role }, org: mapOrg(org, owner?.id), members, meta };
  return ctx;
}

async function need() {
  const c = await loadContext();
  if (!c || !c.org) { const e = new Error('Sign in to continue.'); e.code = 'auth'; throw e; }
  return c;
}

async function loadMembers(orgId) {
  const ms = await rows(sb.from('memberships').select('user_id, role, status, last_active').eq('org_id', orgId).neq('status', 'removed'));
  const ps = ms.length ? await rows(sb.from('profiles').select('user_id, name, initials, email, title').in('user_id', ms.map((x) => x.user_id))) : [];
  const byId = Object.fromEntries(ps.map((p) => [p.user_id, p]));
  const out = ms.map((x) => {
    const p = byId[x.user_id] || {};
    return { id: x.user_id, name: p.name || p.email || 'Member', initials: p.initials || initials(p.name, p.email), email: p.email || '', role: x.role, title: p.title || x.role, status: x.status, lastActive: x.last_active ? x.last_active.slice(0, 10) : null };
  });
  // Pending invitations show as invited members (visible to Owners and Admins).
  const invites = await rows(sb.from('invites').select('id, email, role, expires_at, token').eq('org_id', orgId).is('accepted_at', null));
  invites.forEach((i) => out.push({ id: `invite:${i.id}`, name: i.email.split('@')[0], initials: initials(i.email), email: i.email, role: i.role, title: i.role, status: 'invited', lastActive: null, inviteExpires: i.expires_at.slice(0, 10) }));
  return out;
}

export function can(permission, user = ctx?.user) {
  return !!user && roleCan(permission, user.role);
}

export async function getSession() {
  // Two-factor turned on but this session has not passed it yet: nothing loads
  // (the database returns no rows) until the code is entered.
  if (await mfaNeeded()) return { signedIn: true, mfaRequired: true, onboarded: false, userId: null, user: null, org: null };
  const c = await loadContext();
  if (!c) return { signedIn: false, onboarded: false, userId: null, user: null, org: null };
  return { signedIn: true, onboarded: !!c.org, userId: c.user.id, user: c.user, org: c.org };
}

// ---------------------------------------------------------------------------
// Auth (spec 4.12)

const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'That email and password do not match.'],
  [/email not confirmed/i, 'Verify your email first. Check your inbox for the link.'],
  [/password should (be at least|contain)/i, PASSWORD_RULE],
  [/rate limit/i, 'Too many attempts. Wait a minute and try again.'],
];
const authError = (error) => {
  const hit = AUTH_MESSAGES.find(([re]) => re.test(error.message));
  throw new Error(hit ? hit[1] : error.message);
};

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) authError(error);
  ctx = null;
  return (await loadContext()).user;
}

export async function signUp({ name, org, email, password }) {
  if (passwordProblem(password)) throw new Error(passwordProblem(password));
  const { error } = await sb.auth.signUp({ email, password, options: { data: { name, org }, emailRedirectTo: `${window.location.origin}/onboarding` } });
  if (error) authError(error);
  return { verify: true };
}

// Google sign-in (Supabase OAuth). Supabase redirects back with the session;
// the app's auth guard then sends people without an organisation to onboarding.
export async function signInWithProvider(provider, next = '/portfolio') {
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}${next}` } });
  if (error) throw new Error(error.message);
  return { signedIn: false };
}

export async function requestPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/sign-in?state=reset` });
  if (error) authError(error);
}

export async function resendVerification(email) {
  if (!email) throw new Error('Go back and create your account again to get a new link.');
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/onboarding` } });
  if (error) authError(error);
}

export async function updatePassword(password) {
  if (passwordProblem(password)) throw new Error(passwordProblem(password));
  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    if (/session|expired|jwt/i.test(error.message)) return { state: 'reset-expired' };
    authError(error);
  }
  return { ok: true };
}

export async function signInWithSso(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return { state: 'sso-not-configured' };
  const { data, error } = await sb.auth.signInWithSSO({ domain, options: { redirectTo: `${window.location.origin}/portfolio` } });
  if (error) return { state: /not found|no sso provider/i.test(error.message) ? 'sso-not-configured' : 'sso-error' };
  window.location.assign(data.url);
  return { state: 'redirecting' };
}

export async function signOut() { await sb.auth.signOut(); ctx = null; }

/** Ends the session on every device (all refresh tokens revoked). */
export async function signOutEverywhere() { await sb.auth.signOut({ scope: 'global' }); ctx = null; }

// ---------------------------------------------------------------------------
// Two-factor (authenticator app, TOTP)

async function mfaNeeded() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return false;
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return !error && data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
}

async function verifiedTotp() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) fail(error);
  return (data.totp || []).find((f) => f.status === 'verified') || null;
}

export async function getMfaStatus() {
  return { available: true, enabled: Boolean(await verifiedTotp()) };
}

/** Starts setup: returns the QR code (an SVG data URL) and the secret for manual entry. */
export async function startMfaSetup() {
  const { data: list } = await sb.auth.mfa.listFactors();
  // An abandoned earlier setup blocks a new one: clear it.
  for (const f of (list?.all || []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
    await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `AVA ${new Date().toISOString().slice(0, 10)}` });
  if (error) fail(error);
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

const CODE_ERROR = 'That code did not match. Check the time on your phone and use the newest code.';

export async function confirmMfaSetup(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  if (error) throw new Error(CODE_ERROR);
  ctx = null;
}

/** The sign-in step: upgrades this session with a code from the authenticator app. */
export async function verifyMfa(code) {
  const f = await verifiedTotp();
  if (!f) return;
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: String(code).trim() });
  if (error) throw new Error(CODE_ERROR);
  ctx = null;
}

export async function disableMfa() {
  const f = await verifiedTotp();
  if (!f) return;
  const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
  if (error) fail(error, 'Enter a fresh code first, then try again.');
  await sb.auth.refreshSession();
  ctx = null;
}

export async function completeOnboarding(answers) {
  const c = await loadContext();
  if (!c) throw new Error('Sign in to continue.');
  if (!c.org) {
    const { orgId } = await api('/orgs', { body: { name: answers.orgName || c.meta.org || 'My organisation', kind: answers.kind || 'VC fund' } });
    save(ORG_KEY, orgId);
  }
  ctx = null;
  const { org } = await need();
  const patch = { kind: answers.kind || org.kind, delivery: { ...org.delivery, email: answers.email || org.delivery.email } };
  if (answers.display) patch.finding_display = answers.display;
  if (answers.orgName) patch.name = answers.orgName;
  await rows(sb.from('organisations').update(patch).eq('id', org.id).select('id'));
  if (c.meta.name) await rows(sb.from('profiles').update({ name: c.meta.name, initials: initials(c.meta.name) }).eq('user_id', c.user.id).select('user_id'));
  ctx = null;
}

// ---------------------------------------------------------------------------
// Organisation and people

export async function getOrg() { return { ...(await need()).org }; }

const ORG_COLUMNS = { name: 'name', kind: 'kind', cadence: 'default_cadence', alertRules: 'alert_rules', delivery: 'delivery', currency: 'currency', branding: 'branding', findingDisplay: 'finding_display', retention: 'retention_period', region: 'storage_region', integrations: 'integrations', logoUrl: 'logo_url' };

export async function updateOrg(patch) {
  const { org } = await need();
  const update = {};
  Object.entries(patch).forEach(([k, v]) => { if (ORG_COLUMNS[k]) update[ORG_COLUMNS[k]] = v; });
  const out = await rows(sb.from('organisations').update(update).eq('id', org.id).select('*'));
  if (!out.length) fail({ message: 'permission denied' });
  ctx = null;
  return (await need()).org;
}

export async function getUsers() { const c = await need(); c.members = await loadMembers(c.org.id); return c.members.map((u) => ({ ...u })); }
export async function getCurrentUser() { return { ...(await need()).user }; }

export async function updateProfile(patch) {
  const { user } = await need();
  const update = {};
  if (patch.name !== undefined) { update.name = patch.name; update.initials = initials(patch.name, user.email); }
  if (patch.title !== undefined) update.title = patch.title;
  await rows(sb.from('profiles').update(update).eq('user_id', user.id).select('user_id'));
  ctx = null;
}

export async function actAs() { throw new Error('Viewing as another role is only available in the demo.'); }

export async function inviteMember(email, role) {
  const { org } = await need();
  await api('/invites', { body: { orgId: org.id, email, role } });
  return { email, role, status: 'invited' };
}
export async function changeRole(userId, role) {
  const { org } = await need();
  await api(`/orgs/${org.id}/members/${userId}`, { method: 'PATCH', body: { role } });
  ctx = null;
}
export async function removeMember(userId) {
  const { org } = await need();
  if (userId.startsWith('invite:')) {
    await rows(sb.from('invites').delete().eq('id', userId.slice(7)).select('id'));
    return;
  }
  await api(`/orgs/${org.id}/members/${userId}`, { method: 'DELETE' });
}
export async function transferOwnership(userId) {
  const { org } = await need();
  await api(`/orgs/${org.id}/transfer`, { body: { toUserId: userId } });
  ctx = null;
}
export async function getInvite(token) {
  try { return await api(`/invites/${token}`, { method: 'GET', auth: false }); } catch { return null; }
}
export async function acceptInvite(token) {
  const out = await api(`/invites/${token}/accept`);
  save(ORG_KEY, out.orgId);
  ctx = null;
  return out;
}

// ---------------------------------------------------------------------------
// Mapping database rows to the shared shapes

function mapCompany(c) {
  const extra = c.extra || {};
  return {
    id: c.id, title: c.title, description: c.description, industry: c.industry, country: c.country, city: c.city, model: c.model,
    target: c.target, type: c.type, dealLead: c.deal_lead, stage: c.stage, fund: c.fund, budget: c.budget,
    delivery: extra.delivery || '', price: extra.price || '', competitors: extra.competitors || '',
    cadence: { mode: 'inherit', paused: false, resumeOn: null, ...(c.cadence || {}), nextRun: c.next_run },
    scheduledAudit: c.scheduled_audit, coverage: c.coverage || [], openItems: c.open_items || [], todosDone: c.todos || {},
    updatedAt: c.updated_at,
  };
}

// The model behind an audit is internal: the database does not let users read it.
const AUDIT_FULL = 'id, org_id, company_id, date, status, trigger, depth, score, raw_score, exposure, cap, base_directive, final_directive, overridden, override, override_cited, override_rejected, score_excluding_dismissed, coverage, skipped_sections, orchestrator, prompt_version, calibration_version, snapshot_hash, source_ids, drift_flag, under_review, hold_resolution, counted_against_usage, first_checkpoint, final_checkpoint, outcome_window_version, run_state, run_seconds, started_at, finished_at, notify_on_complete, created_at';
const AUDIT_LIGHT = 'id, company_id, date, status, trigger, depth, score, base_directive, final_directive, exposure, overridden, calibration_version, under_review, created_at';

function mapAudit(a, findings = [], runs = []) {
  const counts = {};
  findings.forEach((f) => { counts[f.agent] = (counts[f.agent] || 0) + 1; });
  return {
    id: a.id, companyId: a.company_id, date: a.date, status: a.status, trigger: a.trigger, depth: a.depth || 'standard',
    calibrationVersion: a.calibration_version, findings, skippedSections: a.skipped_sections || [], sourceIds: a.source_ids || [],
    agentRuns: runs.map((r) => ({ agent: r.agent, status: r.status, duration: r.duration_s == null ? null : Math.round(Number(r.duration_s)), retries: r.retry_count, findings: counts[r.agent] || 0, error: r.error_reason, schema: r.schema_result, fallbackUsed: r.fallback_used })),
    orchestrator: a.orchestrator || null, runSeconds: a.run_seconds, exposure: a.exposure, raw: a.raw_score ?? null, cap: a.cap ?? null,
    score: a.score, baseDirective: a.base_directive, finalDirective: a.final_directive, overridden: !!a.overridden, override: a.override || null,
    overrideCited: a.override_cited || [], overrideRejected: a.override_rejected || null, coverage: a.coverage, countedAgainstUsage: a.counted_against_usage,
    snapshotHash: a.snapshot_hash, promptVersion: a.prompt_version, underReview: !!a.under_review, driftFlag: !!a.drift_flag,
    outcomeWindowVersion: a.outcome_window_version, firstCheckpoint: a.first_checkpoint, finalCheckpoint: a.final_checkpoint,
    createdAt: a.created_at,
    outcome: (a.run_state || {}).outcome || null, outcomeReason: (a.run_state || {}).reason || null,
  };
}

function mapFinding(f, comments = []) {
  return {
    id: f.id, auditId: f.audit_id, agent: f.agent, section: f.section, category: f.category, severity: f.severity, topic: f.topic,
    matchKey: f.match_key, title: f.title, text: f.text, sources: f.sources || [], status: f.status || 'open', owner: f.owner || null,
    dismissReason: f.dismiss_reason || null, history: f.history || [], firstSeenAudit: f.first_seen_audit || null,
    droppedCitations: f.dropped_citations || [],
    comments: comments.filter((c) => c.finding_id === f.id).map((c) => ({ at: c.created_at, by: c.author_name, text: c.text })),
  };
}

function mapSource(s) {
  return {
    id: s.id, companyId: s.company_id, type: s.type, title: s.title, kind: s.kind, date: s.date, reliability: s.reliability, note: s.note,
    url: s.url || undefined, retrieved: s.retrieval_date || undefined, addedBy: s.added_by, status: s.status, storagePath: s.storage_path,
  };
}

const issuedOnly = (list) => list.filter((a) => a.status === 'complete' || a.status === 'partial').sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));

// ---------------------------------------------------------------------------
// Companies

let firstCompanyId = null;
let firstAuditId = null;

async function alertState(orgId, userId) {
  const [reads, snoozes] = await Promise.all([
    rows(sb.from('alert_reads').select('alert_id').eq('user_id', userId)),
    rows(sb.from('alert_snoozes').select('company_id, until').eq('user_id', userId)),
  ]);
  return { read: new Set(reads.map((r) => r.alert_id)), snoozed: Object.fromEntries(snoozes.filter((s) => s.until > todayIso()).map((s) => [s.company_id, s.until])), orgId };
}

export async function getCompanies() {
  const { org, user } = await need();
  const [cs, as, ss, al, st] = await Promise.all([
    rows(sb.from('companies').select('*').eq('org_id', org.id).order('created_at')),
    rows(sb.from('audits').select(AUDIT_LIGHT).eq('org_id', org.id)),
    rows(sb.from('sources').select('id, company_id, type').eq('org_id', org.id)),
    rows(sb.from('alerts').select('id, company_id').eq('org_id', org.id)),
    alertState(org.id, user.id),
  ]);
  const audits = as.map((a) => mapAudit(a));
  const out = cs.map((c) => summarise(mapCompany(c), audits, ss, al, st));
  firstCompanyId = out[0]?.id || null;
  const latest = out.find((c) => c.latest);
  firstAuditId = latest ? latest.latest.id : null;
  return out;
}

function summarise(c, audits, sources, alerts, st) {
  const all = audits.filter((a) => a.companyId === c.id);
  const list = issuedOnly(all);
  const latest = list[list.length - 1] || null;
  const previous = list[list.length - 2] || null;
  return {
    ...c,
    auditCount: list.length,
    latest: latest && pickAudit(latest),
    previous: previous && pickAudit(previous),
    delta: latest && previous ? latest.score - previous.score : null,
    running: all.find((a) => a.status === 'running' || a.status === 'queued') || null,
    unreadAlerts: alerts.filter((x) => x.company_id === c.id && !st.read.has(x.id)).length,
    sourceCount: sources.filter((s) => s.company_id === c.id).length,
    fileCount: sources.filter((s) => s.company_id === c.id && s.type === 'uploaded').length,
  };
}

export async function getCompany(id) {
  const { org, user } = await need();
  const c = await row(sb.from('companies').select('*').eq('id', id).maybeSingle());
  if (!c) return null;
  const [as, ss, al, st] = await Promise.all([
    rows(sb.from('audits').select(AUDIT_LIGHT).eq('company_id', id)),
    rows(sb.from('sources').select('id, company_id, type').eq('company_id', id)),
    rows(sb.from('alerts').select('id, company_id').eq('company_id', id)),
    alertState(org.id, user.id),
  ]);
  const mapped = mapCompany(c);
  return { ...summarise(mapped, as.map((a) => mapAudit(a)), ss, al, st), todos: mapped.openItems.map((t) => ({ ...t, done: !!mapped.todosDone[t.id] })) };
}

export async function toggleTodo(companyId, todoId) {
  const c = await row(sb.from('companies').select('todos').eq('id', companyId).single());
  const todos = { ...(c.todos || {}), [todoId]: !(c.todos || {})[todoId] };
  await rows(sb.from('companies').update({ todos }).eq('id', companyId).select('id'));
}

export async function updateCompany(id, patch) {
  const { org } = await need();
  const update = {};
  const map = { title: 'title', description: 'description', industry: 'industry', country: 'country', city: 'city', model: 'model', target: 'target', type: 'type', dealLead: 'deal_lead', stage: 'stage', fund: 'fund', budget: 'budget', scheduledAudit: 'scheduled_audit' };
  Object.entries(patch).forEach(([k, v]) => { if (map[k]) update[map[k]] = v; });
  if (patch.cadence) {
    const { mode, paused, resumeOn } = patch.cadence;
    update.cadence = { mode, paused: !!paused, resumeOn: resumeOn || null };
    update.next_run = computeNextRun({ cadence: update.cadence }, org);
  }
  update.updated_at = new Date().toISOString();
  const out = await rows(sb.from('companies').update(update).eq('id', id).select('id'));
  if (!out.length) fail({ message: 'permission denied' });
  return getCompany(id);
}

export function effectiveCadence(c, org = ctx?.org) {
  return c.cadence.mode === 'inherit' ? (org?.cadence?.mode || 'quarterly') : c.cadence.mode;
}

// ---------------------------------------------------------------------------
// Audits

async function auditsWithFindings(filter) {
  const as = await rows(filter(sb.from('audits').select(AUDIT_FULL)));
  if (!as.length) return [];
  const ids = as.map((a) => a.id);
  const [fs, runs] = await Promise.all([
    rows(sb.from('findings').select('*').in('audit_id', ids).order('position')),
    rows(sb.from('agent_runs').select('audit_id, agent, status, duration_s, retry_count, error_reason, schema_result, fallback_used').in('audit_id', ids).order('agent')),
  ]);
  const cs = fs.length ? await rows(sb.from('comments').select('finding_id, author_name, text, created_at').in('finding_id', fs.map((f) => f.id)).order('created_at')) : [];
  return as.map((a) => mapAudit(a, fs.filter((f) => f.audit_id === a.id).map((f) => mapFinding(f, cs)), runs.filter((r) => r.audit_id === a.id)));
}

export async function getAudits(companyId) {
  const list = await auditsWithFindings((q) => q.eq('company_id', companyId));
  return list.sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getAudit(id) {
  const a = await row(sb.from('audits').select('company_id').eq('id', id).maybeSingle());
  if (!a) return null;
  const [company, all, sources, links] = await Promise.all([
    row(sb.from('companies').select('*').eq('id', a.company_id).single()),
    getAudits(a.company_id),
    rows(sb.from('sources').select('*').eq('company_id', a.company_id)),
    rows(sb.from('share_links').select('token, audit_id, recipient_email, expires_at, has_password, revoked, created_by, created_at, share_views(viewed_at)').eq('audit_id', id)),
  ]);
  const audit = all.find((x) => x.id === id);
  const out = enrichAudit(audit, { company: mapCompany(company), sources: sources.map(mapSource), issued: issuedOnly(all) });
  out.shareLinks = links.map((l) => ({ token: l.token, auditId: l.audit_id, email: l.recipient_email, expires: l.expires_at, passwordSet: l.has_password, revoked: l.revoked, views: (l.share_views || []).map((v) => ({ at: v.viewed_at })), createdAt: l.created_at }));
  return out;
}

export async function getLatestAuditId(companyId) {
  const list = issuedOnly((await rows(sb.from('audits').select(AUDIT_LIGHT).eq('company_id', companyId))).map((a) => mapAudit(a)));
  return list.length ? list[list.length - 1].id : null;
}

async function ensureCompany(input, org) {
  const fields = ['title', 'description', 'industry', 'country', 'city', 'model', 'target', 'type'];
  if (input.companyId) {
    if (input.title) {
      const current = await row(sb.from('companies').select('*').eq('id', input.companyId).single());
      const update = {};
      fields.forEach((k) => { if (input[k] !== undefined && String(input[k]).trim() !== String(current[k] || '')) update[k] = String(input[k]).trim(); });
      if (Object.keys(update).length) await rows(sb.from('companies').update({ ...update, updated_at: new Date().toISOString() }).eq('id', input.companyId).select('id'));
    }
    return input.companyId;
  }
  const { user } = await need();
  const insert = { org_id: org.id, deal_lead: user.name, stage: input.stage || '', budget: input.budget || '', created_by: user.id, extra: { delivery: input.delivery || '', price: input.price || '', competitors: input.competitors || '' } };
  fields.forEach((k) => { insert[k] = String(input[k] || '').trim(); });
  insert.type = insert.type || 'startup';
  const created = await rows(sb.from('companies').insert(insert).select('id'));
  return created[0].id;
}

export async function runAudit(input) {
  const { org } = await need();
  const companyId = await ensureCompany(input, org);
  if (input.files && input.files.length) await uploadFiles(companyId, input.files, { quiet: true });
  const out = await api('/audits', { body: { companyId, notify: !!input.notify, depth: input.depth === 'deep' ? 'deep' : 'standard' } });
  // A plan limit (402) or thin input (422) comes back as a state, not an audit.
  if (out.state) { const e = new Error(out.error); e.code = out.state; throw e; }
  return { auditId: out.auditId, companyId };
}

export async function notifyOnComplete(auditId) { await api(`/audits/${auditId}/notify`); }

// The running screen polls getRun. While it is open, this tab also advances
// the audit one agent at a time; the scheduled job does the same every minute,
// so closing the tab never stops an audit.
const driving = new Set();
async function drive(id) {
  if (driving.has(id)) return;
  driving.add(id);
  try {
    for (let i = 0; i < 20; i += 1) {
      const st = await api(`/audits/${id}/advance`);
      if (['complete', 'partial', 'failed'].includes(st.audit.status)) break;
    }
  } catch { /* the scheduled job picks it up */ } finally { driving.delete(id); }
}

const TYPICAL_AGENT_SECONDS = 45;

export async function getRun(id) {
  const a = await row(sb.from('audits').select(AUDIT_FULL).eq('id', id).maybeSingle());
  if (!a) return null;
  const done = ['complete', 'partial', 'failed'].includes(a.status);
  const runs = await rows(sb.from('agent_runs').select('agent, status, retry_count, error_reason, duration_s, started_at').eq('audit_id', id).order('agent'));
  if (!done) drive(id);
  const now = Date.now();
  const agents = AGENTS.map((ag) => {
    const r = runs.find((x) => x.agent === ag.n) || { status: 'queued', retry_count: 0 };
    if (r.status === 'complete' || r.status === 'skipped') return { n: ag.n, name: ag.name, state: 'complete', duration: Number(r.duration_s || 0), retried: r.retry_count > 0 };
    if (r.status === 'failed') return { n: ag.n, name: ag.name, state: 'failed', error: r.error_reason || 'No valid report on both attempts.' };
    if (r.status === 'working') {
      const t = r.started_at ? (now - new Date(r.started_at).getTime()) / 1000 : 0;
      return { n: ag.n, name: ag.name, state: r.retry_count > 0 ? 'retrying' : 'working', progress: Math.min(0.95, t / TYPICAL_AGENT_SECONDS) };
    }
    if (r.retry_count > 0) return { n: ag.n, name: ag.name, state: 'retrying', progress: 0 };
    return { n: ag.n, name: ag.name, state: 'queued' };
  });
  const start = new Date(a.started_at || a.created_at).getTime();
  const elapsed = Math.max(0, ((a.finished_at ? new Date(a.finished_at).getTime() : now) - start) / 1000);
  const fs = await rows(sb.from('findings').select('*').eq('audit_id', id));
  const sev = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const preview = fs.map((f) => mapFinding(f)).sort((x, y) => sev[y.severity] - sev[x.severity]).slice(0, 6);
  return { audit: mapAudit(a), done, elapsed, total: done ? elapsed : Math.max(elapsed, AGENTS.length * TYPICAL_AGENT_SECONDS), agents, preview };
}

export async function setRunDebug() { return false; }

// ---------------------------------------------------------------------------
// Finding workflow

export async function setFindingStatus(_auditId, findingId, status, reason = '') {
  if (status === 'dismissed' && !reason.trim()) throw new Error('A reason is required to dismiss a finding.');
  await api(`/findings/${findingId}/status`, { body: { status, reason: reason.trim() || null } });
}
export async function setFindingOwner(_auditId, findingId, owner) { await api(`/findings/${findingId}/owner`, { body: { owner: owner || null } }); }
export async function addComment(_auditId, findingId, text) { await api(`/findings/${findingId}/comments`, { body: { text: text.trim() } }); }

// ---------------------------------------------------------------------------
// Sources and data room

export async function getSources(companyId) {
  const [ss, audits] = await Promise.all([rows(sb.from('sources').select('*').eq('company_id', companyId).order('created_at')), getAudits(companyId)]);
  const issued = issuedOnly(audits);
  return ss.map((s) => ({
    ...mapSource(s),
    citedBy: issued.flatMap((a) => a.findings.filter((f) => f.sources.includes(s.id)).map((f) => ({ auditId: a.id, auditDate: a.date, id: f.id, title: f.title, severity: f.severity, agent: f.agent, section: f.section, latest: a === issued[issued.length - 1] }))),
  }));
}

// Text the agents read, extracted in the browser: PDFs with pdf.js, Word,
// PowerPoint and Excel with the Office reader (both loaded only when needed),
// text formats directly. Legacy .doc/.ppt/.xls and scanned PDFs are stored
// but contribute no text.
async function extractText(file) {
  const name = file.name.toLowerCase();
  if (/\.(txt|csv|md|json)$/.test(name)) return (await file.text()).slice(0, 400000);
  if (/\.(docx|pptx|xlsx)$/.test(name)) return (await import('../lib/office-text.js')).officeText(file);
  if (name.endsWith('.pdf')) {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 150); i += 1) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push(tc.items.map((it) => it.str).join(' '));
    }
    return pages.join('\n\n').slice(0, 400000);
  }
  return '';
}

const NO_TEXT = 'Stored, but no text could be read. Save it as PDF, .docx, .pptx or .xlsx (scanned PDFs need a text layer) and upload again so the agents can cite it.';

export async function uploadFiles(companyId, files) {
  const { org } = await need();
  const added = [];
  for (const file of files) {
    const safe = file.name.replace(/[^\w.-]+/g, '_');
    const path = `${org.id}/${companyId}/${Date.now()}-${safe}`;
    if (typeof file.arrayBuffer === 'function') {
      const { error } = await sb.storage.from('data-room').upload(path, file, { upsert: false });
      if (error) fail(error, `Could not upload ${file.name}.`);
    }
    let text = '';
    try { text = typeof file.arrayBuffer === 'function' ? await extractText(file) : ''; } catch { text = ''; }
    const out = await api(`/data-room/${companyId}/files`, { body: { title: file.name.replace(/\.[^.]+$/, ''), kind: kindOf(file.name), storagePath: path, extract: text } });
    added.push({ id: out.sourceId, companyId, type: 'uploaded', title: file.name.replace(/\.[^.]+$/, ''), kind: kindOf(file.name), date: todayIso(), reliability: 'Unrated', note: out.extracted ? 'Uploaded to the data room. Read before the next audit.' : NO_TEXT, status: 'read', size: file.size || 0 });
  }
  return added;
}

// ---------------------------------------------------------------------------
// Alerts

export async function getAlerts() {
  const { org, user } = await need();
  const [al, st, cs] = await Promise.all([
    rows(sb.from('alerts').select('*').eq('org_id', org.id).order('date', { ascending: false }).limit(500)),
    alertState(org.id, user.id),
    rows(sb.from('companies').select('id, title').eq('org_id', org.id)),
  ]);
  const ids = [...new Set(al.flatMap((x) => [x.finding_id, ...(x.anchoring_finding_ids || [])]).filter(Boolean))];
  const fs = ids.length ? await rows(sb.from('findings').select('id, title, category').in('id', ids)) : [];
  const fById = Object.fromEntries(fs.map((f) => [f.id, f]));
  const title = Object.fromEntries(cs.map((c) => [c.id, c.title]));
  return al.map((x) => ({
    id: x.id, companyId: x.company_id, auditId: x.audit_id, previousAuditId: x.previous_audit_id, fromScore: x.from_score, toScore: x.to_score,
    fromDirective: x.from_directive, toDirective: x.to_directive, trigger: x.trigger, causedByOverride: x.caused_by_override,
    anchoringFindingIds: x.anchoring_finding_ids || [], findingId: x.finding_id, detail: x.detail, date: x.date, emailedAt: x.emailed_at,
    read: st.read.has(x.id), snoozedUntil: st.snoozed[x.company_id] || null, snoozed: !!st.snoozed[x.company_id],
    company: title[x.company_id], findingTitle: fById[x.finding_id]?.title || null, findingCategory: fById[x.finding_id]?.category || null,
    anchors: (x.anchoring_finding_ids || []).map((id) => fById[id]?.title).filter(Boolean),
  }));
}

export async function markAlertRead(id, read = true) {
  const { user } = await need();
  if (read) await rows(sb.from('alert_reads').upsert({ alert_id: id, user_id: user.id }).select('alert_id'));
  else await rows(sb.from('alert_reads').delete().eq('alert_id', id).eq('user_id', user.id).select('alert_id'));
}
export async function markAllAlertsRead() {
  const { org, user } = await need();
  const al = await rows(sb.from('alerts').select('id').eq('org_id', org.id));
  if (al.length) await rows(sb.from('alert_reads').upsert(al.map((x) => ({ alert_id: x.id, user_id: user.id }))).select('alert_id'));
}
export async function snoozeCompany(companyId, days = 7) {
  const { org, user } = await need();
  await rows(sb.from('alert_snoozes').upsert({ org_id: org.id, user_id: user.id, company_id: companyId, until: addDays(todayIso(), days) }).select('company_id'));
}
export async function unsnoozeCompany(companyId) {
  const { user } = await need();
  await rows(sb.from('alert_snoozes').delete().eq('user_id', user.id).eq('company_id', companyId).select('company_id'));
}
export async function unreadAlertCount() {
  return (await getAlerts()).filter((a) => !a.read && !a.snoozed).length;
}

// ---------------------------------------------------------------------------
// Outcomes

export async function getOutcomeRows() {
  const { org } = await need();
  const [as, os, cs] = await Promise.all([
    rows(sb.from('audits').select(AUDIT_FULL).eq('org_id', org.id).in('status', ['complete', 'partial'])),
    rows(sb.from('outcomes').select('*').eq('org_id', org.id)),
    rows(sb.from('companies').select('id, title, type').eq('org_id', org.id)),
  ]);
  const today = todayIso();
  return as.map((r) => {
    const a = mapAudit(r);
    const o = os.find((x) => x.audit_id === a.id);
    const outcome = o ? { auditId: o.audit_id, result: o.result, date: o.outcome_date, evidence: o.evidence, checkpoint: o.checkpoint, loggedBy: o.logged_by, loggedAt: o.logged_at } : null;
    const c = cs.find((x) => x.id === a.companyId) || {};
    return {
      auditId: a.id, companyId: a.companyId, company: c.title, type: c.type, date: a.date, score: a.score, finalDirective: a.finalDirective,
      firstCheckpoint: a.firstCheckpoint, finalCheckpoint: a.finalCheckpoint, outcomeWindowVersion: a.outcomeWindowVersion,
      outcome, status: outcomeStatus(a, outcome, today),
    };
  }).sort((x, y) => x.date.localeCompare(y.date));
}

export async function logOutcome(auditId, { result, date, evidence }) {
  if (result === 'exited' && evidence?.belowLastValuation) throw new Error('An acquisition below the last valuation is logged as Written down or distressed sale.');
  const a = await row(sb.from('audits').select('final_checkpoint').eq('id', auditId).single());
  await api('/outcomes', { body: { auditId, result, date, evidence, checkpoint: a.final_checkpoint && date >= a.final_checkpoint ? 'final' : 'first' } });
}

// ---------------------------------------------------------------------------
// Sharing

export async function createShareLink(auditId, { email, expiryDays = 14, password = '' }) {
  const out = await api('/share', { body: { auditId, email, days: Number(expiryDays), password: password || null } });
  return { token: out.token, url: out.url, auditId, email, expires: out.expiresAt, passwordSet: !!password, revoked: false, views: [] };
}
export async function revokeShareLink(token) { await api(`/share/${token}/revoke`); }

export async function openSharedReport(token, password = '') {
  const r = await api(`/shared/${token}`, { body: { password: password || null }, auth: false });
  if (r.state !== 'ok') return r;
  const company = { ...r.company, id: r.audit.company_id };
  const findings = r.findings.map((f) => mapFinding({ ...f, audit_id: r.audit.id, owner: null, history: [], dismiss_reason: null }));
  const audit = mapAudit({ ...r.audit, company_id: company.id }, findings);
  const sources = r.sources.map((s) => mapSource({ ...s, company_id: company.id }));
  return { state: 'ok', link: r.link, audit: enrichAudit(audit, { company, sources, issued: [audit] }) };
}

// ---------------------------------------------------------------------------
// Import

export async function existingTitles() {
  const { org } = await need();
  return (await rows(sb.from('companies').select('title').eq('org_id', org.id))).map((c) => c.title.toLowerCase());
}

export async function importCompanies(rowsIn, { fileName, cadence = null, auditAll = false }) {
  const { org } = await need();
  const out = await api('/import', { body: { orgId: org.id, file: fileName, rows: rowsIn, auditAll } });
  if (cadence && out.created.length) {
    await rows(sb.from('companies').update({ cadence: { mode: cadence, paused: false, resumeOn: null }, next_run: computeNextRun({ cadence: { mode: cadence } }, org) }).in('id', out.created).select('id'));
  }
  return { job: { file: fileName, rowsValid: out.created.length, rejected: out.rejected, auditAll }, created: out.created.map((id) => ({ id })) };
}

// ---------------------------------------------------------------------------
// Free audit

export function checkWorkEmail(email) { return checkEmailFormat(email); }

export async function runFreeAudit(input, { onProgress = () => {} } = {}) {
  const check = checkWorkEmail(input.email);
  if (!check.ok) throw new Error(check.reason);
  const company = { title: input.title.trim(), description: input.description.trim(), industry: input.industry, country: input.country.trim() };
  const { id } = await api('/free-audit', { body: { email: input.email.trim(), company, turnstileToken: input.turnstileToken || '' }, auth: false });
  for (let i = 0; i < 30; i += 1) {
    const st = await api(`/free-audit/${id}/advance`, { auth: false });
    onProgress(Math.min(AGENTS.length - 1, st.agents.filter((x) => x.status === 'complete' || x.status === 'failed').length));
    if (['complete', 'partial', 'failed'].includes(st.audit.status)) break;
  }
  const r = await api(`/free-audit/${id}`, { method: 'GET', auth: false });
  if (r.status === 'failed') {
    throw new Error(r.reason
      ? `No score issued. ${r.reason} This did not use up your free audit; add the detail and run it again.`
      : 'The audit could not finish. You have not used your free audit; try again later.');
  }
  return { id, inputs: input, status: r.status, score: r.score, directive: r.directive, top: r.top, locked: r.locked, prototype: false };
}

export async function sendFreeAudit(id, to) { await api(`/free-audit/${id}/send`, { body: { to }, auth: false }); }

// ---------------------------------------------------------------------------
// Audit log and exports

export async function getAuditLog() {
  const { org } = await need();
  return (await rows(sb.from('audit_log').select('*').eq('org_id', org.id).order('at', { ascending: false }).limit(500)))
    // Share and invite entries are keyed by their token: show a stub, never a working link.
    .map((e) => ({ at: e.at, who: e.who, action: e.action, object: e.object_type,
      objectId: ['share_links', 'invites'].includes(e.object_type) && e.object_id ? `${String(e.object_id).slice(0, 4)}…` : e.object_id, detail: e.detail }));
}

// ---------------------------------------------------------------------------
// Billing (Stripe) and your data

export async function getBilling() {
  const { org } = await need();
  return api(`/billing/${org.id}`, { method: 'GET' });
}

/** Sends the browser to Stripe Checkout (or the portal when a subscription is live). */
export async function startCheckout(plan) {
  const { org } = await need();
  const { url } = await api(`/billing/${org.id}/checkout`, { body: { plan } });
  window.location.assign(url);
}

export async function openBillingPortal() {
  const { org } = await need();
  const { url } = await api(`/billing/${org.id}/portal`);
  window.location.assign(url);
}

export async function exportOrgData() {
  const { org } = await need();
  return api(`/orgs/${org.id}/export`, { method: 'GET' });
}

export async function deleteOrganisation(confirm) {
  const { org } = await need();
  await api(`/orgs/${org.id}`, { method: 'DELETE', body: { confirm } });
  await signOut();
}

export async function deleteAccount(confirm) {
  await api('/me', { method: 'DELETE', body: { confirm } });
  await signOut();
}

export async function recordExport(auditId, detail) {
  if (auditId && auditId !== 'portfolio') await api(`/audits/${auditId}/export`, { body: { detail } });
}

export async function resetDemo() {}

// Fallbacks for screens opened without a company or audit in the URL: the
// first company in the portfolio and its latest audit.
export const SAMPLE = {
  get companyId() { return firstCompanyId; },
  get auditId() { return firstAuditId; },
};
export { AGENTS, SECTIONS, CATEGORIES };
