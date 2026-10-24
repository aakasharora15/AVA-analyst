// Business details shown across the site. The owner fills these in; an empty
// value is left out of the page rather than shown as a placeholder.
// Every field is listed in OWNER_INPUTS.md.

export const BUSINESS = {
  legalName: 'AVA Verdict', // legal name of the operating company or sole trader
  address: '', // registered address
  privacyEmail: '', // receives privacy requests
  salesEmail: '', // "Book a walkthrough" and Enterprise enquiries
  billingEmail: '', // plan changes and invoices
};

// Plans on the pricing page. Audit allowances are per month.
export const PLANS = [
  { id: 'basic', name: 'Basic', price: '£29.99', unit: 'per month', audits: 20, seats: 1,
    for: 'For students and employees testing ideas, campaigns and strategies.' },
  { id: 'pro', name: 'Pro', price: '£299', unit: 'per month', audits: 199, seats: 3,
    for: 'For founders, investors and managers deciding what to back.' },
  { id: 'pro-max', name: 'Pro Max', price: '£1,499', unit: 'per month', audits: 499, seats: 10,
    for: 'For funds, corporate teams and accelerators running a portfolio.' },
];

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
