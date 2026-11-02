-- "Mes plantes": the user's plants with their watering and the problems
-- checked, synced across a user's devices. One row per plant; the app stores
-- it as JSON and settles edits by updated_at (last write wins), like the
-- vehicles (0007_vehicles.sql).

create table if not exists public.plants (
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

drop trigger if exists plants_touch on public.plants;
create trigger plants_touch before insert or update on public.plants
  for each row execute function public.touch_server_updated_at();

alter table public.plants enable row level security;

drop policy if exists "plants: own rows" on public.plants;
create policy "plants: own rows" on public.plants
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0013_plants.sql') on conflict (name) do nothing;
