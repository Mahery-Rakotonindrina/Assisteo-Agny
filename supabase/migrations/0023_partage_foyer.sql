-- Lists and parcels shared with the household ("Mes dépenses" shared, 0009).
--
-- A shared list leaves "lists" for this table: every member reads it, ticks
-- and adds items (the newest change wins, like the personal lists). A shared
-- parcel is a copy its author's device keeps up to date, read only for the
-- others, without what it cost (the app leaves the money out). Only the
-- author stops sharing (a tombstone, like every removal here).
--
-- Leaving the household (or it being deleted), the author's lists come back
-- to "lists" (same ids) and all their shares are tombstoned. An account
-- deleted: its shares leave the household too.

create table if not exists public.household_shares (
  household_id uuid not null references public.households (id) on delete cascade,
  -- "list:<id>" or "parcel:<id>".
  id text not null,
  kind text not null check (kind in ('list', 'parcel')),
  -- The author: the only one who stops sharing. Null once their account is deleted (then read only, tombstoned).
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  data jsonb not null,
  -- Client clock of the last change.
  updated_at timestamptz not null,
  -- Tombstone: removals must reach the other members too.
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (household_id, id),
  constraint household_shares_id_kind check (id like kind || ':%' and length(id) <= 120)
);

drop trigger if exists household_shares_touch on public.household_shares;
create trigger household_shares_touch before insert or update on public.household_shares
  for each row execute function public.touch_server_updated_at();

-- A member who ticks an item on another's list changes the row: the author,
-- the kind and the household stay as they were, and only the author stops or
-- resumes the sharing (another's tombstone is ignored). The server (no user:
-- triggers, service role) may.
create or replace function public.household_shares_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.user_id := old.user_id;
  new.kind := old.kind;
  new.household_id := old.household_id;
  new.id := old.id;
  -- Kept as it was rather than refused: a member's device pushing an older copy
  -- must not fail the whole batch it is part of.
  if old.user_id is distinct from auth.uid() then
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists household_shares_guard on public.household_shares;
create trigger household_shares_guard before update on public.household_shares
  for each row execute function public.household_shares_guard();

-- The author's account deleted (user_id set to null): their shares leave the household.
create or replace function public.household_shares_author_gone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is null then
    new.deleted_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists household_shares_author_gone on public.household_shares;
create trigger household_shares_author_gone before update of user_id on public.household_shares
  for each row when (old.user_id is not null and new.user_id is null)
  execute function public.household_shares_author_gone();

alter table public.household_shares enable row level security;

-- Read by the members. Written by a member: a share of their own, and any
-- shared list (ticking, adding); a parcel only by its author. No delete: tombstones.
drop policy if exists "household_shares: members read" on public.household_shares;
create policy "household_shares: members read" on public.household_shares
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_shares: author inserts" on public.household_shares;
create policy "household_shares: author inserts" on public.household_shares
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));

drop policy if exists "household_shares: members update lists, authors their parcels" on public.household_shares;
create policy "household_shares: members update lists, authors their parcels" on public.household_shares
  for update to authenticated
  using (user_id is not null and public.is_household_member(household_id) and (kind = 'list' or user_id = auth.uid()))
  with check (public.is_household_member(household_id));

-- ---- Leaving: one's lists come back as personal ones --------------------------------

create or replace function public.household_return_shares(p_household uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from auth.users where id = p_member) then
    insert into public.lists (user_id, id, data, updated_at)
      -- "list:<id>" becomes "<id>" again, in the row and in its data.
      select s.user_id, substr(s.id, 6), jsonb_set(s.data - 'householdId' - 'userId', '{id}', to_jsonb(substr(s.id, 6))), now()
        from public.household_shares s
       where s.household_id = p_household and s.user_id = p_member and s.deleted_at is null and s.kind = 'list'
      on conflict (user_id, id) do update set data = excluded.data, updated_at = excluded.updated_at, deleted_at = null;
  end if;
  update public.household_shares s
     set deleted_at = now(), updated_at = now()
   where s.household_id = p_household and s.user_id = p_member and s.deleted_at is null;
end;
$$;

create or replace function public.household_member_left_shares()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A household being deleted has already given its lists back (household_closing_shares).
  if exists (select 1 from public.households where id = old.household_id) then
    perform public.household_return_shares(old.household_id, old.user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists household_members_left_shares on public.household_members;
create trigger household_members_left_shares after delete on public.household_members
  for each row execute function public.household_member_left_shares();

create or replace function public.household_closing_shares()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  member record;
begin
  for member in select user_id from public.household_members where household_id = old.id loop
    perform public.household_return_shares(old.id, member.user_id);
  end loop;
  return old;
end;
$$;

drop trigger if exists households_closing_shares on public.households;
create trigger households_closing_shares before delete on public.households
  for each row execute function public.household_closing_shares();

-- ---- Who may call what -------------------------------------------------------------
-- Only the triggers call these.
revoke all on function public.household_shares_guard() from public, anon, authenticated;
revoke all on function public.household_shares_author_gone() from public, anon, authenticated;
revoke all on function public.household_return_shares(uuid, uuid) from public, anon, authenticated;
revoke all on function public.household_member_left_shares() from public, anon, authenticated;
revoke all on function public.household_closing_shares() from public, anon, authenticated;
revoke all on table public.household_shares from anon;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0023_partage_foyer.sql') on conflict (name) do nothing;
