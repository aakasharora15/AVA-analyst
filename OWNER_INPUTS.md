# Owner inputs

Everything on the site that only the owner can supply. Until a value is filled
in, the site leaves that detail out (no placeholders are shown).

Most values live in one file: `src/content/business.js`.

## Business details (`src/content/business.js` → `BUSINESS`)

| Field | Used on | Example |
|---|---|---|
| `legalName` | Privacy policy, Terms (currently "AVA Verdict") | AVA Verdict Ltd |
| `address` | Privacy policy ("Who we are") | 1 Example Street, London, EC1A 1AA |
| `privacyEmail` | Privacy policy, Trust centre (contact for data requests and security reports) | privacy@avaverdict.com |
| `salesEmail` | Free audit "Book a walkthrough", Pricing "Contact sales" (otherwise both link to the live demo) | hello@avaverdict.com |
| `billingEmail` | Account → Billing "Contact billing" and the Enterprise link (otherwise links to Pricing) | billing@avaverdict.com |
| `supportEmail` | Help page "Contact us" (the section is hidden until an address is set) | support@avaverdict.com |

## Plans (`src/content/business.js` → `PLANS`)

Current values: Basic £29.99 (20 audits, 1 seat), Pro £299 (199 audits, 3 seats),
Pro Max £1,499 (499 audits, 10 seats). Confirm:

- [ ] Prices
- [ ] Audit allowances (set after measuring the real cost of one audit; see LAUNCH_CHECKLIST 4.4)
- [ ] Seats per plan
- [ ] Who each plan is for (the one-line description)

## Team (`src/content/business.js` → `TEAM`)

- [ ] Role for each founding member (currently "Founding member")
- [ ] One-line bio for each (hidden until supplied)

## Legal and compliance

- [ ] Register with the Information Commissioner's Office (UK data protection fee)
- [ ] Lawyer review of `/privacy` and `/terms` (`src/screens/misc.js`)
- [ ] Confirm retention periods in the privacy policy: 90 days after account closure, free audits 12 months, records up to 6 years
- [ ] Confirm data processing agreements are in place with each service provider (hosting, database, AI model provider, email, error monitoring (Sentry), bot check (Cloudflare))
- [ ] Stripe account: business details, bank account, VAT settings (Stripe Tax if you charge VAT), statement descriptor "AVA VERDICT"
- [ ] Decide trial-to-paid policy: what happens on day 15 is already built (read-only until a plan is chosen); confirm you are happy with it

## Landing page (`src/screens/landing.js`)

- [ ] Real client logos for the "Built for" strip, once clients agree to be named (it currently lists audience types)
