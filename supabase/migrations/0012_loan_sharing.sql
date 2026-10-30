-- "Prêts", shared: a link the lender sends to the borrower ("ce qu'il reste à
-- rendre"), and the loans made or received by the family (household).
--
-- 1. loan_shares: a frozen copy of what one person owes the user (amounts,
--    schedule, repayments, names: never a phone, an e-mail, a note or a proof),
--    behind a random token. Only the token's sha256 is stored. Nobody reads it
--    directly, not even a visitor: the public page goes through the app's
--    server (pages/api/loans/share.ts, service role, rate limited), which also
--    writes the copies after checking the account's plan.
-- 2. household_loans: the household's loans, on the model of
--    household_expenses (0009): read by the members, each row written by its
--    author. A repayment is a row of its own pointing to its loan (kind
--    "repayment", data.loanId), written by whoever got or paid it back: any
--    member adds one without writing in the author's row. A member who leaves
--    gets their loans back as personal ones (table "loans", same ids), with
--    every repayment made on them.

-- ---- 1. The link sent to the borrower ------------------------------------------------

create table if not exists public.loan_shares (
  -- sha256 of the token in the link, in hex: the token itself is never stored.
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The person's key in the app (lib/loans.ts personKey): one live link per person.
  person text not null check (length(person) between 1 and 120),
  -- { v, lender, borrower, updatedAt, loans: [{ amountMga, interestMga, at, dueAt, schedule, repayments }] }.
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Arrêter le partage": the link then answers like an unknown one.
  revoked_at timestamptz
);

create unique index if not exists loan_shares_one_live on public.loan_shares (user_id, person) where revoked_at is null;

alter table public.loan_shares enable row level security;

-- The owner sees and deletes their own copies. No insert or update policy, and
-- no right to: the server writes them, once the plan is checked. No policy at
-- all for visitors.
drop policy if exists "loan_shares: owner reads" on public.loan_shares;
create policy "loan_shares: owner reads" on public.loan_shares
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "loan_shares: owner deletes" on public.loan_shares;
create policy "loan_shares: owner deletes" on public.loan_shares
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.loan_shares from anon;
revoke insert, update on table public.loan_shares from authenticated;

-- ---- 2. The household's loans ----------------------------------------------------------

create table if not exists public.household_loans (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  -- The author: the only one who may change it. Null once the author's account
  -- is deleted: a repayment they noted on another member's loan stays (the
  -- family's money), with their name kept in data.authorName; nobody changes it.
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  -- A loan (kind "loan") or a repayment on one (kind "repayment", loanId, authorName).
  data jsonb not null,
  -- Client clock of the last change.
  updated_at timestamptz not null,
  -- Tombstone: removals must reach the other members too.
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (household_id, id)
);

drop trigger if exists household_loans_touch on public.household_loans;
create trigger household_loans_touch before insert or update on public.household_loans
  for each row execute function public.touch_server_updated_at();

-- An author's account deleted (user_id set to null): their loans leave the
-- household (tombstoned, like the leaving below), and so do their repayments,
-- except those on another member's live loan, which stay.
create or replace function public.household_loans_author_gone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is null and (new.data ->> 'kind' is distinct from 'repayment' or not exists (
       select 1 from public.household_loans l
        where l.household_id = new.household_id and l.id = new.data ->> 'loanId' and l.deleted_at is null
          and l.user_id is not null and l.user_id <> old.user_id)) then
    new.deleted_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists household_loans_author_gone on public.household_loans;
create trigger household_loans_author_gone before update of user_id on public.household_loans
  for each row when (old.user_id is not null and new.user_id is null)
  execute function public.household_loans_author_gone();

alter table public.household_loans enable row level security;

-- Read by the members; written by their author, while a member. Removed with
-- a tombstone (deleted_at), so no delete policy. The same as household_expenses.
-- A row whose author is gone (user_id null) matches no write policy: read only.
drop policy if exists "household_loans: members read" on public.household_loans;
create policy "household_loans: members read" on public.household_loans
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_loans: author inserts" on public.household_loans;
create policy "household_loans: author inserts" on public.household_loans
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));

drop policy if exists "household_loans: author updates" on public.household_loans;
create policy "household_loans: author updates" on public.household_loans
  for update to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id))
  with check (user_id = auth.uid() and public.is_household_member(household_id));

-- ---- Leaving: one's household loans come back as personal ones -----------------------
-- Like the shared expenses (0009): a member who leaves (or is removed), and
-- every member when the household is deleted, finds their loans back in
-- "loans" (same ids), each with all the repayments made on it, whoever wrote
-- them. In the household, their loans and the repayments on them are
-- tombstoned; their repayments on the others' loans stay there. Nothing is
-- copied for an account being deleted.

create or replace function public.household_return_loans(p_household uuid, p_member uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from auth.users where id = p_member) then
    insert into public.loans (user_id, id, data, updated_at)
      select l.user_id, l.id,
             (l.data - 'userId' - 'kind' - 'createdAt') || jsonb_build_object('repayments', coalesce((
               select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'at', r.data -> 'at', 'amountMga', r.data -> 'amountMga', 'note', r.data -> 'note')) order by r.data ->> 'at')
                 from public.household_loans r
                where r.household_id = p_household and r.deleted_at is null and r.data ->> 'kind' = 'repayment' and r.data ->> 'loanId' = l.id
             ), '[]'::jsonb)),
             now()
        from public.household_loans l
       where l.household_id = p_household and l.user_id = p_member and l.deleted_at is null and l.data ->> 'kind' = 'loan'
      on conflict (user_id, id) do update set data = excluded.data, updated_at = excluded.updated_at, deleted_at = null;
  end if;
  update public.household_loans r
     set deleted_at = now(), updated_at = now()
   where r.household_id = p_household and r.deleted_at is null
     and ((r.data ->> 'kind' is distinct from 'repayment' and r.user_id = p_member)
       or (r.data ->> 'kind' = 'repayment' and exists (
             select 1 from public.household_loans l
              where l.household_id = p_household and l.id = r.data ->> 'loanId' and l.user_id = p_member)));
end;
$$;

create or replace function public.household_member_left_loans()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A household being deleted has already given its loans back (households_closing_loans).
  if exists (select 1 from public.households where id = old.household_id) then
    perform public.household_return_loans(old.household_id, old.user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists household_members_left_loans on public.household_members;
create trigger household_members_left_loans after delete on public.household_members
  for each row execute function public.household_member_left_loans();

create or replace function public.household_closing_loans()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  member record;
begin
  for member in select user_id from public.household_members where household_id = old.id loop
    perform public.household_return_loans(old.id, member.user_id);
  end loop;
  return old;
end;
$$;

drop trigger if exists households_closing_loans on public.households;
create trigger households_closing_loans before delete on public.households
  for each row execute function public.household_closing_loans();

-- ---- Who may call what -------------------------------------------------------------
-- Only the triggers call these.
revoke all on function public.household_return_loans(uuid, uuid) from public, anon, authenticated;
revoke all on function public.household_member_left_loans() from public, anon, authenticated;
revoke all on function public.household_closing_loans() from public, anon, authenticated;
revoke all on function public.household_loans_author_gone() from public, anon, authenticated;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0012_loan_sharing.sql') on conflict (name) do nothing;
