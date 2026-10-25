-- Two-factor sign-in, enforced in the database.
-- A user who has turned on an authenticator app must present a session that
-- passed the second factor (aal2) before row-level security returns or
-- changes anything. Users without two-factor are unaffected. The rule is a
-- restrictive policy, so it narrows every existing policy and never widens one.
-- The API enforces the same rule before it acts on a user's behalf.

create or replace function app.mfa_ok() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  aal text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal';
begin
  if coalesce(aal, 'aal1') = 'aal2' then return true; end if;
  if to_regclass('auth.mfa_factors') is null then return true; end if;
  return not exists (select 1 from auth.mfa_factors f where f.user_id = app.uid() and f.status::text = 'verified');
end $$;
grant execute on function app.mfa_ok() to authenticated, anon, service_role;

do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists mfa_required on public.%I', t.relname);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated '
                   'using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists mfa_required on storage.objects';
    execute 'create policy mfa_required on storage.objects as restrictive for all to authenticated '
            'using ((select app.mfa_ok())) with check ((select app.mfa_ok()))';
  end if;
end $$;
