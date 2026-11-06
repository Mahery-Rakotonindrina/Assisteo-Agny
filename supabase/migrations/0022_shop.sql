-- "Ma boutique": a small shopkeeper's book (products in stock, sales and the
-- customers' payments), synced across a user's devices. One row per record;
-- the app stores it as JSON (its "kind": product, sale or payment) and settles
-- edits by updated_at (last write wins), like the plants (0013_plants.sql).
-- No purchase price is kept: nothing here can show a margin.

create table if not exists public.shop (
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

drop trigger if exists shop_touch on public.shop;
create trigger shop_touch before insert or update on public.shop
  for each row execute function public.touch_server_updated_at();

alter table public.shop enable row level security;

drop policy if exists "shop: own rows" on public.shop;
create policy "shop: own rows" on public.shop
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0022_shop.sql') on conflict (name) do nothing;
