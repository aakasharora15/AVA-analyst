import { html } from '../lib/html.js';

// Commercial figures stay as placeholders for the commercial team.
const PLANS = [
  {
    tag: 'Free', tagClass: 'p-tag-free', name: 'Entry audit', price: 'Free',
    body: 'A quick audit with minimal input and a short result. A route into the full product.',
    features: ['One short audit', 'Resilience Score and directive', 'Top findings only'],
    cta: { label: 'Try the free audit', href: '/free-audit' },
  },
  {
    featured: true,
    tag: 'Annual organisation contract', tagClass: 'tag-on-hero', name: 'Portfolio', price: '[PRICE]', unit: 'per year',
    body: 'For investment and corporate development teams monitoring companies over time.',
    features: ['[LIMIT] monitored companies', 'Audit history and comparison', 'Cited findings and a data room', 'Alerts and benchmarking', 'PDF export', '[SEATS] seats'],
    cta: { label: 'Talk to us', href: '/sign-in', primary: true },
  },
  {
    tag: 'Enterprise', tagClass: 'tag-info', name: 'Enterprise', price: 'Custom',
    body: 'For larger funds and corporates with compliance and brand requirements.',
    features: ['Everything in Portfolio', 'Single sign-on', 'Audit log for compliance', 'White-label reports', 'Custom roles and onboarding'],
    cta: { label: 'Contact sales', href: '/sign-in' },
  },
];

export default {
  title: 'Pricing · AVA',

  render() {
    return html`
<section class="hero-panel p-hero" aria-labelledby="pricing-title">
  <div class="stars" aria-hidden="true"></div>
  <span class="lbl p-hero-lbl">Pricing</span>
  <h1 id="pricing-title" class="p-hero-title">Priced per organisation, not per audit</h1>
  <p class="p-hero-sub">Annual contracts for funds, corporate teams and accelerators. Founders can try a free entry audit first.</p>
</section>

<section class="p-plans" aria-label="Plans">
  ${PLANS.map((p) => html`<article class="${p.featured ? 'hero-panel p-plan p-plan-featured' : 'card p-plan'}">
    <span class="tag ${p.tagClass} p-plan-tag">${p.tag}</span>
    <h2 class="p-plan-name">${p.name}</h2>
    <div class="p-plan-price"><span class="num">${p.price}</span>${p.unit ? html`<span class="p-plan-unit">${p.unit}</span>` : ''}</div>
    <p class="p-plan-body">${p.body}</p>
    <ul class="p-features">${p.features.map((f) => html`<li>${f}</li>`)}</ul>
    <a class="btn${p.cta.primary ? ' btn-primary' : ''} p-plan-cta" href="${p.cta.href}">${p.cta.label}</a>
  </article>`)}
</section>

<section class="card p-note">
  <div class="p-note-copy"><b>All prices above are placeholders.</b><span class="muted">Pricing is moving to annual organisation contracts, so figures, limits and seats are marked for the commercial team to fill in.</span></div>
  <a class="btn btn-primary" href="/#faq">Read the FAQ</a>
</section>`;
  },
};
