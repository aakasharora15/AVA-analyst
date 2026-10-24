// Guest share view, invite acceptance, error pages and placeholder legal pages.

import { html } from '../lib/html.js';
import { openSharedReport, getUsers, getOrg, getInvite, acceptInvite, getSession } from '../data/repo.js';
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
  async load(ctx) { return { inv: await getInvite(ctx.params.token), session: await getSession() }; },
  render(ctx, { inv, session }) {
    if (!inv || inv.expired || inv.accepted) {
      return simple({ label: 'Invite', title: inv && inv.accepted ? 'This invite has already been used.' : 'This invite has expired.', body: html`<p>Invites last 7 days. Ask the person who invited you to send a new one.</p>`, actions: [{ href: '/sign-in', label: 'Sign in' }] });
    }
    const here = encodeURIComponent(ctx.path);
    if (session.signedIn && session.user && session.user.email.toLowerCase() === inv.email.toLowerCase()) {
      return html`${simple({ label: 'Invite', title: `Join ${inv.org} on AVA`, body: html`<p>You have been invited as ${inv.role}. Accepting adds you to ${inv.org}.</p><span class="err" role="alert" data-inv-err></span>` })}
<div class="row-actions"><button type="button" class="btn btn-primary" data-accept>Accept and open the portfolio</button></div>`;
    }
    return simple({ label: 'Invite', title: `Join ${inv.org} on AVA`, body: html`<p>You have been invited as ${inv.role} with ${inv.email}. Create an account or sign in with that email to accept.</p>`, actions: [{ href: `/sign-in?mode=up&next=${here}`, label: 'Create account' }, { href: `/sign-in?next=${here}`, label: 'Sign in' }] });
  },
  mount(root, ctx) {
    const btn = root.querySelector('[data-accept]');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await acceptInvite(ctx.params.token); ctx.navigate('/portfolio'); } catch (err) { root.querySelector('[data-inv-err]').textContent = err.message; btn.disabled = false; }
      });
    }
    return null;
  },
};

// /demo: kept for old links. Sends visitors to the sign-in screen with the
// demo login filled in, so they experience the real login.
export const demo = {
  title: 'Live demo · AVA',
  className: 'planned-screen',
  render() { return html`<section class="planned"><span class="lbl">Live demo</span></section>`; },
  mount(root, ctx) {
    const to = ctx.query.get('to') || '';
    const next = /^\/(?!\/)[\w\-/?=&.]*$/.test(to) ? to : '/portfolio';
    ctx.navigate(`/sign-in?demo=1&next=${encodeURIComponent(next)}`, { replace: true });
    return null;
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

// Privacy policy. Processors are named by category, including the AI model
// provider. The operator's details come from LEGAL_ENTITY; a missing detail is
// left out rather than shown as a placeholder.
const LEGAL_ENTITY = {
  name: 'AVA Verdict', // legal name of the operating company or sole trader
  address: '', // registered address
  privacyEmail: '', // address that receives privacy requests
};
const PRIVACY_UPDATED = '24 October 2026';
const contactLine = LEGAL_ENTITY.privacyEmail
  ? html`email <a class="link" href="mailto:${LEGAL_ENTITY.privacyEmail}">${LEGAL_ENTITY.privacyEmail}</a>`
  : html`contact the AVA Verdict team`;
const PRIVACY = [
  ['Who we are', html`<p>AVA (Adversarial Venture Analyst) is operated by ${LEGAL_ENTITY.name}${LEGAL_ENTITY.address ? `, ${LEGAL_ENTITY.address}` : ''}. We are the controller of the personal data described here. For any privacy question or request, ${contactLine}.</p>`],
  ['What we collect', html`<ul>
    <li><b>Account data:</b> your name, work email, organisation, role and sign-in details. If you sign in with Google, we receive your name and email from Google.</li>
    <li><b>Venture data you submit:</b> descriptions, company details, uploaded documents, and the findings, comments, outcomes and decisions recorded against them.</li>
    <li><b>Free audit data:</b> your work email and the venture details you enter.</li>
    <li><b>Activity and security data:</b> a log of actions taken in your workspace, sign-in events and technical data needed to keep the service secure.</li>
    <li><b>Data in your browser:</b> your sign-in session and display preferences. The public demo workspace stores its sample data only in your browser.</li>
  </ul>`],
  ['How we use it', html`<ul>
    <li>To run audits and produce reports, scores and alerts.</li>
    <li>To manage your account, your organisation's members and their access.</li>
    <li>To send service emails such as verification, invitations, alerts and digests.</li>
    <li>To keep AVA secure, prevent misuse and keep a record of changes.</li>
    <li>To keep scores reproducible and monitor their consistency over time.</li>
  </ul>`],
  ['How AI processes your data', html`<p>To produce an audit, the venture information and documents you submit are sent to a <b>third-party AI model provider</b>, which processes them on our behalf and under our instructions as our processor, under a written data processing agreement. AVA's agents may also search publicly available web sources about the venture.</p>
    <p>We do not use your submitted data to train AI models, and our AI provider does not use it to train its models.</p>
    <p>Scores and directives are calculated by AVA's own rules from the findings. They are decision support for people, not automated decisions with legal or similarly significant effects on you.</p>`],
  ['Who we share it with', html`<p>We share personal data only with:</p><ul>
    <li><b>Service providers acting as our processors:</b> hosting and infrastructure, database and file storage, a third-party AI model provider, and email delivery.</li>
    <li><b>Members of your organisation,</b> according to their role.</li>
    <li><b>People you choose to share a report with,</b> through a share link you create. You can set a password and expiry, and revoke the link at any time.</li>
    <li><b>Authorities,</b> where the law requires it.</li>
  </ul><p>We do not sell personal data.</p>`],
  ['Where your data is stored', html`<p>Our database and uploaded files are stored in the United Kingdom (London). Some service providers, including our AI model provider, may process data outside the United Kingdom. Where they do, we protect it with safeguards recognised under UK law, such as the UK International Data Transfer Agreement or the UK Addendum to the EU Standard Contractual Clauses.</p>`],
  ['Our lawful bases', html`<ul>
    <li><b>Contract:</b> to provide the service you or your organisation signed up for.</li>
    <li><b>Legitimate interests:</b> to keep AVA secure, prevent misuse and improve the service.</li>
    <li><b>Consent:</b> for any optional marketing, which you can withdraw at any time.</li>
    <li><b>Legal obligation:</b> where the law requires us to keep or disclose data.</li>
  </ul>`],
  ['How long we keep it', html`<ul>
    <li><b>Account and workspace data:</b> for as long as your organisation's account is active, then deleted within 90 days of the account closing.</li>
    <li><b>Free audit data:</b> deleted 12 months after the audit, unless your organisation signs up and keeps it.</li>
    <li><b>Activity and security records:</b> kept for up to 6 years where needed for legal, accounting or security purposes.</li>
  </ul><p>You can ask us to delete your data sooner, subject to any legal obligation to keep it.</p>`],
  ['Your rights', html`<p>Under UK data protection law you can ask to access, correct, delete, restrict or transfer your personal data, and object to how we use it. To make a request, ${contactLine}, and we will respond within one month. If you are unhappy with our response, you can complain to the Information Commissioner's Office at ico.org.uk.</p>`],
  ['How we protect it', html`<ul>
    <li>Data is encrypted in transit.</li>
    <li>Access inside an organisation is limited by role and enforced in the database itself.</li>
    <li>Passwords are handled by our authentication provider and never stored by AVA in readable form.</li>
    <li>Every change to workspace data is logged.</li>
  </ul>`],
  ['Changes to this policy', html`<p>We will post any changes here and update the date below. If a change materially affects how we use your data, we will tell account owners by email.</p>`],
];

export const privacy = {
  title: 'Privacy policy · AVA',
  className: 'legal-screen',
  render() {
    return html`<article class="legal-page" aria-labelledby="pg-title">
  <span class="lbl">Legal</span>
  <h1 id="pg-title" class="display-m">Privacy policy</h1>
  <p class="legal-lead">How AVA collects, uses, stores and protects personal and company data.</p>
  ${PRIVACY.map(([h, body]) => html`<section class="legal-sec"><h2>${h}</h2>${body}</section>`)}
  <p class="small muted">Last updated ${PRIVACY_UPDATED}.</p>
</article>`;
  },
};
export const terms = legal('Terms', '[TERMS] The terms that govern use of AVA by organisations and their members.');
export const trust = legal('Trust centre', '[CONFIRM WITH LEGAL] Security, data handling, model version pinning, calibration and how AVA keeps scores reproducible.');
