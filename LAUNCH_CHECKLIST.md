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
- [ ] 1.8 Auth emails: custom SMTP (Resend). Blocked on owning a domain: Supabase's built-in email only reaches project team members, so public sign-up needs this
- [x] 1.9 Enable pg_cron and pg_net (2026-10-23)
- [~] 1.10 Google sign-in: Google Cloud project "ava-verdict" (dedicated AVA Verdict account), OAuth client "AVA Verdict staging" (External, Testing), Supabase Google provider saved. Remaining: rotate the secret exposed in a screenshot, test once the site URL is set
- [ ] 1.11 Microsoft sign-in (recommended over Apple for funds and corporates; awaiting decision)

## Stage 2. Vercel (hosting and the API)

- [x] 2.1 Add environment variables: 5 Config + 3 Secret, Production and Preview (2026-10-24)
- [x] 2.2 Production branch: claude/design-implementation-0z8bwt is the repository's only branch, so Vercel production already builds from it (2026-10-24)
- [x] 2.3 Deploy; https://ava-analyst.vercel.app/api/health returns ok: database, Anthropic key, auth verification and cron secret all true (2026-10-24)
- [ ] 2.4 Custom domain and HTTPS

## Stage 3. Background jobs and email

- [x] 3.1 Run supabase/cron.sql: ava-advance every minute and ava-email every 5 minutes, both returning 200 (2026-10-24)
- [ ] 3.2 Resend: verify sending domain, set EMAIL_FROM and RESEND_API_KEY
- [ ] 3.3 Confirm a test email arrives (invite yourself)

## Stage 4. Staging walkthrough (live mode, real Supabase)

- [x] 4.1 Set VITE_AVA_DATA=live and redeploy (2026-10-24)
- [x] 4.1a Public demo workspace: demo@avaverdict.com / VerdictDemo2026 or /demo; sample data in the visitor's browser only, no database, Claude API or email; exit returns to the landing page (2026-10-24)
- [ ] 4.2 Sign up, verify email, onboard
- [ ] 4.3 Add a company, upload a PDF, run a full audit on the real Claude API
- [ ] 4.4 Record cost and run time of one audit
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
- [ ] 5.3 Fill placeholders: [PRICE], [LIMIT], [SEATS], [RENEWAL DATE], [SALES EMAIL], team bios
- [ ] 5.4 Legal: [PRIVACY], [TERMS], retention period
- [ ] 5.5 Decide single sign-on for Enterprise at launch
- [ ] 5.6 Google Auth Platform: complete Branding (home page, privacy, terms, authorised domain), then Publish app so anyone can use Continue with Google

## Stage 6. Build before or soon after first client

- [ ] 6.1 Read Word, PowerPoint and Excel files (decks often arrive as .pptx)
- [ ] 6.2 Billing (plans, payment, limits)
- [ ] 6.3 Error monitoring and failed-audit alerts
- [ ] 6.4 Internal admin screen for drift reports and holds

## Stage 7. Launch

- [ ] 7.1 Production Supabase separate from staging (no seed data). Upgrade to Pro the day the first client signs (backups, no pausing).
- [ ] 7.2 Backups: Supabase daily backups confirmed, restore tested once
- [ ] 7.3 Switch production to live; first pilot client

## Log

- 2026-10-24: Cron jobs fixed: Vault held a placeholder app URL and cron secret. cron.sql now refuses placeholders and updates existing values; the API strips stray whitespace from the secret; /api/health shows a cron secret fingerprint to compare with Vault.
- 2026-10-23: Staging project created. Not linked to GitHub; migrations applied by hand. Data API on, auto-expose off, automatic RLS on.
- 2026-10-23: Removed the pgcrypto dependency from migration 1 so it applies cleanly on Supabase. Checklist created.
