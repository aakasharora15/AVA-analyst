import PLAN_LIMITS from '../../config/plans.json' with { type: 'json' };

// Business details shown across the site. The owner fills these in; an empty
// value is left out of the page rather than shown as a placeholder.
// Every field is listed in OWNER_INPUTS.md.

export const BUSINESS = {
  legalName: 'AVA Verdict', // legal name of the operating company or sole trader
  address: '', // registered address
  privacyEmail: '', // receives privacy requests
  salesEmail: '', // "Book a walkthrough" and Enterprise enquiries
  billingEmail: '', // plan changes and invoices
  supportEmail: '', // help with the product, shown on the Help page
};

// Plans on the pricing page. Audits, seats and Deep audit come from
// config/plans.json, which the server enforces; prices and copy live here.
const PLAN_COPY = [
  { id: 'basic', price: '£29.99', unit: 'per month', for: 'For students and employees testing ideas, campaigns and strategies.' },
  { id: 'pro', price: '£299', unit: 'per month', for: 'For founders, investors and managers deciding what to back.' },
  { id: 'pro-max', price: '£1,499', unit: 'per month', for: 'For funds, corporate teams and accelerators running a portfolio.' },
];
export const PLANS = PLAN_COPY.map((p) => ({ ...p, ...PLAN_LIMITS.plans[p.id] }));

// Every new organisation starts here.
export const TRIAL = { id: 'trial', ...PLAN_LIMITS.plans.trial };

// Founding team. A bio is shown only once supplied.
export const TEAM = [
  { name: 'Alevtyna', role: 'Founding member', bio: '', gradient: 'linear-gradient(145deg,#8B7DFF,#5CC8FF)' },
  { name: 'Amar', role: 'Founding member', bio: '', gradient: 'linear-gradient(145deg,#B07DFF,#FF8FB8)' },
  { name: 'Anastasiia', role: 'Founding member', bio: '', gradient: 'linear-gradient(145deg,#5C7DFF,#7DF0E0)' },
  { name: 'Aakash', role: 'Founding member', bio: '', gradient: 'linear-gradient(145deg,#7B6CFF,#FFA566)' },
];

/** A mailto link when the address is set, otherwise the fallback path. */
export const contactHref = (email, fallback, subject = '') =>
  (email ? `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : fallback);
