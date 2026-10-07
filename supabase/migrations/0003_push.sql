-- Server push for reminders (Android, Firebase Cloud Messaging).
-- Each signed-in device registers its push token and the reminders it has
-- already scheduled locally; the reminder cron only pushes to the others.

create table if not exists public.push_devices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The app's random install id: one row per device, token refreshed in place.
  device_id text not null,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  -- History ids whose reminder this device has scheduled as a local notification.
  scheduled jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.push_devices enable row level security;

drop policy if exists "push_devices: own rows" on public.push_devices;
create policy "push_devices: own rows" on public.push_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- When the cron last pushed this entry's reminder (avoids sending it twice).
alter table public.analyses add column if not exists reminder_pushed_at timestamptz;

create index if not exists analyses_reminder_due_idx on public.analyses (reminder_at)
  where reminder_at is not null and deleted_at is null;
