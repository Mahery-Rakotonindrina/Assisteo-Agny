-- "Mes dépenses": the household's monthly budget, synced across a user's
-- devices. One table for every record, told apart by data.kind: an expense,
-- an income, a recurring item (rent, school fees, a salary), the budget, a
-- custom category, or an exclusion (a computed expense kept out of the
-- budget). The app stores each as JSON and settles edits by updated_at (last
-- write wins), like the parcels, the lists and the vehicles.

create table if not exists public.expenses (
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

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before insert or update on public.expenses
  for each row execute function public.touch_server_updated_at();

alter table public.expenses enable row level security;

drop policy if exists "expenses: own rows" on public.expenses;
create policy "expenses: own rows" on public.expenses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
