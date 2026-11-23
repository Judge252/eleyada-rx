-- Bilingual display names: every doctor and clinic can carry a Hebrew and an English name, so each is shown in the
-- letters of the reader's language (Hebrew UI -> Hebrew name, English UI -> English name). The existing
-- display_name / name stay as the fallback and are unchanged. Names are display text only, never authorization.
begin;

alter table public.prescribers
  add column display_name_he text check (display_name_he is null or length(btrim(display_name_he)) between 1 and 200),
  add column display_name_en text check (display_name_en is null or length(btrim(display_name_en)) between 1 and 200);
alter table public.clinics
  add column name_he text check (name_he is null or length(btrim(name_he)) between 1 and 200),
  add column name_en text check (name_en is null or length(btrim(name_en)) between 1 and 200);

-- Doctor workspace context: adds the per-language names next to the existing fields.
create or replace function public.get_prescriber_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target:=rx_private.doctor_clinic();
 if target is null then return jsonb_build_object('state','unauthorized'); end if;
 return (select jsonb_build_object('state','verified','doctor_id',d.user_id,'doctor_name',d.display_name,'clinic_id',c.id,'clinic_name',c.name,
 'doctor_name_he',d.display_name_he,'doctor_name_en',d.display_name_en,'clinic_name_he',c.name_he,'clinic_name_en',c.name_en,
 'entitled',exists(select 1 from public.clinic_entitlements e where e.clinic_id=c.id and e.is_active and e.starts_at<=clock_timestamp() and (e.ends_at is null or e.ends_at>clock_timestamp())))
 from public.prescribers d join public.clinics c on c.id=target where d.user_id=auth.uid());
end;
$$;

-- Printable sheet / pharmacy lookup: current names plus the per-language names.
create or replace function rx_private.public_sheet(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('doctor_name',coalesce(d.display_name,f.result->>'doctor_name'),'clinic_name',coalesce(c.name,f.result->>'clinic_name'),
    'doctor_name_he',d.display_name_he,'doctor_name_en',d.display_name_en,'clinic_name_he',c.name_he,'clinic_name_en',c.name_en)
  from public.prescriptions p
  left join public.prescribers d on d.user_id=p.doctor_user_id
  left join rx_private.patient_clinics pc on pc.patient_id=p.patient_id
  left join public.clinics c on c.id=pc.clinic_id
  left join rx_private.form_receipts f on f.prescription_id=p.id
  where p.id=p_id;
$$;

-- The lookup passes every name field from the sheet helper through (body otherwise unchanged).
grant rx_public_executor to current_user with inherit false, set true;
grant create on schema public to rx_public_executor;
set local role rx_public_executor;
create or replace function public.public_lookup_prescription(p_identifier text,p_code text,p_client text default null) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare detail jsonb; sheet jsonb; st jsonb; nid text; resolved record; p record; token uuid; checked timestamptz; patient jsonb; sid text;
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  begin
    if not rx_private.consume_public_limit('public_lookup_global','all',2000,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    if p_client is not null and p_client ~ '^[0-9a-f]{64}$' and not rx_private.consume_public_limit('public_lookup_client',p_client,40,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    begin nid:=rx_private.normalize_il_id(p_identifier);
    exception when invalid_parameter_value then return rx_private.public_failure('PT404'); end;
    sid:=rx_private.public_digest('id|'||nid);
    if not rx_private.consume_public_limit('public_lookup_id',sid,15,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
    begin select * into resolved from rx_private.public_resolve(p_identifier,p_code);
    exception when invalid_parameter_value then return rx_private.public_failure('PT404'); end;
    if not found then return rx_private.public_failure('PT404'); end if;
  exception when sqlstate 'PT503' then return rx_private.public_failure('PT503');
  end;
  perform set_config('rx.public_rx',resolved.id::text,true);
  select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=resolved.id for update;
  checked:=clock_timestamp();
  sheet:=rx_private.public_sheet(p.id);
  st:=rx_private.public_fill_state(p.id);
  insert into rx_private.public_lookups(prescription_id,expected_version,fills_seen) values(p.id,p.updated_at,(st->>'fills')::integer) returning id into token;
  select jsonb_build_object('name',name) into patient from public.patients where id=p.patient_id;
  detail:=jsonb_build_object('issued_at',p.issued_at,'expires_at',p.expires_at,'database_time',checked,'patient',patient,
    'items',st->'items','history',st->'history')||coalesce(sheet,'{}'::jsonb);
  if (st->>'complete')::boolean then return detail||jsonb_build_object('state','dispensed','dispensed_at',st->'dispensed_at'); end if;
  if p.status='cancelled' then return detail||jsonb_build_object('state','cancelled'); end if;
  if p.status<>'issued' or p.expires_at is null or p.expires_at<=checked then return detail||jsonb_build_object('state','expired'); end if;
  return detail||jsonb_build_object('state',case when (st->>'fills')::integer>0 then 'partial' else 'eligible' end,
    'prescription_id',p.id,'lookup_id',token,'confirmation_expires_at',(select expires_at from rx_private.public_lookups where id=token));
end;
$$;
reset role;
revoke create on schema public from rx_public_executor;
revoke rx_public_executor from current_user;
commit;
