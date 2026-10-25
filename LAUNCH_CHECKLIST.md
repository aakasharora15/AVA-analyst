# AVA launch checklist

The single list of what stands between this repository and paying clients.
Tick items as they are done, with the date. Details for each step are in DEPLOY.md.

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

## Stage 1. Supabase (database, sign-in, file storage)

- [x] 1.1 Create the Supabase project: organisation "AVA Verdict" (Startup, Free), project ava-verdict-staging, West Europe (London). URL: https://tzjbbsoyhiddgnwtkall.supabase.co (2026-10-23)
- [x] 1.2 Save the project's keys and connection strings (password manager, never in chat or git). JWT signing: ECC (P-256), so SUPABASE_JWT_SECRET stays empty and the API verifies via JWKS (2026-10-23)
- [x] 1.3 Apply migration 1: schema, security rules, audit log (2026-10-23)
- [x] 1.4 Apply migration 2: data room file storage (2026-10-23)
- [x] 1.5 Apply migration 3: reference data (2026-10-23)
- [x] 1.6 Verify: run supabase/checks/verify_setup.sql, every row PASS (2026-10-23, 8/8 PASS)
- [x] 1.7 Auth settings: email confirmation on, password 12+ with upper/lower/digit/symbol, secure password change on, Site URL https://ava-analyst.vercel.app, redirects ava-analyst.vercel.app/** and localhost:5173/** (2026-10-23)
- [x] 1.8 Auth emails: custom SMTP via Resend (smtp.resend.com, no-reply@avaverdict.com) and the three branded templates from supabase/email-templates pasted in (2026-10-25). Still to do: set Site URL to https://avaverdict.com and add https://avaverdict.com/** to redirects (1.7 lists the old values)
- [x] 1.9 Enable pg_cron and pg_net (2026-10-23)
- [x] 1.14 Apply migration 6 (supabase/migrations/20261024000003_trial.sql): free trial for new organisations (2026-10-24)
- [x] 1.13 Apply migration 5 (supabase/migrations/20261024000002_plans_deep_audit.sql): Deep audit flag, plan ids, plans change only through billing (2026-10-24)
- [x] 1.12 Apply migration 4 (supabase/migrations/20261024000001_hide_model.sql): users can no longer read which AI model ran an audit (2026-10-24)
- [x] 1.15 Apply migration 7 (supabase/migrations/20261025000001_billing.sql): billing columns, trial end system-only, free audit address limits. Needed before the free audit works on the live site
- [x] 1.16 Apply migration 8 (supabase/migrations/20261025000002_mfa.sql): two-factor enforced in the database
- [x] 1.18 Apply migration 9 (supabase/migrations/20261025000003_metrics.sql): Enterprise verified metrics. Then verify_setup.sql: 29 tables, 40 policies, all PASS
- [ ] 1.17 Authentication → Multi-Factor: confirm TOTP (authenticator app) is enabled (on by default)
- [~] 1.10 Google sign-in: Google Cloud project "ava-verdict" (dedicated AVA Verdict account), OAuth client "AVA Verdict staging" (External, Testing), Supabase Google provider saved. Remaining: rotate the secret exposed in a screenshot, test once the site URL is set
- [ ] 1.11 Microsoft sign-in (recommended over Apple for funds and corporates; awaiting decision)

## Stage 2. Vercel (hosting and the API)

- [x] 2.1 Add environment variables: 5 Config + 3 Secret, Production and Preview (2026-10-24)
- [x] 2.2 Production branch: claude/design-implementation-0z8bwt is the repository's only branch, so Vercel production already builds from it (2026-10-24)
- [x] 2.3 Deploy; https://ava-analyst.vercel.app/api/health returns ok: database, Anthropic key, auth verification and cron secret all true (2026-10-24)
- [x] 2.4 Custom domain and HTTPS (2026-10-25): avaverdict.com serves production; www, avaverdict.co.uk and avaverdict.co.in (and their www) 308 to it. APP_URL=https://avaverdict.com; Supabase Site URL and redirect URLs updated; Google sign-in tested on the new domain

## Stage 3. Background jobs and email

- [x] 3.1 Run supabase/cron.sql: ava-advance every minute and ava-email every 5 minutes, both returning 200 (2026-10-24)
- [x] 3.2 Resend: avaverdict.com verified (Ireland), EMAIL_FROM and RESEND_API_KEY set (2026-10-25)
- [x] 3.3 Test emails arrive: invite, then every AVA email type via supabase/checks/test_emails.sql, in Gmail and Apple Mail, light and dark (2026-10-25)
- [ ] 3.4 Set AVA_OPS_EMAIL so failed audits and deletion clean-ups reach you

## Stage 4. Staging walkthrough (live mode, real Supabase)

- [x] 4.1 Set VITE_AVA_DATA=live and redeploy (2026-10-24)
- [x] 4.1a Public demo workspace: demo@avaverdict.com / VerdictDemo2026 via the real sign-in screen ("Explore the live demo" pre-fills it); sample data in the visitor's browser only, no database, Claude API or email; exit returns to the landing page (2026-10-24)
- [~] 4.2 Sign up, verify email, onboard
- [x] 4.3 Add a company, upload a PDF, run a full audit on the real Claude API (2026-10-25: AVA audited itself with the factsheet PDF; 6 of 6 agents, 40 findings, 44 sources, score 35 PIVOT)
- [x] 4.4 Record cost and run time of one audit (2026-10-25: about 6 minutes, US$1.26 standard engine). Margin per included audit: Basic and Pro £1.50 revenue vs about £1 cost; Pro Max £3. Deep audit cost not yet measured
- [ ] 4.5 Dismiss a finding, comment, assign an owner
- [ ] 4.6 Share a report (with password), open it signed out, revoke it
- [ ] 4.7 Invite a second account, accept, check role limits (Viewer cannot run audits)
- [ ] 4.8 CSV import, alerts, outcomes, export
- [ ] 4.9 Free audit with a work email; second attempt same domain is blocked
- [ ] 4.10 Real phones and browsers (iOS Safari, Android Chrome, desktop); PDF print
- [x] 4.11 GitHub Actions CI green (runs 1-13 on the branch, 2026-10-23)

## Stage 5. Product sign-off

- [ ] 5.1 Approve agent prompts (Owner plus second reviewer)
- [ ] 5.2 Calibrate on 10 to 20 past deals with known outcomes
- [~] 5.3 Site content is final with no visible placeholders (2026-10-24). Owner-only details are listed in OWNER_INPUTS.md and omitted from pages until supplied
- [~] 5.4 Legal: Privacy policy, Terms of service and Trust centre are live with final wording (2026-10-24). Remaining: owner details, ICO registration, lawyer review (OWNER_INPUTS.md)
- [ ] 5.5 Decide single sign-on for Enterprise at launch
- [ ] 5.6 Google Auth Platform: complete Branding (home page, privacy, terms, authorised domain), then Publish app so anyone can use Continue with Google

## Stage 6. Build before or soon after first client

- [x] 6.1 Read Word, PowerPoint (with speaker notes) and Excel files in the browser (2026-10-25)
- [~] 6.2 Billing built (2026-10-25): Stripe Checkout, Customer Portal (plan changes, card, invoices, cancel), signed webhook as the only writer of plan and seats, trial bar and upgrade prompt. Remaining (owner): Stripe account, three products and prices, webhook endpoint, env vars (6.2a below)
- [ ] 6.2a Stripe setup: create products Basic £29.99, Pro £299, Pro Max £1,499 (monthly); copy price ids to STRIPE_PRICE_*; add webhook https://ava-analyst.vercel.app/api/stripe/webhook for checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed; set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; turn on the Customer Portal (allow plan switching between the three prices, cancellation, invoice history)
- [~] 6.3 Error monitoring and failed-audit alerts built (2026-10-25). Deferred by the owner until paying customers: create a Sentry project, set SENTRY_DSN and VITE_SENTRY_DSN; set AVA_OPS_EMAIL
- [~] 6.5 Free audit spend protection built (2026-10-25): per-address and daily caps on now. Deferred by the owner; needed before the free audit is promoted publicly: Cloudflare Turnstile widget, set VITE_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY
- [x] 6.6 Data export and deletion: export organisation data, delete account, delete organisation (2026-10-25)
- [x] 6.7 Two-factor sign-in (authenticator app), sign out everywhere (2026-10-25)
- [x] 6.9 Enterprise verified metrics (2026-10-25): founder link on the 1st, reminder day 7, escalation day 14, client confirms, AVA verifies at /ava-review, alerts on runway under 6 months, revenue down 20%, shut down or acquired. Remaining: set AVA_STAFF_EMAILS (each reviewer turns on two-factor); decide who on the AVA team reviews and how fast (target: within 2 working days)
- [x] 6.8 Search (⌘K), Help page with live status and What's new, first-run checklist (2026-10-25)
- [ ] 6.4 Internal admin screen for drift reports and holds

## Stage 7. Launch

- [ ] 7.1 Production Supabase separate from staging (no seed data). Upgrade to Pro the day the first client signs (backups, no pausing).
- [ ] 7.2 Backups: Supabase daily backups confirmed, restore tested once
- [ ] 7.3 Switch production to live; first pilot client

## Log

- 2026-10-26: Talking back to a report, and existing businesses. New analysis asks what is analysed (new idea, early-stage startup, operating SME, established company), the decision (invest, launch, expand, campaign, health check) and the person's relationship to it; SMEs get a trading-record section (Companies House number, years trading, revenue, profit, headcount, customer concentration, borrowing). Engine weights still follow the venture type, now derived from the decision [CALIBRATE]. Reports gain Ask AVA (answers from the report only, cited, monthly allowance per plan) and challenges to findings (answered by someone else, never change the score). Owners see "What to fix first". Portfolio gains a risk-by-category heatmap. Needs migration 20261026000001_report_dialogue.sql.

- 2026-10-25: Phase 1 closed. Branded HTML emails (light and dark, following the reader's setting; Gmail always shows light), generated from each email's plain text, which is still sent alongside. Supabase auth emails go through Resend with matching templates. Sentry and Turnstile deferred. Model spend for the phase: US$0.

- 2026-10-25 (strategy doc, section 4): agents now receive price range, delivery mode and known competitors; Deep audit researches with all five agents at 8 searches each; free audit result is emailed as a private link once RESEND_API_KEY is set (until then it shows on the page); free audits older than 12 months are deleted daily unless converted (privacy policy now true); live-mode "Sample data" labels and the Northline link removed; file pickers accept only readable formats.

- 2026-10-25: Free trial changed to 7 days, one audit a day (UK calendar day), at most 7 in total; failed or declined audits still never count. Organisations already on a trial keep their original end date. Worst-case model cost per trial: about US$9.

- 2026-10-25: First real audit: 6 min, US$1.26. Running screen rebuilt so people can see the engine work: live clock and time left, agent pipeline with current step, live activity feed of real events and sources found. Free audits capped at 5 a day by default (AVA_FREE_AUDITS_PER_DAY) to protect a small API budget. One finding came back without a source: to fix.

- 2026-10-25: Migrations 7, 8 and 9 applied; verify_setup all PASS. Owner's personal organisation (aakasharoraa4@gmail.com) set to Pro Max by hand, no billing; change when the owner switches account.

- 2026-10-25: Enterprise verified metrics: monthly founder reporting, client confirmation, AVA review queue, portfolio runway and freshness, alerts on material moves. Tracking is a per-plan flag in config/plans.json (Enterprise only).

- 2026-10-25: SaaS foundation: Stripe billing, trial bar and upgrade prompt, free audit limits and bot check, Sentry, ops alerts, data export and deletion, two-factor enforced in the database, Office files, search, Help, first-run checklist. Fixed: plan limit sent users to /running/undefined; an Owner could extend their own trial; live portfolio said "Sample data"; share tokens appeared in the audit log export.

- 2026-10-24: Free usage closed: new organisations start on a 14-day trial with 3 audits; every plan's audit allowance is checked before any model call. Failed or declined audits never count.
- 2026-10-24: Plans and models: every plan runs the standard engine (Sonnet); Pro Max and Enterprise can run a Deep audit (Opus). Plans change only through billing, enforced in the database.
- 2026-10-24: The AI model is internal: removed from /api/health and shared reports, provider error text kept to server logs, model columns unreadable by users once migration 4 is applied.
- 2026-10-24: Honest-score gate: thin or nonsense inputs are refused before any model call (quality.py, mirrored in the forms), and the Orchestrator can decline to score (assessable=false) with no score issued and no usage counted. Free audit always runs for real, even with the demo open. Prompts edited in place while still unapproved.
- 2026-10-24: Cron jobs fixed: Vault held a placeholder app URL and cron secret. cron.sql now refuses placeholders and updates existing values; the API strips stray whitespace from the secret; /api/health shows a cron secret fingerprint to compare with Vault.
- 2026-10-23: Staging project created. Not linked to GitHub; migrations applied by hand. Data API on, auto-expose off, automatic RLS on.
- 2026-10-23: Removed the pgcrypto dependency from migration 1 so it applies cleanly on Supabase. Checklist created.
