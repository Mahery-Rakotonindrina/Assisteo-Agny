-- Shared loans (0012): the lender may remove a repayment another member noted
-- on their loan (the owner's answer of 2026-11-04). A repayment is a row
-- written by its author, who alone may change it; this function is the one
-- other way to take it off, and only that: it puts the tombstone
-- (deleted_at) on the row, nothing else. The members' devices then drop it
-- on their next sync, like any removal.
-- Allowed to: the repayment's author, and the author of the loan it is on.
-- A member only acts on the rows of their own household. Returns whether
-- a repayment was removed.

create or replace function public.household_remove_repayment(p_id text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  home uuid;
  removed integer;
begin
  if me is null then
    return false;
  end if;
  select m.household_id into home from public.household_members m where m.user_id = me;
  if home is null then
    return false;
  end if;
  update public.household_loans r
     set deleted_at = now(), updated_at = now()
   where r.household_id = home and r.id = p_id and r.deleted_at is null and r.data ->> 'kind' = 'repayment'
     and (r.user_id = me or exists (
           select 1 from public.household_loans l
            where l.household_id = home and l.id = r.data ->> 'loanId' and l.data ->> 'kind' = 'loan' and l.user_id = me));
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.household_remove_repayment(text) from public, anon;
grant execute on function public.household_remove_repayment(text) to authenticated, service_role;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0021_remboursements_foyer.sql') on conflict (name) do nothing;
