-- PREPARED ONLY. Requires explicit native synthetic-secret probe approval.
-- Generates only a temporary non-clinical value; no real namespace reads/exports.
begin;
set local lock_timeout='1s';
set local statement_timeout='5s';
do $$declare value text; artifact uuid;begin
 value:=encode(extensions.gen_random_bytes(32),'hex');
 artifact:=vault.create_secret(value,'al_eyada_rx.probe.'||gen_random_uuid()::text,'Rollback-only native probe');
 if not exists(select 1 from vault.decrypted_secrets where id=artifact and decrypted_secret=value) then
   raise exception 'Native temporary equality check failed';
 end if;
end$$;
rollback;
select count(*)=0 as no_probe_artifacts from vault.secrets where name like 'al_eyada_rx.probe.%';
