-- "Mes mesures" (Ma santé): blood pressure, blood sugar and weight, written by
-- hand, for oneself or a relative (a local profile: data.profileId), synced
-- across a user's devices. One row per measure; the app stores it as JSON (its
-- "kind": pressure, glucose or weight) and settles edits by updated_at (last
-- write wins), like the shop (0022_shop.sql). A table rather than the
-- settings: measures pile up (several a day for years), the app reads only
-- what changed since its last sync (server_updated_at).

create table if not exists public.health_measures (
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

-- Bounds on what one row may hold: a measure is a few numbers and a short note.
-- Dropped then added again, so the file can run twice.
alter table public.health_measures drop constraint if exists health_measures_data_size;
alter table public.health_measures add constraint health_measures_data_size check (octet_length(data::text) <= 4000);
alter table public.health_measures drop constraint if exists health_measures_id_length;
alter table public.health_measures add constraint health_measures_id_length check (char_length(id) <= 64);

drop trigger if exists health_measures_touch on public.health_measures;
create trigger health_measures_touch before insert or update on public.health_measures
  for each row execute function public.touch_server_updated_at();

-- The incremental sync reads one user's rows changed since a moment.
create index if not exists health_measures_user_server_updated on public.health_measures (user_id, server_updated_at);

alter table public.health_measures enable row level security;

drop policy if exists "health_measures: own rows" on public.health_measures;
create policy "health_measures: own rows" on public.health_measures
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0024_mesures_sante.sql') on conflict (name) do nothing;
