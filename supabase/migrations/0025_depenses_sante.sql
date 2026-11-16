-- "Dépenses de santé" (Ma santé), for a plan without "Mes dépenses": what the
-- pharmacy, the doctor, the tests or the hospital cost, written by hand or
-- from a scanned receipt, for oneself or a relative (a local profile:
-- data.profileId), synced across a user's devices. With "Mes dépenses", new
-- ones are expenses of the category "health" (table expenses) instead; these
-- rows stay. One row per expense; the app stores it as JSON and settles edits
-- by updated_at (last write wins), like the measures (0024_mesures_sante.sql).
-- A table rather than the settings: expenses pile up month after month, the
-- app reads only what changed since its last sync (server_updated_at).

create table if not exists public.health_spending (
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

-- Bounds on what one row may hold: an amount, a day, a kind and a short note.
-- Dropped then added again, so the file can run twice.
alter table public.health_spending drop constraint if exists health_spending_data_size;
alter table public.health_spending add constraint health_spending_data_size check (octet_length(data::text) <= 4000);
alter table public.health_spending drop constraint if exists health_spending_id_length;
alter table public.health_spending add constraint health_spending_id_length check (char_length(id) <= 64);

drop trigger if exists health_spending_touch on public.health_spending;
create trigger health_spending_touch before insert or update on public.health_spending
  for each row execute function public.touch_server_updated_at();

-- The incremental sync reads one user's rows changed since a moment.
create index if not exists health_spending_user_server_updated on public.health_spending (user_id, server_updated_at);

alter table public.health_spending enable row level security;

drop policy if exists "health_spending: own rows" on public.health_spending;
create policy "health_spending: own rows" on public.health_spending
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0025_depenses_sante.sql') on conflict (name) do nothing;
