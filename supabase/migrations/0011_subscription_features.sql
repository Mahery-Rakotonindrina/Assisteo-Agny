-- Features and limits set subscriber by subscriber (Admin → Subscriptions),
-- and features offered for a while (Admin → an account's card). Without any
-- of it, a subscription follows its plan exactly as before.
-- Only the server (service role) reads or writes it: no policy for clients.

-- A subscription's own features, as a difference from its plan:
-- {"add": [...], "remove": [...]}; null = the plan's. Kept as a difference so
-- that a later change of the plan still applies, except to what was set here.
alter table public.subscriptions add column if not exists features jsonb
  check (features is null or (jsonb_typeof(features) = 'object' and jsonb_typeof(coalesce(features -> 'add', '[]')) = 'array' and jsonb_typeof(coalesce(features -> 'remove', '[]')) = 'array'));

-- Its own limits, each replacing the plan's ("scans", "questionsPerDay",
-- "parcels", "deepPerMonth"); null = the plan's.
alter table public.subscriptions add column if not exists quotas jsonb
  check (quotas is null or jsonb_typeof(quotas) = 'object');

-- A feature offered to an e-mail for a while, whatever its plan (free
-- included). It always ends: it stops by itself at ends_at, no job needed.
create table if not exists public.feature_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  feature text not null check (length(feature) between 1 and 40),
  starts_at timestamptz not null default now(),
  -- Exclusive.
  ends_at timestamptz not null check (ends_at > starts_at),
  note text check (note is null or length(note) <= 500),
  -- "owner" or an admin's e-mail.
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists feature_grants_email on public.feature_grants (email, ends_at);

alter table public.feature_grants enable row level security;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0011_subscription_features.sql') on conflict (name) do nothing;
