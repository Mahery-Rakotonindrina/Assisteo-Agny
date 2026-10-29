-- "Prêts": money the user lent ("On me doit") or borrowed ("Je dois"), with
-- its repayments, synced across a user's devices. Always personal: never
-- shared with a household. One row per loan; the app stores it as JSON and
-- settles edits by updated_at (last write wins), like the vehicles and the
-- expenses. Lending is neither an expense nor an income: nothing here is read
-- by "Mes dépenses".

create table if not exists public.loans (
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

drop trigger if exists loans_touch on public.loans;
create trigger loans_touch before insert or update on public.loans
  for each row execute function public.touch_server_updated_at();

alter table public.loans enable row level security;

drop policy if exists "loans: own rows" on public.loans;
create policy "loans: own rows" on public.loans
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
