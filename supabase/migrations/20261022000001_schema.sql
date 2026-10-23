-- AVA schema (spec section 5). Postgres on Supabase.
--
-- Security model
-- * Every user-facing table has row-level security on.
-- * The API runs user writes as the signed-in user (role `authenticated` with
--   their JWT claims), so these policies enforce the spec 4.8 matrix in the
--   database itself, not only in application code.
-- * System work (agents, scoring, crons) runs as `service_role`, which
--   bypasses RLS. Triggers stop users from writing system-owned columns.
-- * Every state change writes to audit_log through triggers.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerations (as check constraints, so new values need only a migration)

create table public.organisations (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  kind text not null default 'VC fund' check (kind in ('VC fund', 'Corporate venture or development', 'Accelerator')),
  logo_url text,
  branding jsonb not null default '{"coverName": null, "footer": "Confidential. Prepared for the investment committee.", "attribution": true}',
  -- Billing (Owner only)
  plan text not null default 'Portfolio',
  renewal_date date,
  company_limit integer,                  -- [LIMIT]
  seat_limit integer,                     -- [SEATS]
  billing_contact text,
  -- Settings (Owner and Admin)
  alert_rules jsonb not null default '{"directive": true, "score": true, "high": true, "evidence": false}',
  delivery jsonb not null default '{"inApp": true, "email": "weekly", "immediate": true}',
  default_cadence jsonb not null default '{"mode": "quarterly", "day": 1}',
  currency text not null default 'GBP',
  retention_period text,                  -- [CONFIRM WITH LEGAL]
  storage_region text not null default 'United Kingdom',
  finding_display text not null default 'cited',
  integrations jsonb not null default '{}',
  -- System
  hold_mode boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  initials text not null default '',
  email text not null,
  title text not null default '',
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id text not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('Owner', 'Admin', 'Analyst', 'Viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'removed')),
  last_active timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create unique index memberships_one_owner on public.memberships (org_id) where role = 'Owner' and status = 'active';

create table public.invites (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('Admin', 'Analyst', 'Viewer')),
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.companies (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  title text not null,
  description text not null default '',
  industry text not null,
  country text not null,
  city text not null default '',
  model text not null default '',
  target text not null default '',
  type text not null default 'startup' check (type in ('startup', 'strategy', 'campaign')),
  deal_lead text not null default '',
  stage text not null default '',
  fund text not null default '',
  budget text not null default '',
  extra jsonb not null default '{}',
  cadence jsonb not null default '{"mode": "inherit", "paused": false, "resumeOn": null}',
  next_run date,
  scheduled_audit date,
  coverage jsonb not null default '[]',
  open_items jsonb not null default '[]',
  todos jsonb not null default '{}',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_title_per_org on public.companies (org_id, lower(title));

create table public.audits (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  date date not null default current_date,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'partial', 'failed')),
  trigger text not null default 'manual' check (trigger in ('manual', 'scheduled', 'evidence', 'import', 'shadow')),
  -- Scoring (system only)
  score integer,
  raw_score integer,
  exposure jsonb,
  cap jsonb,
  base_directive text check (base_directive in ('PROCEED', 'HOLD', 'PIVOT', 'KILL')),
  final_directive text check (final_directive in ('PROCEED', 'HOLD', 'PIVOT', 'KILL')),
  overridden boolean not null default false,
  override jsonb,
  override_cited text[] not null default '{}',
  override_rejected text,
  score_excluding_dismissed integer,
  coverage jsonb,
  skipped_sections jsonb not null default '[]',
  orchestrator jsonb,
  -- Reproducibility
  model_version text,
  prompt_version text,
  calibration_version text,
  input_snapshot jsonb,
  snapshot_hash text,
  source_ids text[] not null default '{}',
  drift_flag boolean not null default false,
  under_review boolean not null default false,
  hold_resolution text check (hold_resolution in ('confirmed', 're-scored')),
  counted_against_usage boolean not null default true,
  -- Outcome window (written at issue, never edited)
  first_checkpoint date,
  final_checkpoint date,
  outcome_window_version text,
  -- Run state
  run_state jsonb not null default '{}',
  run_seconds integer,
  started_at timestamptz,
  finished_at timestamptz,
  notify_on_complete boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index audits_company on public.audits (company_id, date);
create index audits_running on public.audits (status) where status in ('queued', 'running');

create table public.agent_runs (
  id text primary key default gen_random_uuid()::text,
  audit_id text not null references public.audits (id) on delete cascade,
  org_id text not null references public.organisations (id) on delete cascade,
  agent integer not null check (agent between 1 and 6),
  status text not null default 'queued' check (status in ('queued', 'working', 'complete', 'skipped', 'failed')),
  duration_s numeric,
  retry_count integer not null default 0,
  error_reason text,
  schema_result text check (schema_result in ('valid', 'malformed')),
  served_model text,
  fallback_used boolean not null default false,
  usage jsonb,
  output jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  unique (audit_id, agent)
);

create table public.sources (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  audit_id text references public.audits (id) on delete set null,
  type text not null check (type in ('uploaded', 'public')),
  title text not null,
  kind text not null default 'File',
  date date not null default current_date,
  reliability text not null default 'Unrated',
  note text not null default '',
  url text,
  retrieval_date date,
  storage_path text,
  content_hash text,
  extract text,
  added_by text not null default '',
  status text not null default 'read' check (status in ('reading', 'read', 'superseded')),
  coverage_topic text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index sources_company on public.sources (company_id);

create table public.findings (
  id text primary key default gen_random_uuid()::text,
  audit_id text not null references public.audits (id) on delete cascade,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  agent integer not null check (agent between 1 and 5),
  section text not null,
  category text not null check (category in ('Market', 'Financial', 'Operational', 'Competition', 'Customer psychology', 'Geographic', 'Regulatory')),
  severity text not null check (severity in ('HIGH', 'MEDIUM', 'LOW')),
  topic text not null default '',
  match_key text not null,
  title text not null,
  text text not null,
  sources text[] not null default '{}',
  dropped_citations text[] not null default '{}',
  -- Workflow (users with Analyst or above)
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'resolved')),
  owner text,
  dismiss_reason text,
  history jsonb not null default '[]',
  first_seen_audit text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint dismiss_needs_reason check (status <> 'dismissed' or length(trim(coalesce(dismiss_reason, ''))) > 0)
);
create index findings_audit on public.findings (audit_id);
create index findings_match on public.findings (company_id, match_key);

create table public.comments (
  id text primary key default gen_random_uuid()::text,
  finding_id text not null references public.findings (id) on delete cascade,
  org_id text not null references public.organisations (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  author_name text not null default '',
  text text not null check (length(trim(text)) > 0),
  created_at timestamptz not null default now()
);

create table public.alerts (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  audit_id text references public.audits (id) on delete cascade,
  previous_audit_id text references public.audits (id) on delete set null,
  trigger text not null check (trigger in ('directive', 'score', 'high', 'evidence')),
  from_score integer,
  to_score integer,
  from_directive text,
  to_directive text,
  caused_by_override boolean not null default false,
  anchoring_finding_ids text[] not null default '{}',
  finding_id text,
  detail text,
  date date not null default current_date,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_org on public.alerts (org_id, date desc);

create table public.alert_reads (
  alert_id text not null references public.alerts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create table public.alert_snoozes (
  org_id text not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id text not null references public.companies (id) on delete cascade,
  until date not null,
  primary key (user_id, company_id)
);

create table public.outcomes (
  audit_id text primary key references public.audits (id) on delete cascade,
  org_id text not null references public.organisations (id) on delete cascade,
  result text not null check (result in ('grew', 'flat', 'changed', 'exited', 'writtenDown', 'shutDown')),
  checkpoint text not null check (checkpoint in ('first', 'final')),
  outcome_date date not null,
  evidence jsonb not null check (length(trim(coalesce(evidence ->> 'value', ''))) > 0),
  logged_by text not null,
  logged_by_id uuid references auth.users (id),
  logged_at timestamptz not null default now()
);

create table public.share_links (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  org_id text not null references public.organisations (id) on delete cascade,
  audit_id text not null references public.audits (id) on delete cascade,
  recipient_email text not null,
  expires_at date not null default current_date + 14,
  password_hash text,
  has_password boolean generated always as (password_hash is not null) stored,
  revoked boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.share_views (
  id bigserial primary key,
  token text not null references public.share_links (token) on delete cascade,
  viewed_at timestamptz not null default now()
);

create table public.import_jobs (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  file text not null,
  mapping jsonb not null default '{}',
  rows_valid integer not null default 0,
  rows_rejected integer not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  -- No foreign key: the log outlives what it records, including a deleted organisation.
  org_id text,
  at timestamptz not null default now(),
  user_id uuid,
  who text not null default 'AVA',
  action text not null,
  object_type text not null,
  object_id text,
  detail text not null default ''
);
create index audit_log_org on public.audit_log (org_id, at desc);

create table public.email_outbox (
  id bigserial primary key,
  org_id text references public.organisations (id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  kind text not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table public.free_audits (
  id text primary key default gen_random_uuid()::text,
  email text not null,
  domain text not null,
  inputs jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'partial', 'failed')),
  audit_id text references public.audits (id) on delete set null,
  result jsonb,
  converted_org text references public.organisations (id),
  created_at timestamptz not null default now()
);
create index free_audits_domain_month on public.free_audits (domain, created_at);

-- Calibration, drift and hold (spec 4.0)
create table public.calibration_versions (
  version text primary key,
  model_version text not null,
  prompt_version text not null,
  weights jsonb not null,
  variance numeric,
  agreement numeric,
  score_shift numeric,
  approved_by_owner text,
  approved_by_second_reviewer text,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.calibration_runs (
  id text primary key default gen_random_uuid()::text,
  venture_type text not null,
  venture_set text not null,
  frozen_source_set text not null,
  prompt_version text not null,
  calibration_version text not null,
  scores jsonb not null default '[]',
  variance numeric,
  flip_rate numeric,
  created_at timestamptz not null default now()
);

create table public.shadow_runs (
  id text primary key default gen_random_uuid()::text,
  original_audit text not null references public.audits (id) on delete cascade,
  snapshot_hash text,
  model_version text,
  prompt_version text,
  calibration_version text,
  run_date timestamptz not null default now(),
  purpose text not null check (purpose in ('monthly', 'recalibration', 're-score')),
  original_score integer,
  shadow_score integer,
  score_change integer,
  original_directive text,
  shadow_directive text,
  flipped boolean
);

create table public.drift_reports (
  id text primary key default gen_random_uuid()::text,
  period text not null,
  sample_size integer not null,
  median_change numeric not null,
  flip_rate numeric not null,
  level text not null check (level in ('normal', 'warning', 'hold')),
  owner_decision text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.hold_events (
  id text primary key default gen_random_uuid()::text,
  started_at timestamptz not null default now(),
  trigger_report text references public.drift_reports (id),
  lifted_at timestamptz,
  lift_reason text,
  lifted_by text,
  second_reviewer text,
  affected_audits jsonb not null default '[]'
);

create table public.outcome_window_versions (
  version text primary key,
  first_months integer not null,
  final_months integer not null,
  effective_from date not null
);

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function app.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;

create or replace function app.member_role(org text) returns text
language sql stable security definer set search_path = public as $$
  select role from public.memberships
  where org_id = org and user_id = app.uid() and status = 'active'
$$;

create or replace function app.has_role(org text, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.member_role(org) = any (roles), false)
$$;

create or replace function app.is_system() returns boolean
language sql stable as $$
  -- The role decides, never a session setting a user could influence.
  select current_user in ('postgres', 'service_role', 'supabase_admin')
$$;

create or replace function app.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where user_id = app.uid()), nullif(current_setting('app.actor', true), ''), 'AVA')
$$;

grant usage on schema app to authenticated, anon, service_role;
grant execute on all functions in schema app to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Guards: users may only touch the columns their workflow owns.

create or replace function app.guard_finding_update() returns trigger
language plpgsql as $$
begin
  if app.is_system() then return new; end if;
  if (new.audit_id, new.org_id, new.company_id, new.agent, new.section, new.category, new.severity, new.topic,
      new.match_key, new.title, new.text, new.sources, new.first_seen_audit)
     is distinct from
     (old.audit_id, old.org_id, old.company_id, old.agent, old.section, old.category, old.severity, old.topic,
      old.match_key, old.title, old.text, old.sources, old.first_seen_audit) then
    raise exception 'Only the status, owner and dismissal reason of a finding can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger findings_guard before update on public.findings for each row execute function app.guard_finding_update();

create or replace function app.guard_org_update() returns trigger
language plpgsql as $$
begin
  if app.is_system() then return new; end if;
  if (new.plan, new.renewal_date, new.company_limit, new.seat_limit, new.billing_contact)
     is distinct from (old.plan, old.renewal_date, old.company_limit, old.seat_limit, old.billing_contact)
     and app.member_role(old.id) is distinct from 'Owner' then
    raise exception 'Only the Owner can change billing' using errcode = '42501';
  end if;
  if new.hold_mode is distinct from old.hold_mode then
    raise exception 'Hold mode is set by drift monitoring only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organisations_guard before update on public.organisations for each row execute function app.guard_org_update();

create or replace function app.guard_membership() returns trigger
language plpgsql as $$
begin
  if app.is_system() then return coalesce(new, old); end if;
  -- Deleting the organisation cascades to its memberships, the Owner's included.
  if tg_op = 'DELETE' and not exists (select 1 from public.organisations where id = old.org_id) then return old; end if;
  -- Nobody but the system (ownership transfer) changes or removes the Owner.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'Owner' then
    raise exception 'Transfer ownership to change the Owner' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'Owner' then
    raise exception 'Transfer ownership to make someone the Owner' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_guard before insert or update or delete on public.memberships for each row execute function app.guard_membership();

create or replace function app.guard_outcome() returns trigger
language plpgsql as $$
begin
  -- An acquisition below the last valuation is always a written-down or distressed sale.
  if new.result = 'exited' and coalesce((new.evidence ->> 'belowLastValuation')::boolean, false) then
    raise exception 'An acquisition below the last valuation is logged as Written down or distressed sale' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger outcomes_guard before insert or update on public.outcomes for each row execute function app.guard_outcome();

-- Checkpoint dates are written once, at issue, and never edited.
create or replace function app.guard_checkpoints() returns trigger
language plpgsql as $$
begin
  if old.first_checkpoint is not null and (new.first_checkpoint, new.final_checkpoint, new.outcome_window_version)
     is distinct from (old.first_checkpoint, old.final_checkpoint, old.outcome_window_version) then
    raise exception 'Outcome checkpoint dates cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger audits_checkpoints before update on public.audits for each row execute function app.guard_checkpoints();

-- ---------------------------------------------------------------------------
-- Audit log: every state-changing action on user-facing tables.

create or replace function app.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  org text;
  obj text;
  detail text := '';
  rec record := coalesce(new, old);
  j jsonb := to_jsonb(coalesce(new, old));
begin
  org := case tg_table_name when 'organisations' then j ->> 'id' else j ->> 'org_id' end;
  obj := case tg_table_name
    when 'memberships' then j ->> 'user_id'
    when 'outcomes' then j ->> 'audit_id'
    when 'share_links' then j ->> 'token'
    else j ->> 'id' end;
  if tg_table_name = 'findings' then
    if tg_op <> 'UPDATE' then return null; end if;
    if new.status is distinct from old.status then
      detail := format('Marked "%s" as %s%s', new.title, initcap(new.status),
                       case when new.status = 'dismissed' then ': ' || new.dismiss_reason
                            when old.status = 'dismissed' then ' (restored)' else '' end);
    elsif new.owner is distinct from old.owner then
      detail := format('Assigned "%s" to %s', new.title, coalesce(new.owner, 'nobody'));
    else
      return null;
    end if;
  elsif tg_table_name = 'comments' then detail := 'Commented on a finding';
  elsif tg_table_name = 'companies' then detail := format('%s company %s', initcap(lower(tg_op)) || 'd', rec.title);
  elsif tg_table_name = 'memberships' then detail := format('%s membership: role %s, status %s', initcap(lower(tg_op)), rec.role, rec.status);
  elsif tg_table_name = 'outcomes' then detail := format('Logged outcome %s', rec.result);
  elsif tg_table_name = 'share_links' then detail := case when tg_op = 'UPDATE' and new.revoked then 'Revoked share link for ' || rec.recipient_email else 'Shared a report with ' || rec.recipient_email end;
  elsif tg_table_name = 'sources' then detail := format('%s source %s', initcap(lower(tg_op)), rec.title);
  elsif tg_table_name = 'organisations' then detail := 'Updated organisation settings';
  elsif tg_table_name = 'import_jobs' then detail := format('Imported %s companies from %s', rec.rows_valid, rec.file);
  elsif tg_table_name = 'invites' then detail := format('Invited %s as %s', rec.email, rec.role);
  elsif tg_table_name = 'audits' then
    if tg_op = 'INSERT' then detail := 'Started an audit';
    elsif new.status is distinct from old.status and new.status in ('complete', 'partial', 'failed') then
      detail := format('Audit %s%s', new.status, case when new.final_directive is not null then '. Directive ' || new.final_directive || '.' else '' end);
    else return null; end if;
  else detail := tg_op;
  end if;
  insert into public.audit_log (org_id, user_id, who, action, object_type, object_id, detail)
  values (org, app.uid(), app.actor_name(), tg_table_name || '.' || lower(tg_op), tg_table_name, obj, detail);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organisations', 'memberships', 'invites', 'companies', 'audits', 'findings', 'comments', 'sources', 'outcomes', 'share_links', 'import_jobs']
  loop
    execute format('create trigger %I_log after insert or update or delete on public.%I for each row execute function app.log_change()', t, t);
  end loop;
end $$;

-- Usage limits (spec 4.10): block the action at the limit.
create or replace function app.enforce_company_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  select company_limit into lim from public.organisations where id = new.org_id;
  if lim is not null and (select count(*) from public.companies where org_id = new.org_id) >= lim then
    raise exception 'Monitored company limit reached (%). Contact us to change your plan.', lim using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger companies_limit before insert on public.companies for each row execute function app.enforce_company_limit();

create or replace function app.enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  select seat_limit into lim from public.organisations where id = new.org_id;
  if lim is not null and new.status = 'active'
     and (select count(*) from public.memberships where org_id = new.org_id and status = 'active' and user_id <> new.user_id) >= lim then
    raise exception 'Seat limit reached (%). Contact us to add seats.', lim using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger memberships_limit before insert or update on public.memberships for each row execute function app.enforce_seat_limit();

-- ---------------------------------------------------------------------------
-- Row-level security (spec 4.8)
--
-- | Action                                         | Owner | Admin | Analyst | Viewer | Guest |
-- | Billing, delete organisation, transfer owner    |  yes  |  no   |   no    |   no   |  no   |
-- | Manage members and roles                        |  yes  |  yes  |   no    |   no   |  no   |
-- | Alert rules, cadence defaults, integrations     |  yes  |  yes  |   no    |   no   |  no   |
-- | Create companies, import, run audits            |  yes  |  yes  |   yes   |   no   |  no   |
-- | Upload to data room                             |  yes  |  yes  |   yes   |   no   |  no   |
-- | Change finding status, assign owner             |  yes  |  yes  |   yes   |   no   |  no   |
-- | Comment on findings                             |  yes  |  yes  |   yes   |   yes  |  no   |
-- | Export and share                                |  yes  |  yes  |   yes   |   yes  |  no   |
-- | View reports                                    |  all  |  all  |   all   |   all  | one shared report (via API) |

do $$
declare t text;
begin
  foreach t in array array['organisations', 'profiles', 'memberships', 'invites', 'companies', 'audits', 'agent_runs', 'sources',
    'findings', 'comments', 'alerts', 'alert_reads', 'alert_snoozes', 'outcomes', 'share_links', 'share_views', 'import_jobs',
    'audit_log', 'email_outbox', 'free_audits', 'calibration_versions', 'calibration_runs', 'shadow_runs', 'drift_reports',
    'hold_events', 'outcome_window_versions']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Members read everything in their organisation.
create policy org_read on public.organisations for select using (app.member_role(id) is not null);
create policy org_settings on public.organisations for update using (app.has_role(id, array['Owner', 'Admin'])) with check (app.has_role(id, array['Owner', 'Admin']));
create policy org_delete on public.organisations for delete using (app.has_role(id, array['Owner']));

create policy profiles_read on public.profiles for select using (
  user_id = app.uid() or exists (
    select 1 from public.memberships m1 join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = app.uid() and m1.status = 'active' and m2.user_id = profiles.user_id));
create policy profiles_own on public.profiles for update using (user_id = app.uid()) with check (user_id = app.uid());

create policy members_read on public.memberships for select using (app.member_role(org_id) is not null);
create policy members_manage_ins on public.memberships for insert with check (app.has_role(org_id, array['Owner', 'Admin']));
create policy members_manage_upd on public.memberships for update using (app.has_role(org_id, array['Owner', 'Admin'])) with check (app.has_role(org_id, array['Owner', 'Admin']));
create policy members_manage_del on public.memberships for delete using (app.has_role(org_id, array['Owner', 'Admin']));

create policy invites_manage on public.invites for all using (app.has_role(org_id, array['Owner', 'Admin'])) with check (app.has_role(org_id, array['Owner', 'Admin']));

create policy companies_read on public.companies for select using (app.member_role(org_id) is not null);
create policy companies_write_ins on public.companies for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));
create policy companies_write_upd on public.companies for update using (app.has_role(org_id, array['Owner', 'Admin', 'Analyst'])) with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));
create policy companies_delete on public.companies for delete using (app.has_role(org_id, array['Owner', 'Admin']));

-- Shadow re-runs (drift monitoring) are internal and never shown to users.
create policy audits_read on public.audits for select using (app.member_role(org_id) is not null and trigger <> 'shadow');
create policy audits_run on public.audits for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']) and status = 'queued' and score is null);

create policy agent_runs_read on public.agent_runs for select using (app.member_role(org_id) is not null);

create policy sources_read on public.sources for select using (app.member_role(org_id) is not null);
create policy sources_upload on public.sources for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']) and type = 'uploaded');
create policy sources_update on public.sources for update using (app.has_role(org_id, array['Owner', 'Admin', 'Analyst'])) with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));

create policy findings_read on public.findings for select using (app.member_role(org_id) is not null);
create policy findings_workflow on public.findings for update using (app.has_role(org_id, array['Owner', 'Admin', 'Analyst'])) with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));

create policy comments_read on public.comments for select using (app.member_role(org_id) is not null);
create policy comments_write on public.comments for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst', 'Viewer']) and author_id = app.uid());

create policy alerts_read on public.alerts for select using (app.member_role(org_id) is not null);
create policy alert_reads_own on public.alert_reads for all using (user_id = app.uid()) with check (user_id = app.uid());
create policy alert_snoozes_own on public.alert_snoozes for all using (user_id = app.uid()) with check (user_id = app.uid() and app.member_role(org_id) is not null);

create policy outcomes_read on public.outcomes for select using (app.member_role(org_id) is not null);
create policy outcomes_ins on public.outcomes for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));
create policy outcomes_upd on public.outcomes for update using (app.has_role(org_id, array['Owner', 'Admin', 'Analyst'])) with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));

create policy share_read on public.share_links for select using (app.member_role(org_id) is not null);
create policy share_create on public.share_links for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst', 'Viewer']) and created_by = app.uid());
create policy share_revoke on public.share_links for update using (created_by = app.uid() or app.has_role(org_id, array['Owner', 'Admin'])) with check (app.member_role(org_id) is not null);
create policy share_views_read on public.share_views for select using (exists (select 1 from public.share_links s where s.token = share_views.token and app.member_role(s.org_id) is not null));

create policy import_read on public.import_jobs for select using (app.member_role(org_id) is not null);
create policy import_run on public.import_jobs for insert with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));

create policy audit_log_read on public.audit_log for select using (app.member_role(org_id) is not null);

-- free_audits, email_outbox, calibration, shadow, drift and hold tables have
-- no user policies: only the system (service_role) reads or writes them.

grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- Members see whether a share link has a password, never its hash.
revoke select on public.share_links from authenticated;
grant select (token, org_id, audit_id, recipient_email, expires_at, has_password, revoked, created_by, created_at) on public.share_links to authenticated;
