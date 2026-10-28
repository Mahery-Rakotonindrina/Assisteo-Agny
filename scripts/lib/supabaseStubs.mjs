// What Supabase provides and the migrations rely on, reduced to the minimum,
// for a throwaway Postgres (scripts/db-restore-check.mjs, db-rls-check.mjs).
// auth.uid() reads the user id like Supabase does (request.jwt.claim.sub):
// null unless a test sets it.
export const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz, last_sign_in_at timestamptz, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

/**
 * The table and function rights Supabase gives the API roles on what the
 * migrations create (its default privileges). Run before the migrations, so
 * that their own "revoke" lines are tested as they'll run on Supabase.
 */
export const SUPABASE_GRANTS = `
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;
