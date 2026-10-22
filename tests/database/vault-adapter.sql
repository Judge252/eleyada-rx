-- LOCAL TEST HARNESS ONLY. This is not Supabase Vault or its AEAD implementation.
-- Real pgcrypto encryption exercises transactional artifacts/permissions, not provider recovery.
create schema extensions;
create extension pgcrypto with schema extensions;
create schema vault;
create table vault.local_root (key text not null);
insert into vault.local_root values (encode(extensions.gen_random_bytes(32),'hex'));
create table vault.secrets (
  id uuid primary key default gen_random_uuid(), name text unique, description text,
  secret bytea not null
);
create view vault.decrypted_secrets as
  select s.id,s.name,s.description,extensions.pgp_sym_decrypt(s.secret,r.key) as decrypted_secret
  from vault.secrets s cross join vault.local_root r;
create function vault.create_secret(new_secret text,new_name text default null,
  new_description text default '',new_key_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  insert into vault.secrets(name,description,secret)
  select new_name,new_description,extensions.pgp_sym_encrypt(new_secret,key) from vault.local_root
  returning id into result;
  return result;
end;
$$;
revoke all on schema vault from public,anon,authenticated,service_role;
revoke all on all tables in schema vault from public,anon,authenticated,service_role;
revoke all on all functions in schema vault from public,anon,authenticated,service_role;
