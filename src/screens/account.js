import { html } from '../lib/html.js';
import { BUSINESS, PLANS, TRIAL, contactHref } from '../content/business.js';
import { planId } from '../data/shared.js';
import {
  getOrg, updateOrg, getUsers, getCurrentUser, updateProfile, inviteMember, changeRole, removeMember, actAs,
  getAuditLog, getCompanies, can, signOut, resetDemo, transferOwnership, MODE,
} from '../data/repo.js';
import { fmtDate, fmtDateTime, emptyState, initials } from '../components/ui.js';
import { openSheet, toast } from '../components/sheet.js';

const TABS = [['profile', 'Profile'], ['org', 'Organisation'], ['team', 'Team and roles'], ['billing', 'Billing and usage'], ['log', 'Audit log'], ['brand', 'White-label reports']];
const ROLES = ['Admin', 'Analyst', 'Viewer'];
const ROLE_NOTE = {
  Owner: 'Billing, members, settings, audits, findings, comments, export',
  Admin: 'Members, settings, audits, findings, comments, export',
  Analyst: 'Create companies, import, run audits, upload, change findings, comment, export',
  Viewer: 'Read reports, comment, export and share',
};

function profile(me) {
  return html`<form class="card card-pad stack-lg" data-profile>
  <h2 class="card-title">Profile</h2>
  <div class="row-actions"><span class="avatar ac-avatar" aria-hidden="true">${me.initials}</span><span class="small muted">${me.role} · last active ${fmtDate(me.lastActive)}</span></div>
  <div class="grid-2">
    <div class="fld"><label for="p-name">Full name</label><input id="p-name" class="inp" name="name" value="${me.name}" autocomplete="name"></div>
    <div class="fld"><label for="p-title">Job title</label><input id="p-title" class="inp" name="title" value="${me.title}"></div>
    <div class="fld"><label for="p-email">Work email</label><input id="p-email" type="email" class="inp" name="email" value="${me.email}" autocomplete="email"></div>
  </div>
  <div class="row-actions"><button type="submit" class="btn btn-primary">Save changes</button><button type="button" class="btn" data-signout>Sign out</button>${MODE === 'mock' ? html`<button type="button" class="btn" data-reset>Reset demo data</button>` : ''}</div>
</form>`;
}

function org(o, users, me) {
  const owner = me.role === 'Owner';
  const disabled = can('settings', me) ? '' : html` disabled`;
  return html`<form class="card card-pad stack-lg" data-org>
  <h2 class="card-title">Organisation</h2>
  <div class="grid-2">
    <div class="fld"><label for="o-name">Organisation name</label><input id="o-name" class="inp" name="name" value="${o.name}"${disabled}></div>
    <div class="fld"><label for="o-kind">Organisation type</label><select id="o-kind" class="inp" name="kind"${disabled}>${['VC fund', 'Corporate venture or development', 'Accelerator'].map((k) => html`<option${o.kind === k ? html` selected` : ''}>${k}</option>`)}</select></div>
    <div class="fld"><label for="o-cad">Default monitoring cadence</label><select id="o-cad" class="inp" name="cadence"${disabled}>${[['off', 'Off'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly (default)']].map(([k, l]) => html`<option value="${k}"${o.cadence.mode === k ? html` selected` : ''}>${l}</option>`)}</select></div>
    <div class="fld"><label for="o-day">Day of month to run</label><input id="o-day" type="number" min="1" max="28" class="inp" name="day" value="${o.cadence.day}"${disabled}></div>
    <div class="fld"><label for="o-cur">Currency</label><select id="o-cur" class="inp" name="currency"${disabled}>${['GBP', 'EUR', 'USD'].map((k) => html`<option${o.currency === k ? html` selected` : ''}>${k}</option>`)}</select></div>
    <div class="fld"><label for="o-reg">Storage region</label><select id="o-reg" class="inp" name="region"${disabled}>${['United Kingdom', 'European Union', 'United States'].map((k) => html`<option${o.region === k ? html` selected` : ''}>${k}</option>`)}</select></div>
    <div class="fld"><span class="fld-label">Data retention period</span><span class="inp ac-static">${o.retention}</span></div>
    <div class="fld"><span class="fld-label">Score-move alert threshold</span><span class="inp ac-static">5 points</span></div>
  </div>
  <p class="hint">Type sets the defaults for new companies, report wording and alert rules. Companies inherit the cadence unless they override it.</p>
  ${can('settings', me) ? html`<div><button type="submit" class="btn btn-primary">Save changes</button></div>` : html`<p class="hint">Only Owners and Admins can change organisation settings.</p>`}
</form>
${owner ? html`<section class="card card-pad stack-md ac-danger" aria-labelledby="danger-title">
  <h2 id="danger-title" class="card-title">Owner actions</h2>
  <form class="row-actions" data-transfer><label class="sr-only" for="o-new-owner">New owner</label><select id="o-new-owner" class="inp ac-inline">${users.filter((u) => u.status === 'active' && u.id !== me.id).map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select><button type="submit" class="btn">Transfer ownership</button></form>
  <div class="row-actions"><button type="button" class="btn ac-delete" data-delete-org>Delete organisation</button><span class="hint">Permanently deletes every company, audit, file and member within 90 days, as set out in our privacy policy.</span></div>
</section>` : ''}`;
}

function team(users, me) {
  const manage = can('members', me);
  const active = users.filter((u) => u.status !== 'removed');
  return html`<section class="card card-pad stack-lg" aria-labelledby="team-title">
  <div class="r-sec-head"><h2 id="team-title" class="card-title">Team and roles</h2><span class="small muted">${active.filter((u) => u.status === 'active').length} active ${active.filter((u) => u.status === 'active').length === 1 ? 'member' : 'members'}</span></div>
  ${manage ? html`<form class="ac-invite" data-invite novalidate>
    <div class="fld"><label for="inv-email">Invite by work email</label><input id="inv-email" type="email" class="inp" name="email" autocomplete="off" aria-describedby="inv-err"></div>
    <div class="fld"><label for="inv-role">Role</label><select id="inv-role" class="inp" name="role">${ROLES.map((r) => html`<option${r === 'Analyst' ? html` selected` : ''}>${r}</option>`)}</select></div>
    <button type="submit" class="btn btn-primary">Send invite</button>
    <span class="err" id="inv-err" data-inv-err></span>
  </form>` : html`<p class="hint">Only Owners and Admins can manage members.</p>`}
  <div class="scroll-x"><div class="ac-table" role="table" aria-label="Members">
    <div class="ac-row lbl" role="row"><span role="columnheader">Member</span><span role="columnheader">Role</span><span role="columnheader">Status</span><span role="columnheader"><span class="sr-only">Actions</span></span></div>
    ${active.map((u) => html`<div class="ac-row ac-member" role="row">
      <span role="cell" class="row-actions"><span class="avatar ac-mini" aria-hidden="true">${u.initials || initials(u.name)}</span><span class="stack-sm"><b>${u.name}${u.id === me.id ? ' (you)' : ''}</b><span class="xsmall muted">${u.email}</span></span></span>
      <span role="cell">${manage && u.role !== 'Owner' ? html`<label class="sr-only" for="role-${u.id}">Role for ${u.name}</label><select id="role-${u.id}" class="inp ac-inline" data-role="${u.id}">${ROLES.map((r) => html`<option${r === u.role ? html` selected` : ''}>${r}</option>`)}</select>` : html`<span class="small">${u.role}</span>`}</span>
      <span role="cell"><span class="tag ${u.status === 'active' ? 'v-proceed verdict' : 'sev-medium'}">${u.status === 'active' ? 'ACTIVE' : 'INVITED'}</span>${u.inviteExpires ? html`<span class="xsmall muted"> expires ${fmtDate(u.inviteExpires)}</span>` : ''}</span>
      <span role="cell">${manage && u.role !== 'Owner' ? html`<button type="button" class="btn ac-small" data-remove="${u.id}" aria-label="Remove ${u.name}">Remove</button>` : ''}</span>
    </div>`)}
  </div></div>
  <div class="inner stack-sm small">
    <b>What each role can do</b>
    ${Object.entries(ROLE_NOTE).map(([r, n]) => html`<div class="kv"><span>${r}</span><span class="muted">${n}</span></div>`)}
    <span class="muted">External guests see one shared report only. Permissions are enforced server-side in the live product.</span>
  </div>
  ${MODE === 'mock' ? html`<div class="fld ac-viewas"><label for="view-as">Demo only: view the app as</label><select id="view-as" class="inp" data-view-as>${users.filter((u) => u.status === 'active').map((u) => html`<option value="${u.id}"${u.id === me.id ? html` selected` : ''}>${u.name} (${u.role})</option>`)}</select></div>` : ''}
</section>`;
}

function billing(o, companies, users, audits) {
  const pid = planId(o.plan);
  const plan = pid === 'trial' ? { ...TRIAL, price: 'Free', unit: 'trial', for: o.trialEndsAt ? `Your trial ends on ${fmtDate(o.trialEndsAt.slice(0, 10))}. Choose a plan any time to keep going.` : 'Choose a plan any time to keep going.' } : (PLANS.find((p) => p.id === pid) || null);
  const seatsUsed = users.filter((u) => u.status === 'active').length;
  const changeHref = contactHref(BUSINESS.billingEmail, '/pricing', 'AVA plan change');
  return html`<div class="ac-bill">
  <div class="hero-panel ac-plan">
    <div class="stars" aria-hidden="true"></div>
    <div class="r-sec-head"><span class="lbl">Plan</span><span class="tag tag-on-hero">${plan ? plan.name : o.plan}</span></div>
    <div class="row-actions"><span class="hero-num">${plan ? plan.price : companies.length}</span><span class="r-of">${plan ? plan.unit : 'monitored companies'}</span></div>
    <span class="small">${o.renewal ? `Renews ${o.renewal}. ` : ''}${plan ? plan.for : 'Plan details are agreed with your organisation.'}</span>
  </div>
  <div class="card card-pad stack-sm">
    <h2 class="card-title">${pid === 'trial' ? 'Trial usage' : 'Usage this month'}</h2>
    <div class="kv"><span class="muted">Audits${pid === 'trial' ? ' in your trial' : ''}</span><b>${audits.counted}${plan && plan.audits != null ? ` of ${plan.audits}` : ''} counted · ${audits.failed} not counted</b></div>
    <div class="kv"><span class="muted">Seats</span><b>${seatsUsed}${plan ? ` of ${plan.seats}` : ''}</b></div>
    <div class="kv"><span class="muted">Monitored companies</span><b>${companies.length}</b></div>
    <p class="hint">Audits that issue no score, failed or declined, never count towards your allowance.</p>
    <div class="row-actions">${pid === 'trial' ? html`<a class="btn btn-primary" href="/pricing">Choose a plan</a>` : html`<a class="btn" href="${changeHref}"${BUSINESS.billingEmail ? html` data-external` : ''}>${BUSINESS.billingEmail ? 'Contact us to change plan' : 'Compare plans'}</a>`}</div>
  </div>
  <div class="card card-pad stack-sm">
    <h2 class="card-title">Invoices</h2>
    <p class="muted small">Invoices appear here once your subscription starts.</p>
  </div>
</div>`;
}

function auditLog(log, ctx, users) {
  const who = ctx.query.get('who') || '';
  const act = ctx.query.get('act') || '';
  const from = ctx.query.get('from') || '';
  const to = ctx.query.get('to') || '';
  const list = log.filter((l) => (!who || l.who === who) && (!act || l.action.startsWith(act)) && (!from || l.at.slice(0, 10) >= from) && (!to || l.at.slice(0, 10) <= to));
  const actions = [...new Set(log.map((l) => l.action.split('.')[0]))];
  return html`<section class="card card-pad stack-md" aria-labelledby="log-title">
  <div class="r-sec-head"><h2 id="log-title" class="card-title">Audit log</h2><button type="button" class="btn" data-csv>Export CSV</button></div>
  <form class="ac-filters" data-log-filter>
    <div class="fld"><label for="lf-who">User</label><select id="lf-who" class="inp" name="who"><option value="">Everyone</option>${[...new Set([...users.map((u) => u.name), 'AVA'])].map((n) => html`<option${n === who ? html` selected` : ''}>${n}</option>`)}</select></div>
    <div class="fld"><label for="lf-act">Action</label><select id="lf-act" class="inp" name="act"><option value="">All actions</option>${actions.map((a) => html`<option value="${a}"${a === act ? html` selected` : ''}>${a}</option>`)}</select></div>
    <div class="fld"><label for="lf-from">From</label><input id="lf-from" type="date" class="inp" name="from" value="${from}"></div>
    <div class="fld"><label for="lf-to">To</label><input id="lf-to" type="date" class="inp" name="to" value="${to}"></div>
  </form>
  ${list.length ? html`<div class="scroll-x"><div class="ac-table ac-log" role="table" aria-label="Audit log">
    <div class="ac-row lbl" role="row"><span role="columnheader">When</span><span role="columnheader">Who</span><span role="columnheader">Action</span></div>
    ${list.map((l) => html`<div class="ac-row" role="row"><span role="cell" class="small">${fmtDateTime(l.at)}</span><span role="cell" class="small strong">${l.who}</span><span role="cell" class="small">${l.detail}</span></div>`)}
  </div></div>` : html`<p class="hint">No events match these filters.</p>`}
</section>`;
}

function brand(o, me) {
  const b = o.branding;
  const dis = can('settings', me) ? '' : html` disabled`;
  return html`<div class="ac-brand">
  <form class="card card-pad stack-lg" data-brand>
    <h2 class="card-title">White-label reports</h2>
    <div class="row-actions"><div class="stack-sm ac-grow"><b>Organisation logo</b><span class="hint">SVG or PNG. Used on every exported report.</span></div><label class="btn" for="b-logo">Upload logo</label><input id="b-logo" type="file" accept=".svg,.png" class="sr-only" data-logo${dis}></div>
    <div class="fld"><label for="b-name">Name on report cover</label><input id="b-name" class="inp" name="coverName" value="${b.coverName}"${dis}></div>
    <div class="fld"><label for="b-foot">Footer text</label><input id="b-foot" class="inp" name="footer" value="${b.footer}"${dis}></div>
    <label class="check"><input type="checkbox" name="attribution"${b.attribution ? html` checked` : ''}${dis}><span>Show AVA attribution on the cover</span></label>
    <div class="row-actions">${dis ? '' : html`<button type="submit" class="btn btn-primary">Save branding</button>`}<a class="btn" href="/export">Preview in export</a></div>
  </form>
  <div class="pdf-page ac-brand-prev" aria-label="Cover preview">
    <div class="pdf-head"><b data-prev-name>${b.coverName}</b><span class="pl">Confidential</span></div>
    <div class="ac-logo" data-logo-prev aria-hidden="true">${o.logo ? html`<img src="${o.logo}" alt="">` : 'LOGO'}</div>
    <div class="pdf-cover"><span class="pl">Venture risk audit</span><div class="pdf-title">Northline Cold Chain</div></div>
    <div class="pdf-verdict"><div><div class="pl">Score</div><div class="pdf-big">41</div></div><div><div class="pl">Directive</div><div class="pdf-big pdf-dir">PIVOT</div></div></div>
    <div class="pdf-foot"><span data-prev-foot>${b.footer}</span></div>
  </div>
</div>`;
}

export default {
  title: 'Account · AVA',
  className: 'account',

  async load() {
    const [o, users, me, log, companies] = await Promise.all([getOrg(), getUsers(), getCurrentUser(), getAuditLog(), getCompanies()]);
    const qStart = new Date();
    qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3, 1);
    const since = qStart.toISOString().slice(0, 10);
    const audits = { counted: 0, failed: 0 };
    companies.forEach((c) => { if (c.latest && c.latest.date >= since) audits.counted += 1; });
    log.filter((l) => l.action === 'audit.failed' && l.at.slice(0, 10) >= since).forEach(() => { audits.failed += 1; });
    return { o, users, me, log, companies, audits };
  },

  render(ctx, d) {
    const tab = ctx.query.get('tab') || 'profile';
    let body;
    if (tab === 'profile') body = profile(d.me);
    else if (tab === 'org') body = org(d.o, d.users, d.me);
    else if (tab === 'team') body = team(d.users, d.me);
    else if (tab === 'billing') body = d.me.role === 'Owner' ? billing(d.o, d.companies, d.users, d.audits) : emptyState({ title: 'Billing is Owner only.', body: `Ask your organisation Owner (${d.users.find((u) => u.role === 'Owner').name}) about plan, usage and invoices.` });
    else if (tab === 'log') body = auditLog(d.log, ctx, d.users);
    else body = brand(d.o, d.me);
    return html`
<div class="page-head"><div class="page-head-copy"><span class="lbl">${d.o.name} · signed in as ${d.me.name} (${d.me.role})</span><h1 class="page-title">Account</h1></div></div>
<div class="split ac">
  <nav class="side card ac-nav" aria-label="Account sections">${TABS.map(([k, l]) => html`<a class="list-btn" href="/account?tab=${k}"${tab === k ? html` aria-current="true"` : ''}>${l}</a>`)}</nav>
  <section class="body">${body}</section>
</div>`;
  },

  mount(root, ctx, d) {
    const ac = new AbortController();
    const opts = { signal: ac.signal };
    const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); ctx.refresh(); } catch (err) { toast(err.message); } };
    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fd = new FormData(f);
      if (f.matches('[data-profile]')) run(() => updateProfile({ name: fd.get('name'), title: fd.get('title'), email: fd.get('email'), initials: initials(fd.get('name')) }), 'Profile saved.');
      if (f.matches('[data-org]')) run(() => updateOrg({ name: fd.get('name'), kind: fd.get('kind'), currency: fd.get('currency'), region: fd.get('region'), cadence: { mode: fd.get('cadence'), day: Number(fd.get('day')) || 1 } }, 'Changed organisation settings'), 'Organisation saved.');
      if (f.matches('[data-invite]')) {
        const email = String(fd.get('email') || '').trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) { root.querySelector('[data-inv-err]').textContent = 'Enter a valid work email.'; f.elements.email.setAttribute('aria-invalid', 'true'); f.elements.email.focus(); return; }
        run(() => inviteMember(email, fd.get('role')), `Invite sent to ${email}. The link expires in 7 days.`);
      }
      if (f.matches('[data-brand]')) run(() => updateOrg({ branding: { coverName: fd.get('coverName'), footer: fd.get('footer'), attribution: fd.get('attribution') === 'on' } }, 'Changed report branding'), 'Branding saved.');
      if (f.matches('[data-transfer]')) {
        const u = d.users.find((x) => x.id === f.querySelector('select').value);
        openSheet({
          title: 'Transfer ownership',
          body: html`<p>${u.name} becomes the Owner, with billing and organisation control. You become an Admin. This is logged.</p><div class="row-actions"><button type="button" class="btn btn-primary" data-confirm>Transfer to ${u.name}</button><button type="button" class="btn" data-close>Cancel</button></div>`,
          onMount(el, close) { el.querySelector('[data-confirm]').addEventListener('click', () => { close(); run(() => transferOwnership(u.id), `${u.name} is now the Owner. You are an Admin.`); }); },
        });
      }
    }, opts);
    root.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.matches('[data-role]')) run(() => changeRole(t.dataset.role, t.value), 'Role changed.');
      if (t.matches('[data-view-as]')) run(() => actAs(t.value), 'Viewing the app with this role.');
      if (t.closest('[data-log-filter]')) {
        const fd = new FormData(t.closest('form'));
        const q = new URLSearchParams({ tab: 'log' });
        fd.forEach((v, k) => { if (v) q.set(k, v); });
        ctx.navigate(`/account?${q}`, { replace: true });
      }
      if (t.matches('[data-logo]') && t.files[0]) {
        const url = URL.createObjectURL(t.files[0]);
        root.querySelector('[data-logo-prev]').innerHTML = String(html`<img src="${url}" alt="">`);
        toast('Logo previewed. Save branding to keep it.');
      }
    }, opts);
    root.addEventListener('input', (e) => {
      if (e.target.name === 'coverName') root.querySelector('[data-prev-name]').textContent = e.target.value;
      if (e.target.name === 'footer') root.querySelector('[data-prev-foot]').textContent = e.target.value;
    }, opts);
    root.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const u = d.users.find((x) => x.id === rm.dataset.remove);
        openSheet({
          title: `Remove ${u.name}?`,
          body: html`<p>${u.name} loses access immediately. Their comments and audit log entries stay. This is logged.</p><div class="row-actions"><button type="button" class="btn btn-primary" data-confirm>Remove</button><button type="button" class="btn" data-close>Cancel</button></div>`,
          onMount(el, close) { el.querySelector('[data-confirm]').addEventListener('click', () => { close(); run(() => removeMember(u.id), `${u.name} removed.`); }); },
        });
      }
      if (e.target.closest('[data-csv]')) {
        const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
        const csv = ['time,user,action,object,object_id,detail', ...d.log.map((l) => [l.at, l.who, l.action, l.object, l.objectId, l.detail].map(esc).join(','))].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'ava-audit-log.csv';
        a.dataset.external = '';
        a.click();
        toast('Audit log exported.');
      }
      if (e.target.closest('[data-signout]')) { ctx.navigate(await signOut()); }
      if (e.target.closest('[data-reset]')) { await resetDemo(); toast('Demo data reset.'); ctx.refresh(); }
      if (e.target.closest('[data-delete-org]')) {
        openSheet({
          title: 'Delete organisation',
          body: html`<p>This permanently deletes every company, audit, file and member for ${d.o.name} within 90 days. It cannot be undone.</p><div class="fld"><label for="del-confirm">Type the organisation name to confirm</label><input id="del-confirm" class="inp" autocomplete="off"></div><div class="row-actions"><button type="button" class="btn ac-delete" data-confirm disabled>Delete organisation</button><button type="button" class="btn" data-close>Cancel</button></div>`,
          onMount(el, close) {
            const input = el.querySelector('#del-confirm');
            const btn = el.querySelector('[data-confirm]');
            input.addEventListener('input', () => { btn.disabled = input.value.trim() !== d.o.name; });
            btn.addEventListener('click', () => { close(); toast('Deletion request logged. Your account manager will confirm before anything is removed.'); });
          },
        });
      }
    }, opts);
    return () => ac.abort();
  },
};
