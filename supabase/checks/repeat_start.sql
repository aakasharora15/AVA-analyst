-- Repeatability test (Phase 3), step 1: queue repeat runs of an audit you already have.
-- Change the two values on the "params" line, then Run in the Supabase SQL editor.
-- Each repeat re-judges exactly the evidence the original saw (no new web
-- searches), so it costs less than a full audit. The ava-advance job picks the
-- repeats up within a minute; each takes about 5 minutes. Repeats never change
-- the original audit, never count against plan usage and are not shown in the app.

with params as (select 'AVA Verdict%'::text as title_like, 1 as repeats),
orig as (
  select a.* from public.audits a join public.companies c on c.id = a.company_id, params p
  where c.title ilike p.title_like and a.trigger <> 'shadow' and a.status = 'complete'
  order by a.created_at desc limit 1),
shadows as (
  insert into public.audits (org_id, company_id, trigger, depth, status, input_snapshot, snapshot_hash, source_ids,
                             model_version, prompt_version, calibration_version, run_state)
  select o.org_id, o.company_id, 'shadow', o.depth, 'queued', o.input_snapshot, o.snapshot_hash,
         array(select distinct unnest(o.source_ids || coalesce((select array_agg(s.id) from public.sources s where s.audit_id = o.id), '{}'))),
         o.model_version, o.prompt_version, o.calibration_version,
         jsonb_build_object('shadowOf', o.id, 'purpose', 'recalibration')
  from orig o, params p, generate_series(1, p.repeats)
  returning id, org_id)
insert into public.agent_runs (audit_id, org_id, agent)
select s.id, s.org_id, g from shadows s, generate_series(1, 6) g;
