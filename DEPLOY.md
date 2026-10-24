# Deploying AVA

AVA runs as one Vercel project: the Vite front end, plus one Python function (`api/index.py`) serving every `/api/*` route. Data and sign-in run on Supabase. The six agents call the Claude API.

```
Browser ── reads (RLS) ──────────────► Supabase Postgres + Auth + Storage
   │                                        ▲
   └── writes, audits ──► /api (Vercel, FastAPI) ── as the user (RLS) / as system
                               │
                               └──► Claude API (six agents)
```

The front end still ships in demo mode by default (`VITE_AVA_DATA=mock`). Switching to live is one environment variable once the steps below are done.

## 1. Supabase

1. Create a project. Pick the region your clients expect (the app's default storage region label is United Kingdom, so London fits).
2. Apply the migrations in order. Either `supabase link` then `supabase db push`, or paste each file into the SQL editor:
   - `supabase/migrations/20261022000001_schema.sql`: tables, guards, audit log, limits, row-level security
   - `supabase/migrations/20261022000002_storage.sql`: private `data-room` bucket and its policies
   - `supabase/migrations/20261022000003_reference.sql`: calibration versions, outcome window, free-audit system organisation
3. **Authentication → Providers → Email:** turn on Confirm email. Set the minimum password length to 12.
4. **Authentication → URL configuration:** set Site URL to your domain. Add these redirect URLs:
   `https://YOUR-DOMAIN/onboarding`, `https://YOUR-DOMAIN/sign-in?state=reset`, `https://YOUR-DOMAIN/portfolio`.
5. **Single sign-on** (Enterprise plan only) needs Supabase SAML, which depends on your Supabase plan. Until a domain is configured, the sign-in screen shows "Single sign-on is not set up for this domain".
6. **Staging only:** `supabase/seed.sql` loads the demo portfolio as the organisation `demo-fund`. The last lines of the file show how to make yourself its Owner. Never seed a production project.

## 2. Vercel

1. **Settings → Environment Variables:** add everything in `.env.example`. Set `VITE_AVA_DATA=live` only when you are ready to leave demo mode.
2. Use the transaction pooler connection string (port 6543) for `DATABASE_URL`. The API turns prepared statements off, which the pooler needs.
3. **Production branch.** Vercel deploys production from the repository's default branch. This work is on `claude/design-implementation-0z8bwt`, so it only gets preview deployments until it is merged or the production branch is changed.
4. Crons in `vercel.json` run once a day, which is all the Hobby plan allows: cadence, shadow sample and drift, weekly digest, plus daily fallbacks for email and audit advancement.

## 3. Minute-level jobs

The running screen moves an audit forward while it is open. To keep audits moving and email flowing with nobody watching, run `supabase/cron.sql` once in the Supabase SQL editor (enable `pg_cron` and `pg_net` first, then replace the domain and cron secret placeholders). It calls `/api/cron/advance` every minute and `/api/cron/email` every five minutes.

On Vercel Pro you can schedule those two jobs in `vercel.json` instead.

## 4. Email

Mail goes into `email_outbox` first, then out through Resend when `RESEND_API_KEY` is set. Verify your sending domain in Resend and set `EMAIL_FROM` to an address on it. Without a key, mail stays queued and each row carries the reason.

## 5. Before the first client audit

- **Approve the prompts.** `ava_server/prompts/prompts-2026.10/` holds the shared rules and one file per agent. They are new and have not been approved (spec 0a). Have the Owner and a second reviewer sign off. Any change needs a new version folder and `AVA_PROMPT_VERSION` bumped.
- **Calibrate.** Run the harness on a frozen set of past audits:
  `python -m ava_server.cli calibrate --audits ID1 ID2 ... --runs 5 --venture-set pilot`.
  It fails when run-to-run spread exceeds `drift.maxRunVariance` in `config/engine.json`. Every weight and threshold there is still marked `[CALIBRATE]`.
- **Fill the placeholders:** `[PRICE]`, `[LIMIT]`, `[SEATS]`, `[RENEWAL DATE]`, `[CONFIRM WITH LEGAL]`, `[PRIVACY]`, `[TERMS]`, `[SALES EMAIL]`, team bios. Set `company_limit` and `seat_limit` per organisation; the database blocks the action at the limit.

## Model behaviour

- **Models.** Every plan runs the standard engine, `AVA_MODEL` (default `claude-sonnet-5-5`), so the same venture gets the same verdict on any plan. Pro Max and Enterprise can also run a Deep audit on `AVA_DEEP_MODEL` (default `claude-opus-5-5`). Both are exact model versions, recorded on every audit and agent run, and never shown to users.
- **No temperature.** This model rejects sampling parameters, so temperature cannot be set to 0. Repeatability comes from the pinned model and prompt versions, schema-constrained JSON output, fixed effort (`AVA_EFFORT`), frozen input snapshots, and code-side scoring. The monthly shadow sample measures what variance remains.
- **Refusal fallback.** With `AVA_REFUSAL_FALLBACK=default`, a refused agent request is retried server-side on Anthropic's fallback model. The model that actually answered is stored per agent run (`served_model`, `fallback_used`). Set it to `off` to fail the agent instead. One retry follows, then the audit goes Partial.
- **Drift and hold.** A monthly shadow sample re-runs past audits on their frozen inputs. A median score change above 6 starts hold mode automatically. New verdicts are then labelled Under review and directive alerts pause. Lifting a hold needs a written reason and a second reviewer:
  `python -m ava_server.cli lift-hold --reason "..." --by "Name" --second-reviewer "Name"`.

## Known limits

- **File text.** PDFs are read in the browser with pdf.js, and text formats are read directly. Scanned PDFs (no text layer), Word, PowerPoint and Excel files are stored but contribute no text yet. The data room says so on upload. Server-side extraction is the next step.
- **Live mode testing.** The API, schema, policies and lifecycle are tested against Postgres (`npm run test:api`). The browser's live adapter (`src/data/repo.live.js`) builds and returns the same shapes as the demo layer, but it has not yet been run against a real Supabase project. Do one full walkthrough on staging before inviting clients: sign up, onboard, add a company, run an audit, share, and accept an invite.
- **Function time.** One agent attempt runs per API call, inside Vercel's 300-second limit. A claim older than 10 minutes counts as a failed attempt and is retried.

## Local development

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
npm test                 # front-end and engine
npm run test:api         # starts a throwaway Postgres, runs the API tests
npm run dev              # demo mode
npm run api & npm run dev:live   # live mode against your Supabase (needs .env.local)
```
