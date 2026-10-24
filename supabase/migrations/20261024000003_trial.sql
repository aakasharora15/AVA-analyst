-- Free trial for new organisations: 14 days, 3 audits, 3 seats
-- (config/plans.json). Allowances are enforced by the API before any audit
-- starts; seats by the existing seat-limit trigger.

alter table public.organisations add column if not exists trial_ends_at timestamptz;
alter table public.organisations alter column plan set default 'trial';
