-- "Mes listes": shopping lists, to-do lists… synced across a user's devices.
-- One row per list; the app stores the list as JSON (title, kind, items) and
-- settles edits by updated_at (last write wins), like the parcels.

create table if not exists public.lists (
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

drop trigger if exists lists_touch on public.lists;
create trigger lists_touch before insert or update on public.lists
  for each row execute function public.touch_server_updated_at();

alter table public.lists enable row level security;

drop policy if exists "lists: own rows" on public.lists;
create policy "lists: own rows" on public.lists
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
