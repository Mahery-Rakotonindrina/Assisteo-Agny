-- "Ma maison": the things of the user's home (fridge, TV, sofa…) with their
-- purchase, warranty end, serial number, a small photo and the scans of their
-- papers (by scan id), synced across a user's devices. One row per thing; the
-- app stores it as JSON and settles edits by updated_at (last write wins),
-- like the vehicles. Not applied by the app: the owner pastes it or runs npm run db:migrate.

create table if not exists public.home_items (
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

drop trigger if exists home_items_touch on public.home_items;
create trigger home_items_touch before insert or update on public.home_items
  for each row execute function public.touch_server_updated_at();

alter table public.home_items enable row level security;

drop policy if exists "home_items: own rows" on public.home_items;
create policy "home_items: own rows" on public.home_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0014_home_items.sql') on conflict (name) do nothing;
