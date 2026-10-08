-- Subscriptions recorded by the owner from /admin. Payment happens outside
-- the app (Mobile Money to the owner's account): each row records one
-- payment, or an offered access, granting a plan to an email for a period.
-- Keyed by email so a plan can be granted before the person signs up.
-- Only the server (service role) reads or writes it: no policy for clients.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  plan text not null check (plan in ('lite', 'premium', 'pro', 'unlimited')),
  starts_at timestamptz not null default now(),
  -- Exclusive; null = no end (offered access).
  ends_at timestamptz check (ends_at is null or ends_at >= starts_at),
  amount_mga integer check (amount_mga is null or amount_mga >= 0),
  payment_method text,
  payment_ref text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_email on public.subscriptions (email);

drop trigger if exists subscriptions_touch on public.subscriptions;
create or replace function public.touch_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
