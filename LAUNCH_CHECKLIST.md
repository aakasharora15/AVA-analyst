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
- [~] 1.6 Verify: run supabase/checks/verify_setup.sql, every row PASS
- [ ] 1.7 Auth settings: email confirmation on, password minimum 12, site URL, redirect URLs
- [ ] 1.8 Auth emails: custom SMTP (Resend) so sign-up emails are not rate-limited
- [ ] 1.9 Enable pg_cron and pg_net (needed in Stage 3)

## Stage 2. Vercel (hosting and the API)

- [ ] 2.1 Add environment variables from .env.example
- [ ] 2.2 Production branch: merge this branch or point production at it
- [ ] 2.3 Deploy; confirm /api/health returns ok
- [ ] 2.4 Custom domain and HTTPS

## Stage 3. Background jobs and email

- [ ] 3.1 Run supabase/cron.sql (audit advancement every minute, email every 5 minutes)
- [ ] 3.2 Resend: verify sending domain, set EMAIL_FROM and RESEND_API_KEY
- [ ] 3.3 Confirm a test email arrives (invite yourself)

## Stage 4. Staging walkthrough (live mode, real Supabase)

- [ ] 4.1 Set VITE_AVA_DATA=live on a staging deployment
- [ ] 4.2 Sign up, verify email, onboard
- [ ] 4.3 Add a company, upload a PDF, run a full audit on the real Claude API
- [ ] 4.4 Record cost and run time of one audit
- [ ] 4.5 Dismiss a finding, comment, assign an owner
- [ ] 4.6 Share a report (with password), open it signed out, revoke it
- [ ] 4.7 Invite a second account, accept, check role limits (Viewer cannot run audits)
- [ ] 4.8 CSV import, alerts, outcomes, export
- [ ] 4.9 Free audit with a work email; second attempt same domain is blocked
- [ ] 4.10 Real phones and browsers (iOS Safari, Android Chrome, desktop); PDF print
- [ ] 4.11 GitHub Actions CI green

## Stage 5. Product sign-off

- [ ] 5.1 Approve agent prompts (Owner plus second reviewer)
- [ ] 5.2 Calibrate on 10 to 20 past deals with known outcomes
- [ ] 5.3 Fill placeholders: [PRICE], [LIMIT], [SEATS], [RENEWAL DATE], [SALES EMAIL], team bios
- [ ] 5.4 Legal: [PRIVACY], [TERMS], retention period
- [ ] 5.5 Decide single sign-on for Enterprise at launch

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

- 2026-10-23: Staging project created. Not linked to GitHub; migrations applied by hand. Data API on, auto-expose off, automatic RLS on.
- 2026-10-23: Removed the pgcrypto dependency from migration 1 so it applies cleanly on Supabase. Checklist created.
