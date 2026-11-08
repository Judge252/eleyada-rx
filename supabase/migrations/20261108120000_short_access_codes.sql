-- Short patient access code: six digits, bound to ONE prescription and used together with the Israeli ID.
-- Additive. The long RX1 reference keeps working. The code is stored only as a keyed digest plus a Vault copy
-- the issuing doctor can re-read. Brute force is bounded by per-ID hourly (15) and daily (40) budgets.
begin;

create table rx_private.short_codes (
  prescription_id uuid primary key references public.prescriptions(id),
  digest text not null,
  vault_secret_id uuid not null
);
alter table rx_private.short_codes enable row level security;
revoke all on rx_private.short_codes from public,anon,authenticated,service_role;
create trigger immutable_short_code before update or delete on rx_private.short_codes
  for each row execute function rx_private.guard_audit_history();

create function rx_private.short_digest(p_id uuid,p_code text) returns text
language plpgsql security definer set search_path='' as $$
declare key_hex text;
begin
  select decrypted_secret into key_hex from vault.decrypted_secrets where name='al_eyada_rx.lookup.v1';
  if key_hex is null or key_hex !~ '^[0-9a-f]{64}$' then raise exception 'Key unavailable' using errcode='PT503'; end if;
  return encode(extensions.hmac(convert_to('al-eyada-rx|short|v1|'||p_id::text||'|'||p_code,'UTF8'),decode(key_hex,'hex'),'sha256'),'hex');
exception when sqlstate 'PT503' then raise;
  when others then raise exception 'Key unavailable' using errcode='PT503';
end;
$$;

-- Issuing doctor only. Creates the code on first call (also works for already-issued prescriptions), then re-reads it.
create function public.reveal_doctor_short_code(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; s rx_private.short_codes; code text; attempt integer; secret uuid;
begin
  perform rx_private.assert_lifecycle_doctor();
  select * into p from public.prescriptions where id=p_id and doctor_user_id=auth.uid() for update;
  if not found or p.status='draft' then raise exception 'Issued prescription unavailable' using errcode='42501'; end if;
  perform rx_private.assert_lifecycle_doctor();
  select * into s from rx_private.short_codes where prescription_id=p_id;
  if found then
    select decrypted_secret into code from vault.decrypted_secrets where id=s.vault_secret_id;
    if code is null or rx_private.short_digest(p_id,code) is distinct from s.digest then
      raise exception 'Code unavailable' using errcode='PT503'; end if;
  else
    for attempt in 1..30 loop
      code:=lpad((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 1000000)::text,6,'0');
      -- No other prescription of the same patient ID may share this code (a lookup must name exactly one).
      continue when exists(
        select 1 from rx_private.patient_identities mine
        join rx_private.patient_identities sib on sib.country=mine.country and sib.document_type=mine.document_type and sib.identifier=mine.identifier
        join public.prescriptions q on q.patient_id=sib.patient_id and q.id<>p_id
        join rx_private.short_codes sc on sc.prescription_id=q.id
        where mine.patient_id=p.patient_id and sc.digest=rx_private.short_digest(q.id,code));
      secret:=vault.create_secret(code,'al_eyada_rx.shortcode.'||p_id::text,'Prescription short access code');
      insert into rx_private.short_codes(prescription_id,digest,vault_secret_id) values(p_id,rx_private.short_digest(p_id,code),secret);
      exit;
    end loop;
    if not exists(select 1 from rx_private.short_codes where prescription_id=p_id) then raise exception 'Code allocation unavailable' using errcode='PT503'; end if;
  end if;
  insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata)
    values(auth.uid(),'prescriptions.short_code_retrieved','prescriptions',p_id,'{}'::jsonb);
  return jsonb_build_object('id',p_id,'code',code);
end;
$$;
revoke all on function public.reveal_doctor_short_code(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reveal_doctor_short_code(uuid) to authenticated;

-- Public proof: six-digit code (new) or RX1 reference (existing), always together with the Israeli ID.
create or replace function rx_private.public_resolve(p_identifier text,p_code text) returns table(id uuid,version timestamptz)
language plpgsql security definer set search_path='' as $$
declare nid text:=rx_private.normalize_il_id(p_identifier); digest text;
begin
 if p_code ~ '^[0-9]{6}$' then
   -- Short codes are guessable by volume, so every attempt also spends a daily per-ID budget. Exhaustion looks like "no match".
   if not rx_private.consume_public_limit('public_lookup_id_day',rx_private.public_digest('id|'||nid),40,interval '24 hours') then return; end if;
   return query select p.id,p.updated_at from rx_private.patient_identities i
     join public.prescriptions p on p.patient_id=i.patient_id
     join rx_private.short_codes s on s.prescription_id=p.id
     where i.country='IL' and i.document_type='national_id' and i.identifier=nid and p.status<>'draft'
       and s.digest=rx_private.short_digest(p.id,p_code) limit 1;
   return;
 end if;
 perform rx_private.normalize_reference(p_code);
 digest:=rx_private.reference_digest(p_code);
 return query select p.id,p.updated_at from public.prescriptions p
  where p.reference_digest=digest and p.status<>'draft'
   and exists(select 1 from rx_private.patient_identities i where i.patient_id=p.patient_id and i.country='IL' and i.document_type='national_id' and i.identifier=nid);
end;
$$;

-- Printable prescription sheet: the public lookup also returns the doctor and clinic names (display text only).
create function rx_private.public_sheet(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('doctor_name',coalesce(f.result->>'doctor_name',d.display_name),'clinic_name',coalesce(f.result->>'clinic_name',c.name))
  from public.prescriptions p
  left join public.prescribers d on d.user_id=p.doctor_user_id
  left join rx_private.patient_clinics pc on pc.patient_id=p.patient_id
  left join public.clinics c on c.id=pc.clinic_id
  left join rx_private.form_receipts f on f.prescription_id=p.id
  where p.id=p_id;
$$;
revoke all on function rx_private.public_sheet(uuid) from public,anon,authenticated,service_role;
grant execute on function rx_private.public_sheet(uuid) to rx_public_executor;
grant rx_public_executor to current_user with inherit false,set true;
grant create on schema public to rx_public_executor;
set local role rx_public_executor;
create or replace function public.public_lookup_prescription(p_identifier text,p_code text,p_client text default null) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare detail jsonb; sheet jsonb; nid text; resolved record; p record; token uuid; completion timestamptz; checked timestamptz; items jsonb; patient jsonb; sid text;
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  -- Preference overrides (e.g. tx=rollback) could roll back budgets while returning data.
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  begin
    if not rx_private.consume_public_limit('public_lookup_global','all',2000,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    if p_client is not null and p_client ~ '^[0-9a-f]{64}$' and not rx_private.consume_public_limit('public_lookup_client',p_client,40,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    begin nid:=rx_private.normalize_il_id(p_identifier);
    exception when invalid_parameter_value then return rx_private.public_failure('PT404'); end;
    sid:=rx_private.public_digest('id|'||nid);
    -- Per-ID budget counts every attempt (valid or not) before proof is checked.
    if not rx_private.consume_public_limit('public_lookup_id',sid,15,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    begin select * into resolved from rx_private.public_resolve(p_identifier,p_code);
    exception when invalid_parameter_value then return rx_private.public_failure('PT404'); end;
    if not found then return rx_private.public_failure('PT404'); end if;
  exception when sqlstate 'PT503' then return rx_private.public_failure('PT503');
  end;
  perform set_config('rx.public_rx',resolved.id::text,true);
  sheet:=rx_private.public_sheet(resolved.id);
  insert into rx_private.public_lookups(prescription_id,expected_version) values(resolved.id,resolved.version) returning id into token;
  select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=resolved.id for update;
  checked:=clock_timestamp();
  select dispensed_at into completion from public.dispensations where prescription_id=p.id;
  select jsonb_build_object('name',name) into patient from public.patients where id=p.patient_id;
  select jsonb_agg(jsonb_build_object('medication_name',medication_name,'strength',strength,'dose',dose,'frequency',frequency,'duration',duration,'quantity',quantity,'special_instructions',special_instructions) order by sort_order,id) into items from public.prescription_items where prescription_id=p.id;
  -- Proof holders can always re-open the sheet (print/PDF) for any issued prescription; only an eligible one can be dispensed.
  detail:=jsonb_build_object('issued_at',p.issued_at,'expires_at',p.expires_at,'database_time',checked,'patient',patient,'items',items,'doctor_name',sheet->>'doctor_name','clinic_name',sheet->>'clinic_name');
  if completion is not null then return detail||jsonb_build_object('state','dispensed','dispensed_at',completion); end if;
  if p.status='cancelled' then return detail||jsonb_build_object('state','cancelled'); end if;
  if p.status<>'issued' or p.expires_at is null or p.expires_at<=checked then return detail||jsonb_build_object('state','expired'); end if;
  return detail||jsonb_build_object('state','eligible','prescription_id',p.id,'lookup_id',token,'confirmation_expires_at',(select expires_at from rx_private.public_lookups where id=token));
end;
$$;
reset role;
revoke create on schema public from rx_public_executor;
revoke rx_public_executor from current_user;
commit;
