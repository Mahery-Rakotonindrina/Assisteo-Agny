-- "Mon garage": the user's vehicles (car, motorbike…) with their service log,
-- fuel fills and expenses, synced across a user's devices. One row per
-- vehicle; the app stores it as JSON and settles edits by updated_at (last
-- write wins), like the parcels and the lists.

create table if not exists public.vehicles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  -- Client clock of the last change.
  updated_at timestamptz not null,
  -- Tombstone: removals must reach the other devices too.
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

drop trigger if exists vehicles_touch on public.vehicles;
create trigger vehicles_touch before insert or update on public.vehicles
  for each row execute function public.touch_server_updated_at();

alter table public.vehicles enable row level security;

drop policy if exists "vehicles: own rows" on public.vehicles;
create policy "vehicles: own rows" on public.vehicles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
