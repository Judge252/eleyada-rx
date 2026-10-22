-- TEST HARNESS ONLY. Never run on a Supabase project or any existing database.
-- Minimal Supabase auth table/roles/UID context for real standalone PostgreSQL tests.
-- No Auth service, passwords, sessions, login identities or real patient data.
create role anon nologin nobypassrls;
create role authenticated nologin nobypassrls;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
create function auth.uid() returns uuid language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Reproduce legacy Supabase defaults so the migration must remove these grants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
