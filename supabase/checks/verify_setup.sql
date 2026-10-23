-- Run in the Supabase SQL editor after the three migrations. Every row should say PASS.
select check_name, result, case when ok then 'PASS' else 'FAIL' end as status from (
  select 1 as n, 'Tables in public schema (expect 26)' as check_name,
         count(*)::text as result, count(*) = 26 as ok
  from pg_tables where schemaname = 'public'
  union all
  select 2, 'Tables WITHOUT row-level security (expect none)',
         coalesce(string_agg(tablename, ', '), 'none'), count(*) = 0
  from pg_tables where schemaname = 'public' and not rowsecurity
  union all
  select 3, 'Access policies on public tables (expect 39)',
         count(*)::text, count(*) = 39
  from pg_policies where schemaname = 'public'
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
) x order by n;
