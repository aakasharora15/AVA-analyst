-- Talking back to a report.
-- Challenges: a member disputes a finding with evidence. The official score
-- never changes; a challenge is recorded, answered by the team and kept as
-- calibration evidence.
-- Questions: "Ask AVA" answers questions about one report from that report
-- only. Answers are written by the API (system role) after the model call;
-- members read their organisation's questions. Token usage stays internal.

create table if not exists public.finding_challenges (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  audit_id text not null references public.audits (id) on delete cascade,
  finding_id text not null references public.findings (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  author_name text not null default '',
  claim text not null check (length(trim(claim)) > 0),
  evidence text not null default '',
  status text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  response text not null default '',
  responded_by text,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists finding_challenges_audit on public.finding_challenges (audit_id);
alter table public.finding_challenges enable row level security;
revoke all on public.finding_challenges from anon;
drop policy if exists finding_challenges_read on public.finding_challenges;
create policy finding_challenges_read on public.finding_challenges for select using (app.member_role(org_id) is not null);
drop policy if exists finding_challenges_write on public.finding_challenges;
create policy finding_challenges_write on public.finding_challenges for insert
  with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst', 'Viewer']) and author_id = app.uid() and status = 'open');
drop policy if exists finding_challenges_answer on public.finding_challenges;
create policy finding_challenges_answer on public.finding_challenges for update
  using (app.has_role(org_id, array['Owner', 'Admin', 'Analyst'])) with check (app.has_role(org_id, array['Owner', 'Admin', 'Analyst']));
grant select, insert, update on public.finding_challenges to authenticated;

create table if not exists public.report_questions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organisations (id) on delete cascade,
  audit_id text not null references public.audits (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  user_name text not null default '',
  question text not null check (length(trim(question)) > 0),
  answer text not null default '',
  finding_ids text[] not null default '{}',
  status text not null default 'answered' check (status in ('answered', 'failed')),
  usage jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists report_questions_audit on public.report_questions (audit_id, created_at);
create index if not exists report_questions_org_month on public.report_questions (org_id, created_at);
alter table public.report_questions enable row level security;
revoke all on public.report_questions from anon, authenticated;
grant select (id, org_id, audit_id, user_id, user_name, question, answer, finding_ids, status, created_at) on public.report_questions to authenticated;
drop policy if exists report_questions_read on public.report_questions;
create policy report_questions_read on public.report_questions for select using (app.member_role(org_id) is not null);

-- Two-factor rule (migration 8) on the new tables too.
do $$
declare t text;
begin
  foreach t in array array['finding_challenges', 'report_questions'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated '
                   'using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
  end loop;
end $$;
