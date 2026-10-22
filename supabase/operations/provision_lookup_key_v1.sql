-- OPERATOR ONLY, SEPARATE APPROVAL REQUIRED. Never part of application startup.
-- Exact approved project must be independently checked before executing this file.
-- Generates inside PostgreSQL: no secret literals, stdout values or application env key.
begin;
do $$ begin
  if current_user<>'postgres' then raise exception 'Trusted provisioner required'; end if;
  if exists(select 1 from vault.secrets where name='al_eyada_rx.lookup.v1') then
    raise exception 'Lookup v1 already exists; never replace a used key';
  end if;
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
    'al_eyada_rx.lookup.v1','Prescription lookup HMAC key version 1');
end $$;
commit;
