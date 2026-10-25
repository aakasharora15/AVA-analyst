-- Repeatability test (Phase 3), step 2: results. Changes nothing.
-- One row per audit: the original first, then each repeat. Tokens are what the
-- AI read and wrote; the Anthropic console turns them into dollars.
select c.title as venture,
       case when a.trigger = 'shadow' then 'repeat' else 'original' end as run,
       a.status, a.score, a.final_directive as directive,
       (select sum((r.usage ->> 'input_tokens')::bigint) from public.agent_runs r where r.audit_id = a.id) as input_tokens,
       (select sum((r.usage ->> 'cache_read_input_tokens')::bigint) from public.agent_runs r where r.audit_id = a.id) as cached_tokens,
       (select sum((r.usage ->> 'output_tokens')::bigint) from public.agent_runs r where r.audit_id = a.id) as output_tokens,
       a.created_at
from public.audits a join public.companies c on c.id = a.company_id
where a.id in (select (run_state ->> 'shadowOf') from public.audits where trigger = 'shadow' and run_state ->> 'purpose' = 'recalibration')
   or (a.trigger = 'shadow' and a.run_state ->> 'purpose' = 'recalibration')
order by c.title, a.created_at;
