-- A limit on the photos an account keeps in the "scans" bucket (audit F8).
-- The app uploads from the device with the user's own session, so the limit
-- has to live in the database, where an old app and a hand-made request are
-- held to it too:
--   * one file: 2 MB (a photo is ~150 KB, a thumbnail ~20 KB);
--   * one account: public.photo_quota_bytes() in all, 100 MB by default
--     (about 600 scans). To change it, run the "create or replace
--     function" below again with another number.
-- An upload past the limit is refused (the app keeps the photo on the device
-- and says so). Writing over a file that already exists is allowed, so the
-- app can still shrink its old photos to free space. The check reads the
-- total before the upload, so an account may go over by one file at most.

update storage.buckets set file_size_limit = 2097152 where id = 'scans' and file_size_limit is distinct from 2097152;

create or replace function public.photo_quota_bytes()
returns bigint
language sql immutable set search_path = ''
as $$ select 104857600::bigint $$;

-- Whether the signed-in account may add the file `p_name` to the bucket.
create or replace function public.photo_quota_ok(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from storage.objects where bucket_id = 'scans' and name = p_name)
      or coalesce((
           select sum(coalesce((metadata ->> 'size')::bigint, 0))
             from storage.objects
            where bucket_id = 'scans' and name like (select auth.uid())::text || '/%'
         ), 0) < public.photo_quota_bytes()
$$;

revoke all on function public.photo_quota_bytes() from public, anon;
revoke all on function public.photo_quota_ok(text) from public, anon;
grant execute on function public.photo_quota_bytes() to authenticated, service_role;
grant execute on function public.photo_quota_ok(text) to authenticated, service_role;

-- Restrictive: added to the "own folder" policy of 0001, never instead of it.
drop policy if exists "scans: quota" on storage.objects;
create policy "scans: quota" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'scans' or public.photo_quota_ok(name));

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0020_quota_photos.sql') on conflict (name) do nothing;
