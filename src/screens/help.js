import { html } from '../lib/html.js';
import { BUSINESS, PLANS, TRIAL_SUMMARY } from '../content/business.js';
import { MODE } from '../data/repo.js';

// Help: how AVA works, common questions, live service status, what's new and
// how to reach the team. Contact lines appear only once their address is set.

const STEPS = [
  ['Describe the venture', 'A few required fields. Add the deck, model or board pack to the data room and findings cite the page they come from.'],
  ['Six agents attack it', 'Financial, competitive, market, demand, regulatory and an Orchestrator. Each reads what the others found and looks for what would break the venture.'],
  ['AVA scores the findings', 'The Resilience Score (0 to 100) and the directive come from AVA\'s published rules applied to the findings, not from an AI\'s opinion. The same findings always give the same score.'],
  ['Watch risk move', 'Re-audit when new numbers arrive, or let monitoring run monthly or quarterly. Alerts fire only on material movement.'],
];

const FAQ = [
  ['What do the directives mean?', html`<p><b>PROCEED</b> (65 and above): the venture holds up under attack. <b>HOLD</b> (45 to 64): real risks need answers first. <b>PIVOT</b> (35 to 44): the current plan is unlikely to work as it stands. <b>KILL</b> (below 35): the risks outweigh the case. Some HIGH findings cap the directive whatever the score, and a Partial audit (an agent could not finish) is capped at HOLD.</p>`],
  ['Why did AVA decline to score?', html`<p>When the inputs are too thin, vague or contradictory to assess honestly, AVA says so instead of inventing a score. Add specifics (customers, revenue, pricing, market, team) or upload documents and run it again. Declined audits never count against your allowance.</p>`],
  ['How long does an audit take?', html`<p>Usually a few minutes. You can leave the running screen; tick "Email me when it finishes" and the result arrives in your inbox.</p>`],
  ['Which files can AVA read?', html`<p>PDF, Word (.docx), PowerPoint (.pptx, including speaker notes), Excel (.xlsx, every sheet), CSV and text. Scanned PDFs need a text layer, and older .doc, .ppt and .xls files should be saved in the newer format first.</p>`],
  ['Is my data used to train AI?', html`<p>No. What you submit is used only to produce your audits, and our AI provider does not train on it either. See the <a class="link" href="/privacy">privacy policy</a> and <a class="link" href="/trust">trust centre</a>.</p>`],
  ['What counts as an audit?', html`<p>Every audit that issues a score: new analyses, re-audits, scheduled monitoring and audits triggered by new evidence. Failed or declined audits do not count. The ${TRIAL_SUMMARY}; paid plans reset monthly (${PLANS.map((p) => `${p.name} ${p.audits}`).join(', ')}).</p>`],
  ['How do I change plan, card or get an invoice?', html`<p>Owners go to Account, then Billing and usage. Manage billing opens the secure billing portal for plan changes, card details, invoices and cancellation.</p>`],
  ['How do I turn on two-factor sign-in?', html`<p>Account, then Security, then Turn on two-factor. Scan the code with an authenticator app and enter the 6-digit code. From then on, AVA shows no data to a session that has not entered a code.</p>`],
  ['Can I share a report with someone outside my organisation?', html`<p>Yes. Open the report and choose Share. Each link can have a password and an expiry date, every view is logged, and you can revoke it at any time.</p>`],
  ['How do I export or delete our data?', html`<p>Owners and Admins can download everything as one file under Account, then Profile. Any user can delete their own account there; an Owner can delete the whole organisation under Account, then Organisation.</p>`],
];

// Most recent first. Product changes users will notice, in plain words.
const CHANGES = [
  ['25 October 2026', [
    'The free trial is now 7 days, with one audit a day.',
    'Subscribe and manage billing online: change plan, update your card, download invoices.',
    'Two-factor sign-in with an authenticator app, plus "Sign out everywhere".',
    'AVA now reads Word, PowerPoint (including speaker notes) and Excel files.',
    'Search anything with ⌘K (Ctrl K on Windows).',
    'Download all your organisation\'s data, or delete your account, from Account.',
    'A setup checklist on your portfolio to get to a first verdict quickly.',
    'Enterprise: verified monthly company metrics. Founders report through a private link, your team confirms, AVA checks.',
  ]],
  ['24 October 2026', [
    'New organisations start on a free trial.',
    'Deep audit on Pro Max and Enterprise: extended analysis for high-stakes decisions.',
    'AVA declines to score inputs too thin to assess, rather than guessing.',
  ]],
];

function contacts() {
  const rows = [
    ['Product help', BUSINESS.supportEmail],
    ['Billing and invoices', BUSINESS.billingEmail],
    ['Sales and Enterprise', BUSINESS.salesEmail],
    ['Privacy and security', BUSINESS.privacyEmail],
  ].filter(([, e]) => e);
  if (!rows.length) return '';
  return html`<section class="legal-sec" aria-labelledby="h-contact"><h2 id="h-contact">Contact us</h2>
  <ul class="help-contacts">${rows.map(([l, e]) => html`<li><span class="muted">${l}</span><a class="link" href="mailto:${e}">${e}</a></li>`)}</ul></section>`;
}

export default {
  title: 'Help · AVA',
  className: 'legal-screen help-screen',

  render() {
    return html`<article class="legal-page" aria-labelledby="pg-title">
  <span class="lbl">Help</span>
  <h1 id="pg-title" class="display-m">How can we help?</h1>
  <p class="legal-lead">How AVA works, answers to common questions, and what has changed recently.</p>
  ${MODE === 'live' ? html`<div class="help-status" data-status role="status"><span class="help-dot" aria-hidden="true"></span><span>Checking service status…</span></div>` : ''}
  <section class="legal-sec" aria-labelledby="h-how"><h2 id="h-how">How an audit works</h2>
    <ol class="help-steps">${STEPS.map(([t, b], i) => html`<li><span class="lbl">0${i + 1}</span><span><b>${t}</b><br><span class="muted">${b}</span></span></li>`)}</ol>
  </section>
  <section class="legal-sec" aria-labelledby="h-faq"><h2 id="h-faq">Common questions</h2>
    <div class="faq">${FAQ.map(([q, a]) => html`<details><summary>${q}</summary>${a}</details>`)}</div>
  </section>
  <section class="legal-sec" aria-labelledby="h-new"><h2 id="h-new">What's new</h2>
    ${CHANGES.map(([d, items]) => html`<div class="help-change"><h3 class="lbl">${d}</h3><ul>${items.map((x) => html`<li>${x}</li>`)}</ul></div>`)}
  </section>
  ${contacts()}
</article>`;
  },

  mount(root) {
    const el = root.querySelector('[data-status]');
    if (!el) return null;
    const ctl = new AbortController();
    fetch('/api/health', { signal: ctl.signal })
      .then((r) => r.json())
      .then((h) => {
        const ok = h && h.ok;
        el.classList.add(ok ? 'is-ok' : 'is-warn');
        el.lastElementChild.textContent = ok ? 'All systems working.' : 'Some services are degraded. Audits may be delayed; your data is safe.';
      })
      .catch(() => { if (!ctl.signal.aborted) { el.classList.add('is-warn'); el.lastElementChild.textContent = 'Service status is unavailable right now.'; } });
    return () => ctl.abort();
  },
};
