-- "Mes dépenses", shared with the family: a household, its members, the
-- invitation codes and the expenses its members share. Each expense is
-- personal (table "expenses", never readable by anyone else) or shared with
-- the household (table "household_expenses", readable by every member, written
-- by its author only). One household per account for now.
--
-- Creating, joining and managing a household go through the app's server
-- (pages/api/household.ts: Admin plan to create, a rate limit on codes), which
-- calls the functions below with the service role and the verified user's id.
-- Clients only read their household and sync their shared expenses, under RLS.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  -- The creator: invites, removes members, names the household and sets its budget.
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- { name, budget: { total, categories } }.
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

drop trigger if exists households_touch on public.households;
create trigger households_touch before insert or update on public.households
  for each row execute function public.touch_server_updated_at();

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  -- One household per account.
  constraint household_members_one_per_user unique (user_id)
);

create table if not exists public.household_invites (
  -- 6 signs out of 26, without look-alikes (no 0/O, 1/I/L, 5/S, 8/B, Z): shown as "4K7-P2Q".
  code text primary key check (code ~ '^[234679ACDEFGHJKMNPQRTUVWXY]{6}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists household_invites_household on public.household_invites (household_id);

create table if not exists public.household_expenses (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  -- The author: the only one who may change it.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  -- Client clock of the last change.
  updated_at timestamptz not null,
  -- Tombstone: removals must reach the other members too.
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (household_id, id)
);

drop trigger if exists household_expenses_touch on public.household_expenses;
create trigger household_expenses_touch before insert or update on public.household_expenses
  for each row execute function public.touch_server_updated_at();

-- ---- Helpers for the policies (security definer: no RLS recursion) --------------

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid());
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.households h where h.id = hid and h.owner_id = auth.uid());
$$;

-- ---- Row Level Security ------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_expenses enable row level security;

-- Households: read by the members, changed and deleted by the creator. No
-- insert policy: a household is only created with its owner, by create_household.
drop policy if exists "households: members read" on public.households;
create policy "households: members read" on public.households
  for select to authenticated
  using (public.is_household_member(id));

drop policy if exists "households: owner updates" on public.households;
create policy "households: owner updates" on public.households
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "households: owner deletes" on public.households;
create policy "households: owner deletes" on public.households
  for delete to authenticated
  using (owner_id = auth.uid());

-- Members: seen by the other members. A member may leave, the owner may remove
-- a member; the owner leaves by deleting the household. Added by join_household only.
drop policy if exists "household_members: members read" on public.household_members;
create policy "household_members: members read" on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_members: leave or remove" on public.household_members;
create policy "household_members: leave or remove" on public.household_members
  for delete to authenticated
  using (role = 'member' and (user_id = auth.uid() or public.is_household_owner(household_id)));

-- Invitation codes: no policy at all, and no table rights. Only the functions read them.
revoke all on table public.household_invites from anon, authenticated;

-- Shared expenses: read by the members; written by their author, while a
-- member. Removed with a tombstone (deleted_at), so no delete policy.
drop policy if exists "household_expenses: members read" on public.household_expenses;
create policy "household_expenses: members read" on public.household_expenses
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_expenses: author inserts" on public.household_expenses;
create policy "household_expenses: author inserts" on public.household_expenses
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));

drop policy if exists "household_expenses: author updates" on public.household_expenses;
create policy "household_expenses: author updates" on public.household_expenses
  for update to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id))
  with check (user_id = auth.uid() and public.is_household_member(household_id));

-- ---- Leaving: one's shared expenses come back as personal ones ---------------------
-- A member who leaves (or is removed), and every member when the household is
-- deleted, finds their shared expenses back in "expenses" (same ids: synced
-- like any personal expense, never twice). In the household they are
-- tombstoned, so the other members' devices drop them. Nothing is copied for
-- an account being deleted.

create or replace function public.household_return_expenses(p_household uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from auth.users where id = p_member) then
    insert into public.expenses (user_id, id, data, updated_at)
      select e.user_id, e.id, (e.data - 'userId') || jsonb_build_object('kind', 'expense'), now()
        from public.household_expenses e
       where e.household_id = p_household and e.user_id = p_member and e.deleted_at is null
      on conflict (user_id, id) do update set data = excluded.data, updated_at = excluded.updated_at, deleted_at = null;
  end if;
  update public.household_expenses
     set deleted_at = now(), updated_at = now()
   where household_id = p_household and user_id = p_member and deleted_at is null;
end;
$$;

create or replace function public.household_member_left()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A household being deleted has already given its expenses back (households_closing).
  if exists (select 1 from public.households where id = old.household_id) then
    perform public.household_return_expenses(old.household_id, old.user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists household_members_left on public.household_members;
create trigger household_members_left after delete on public.household_members
  for each row execute function public.household_member_left();

create or replace function public.household_closing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  member record;
begin
  for member in select user_id from public.household_members where household_id = old.id loop
    perform public.household_return_expenses(old.id, member.user_id);
  end loop;
  return old;
end;
$$;

drop trigger if exists households_closing on public.households;
create trigger households_closing before delete on public.households
  for each row execute function public.household_closing();

-- ---- What the server calls (service role, with the verified user's id) ------------
-- Errors are stable words the server maps to the app's messages:
-- already_member, not_member, not_owner, invalid_code, expired, household_full, invalid_name.

-- The user's household, its members (with their e-mail and name, which the
-- server masks) and, for the owner, the live invitation code. Null without one.
create or replace function public.household_state(p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', h.id,
    'ownerId', h.owner_id,
    'role', me.role,
    'data', h.data,
    'updatedAt', h.updated_at,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role, 'joinedAt', m.joined_at, 'email', u.email, 'name', u.raw_user_meta_data ->> 'full_name') order by m.joined_at), '[]'::jsonb)
        from public.household_members m left join auth.users u on u.id = m.user_id
       where m.household_id = h.id
    ),
    'invite', case when h.owner_id = p_user then (
      select jsonb_build_object('code', i.code, 'expiresAt', i.expires_at)
        from public.household_invites i
       where i.household_id = h.id and i.revoked_at is null and i.expires_at > now()
       order by i.created_at desc limit 1
    ) end
  )
    from public.household_members me
    join public.households h on h.id = me.household_id
   where me.user_id = p_user;
$$;

create or replace function public.create_household(p_user uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  clean_name text := left(btrim(coalesce(p_name, '')), 60);
  hid uuid;
begin
  if p_user is null then raise exception 'not_member'; end if;
  if clean_name = '' then raise exception 'invalid_name'; end if;
  if exists (select 1 from public.household_members where user_id = p_user) then raise exception 'already_member'; end if;
  insert into public.households (owner_id, data) values (p_user, jsonb_build_object('name', clean_name, 'budget', jsonb_build_object('categories', '{}'::jsonb)))
    returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, p_user, 'owner');
  return hid;
exception when unique_violation then
  raise exception 'already_member';
end;
$$;

-- A new code for 48 hours; the owner's earlier codes stop working.
create or replace function public.create_household_invite(p_user uuid, p_household uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := '234679ACDEFGHJKMNPQRTUVWXY';
  random_bytes bytea;
  random_byte int;
  idx int;
  candidate text;
  expires timestamptz := now() + interval '48 hours';
begin
  if not exists (select 1 from public.households where id = p_household and owner_id = p_user) then raise exception 'not_owner'; end if;
  update public.household_invites set revoked_at = now() where household_id = p_household and revoked_at is null;
  delete from public.household_invites where expires_at < now() - interval '30 days';
  for attempt in 1..8 loop
    -- gen_random_uuid() draws from a strong random source: 12 of its 16 bytes
    -- are fully random. Bytes from 234 up are skipped (26 × 9 = 234: no bias).
    candidate := '';
    while length(candidate) < 6 loop
      random_bytes := uuid_send(gen_random_uuid());
      foreach idx in array array[0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15] loop
        exit when length(candidate) = 6;
        random_byte := get_byte(random_bytes, idx);
        if random_byte < 234 then
          candidate := candidate || substr(alphabet, 1 + random_byte % 26, 1);
        end if;
      end loop;
    end loop;
    insert into public.household_invites (code, household_id, created_by, expires_at)
      values (candidate, p_household, p_user, expires)
      on conflict (code) do nothing;
    if found then
      return jsonb_build_object('code', candidate, 'expiresAt', expires);
    end if;
  end loop;
  raise exception 'invite_failed';
end;
$$;

create or replace function public.revoke_household_invites(p_user uuid, p_household uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.households where id = p_household and owner_id = p_user) then raise exception 'not_owner'; end if;
  update public.household_invites set revoked_at = now() where household_id = p_household and revoked_at is null;
end;
$$;

-- Joins with a code: valid, not expired, not revoked, for an account without a household.
create or replace function public.join_household(p_user uuid, p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  invite public.household_invites;
begin
  if p_user is null then raise exception 'not_member'; end if;
  if exists (select 1 from public.household_members where user_id = p_user) then raise exception 'already_member'; end if;
  select * into invite from public.household_invites where code = upper(btrim(coalesce(p_code, '')));
  if not found or invite.revoked_at is not null then raise exception 'invalid_code'; end if;
  if invite.expires_at <= now() then raise exception 'expired'; end if;
  if (select count(*) from public.household_members where household_id = invite.household_id) >= 12 then raise exception 'household_full'; end if;
  insert into public.household_members (household_id, user_id, role) values (invite.household_id, p_user, 'member');
  return invite.household_id;
exception when unique_violation then
  raise exception 'already_member';
end;
$$;

-- The owner renames the household or sets its budget (the server validates p_data).
create or replace function public.update_household(p_user uuid, p_household uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.households set data = p_data, updated_at = now() where id = p_household and owner_id = p_user;
  if not found then raise exception 'not_owner'; end if;
end;
$$;

-- A member leaves (p_member = p_user), or the owner removes one. The owner
-- can't leave this way: deleting the household is how the owner leaves.
create or replace function public.remove_household_member(p_user uuid, p_household uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_member <> p_user and not exists (select 1 from public.households where id = p_household and owner_id = p_user) then raise exception 'not_owner'; end if;
  delete from public.household_members where household_id = p_household and user_id = p_member and role = 'member';
  if not found then raise exception 'not_member'; end if;
end;
$$;

-- The owner leaves: the household, its members, codes and shared expenses go.
create or replace function public.delete_household(p_user uuid, p_household uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.households where id = p_household and owner_id = p_user;
  if not found then raise exception 'not_owner'; end if;
end;
$$;

-- ---- Who may call what -------------------------------------------------------------
-- New functions are executable by everyone by default (and Supabase grants
-- them to anon and authenticated): take it back, then grant what is needed.

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_owner(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

revoke all on function public.household_return_expenses(uuid, uuid) from public, anon, authenticated;
revoke all on function public.household_member_left() from public, anon, authenticated;
revoke all on function public.household_closing() from public, anon, authenticated;
revoke all on function public.household_state(uuid) from public, anon, authenticated;
revoke all on function public.create_household(uuid, text) from public, anon, authenticated;
revoke all on function public.create_household_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_household_invites(uuid, uuid) from public, anon, authenticated;
revoke all on function public.join_household(uuid, text) from public, anon, authenticated;
revoke all on function public.update_household(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_household_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_household(uuid, uuid) from public, anon, authenticated;

grant execute on function public.household_state(uuid) to service_role;
grant execute on function public.create_household(uuid, text) to service_role;
grant execute on function public.create_household_invite(uuid, uuid) to service_role;
grant execute on function public.revoke_household_invites(uuid, uuid) to service_role;
grant execute on function public.join_household(uuid, text) to service_role;
grant execute on function public.update_household(uuid, uuid, jsonb) to service_role;
grant execute on function public.remove_household_member(uuid, uuid, uuid) to service_role;
grant execute on function public.delete_household(uuid, uuid) to service_role;
