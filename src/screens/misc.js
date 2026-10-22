// Guest share view, invite acceptance, error pages and placeholder legal pages.

import { html } from '../lib/html.js';
import { openSharedReport, getUsers, getOrg } from '../data/repo.js';
import { reportBody } from './report.js';
import { logo } from '../components/logo.js';
import { fmtDate } from '../components/ui.js';

const simple = ({ label, title, body, actions = [] }) => html`<section class="planned" aria-labelledby="pg-title">
  <span class="lbl">${label}</span>
  <h1 id="pg-title" class="display-m">${title}</h1>
  ${body}
  <div class="row-actions">${actions.map((a, i) => html`<a class="btn${i === 0 ? ' btn-primary' : ''}" href="${a.href}">${a.label}</a>`)}</div>
</section>`;

export const shared = {
  title: 'Shared report · AVA',
  className: 'shared',
  async load(ctx) { return openSharedReport(ctx.params.token, ctx.query.get('p') || ''); },
  render(ctx, r) {
    const top = html`<div class="shared-top">${logo({ href: '/' })}<span class="lbl">Shared view-only report</span></div>`;
    if (r.state === 'ok') {
      return html`${top}<div class="shared-mark" aria-hidden="true">${Array.from({ length: 24 }, () => html`<span>${r.link.email}</span>`)}</div>
<div class="banner banner-info" role="note"><b>Shared with ${r.link.email}</b><span class="small">View only. Expires ${fmtDate(r.link.expires)}. Views are logged.</span></div>
<div class="report shared-body">${reportBody(r.audit, { guest: true })}</div>`;
    }
    if (r.state === 'password') {
      return html`${top}<form class="card card-pad stack-md shared-pass" data-pass><h1 class="card-title">This report is password protected.</h1><div class="fld"><label for="sp">Password</label><input id="sp" type="password" class="inp" autocomplete="off"></div><button type="submit" class="btn btn-primary">Open report</button></form>`;
    }
    return html`${top}${simple({
      label: r.state === 'revoked' ? 'Link revoked' : r.state === 'expired' ? 'Link expired' : 'Link not found',
      title: r.state === 'revoked' ? 'This link has been revoked.' : r.state === 'expired' ? 'This link has expired.' : 'This link does not exist.',
      body: html`<p>Ask the person who shared it to send a new link.</p>`,
      actions: [{ href: '/', label: 'About AVA' }],
    })}`;
  },
  mount(root, ctx) {
    const form = root.querySelector('[data-pass]');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); ctx.navigate(`/shared/${ctx.params.token}?p=${encodeURIComponent(form.querySelector('#sp').value)}`, { replace: true }); });
    return null;
  },
};

export const invite = {
  title: 'Accept invite · AVA',
  className: 'invite',
  async load(ctx) { return { users: await getUsers(), org: await getOrg(), token: ctx.params.token }; },
  render(ctx, { users, org, token }) {
    const u = users.find((x) => x.id === token && x.status === 'invited');
    if (!u || (u.inviteExpires && u.inviteExpires < new Date().toISOString().slice(0, 10))) {
      return simple({ label: 'Invite', title: 'This invite has expired.', body: html`<p>Invites last 7 days. Ask the person who invited you to send a new one.</p>`, actions: [{ href: '/sign-in', label: 'Sign in' }] });
    }
    return simple({ label: 'Invite', title: `Join ${org.name} on AVA`, body: html`<p>You have been invited as ${u.role} with ${u.email}. Create an account or sign in to accept.</p>`, actions: [{ href: '/sign-in?mode=up', label: 'Create account' }, { href: '/sign-in', label: 'Sign in' }] });
  },
};

export const noAccess = {
  title: 'No access · AVA',
  className: 'planned-screen',
  async load() { return { users: await getUsers(), org: await getOrg() }; },
  render(ctx, { users, org }) {
    const owner = users.find((u) => u.role === 'Owner');
    return simple({ label: '403', title: 'You do not have access to this page', body: html`<p>Your role does not include this area of ${org.name}. Ask the organisation Owner, ${owner.name} (${owner.email}), to change your role.</p>`, actions: [{ href: '/portfolio', label: 'Back to portfolio' }] });
  },
};

export const maintenance = {
  title: 'Scheduled maintenance · AVA',
  className: 'planned-screen',
  render() {
    return simple({ label: 'Scheduled maintenance', title: 'AVA is down for scheduled maintenance', body: html`<p>We expect to be back by [TIME, DATE]. Audits that were running will resume automatically. Nothing you saved is affected.</p>`, actions: [{ href: '/', label: 'Back to home' }] });
  },
};

const legal = (name, intro) => ({
  title: `${name} · AVA`,
  className: 'planned-screen',
  render() {
    return simple({ label: '[CONFIRM WITH LEGAL]', title: name, body: html`<p>${intro}</p><p class="muted">Final wording to be supplied before launch.</p>`, actions: [{ href: '/', label: 'Back to home' }] });
  },
});

export const privacy = legal('Privacy', '[PRIVACY] How AVA collects, uses, stores and deletes personal and company data, including data retention and storage region.');
export const terms = legal('Terms', '[TERMS] The terms that govern use of AVA by organisations and their members.');
export const trust = legal('Trust centre', '[CONFIRM WITH LEGAL] Security, data handling, model version pinning, calibration and how AVA keeps scores reproducible.');
