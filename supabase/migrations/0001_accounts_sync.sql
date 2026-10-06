-- Accounts & cross-device sync for Assisteo Agny.
-- Every table is protected by Row Level Security: a signed-in user can only
-- see and change their own rows. Photos live in the private "scans" bucket,
-- under a folder named after the user's id.

-- Bumped by the database itself, so the pull cursor never depends on a
-- device's clock.
create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = now();
  return new;
end;
$$;

-- ---- History ----------------------------------------------------------------

create table if not exists public.analyses (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  created_at timestamptz not null,
  -- Client clock, used to resolve edits made on two devices (last write wins).
  updated_at timestamptz not null,
  -- Tombstone: deletions must reach the other devices too.
  deleted_at timestamptz,
  mode text not null,
  analysis jsonb not null,
  meta jsonb not null,
  reminder_at timestamptz,
  preview_path text,
  thumbnail_path text,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists analyses_user_sync_idx on public.analyses (user_id, server_updated_at);

drop trigger if exists analyses_touch on public.analyses;
create trigger analyses_touch before insert or update on public.analyses
  for each row execute function public.touch_server_updated_at();

alter table public.analyses enable row level security;

drop policy if exists "analyses: own rows" on public.analyses;
create policy "analyses: own rows" on public.analyses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- Settings -----------------------------------------------------------------

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before insert or update on public.user_settings
  for each row execute function public.touch_server_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: own row" on public.user_settings;
create policy "user_settings: own row" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- Own AI keys (encrypted) ----------------------------------------------------
-- Written and read only by the server (service role), which encrypts with a
-- secret that never leaves Vercel. No policy for "authenticated": clients
-- can't touch this table directly, not even their own row.

create table if not exists public.user_ai_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preset_id text not null,
  ciphertext text not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now()
);

drop trigger if exists user_ai_keys_touch on public.user_ai_keys;
create trigger user_ai_keys_touch before insert or update on public.user_ai_keys
  for each row execute function public.touch_server_updated_at();

alter table public.user_ai_keys enable row level security;

-- ---- Photos ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scans', 'scans', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "scans: own folder" on storage.objects;
create policy "scans: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'scans' and (storage.foldername (name))[1] = auth.uid()::text)
  with check (bucket_id = 'scans' and (storage.foldername (name))[1] = auth.uid()::text);
