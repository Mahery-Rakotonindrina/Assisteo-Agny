-- Web Push for reminders (the site added to an iPhone home screen, and
-- browsers): a subscribed browser is one more row of push_devices, with
-- platform 'web' and its subscription (endpoint and keys, as JSON) in `token`.
-- Written by the server only (pages/api/push/web.ts); the row policy of 0003
-- is unchanged: each account sees its own devices.

alter table public.push_devices drop constraint if exists push_devices_platform_check;
alter table public.push_devices add constraint push_devices_platform_check check (platform in ('android', 'ios', 'web'));

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0017_web_push.sql') on conflict (name) do nothing;
