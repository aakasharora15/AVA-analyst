-- Minute-level jobs, run from Supabase (pg_cron + pg_net, available on every
-- Supabase plan). Vercel's own crons in vercel.json are daily, which is all the
-- Hobby plan allows; these keep audits moving and email flowing when nobody
-- has the running screen open.
--
-- Not a migration: run once in the SQL editor after the first deploy, after
-- replacing the two values below. Re-running replaces the jobs.
--   Database -> Extensions: enable pg_cron and pg_net first.

-- Creates the two Vault entries, or updates them when they already exist, so
-- re-running this file with corrected values fixes a typo.
do $$
declare
  app_url text := 'https://YOUR-DOMAIN';          -- e.g. https://ava-analyst.vercel.app (no trailing slash)
  cron_secret text := 'YOUR-CRON-SECRET';         -- the same value as CRON_SECRET in Vercel
begin
  if app_url like '%YOUR-DOMAIN%' or cron_secret = 'YOUR-CRON-SECRET' then
    raise exception 'Replace YOUR-DOMAIN and YOUR-CRON-SECRET before running';
  end if;
  app_url := rtrim(trim(app_url), '/');
  if exists (select 1 from vault.secrets where name = 'ava_app_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'ava_app_url'), app_url);
  else
    perform vault.create_secret(app_url, 'ava_app_url');
  end if;
  if exists (select 1 from vault.secrets where name = 'ava_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'ava_cron_secret'), trim(cron_secret));
  else
    perform vault.create_secret(trim(cron_secret), 'ava_cron_secret');
  end if;
end $$;

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
