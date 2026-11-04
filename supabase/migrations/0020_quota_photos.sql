-- A limit on the photos an account keeps in the "scans" bucket (audit F8).
-- The app uploads from the device with the user's own session, so the limit
-- has to live in the database, where an old app and a hand-made request are
-- held to it too:
--   * one file: 2 MB (a photo is ~150 KB, a thumbnail ~20 KB);
--   * one account: public.photo_quota_bytes() in all, 100 MB by default
--     (about 600 scans). To change it, run the "create or replace
--     function" below again with another number.
-- Adding a file, and writing over one (its size may change: empty files
-- grown to 2 MB each would get round a check on adding only), are both held
-- to it: the account's total, with this file's new size in place of its old
-- one, must stay within the limit. A file that does not grow is always
-- allowed, so the app can still shrink its old photos to free space. A size
-- the request doesn't tell counts as the largest file. Two uploads at the
-- very same time may go over by a file each: the limit is firm, not exact.

update storage.buckets set file_size_limit = 2097152 where id = 'scans' and file_size_limit is distinct from 2097152;

create or replace function public.photo_quota_bytes()
returns bigint
language sql immutable set search_path = ''
as $$ select 104857600::bigint $$;

-- Whether the signed-in account may store the file `p_name` with the size `p_size`
-- (null: not told). Not "security definer" on purpose: it runs as the account,
-- which reads its own folder through the policy of 0001, so it counts the
-- same whether or not the role owning a function would bypass row security
-- (on Supabase it may not be allowed to see the files at all). Only the
-- account's own folder is counted.
create or replace function public.photo_quota_ok(p_name text, p_size bigint default null)
returns boolean
language sql stable set search_path = ''
as $$
  with mine as (
    select name, coalesce((metadata ->> 'size')::bigint, 0) as size
      from storage.objects
     where bucket_id = 'scans' and name like (select auth.uid())::text || '/%'
  )
  select coalesce(p_size, 2097152) <= coalesce((select size from mine where name = p_name), 0)
      or (select coalesce(sum(size), 0) from mine where name <> p_name) + coalesce(p_size, 2097152) <= public.photo_quota_bytes()
$$;

revoke all on function public.photo_quota_bytes() from public, anon;
revoke all on function public.photo_quota_ok(text, bigint) from public, anon;
grant execute on function public.photo_quota_bytes() to authenticated, service_role;
grant execute on function public.photo_quota_ok(text, bigint) to authenticated, service_role;

-- Restrictive: added to the "own folder" policy of 0001, never instead of it.
drop policy if exists "scans: quota" on storage.objects;
create policy "scans: quota" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'scans' or public.photo_quota_ok(name, (metadata ->> 'size')::bigint));

drop policy if exists "scans: quota on update" on storage.objects;
create policy "scans: quota on update" on storage.objects
  as restrictive for update to authenticated
  using (true)
  with check (bucket_id <> 'scans' or public.photo_quota_ok(name, (metadata ->> 'size')::bigint));

-- Pasted by hand in the SQL editor: noted as applied, so "npm run db:migrate"
-- skips it (it runs it again otherwise, which changes nothing).
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
insert into public._migrations (name) values ('0020_quota_photos.sql') on conflict (name) do nothing;
