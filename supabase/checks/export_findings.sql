-- Export every finished audit's findings for scripts/compare_formulas.py.
-- Run in the Supabase SQL editor. Copies no model output, prompts or personal
-- data: only each finding's agent, category, severity, topic and status.
select json_build_object(
  'name', left(c.title, 48),
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
where a.status in ('complete', 'partial') and a.trigger <> 'shadow'
order by a.created_at;
