import { html } from '../lib/html.js';

import { BUSINESS, PLANS, contactHref } from '../content/business.js';

const FEATURES = {
  basic: ['Scored, cited audit reports', 'Ideas, campaigns, strategies and startups', 'Share a report with a manager or investor', 'PDF export'],
  pro: ['Everything in Basic', 'Monitoring and alerts when risk moves', 'Audit history and side-by-side comparison', 'Data room for your documents', 'Benchmarks and outcome tracking'],
  'pro-max': ['Everything in Pro', 'Portfolio overview across every company', 'Team roles and permissions', 'Branded reports', 'Priority support'],
};

const cards = () => [
  {
    tag: 'Free', tagClass: 'p-tag-free', name: 'Free audit', price: 'Free',
    body: 'One audit with a score, a directive and your top three findings. One per company email domain each month.',
    features: ['Resilience Score and directive', 'Top three findings in full', 'Work email required'],
    cta: { label: 'Run a free audit', href: '/free-audit' },
  },
  ...PLANS.map((p) => ({
    featured: p.id === 'pro',
    tag: p.id === 'pro' ? 'Most popular' : p.name, tagClass: p.id === 'pro' ? 'tag-on-hero' : 'tag-info',
    name: p.name, price: p.price, unit: p.unit, body: p.for,
    features: [`${p.audits} audits a month`, `${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}`, ...FEATURES[p.id]],
    cta: { label: 'Get started', href: '/sign-in?mode=up', primary: p.id === 'pro' },
  })),
];

export default {
  title: 'Pricing · AVA',

  render() {
    return html`
<section class="hero-panel p-hero" aria-labelledby="pricing-title">
  <div class="stars" aria-hidden="true"></div>
  <span class="lbl p-hero-lbl">Pricing</span>
  <h1 id="pricing-title" class="p-hero-title">One honest verdict, at every scale</h1>
  <p class="p-hero-sub">From a student testing an idea to a fund monitoring its portfolio. Every plan runs the same audit; plans differ in volume, seats and portfolio tools.</p>
</section>

<section class="p-plans" aria-label="Plans">
  ${cards().map((p) => html`<article class="${p.featured ? 'hero-panel p-plan p-plan-featured' : 'card p-plan'}">
    <span class="tag ${p.tagClass} p-plan-tag">${p.tag}</span>
    <h2 class="p-plan-name">${p.name}</h2>
    <div class="p-plan-price"><span class="num">${p.price}</span>${p.unit ? html`<span class="p-plan-unit">${p.unit}</span>` : ''}</div>
    <p class="p-plan-body">${p.body}</p>
    <ul class="p-features">${p.features.map((f) => html`<li>${f}</li>`)}</ul>
    <a class="btn${p.cta.primary ? ' btn-primary' : ''} p-plan-cta" href="${p.cta.href}">${p.cta.label}</a>
  </article>`)}
</section>

<section class="card p-note">
  <div class="p-note-copy"><b>Need more than Pro Max?</b><span class="muted">Enterprise plans add single sign-on, custom audit volumes, data retention terms and dedicated onboarding.</span></div>
  <a class="btn btn-primary" href="${contactHref(BUSINESS.salesEmail, '/sign-in?demo=1', 'AVA Enterprise')}"${BUSINESS.salesEmail ? html` data-external` : ''}>${BUSINESS.salesEmail ? 'Contact sales' : 'Explore the live demo'}</a>
</section>`;
  },
};
