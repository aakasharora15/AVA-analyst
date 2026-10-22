-- Data room file storage (Supabase Storage). Objects are stored under
-- <org_id>/<company_id>/<file>. Members read; Owner, Admin and Analyst upload
-- (spec 4.8). Skipped on databases without the storage schema (tests).

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping data room bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public) values ('data-room', 'data-room', false)
  on conflict (id) do nothing;

  execute $p$create policy data_room_read on storage.objects for select
    using (bucket_id = 'data-room' and app.member_role(split_part(name, '/', 1)) is not null)$p$;
  execute $p$create policy data_room_upload on storage.objects for insert
    with check (bucket_id = 'data-room' and app.has_role(split_part(name, '/', 1), array['Owner', 'Admin', 'Analyst']))$p$;
end $$;
