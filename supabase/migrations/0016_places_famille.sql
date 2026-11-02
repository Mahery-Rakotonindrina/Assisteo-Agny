-- Family seats: a subscriber shares their plan with a few people, by e-mail,
-- from "Mon offre" (Premium and Pro by default; the count of each plan is set
-- in Admin → Offers). A person gets the plan's features and its quotas,
-- counted for them alone, while the subscriber's subscription runs.
-- Only the server writes here (service role), after checking the
-- subscriber's plan and free seats (pages/api/family-seats.ts). The
-- subscriber reads their seats, the invited person reads their own.

create table if not exists public.family_seats (
  id uuid primary key default gen_random_uuid(),
  -- The subscriber. Their account deleted: their seats go with it.
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null check (owner_email = lower(owner_email) and position('@' in owner_email) > 1),
  -- Shown to the invited person: the subscriber's first name (null: their e-mail).
  owner_name text check (owner_name is null or length(owner_name) <= 60),
  -- The invited person, who may not have an account yet.
  member_email text not null check (member_email = lower(member_email) and position('@' in member_email) > 1 and length(member_email) <= 254),
  created_at timestamptz not null default now(),
  constraint family_seats_not_self check (member_email <> owner_email)
);

-- One seat per person at a time.
create unique index if not exists family_seats_one_per_member on public.family_seats (member_email);
create index if not exists family_seats_owner on public.family_seats (owner_id, created_at);
create index if not exists family_seats_owner_email on public.family_seats (owner_email);

alter table public.family_seats enable row level security;

-- The subscriber reads their seats; the invited person reads their own
-- (by the e-mail of their session). No insert, update or delete for clients.
drop policy if exists "family_seats: owner reads" on public.family_seats;
create policy "family_seats: owner reads" on public.family_seats
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "family_seats: member reads" on public.family_seats;
create policy "family_seats: member reads" on public.family_seats
  for select to authenticated
  using (member_email = lower((select auth.jwt() ->> 'email')));

revoke all on table public.family_seats from anon;
revoke insert, update, delete on table public.family_seats from authenticated;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0016_places_famille.sql') on conflict (name) do nothing;
