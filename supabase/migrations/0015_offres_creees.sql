-- Plans created from the Admin (Admin → Offers → "Créer une offre"): a
-- subscription may now hold one of them, by its short id ("famille",
-- "etudiant"…). The fixed list of 0005 ('lite', 'premium', 'pro',
-- 'unlimited') becomes a format check; the server checks that the plan
-- exists in its settings (lib/server/planConfig.ts) before writing a row.
-- Rows already recorded all pass the new check.

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_plan_format;
alter table public.subscriptions
  add constraint subscriptions_plan_format check (plan ~ '^[a-z][a-z0-9-]{1,23}$');

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0015_offres_creees.sql') on conflict (name) do nothing;
