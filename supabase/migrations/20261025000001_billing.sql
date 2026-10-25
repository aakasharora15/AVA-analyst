-- Billing (Stripe), free audit abuse limits and account deletion support.
-- * Subscription state lives on the organisation and changes only through the
--   Stripe webhook (system role), like the plan itself.
-- * trial_ends_at becomes system-only too: an Owner could otherwise extend
--   their own trial.
-- * billing_events records every processed Stripe event id, so a redelivered
--   webhook is applied once.
-- * free_audits.ip_hash: a salted hash of the requester's address (never the
--   address itself), used for per-address daily limits.

alter table public.organisations
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

create or replace function app.guard_org_update() returns trigger
language plpgsql as $$
begin
  if app.is_system() then return new; end if;
  if (new.plan, new.renewal_date, new.company_limit, new.seat_limit, new.trial_ends_at,
      new.stripe_customer_id, new.stripe_subscription_id, new.subscription_status, new.current_period_end, new.cancel_at_period_end)
     is distinct from
     (old.plan, old.renewal_date, old.company_limit, old.seat_limit, old.trial_ends_at,
      old.stripe_customer_id, old.stripe_subscription_id, old.subscription_status, old.current_period_end, old.cancel_at_period_end) then
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

create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  org_id text references public.organisations (id) on delete set null,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

alter table public.free_audits add column if not exists ip_hash text;
create index if not exists free_audits_ip on public.free_audits (ip_hash, created_at);
