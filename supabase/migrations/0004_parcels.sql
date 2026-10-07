-- "Mes colis": the parcels a user follows, synced across their devices.
-- One row per parcel; the app stores the parcel as JSON (status, timeline,
-- linked scan ids) and settles edits by updated_at (last write wins).

create table if not exists public.parcels (
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

drop trigger if exists parcels_touch on public.parcels;
create trigger parcels_touch before insert or update on public.parcels
  for each row execute function public.touch_server_updated_at();

alter table public.parcels enable row level security;

drop policy if exists "parcels: own rows" on public.parcels;
create policy "parcels: own rows" on public.parcels
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
