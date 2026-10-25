-- Verified company metrics (Enterprise).
-- Each month the founder reports key numbers through a private link (no
-- login), the client's team confirms them, and an AVA reviewer verifies them.
-- Writes go only through the API (system role); members read their own
-- organisation's metrics. Which plans track is set in config/plans.json.

alter table public.companies
  add column if not exists owner_id uuid references auth.users (id) on delete set null,
  add column if not exists founder_email text;

create table if not exists public.company_metrics (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  revenue numeric check (revenue >= 0),
  cash numeric check (cash >= 0),
  burn numeric check (burn >= 0),
  headcount integer check (headcount >= 0),
  customers integer check (customers >= 0),
  status text not null default 'operating' check (status in ('operating', 'raising', 'acquired', 'shut_down', 'paused')),
  note text not null default '',
  source text not null check (source in ('founder', 'team')),
  submitted_by text not null default '',
  submitted_at timestamptz not null default now(),
  flags jsonb not null default '[]',
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_by_name text,
  confirmed_at timestamptz,
  ava_status text not null default 'pending' check (ava_status in ('pending', 'verified', 'queried')),
  ava_reviewer text,
  ava_reviewed_at timestamptz,
  ava_note text not null default '',
  unique (company_id, period)
);
create index if not exists company_metrics_review on public.company_metrics (ava_status, confirmed_at);
alter table public.company_metrics enable row level security;
revoke all on public.company_metrics from anon;
revoke insert, update, delete on public.company_metrics from authenticated;
grant select on public.company_metrics to authenticated;
drop policy if exists company_metrics_read on public.company_metrics;
create policy company_metrics_read on public.company_metrics for select using (app.member_role(org_id) is not null);

-- One private link per company per month. Only a hash of the token is stored.
create table if not exists public.metric_requests (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  period date not null,
  -- founder: a private link to the founder; team: a task for the company owner.
  kind text not null default 'founder' check (kind in ('founder', 'team')),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  reminded_at timestamptz,
  escalated_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, period)
);
alter table public.metric_requests enable row level security;
revoke all on public.metric_requests from anon, authenticated;

-- Material movement in the numbers raises an alert like a score move does.
alter table public.alerts drop constraint if exists alerts_trigger_check;
alter table public.alerts add constraint alerts_trigger_check check (trigger in ('directive', 'score', 'high', 'evidence', 'metrics'));

-- Two-factor rule (migration 8) on the new tables too.
do $$
declare t text;
begin
  foreach t in array array['company_metrics', 'metric_requests'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated '
                   'using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
  end loop;
end $$;
