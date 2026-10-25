-- Run in the Supabase SQL editor after applying every migration. Every row should say PASS.
select check_name, result, case when ok then 'PASS' else 'FAIL' end as status from (
  select 1 as n, 'Tables in public schema (expect 27)' as check_name,
         count(*)::text as result, count(*) = 27 as ok
  from pg_tables where schemaname = 'public'
  union all
  select 2, 'Tables WITHOUT row-level security (expect none)',
         coalesce(string_agg(tablename, ', '), 'none'), count(*) = 0
  from pg_tables where schemaname = 'public' and not rowsecurity
  union all
  select 3, 'Access policies on public tables (expect 39)',
         count(*)::text, count(*) = 39
  from pg_policies where schemaname = 'public' and policyname <> 'mfa_required'
  union all
  select 4, 'Data room bucket exists and is private',
         coalesce((select case when public then 'PUBLIC' else 'private' end from storage.buckets where id = 'data-room'), 'missing'),
         coalesce((select not public from storage.buckets where id = 'data-room'), false)
  union all
  select 5, 'Data room upload/read policies (expect 2)',
         count(*)::text, count(*) = 2
  from pg_policies where schemaname = 'storage' and policyname like 'data_room_%'
  union all
  select 6, 'Calibration versions (expect 2)', count(*)::text, count(*) = 2 from public.calibration_versions
  union all
  select 7, 'Free-audit system organisation', count(*)::text, count(*) = 1 from public.organisations where id = 'free-audits'
  union all
  select 8, 'Audit log triggers (expect 11)', count(*)::text, count(*) = 11
  from pg_trigger where tgname like '%\_log' and not tgisinternal
  union all
  select 9, 'Billing (migration 7): billing_events table and subscription columns',
         case when to_regclass('public.billing_events') is not null
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organisations' and column_name = 'subscription_status')
              then 'present' else 'missing' end,
         to_regclass('public.billing_events') is not null
           and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organisations' and column_name = 'subscription_status')
  union all
  select 10, 'Two-factor (migration 8): a policy on every protected table',
         (select count(*) from pg_policies where schemaname = 'public' and policyname = 'mfa_required')::text || ' of '
           || (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)::text,
         (select count(*) from pg_policies where schemaname = 'public' and policyname = 'mfa_required')
           = (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)
           and (select count(*) from pg_policies where schemaname = 'public' and policyname = 'mfa_required') > 0
) x order by n;
