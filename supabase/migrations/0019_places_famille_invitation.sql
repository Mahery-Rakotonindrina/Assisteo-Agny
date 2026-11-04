-- Family seats, two hardenings (audit of 2026-11-03):
--
-- 1. The invited person's read policy of 0016 compared the e-mail of the
--    session with the seat's, confirmed or not. Now it also asks that
--    Supabase Auth confirmed that e-mail (auth.users.email_confirmed_at),
--    through public.email_confirmed(). user_metadata is never used: the
--    user can change it.
-- 2. An invitation to accept: adding an e-mail no longer gives the seat; the
--    person accepts or refuses in "Mon offre" (pages/api/family-seats.ts).
--    accepted_at is null while the invitation waits: no plan, nothing seen.
--    The seats that exist when this migration runs count as accepted.

-- ---- 1. The e-mail of the session is confirmed ----------------------------------------

create or replace function public.email_confirmed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select email_confirmed_at is not null from auth.users where id = (select auth.uid())), false)
$$;

revoke all on function public.email_confirmed() from public, anon;
grant execute on function public.email_confirmed() to authenticated, service_role;

-- ---- 2. The invitation ------------------------------------------------------------------

do $$
begin
  if not exists (select from information_schema.columns where table_schema = 'public' and table_name = 'family_seats' and column_name = 'accepted_at') then
    alter table public.family_seats add column accepted_at timestamptz;
    -- Only once, with the column: the seats already in place stay as they are.
    update public.family_seats set accepted_at = created_at where accepted_at is null;
  end if;
end $$;

-- ---- The read policy, with both ----------------------------------------------------------

-- The invited person reads their own seat, pending or accepted (the screen
-- answers from the server, which reads it too), with a confirmed e-mail only.
drop policy if exists "family_seats: member reads" on public.family_seats;
create policy "family_seats: member reads" on public.family_seats
  for select to authenticated
  using (member_email = lower((select auth.jwt() ->> 'email')) and public.email_confirmed());

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0019_places_famille_invitation.sql') on conflict (name) do nothing;
