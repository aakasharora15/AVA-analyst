-- Where are emails stuck? Run in the Supabase SQL editor; it changes nothing.
-- One table, three kinds of row:
--   outbox   the last emails AVA queued and whether each was sent
--   cron     the last runs of the scheduler that sends them
--   http     the last replies from the AVA server to that scheduler
(select 'outbox' as what, left(subject, 60) as detail,
        coalesce(left(error, 120), case when sent_at is null then 'waiting to send' else 'sent ' || to_char(sent_at, 'HH24:MI') end) as status,
        created_at as at
 from public.email_outbox order by id desc limit 8)
union all
(select 'cron', j.jobname, d.status || ': ' || left(coalesce(d.return_message, ''), 100), d.start_time
 from cron.job_run_details d join cron.job j using (jobid)
 where j.jobname = 'ava-email' order by d.start_time desc limit 3)
union all
(select 'http', coalesce(status_code::text, 'no reply'), left(coalesce(error_msg, content::text, ''), 120), created
 from net._http_response order by created desc limit 4)
order by what, at desc;
