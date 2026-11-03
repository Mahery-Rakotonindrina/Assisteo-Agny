-- The list of applied migrations (public._migrations, written by
-- "npm run db:migrate" and by each migration pasted by hand) had no row
-- security: in the public schema, the app's public key could read it, and
-- write it where Supabase grants anon and authenticated by default (a name
-- written there makes db:migrate skip that migration). Only the server reads
-- and writes it: the postgres role and the service key bypass RLS.

create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
alter table public._migrations enable row level security;
revoke all on table public._migrations from anon, authenticated;

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
insert into public._migrations (name) values ('0018_migrations_privees.sql') on conflict (name) do nothing;
