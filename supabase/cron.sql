-- Minute-level jobs, run from Supabase (pg_cron + pg_net, available on every
-- Supabase plan). Vercel's own crons in vercel.json are daily, which is all the
-- Hobby plan allows; these keep audits moving and email flowing when nobody
-- has the running screen open.
--
-- Not a migration: run once in the SQL editor after the first deploy, after
-- replacing the two values below. Re-running replaces the jobs.
--   Database -> Extensions: enable pg_cron and pg_net first.

select vault.create_secret('https://YOUR-DOMAIN', 'ava_app_url')
where not exists (select 1 from vault.secrets where name = 'ava_app_url');
select vault.create_secret('YOUR-CRON-SECRET', 'ava_cron_secret')
where not exists (select 1 from vault.secrets where name = 'ava_cron_secret');

create or replace function app.call_cron(job text) returns void
language sql security definer set search_path = public as $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ava_app_url') || '/api/cron/' || job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ava_cron_secret')),
    timeout_milliseconds := 290000);
$$;
revoke execute on function app.call_cron(text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('ava-advance', 'ava-email');
select cron.schedule('ava-advance', '* * * * *', $$select app.call_cron('advance')$$);
select cron.schedule('ava-email', '*/5 * * * *', $$select app.call_cron('email')$$);
