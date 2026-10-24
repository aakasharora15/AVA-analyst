-- Plans and Deep audit.
-- * Every plan runs the standard engine; Pro Max and Enterprise may also run a
--   Deep audit (extended analysis on a larger model). The model itself stays
--   internal (migration 4); users see only the depth.
-- * Organisation plans use the ids from src/content/business.js:
--   basic, pro, pro-max, enterprise.

alter table public.audits add column if not exists depth text not null default 'standard'
  check (depth in ('standard', 'deep'));
grant select (depth) on public.audits to authenticated;

alter table public.organisations alter column plan set default 'pro';
update public.organisations set plan = 'pro' where plan = 'Portfolio';

-- The plan is a paid entitlement: only the system (billing) changes it, along
-- with renewal date and limits. The Owner still manages the billing contact.
create or replace function app.guard_org_update() returns trigger
language plpgsql as $$
begin
  if app.is_system() then return new; end if;
  if (new.plan, new.renewal_date, new.company_limit, new.seat_limit)
     is distinct from (old.plan, old.renewal_date, old.company_limit, old.seat_limit) then
    raise exception 'Plans and limits change through billing' using errcode = '42501';
  end if;
  if new.billing_contact is distinct from old.billing_contact and app.member_role(old.id) is distinct from 'Owner' then
    raise exception 'Only the Owner can change billing' using errcode = '42501';
  end if;
  if new.hold_mode is distinct from old.hold_mode then
    raise exception 'Hold mode is set by drift monitoring only' using errcode = '42501';
  end if;
  return new;
end $$;
