-- Repeatability test (Phase 3): findings of each original and its repeats, for
-- re-scoring under both formulas (scripts/compare_formulas.py). Changes nothing.
-- Copies no model output or personal data: only agent, category, severity, topic and status.
select json_build_object(
  'name', left(c.title, 40) || case when a.trigger = 'shadow' then ' (repeat ' || to_char(a.created_at, 'HH24:MI') || ')' else ' (original)' end,
  'type', c.type,
  'status', a.status,
  'score', a.score,
  'findings', coalesce((
    select json_agg(json_build_object('id', f.id, 'agent', f.agent, 'category', f.category, 'severity', f.severity,
                                      'status', f.status, 'match_key', f.match_key) order by f.position)
    from public.findings f where f.audit_id = a.id), '[]'::json)
) as audit
from public.audits a
join public.companies c on c.id = a.company_id
where a.status in ('complete', 'partial')
  and (a.id in (select run_state ->> 'shadowOf' from public.audits where trigger = 'shadow' and run_state ->> 'purpose' = 'recalibration')
       or (a.trigger = 'shadow' and a.run_state ->> 'purpose' = 'recalibration'))
order by c.title, a.created_at;
