-- Clinic RX: Israel-only identity, username sign-in budget, open pharmacy portal. Additive; no history rewrites.
-- Public access model: national ID + patient-held prescription code (existing RX1 reference) => one narrow capability.
begin;

-- ---------------------------------------------------------------------------
-- 1. Israeli national ID: exactly nine ASCII digits after digit-form conversion.
-- No checksum: no authoritative (Population and Immigration Authority) source was verified; leading zeros preserved.
-- ---------------------------------------------------------------------------
create function rx_private.normalize_il_id(p_id text) returns text
language plpgsql immutable set search_path='' as $$
declare normalized text:=translate(btrim(p_id),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
begin
 if normalized is null or normalized!~'^[0-9]{9}$' then raise exception 'Invalid identity' using errcode='22023'; end if;
 return normalized;
end;
$$;

-- Prescription issuance: country/type are fixed here, never accepted from the client.
grant rx_form_executor to current_user with inherit false,set true;
grant create on schema public to rx_form_executor;
grant execute on function rx_private.normalize_il_id(text) to rx_form_executor;
set local role rx_form_executor;
create or replace function public.issue_form_prescription(p_request_id uuid,p_payload jsonb,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare actor uuid:=rx_private.lifecycle_actor_id(); clinic uuid; identity jsonb; patient uuid; prescription uuid; version timestamptz; item jsonb; field text; n integer:=0; fingerprint text; receipt rx_private.form_receipts; result jsonb; review jsonb;
begin
 clinic:=rx_private.assert_clinic_access(false);
 if p_request_id is null or p_confirmed is distinct from true or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['name','identifier','notes','items']<>'{}'::jsonb or jsonb_typeof(p_payload->'identifier') is distinct from 'string' then raise exception 'Invalid form' using errcode='22023'; end if;
 identity:=jsonb_build_object('country','IL','type','national_id','identifier',rx_private.normalize_il_id(p_payload->>'identifier'));
 if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 200 or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>4000 or jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 30 then raise exception 'Invalid form' using errcode='22023'; end if;
 fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,9));
 select * into receipt from rx_private.form_receipts where actor_id=actor and request_id=p_request_id;
 if found then
   if receipt.fingerprint<>fingerprint then raise exception 'Request changed' using errcode='PT409'; end if;
   return receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform rx_private.assert_clinic_access(true);
 for item in select value from jsonb_array_elements(p_payload->'items') loop
   if jsonb_typeof(item) is distinct from 'object' or item-array['medication_name','strength','dose','frequency','duration','quantity','special_instructions']<>'{}'::jsonb then raise exception 'Invalid medication' using errcode='22023'; end if;
   foreach field in array array['medication_name','strength','dose','frequency','duration','special_instructions'] loop
     if jsonb_typeof(item->field) is distinct from 'string' or length(item->>field)>(case field when 'strength' then 120 when 'duration' then 120 when 'special_instructions' then 2000 else 200 end) or (field<>'special_instructions' and length(btrim(item->>field))=0) then raise exception 'Invalid medication' using errcode='22023'; end if;
   end loop;
   if jsonb_typeof(item->'quantity') is distinct from 'number' or item->>'quantity'!~'^[1-9][0-9]{0,6}$' or (item->>'quantity')::numeric>1000000 then raise exception 'Invalid quantity' using errcode='22023'; end if;
 end loop;
 insert into public.patients(name) values(btrim(p_payload->>'name')) returning id into patient;
 insert into rx_private.patient_identities values(patient,identity->>'country',identity->>'type',identity->>'identifier');
 insert into public.prescriptions(patient_id,doctor_user_id,doctor_notes) values(patient,actor,nullif(p_payload->>'notes','')) returning id,updated_at into prescription,version;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
   insert into public.prescription_items(prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order) values(prescription,item->>'medication_name',item->>'strength',item->>'dose',item->>'frequency',item->>'duration',(item->>'quantity')::integer,nullif(item->>'special_instructions',''),n);
   n:=n+1;
 end loop;
 review:=rx_private.review_payload(prescription);
 result:=public.issue_doctor_prescription(prescription,version,encode(extensions.digest(review::text,'sha256'),'hex'),p_request_id)-'reference';
 result:=result||jsonb_build_object('doctor_id',actor,'clinic_id',clinic,'doctor_name',(select display_name from public.prescribers where user_id=actor),'clinic_name',(select name from public.clinics where id=clinic));
 insert into rx_private.form_receipts values(actor,p_request_id,fingerprint,prescription,clinic,result);
 return result;
exception when unique_violation then raise exception 'Request conflict' using errcode='PT409';
end;
$$;
reset role;
revoke create on schema public from rx_form_executor;
revoke rx_form_executor from current_user;

-- ---------------------------------------------------------------------------
-- 2. Dispensations: honest attribution for anonymous completions.
-- Existing rows keep access_method='pharmacy_account' and their pharmacy/pharmacist FKs.
-- Public rows carry NO pharmacy/pharmacist identity; the visitor label is stored as unverified text.
-- ---------------------------------------------------------------------------
alter table public.dispensations
  add column access_method text not null default 'pharmacy_account' check(access_method in ('pharmacy_account','public_code')),
  add column pharmacy_label text check(pharmacy_label is null or length(pharmacy_label) between 1 and 120);
alter table public.dispensations alter column pharmacy_id drop not null, alter column pharmacist_user_id drop not null;
alter table public.dispensations add constraint dispensations_access_attribution check(
  (access_method='pharmacy_account' and pharmacy_id is not null and pharmacist_user_id is not null and pharmacy_label is null)
  or (access_method='public_code' and pharmacy_id is null and pharmacist_user_id is null));
create or replace function rx_private.guard_dispensation() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  p_status public.prescription_status;
  p_expiry timestamptz;
  p_issued timestamptz;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Dispensation history is append-only' using errcode = '23514';
  end if;
  select p.status, p.expires_at, p.issued_at into p_status, p_expiry, p_issued
  from public.prescriptions p where p.id = new.prescription_id for update;
  if not found then
    raise exception 'Prescription does not exist' using errcode = '23503';
  end if;
  if p_status <> 'issued' or (p_expiry is not null and p_expiry <= clock_timestamp()) then
    raise exception 'Dispensation requires an issued, unexpired prescription' using errcode = '23514';
  end if;
  if new.dispensed_at < p_issued or new.dispensed_at > clock_timestamp() then
    raise exception 'Invalid dispensation timestamp' using errcode = '23514';
  end if;
  if new.access_method = 'pharmacy_account' and not exists (select 1 from public.app_users u join public.pharmacies ph on ph.id = u.pharmacy_id
    where u.id = new.pharmacist_user_id and u.pharmacy_id = new.pharmacy_id
      and u.role = 'pharmacist' and u.is_active and ph.is_active) then
    raise exception 'Dispensation requires an active pharmacist in the matching active pharmacy'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Persistent public budgets and keyed digests (reuses rx_private.access_limits; no client table access).
-- ---------------------------------------------------------------------------
create function rx_private.consume_public_limit(p_scope text,p_subject text,p_max integer,p_period interval) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare used integer;
begin
 insert into rx_private.access_limits as t(scope,subject,window_start,attempts) values(p_scope,p_subject,clock_timestamp(),1)
 on conflict(scope,subject) do update set attempts=case when t.window_start+p_period<=clock_timestamp() then 1 else least(t.attempts+1,100001) end,
   window_start=case when t.window_start+p_period<=clock_timestamp() then clock_timestamp() else t.window_start end returning attempts into used;
 return used<=p_max;
end;
$$;
create function rx_private.public_digest(p_value text) returns text
language plpgsql security definer set search_path='' as $$
declare key_hex text;
begin
  select decrypted_secret into key_hex from vault.decrypted_secrets where name='al_eyada_rx.lookup.v1';
  if key_hex is null or key_hex !~ '^[0-9a-f]{64}$' then raise exception 'Key unavailable' using errcode='PT503'; end if;
  return encode(extensions.hmac(convert_to('al-eyada-rx|public-subject|v1|'||p_value,'UTF8'),decode(key_hex,'hex'),'sha256'),'hex');
exception when sqlstate 'PT503' then raise;
  when others then raise exception 'Key unavailable' using errcode='PT503';
end;
$$;
-- Proof: BOTH the Israeli ID and the patient-held code must match the same prescription. Returns at most one row.
create function rx_private.public_resolve(p_identifier text,p_code text) returns table(id uuid,version timestamptz)
language plpgsql security definer set search_path='' as $$
declare nid text:=rx_private.normalize_il_id(p_identifier); digest text;
begin
 perform rx_private.normalize_reference(p_code);
 digest:=rx_private.reference_digest(p_code);
 return query select p.id,p.updated_at from public.prescriptions p
  where p.reference_digest=digest and p.status<>'draft'
   and exists(select 1 from rx_private.patient_identities i where i.patient_id=p.patient_id and i.country='IL' and i.document_type='national_id' and i.identifier=nid);
end;
$$;
create function rx_private.public_failure(p_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform set_config('response.status',case p_code when 'PT404' then '404' when 'PT409' then '409' when 'PT429' then '429' when 'PT503' then '503' else '400' end,true);
 return jsonb_build_object('code',p_code,'message','Public request unavailable','details',null,'hint',null);
end;
$$;
create function rx_private.public_scope() returns uuid
language sql stable security invoker set search_path='' as $$ select nullif(current_setting('rx.public_rx',true),'')::uuid; $$;

create table rx_private.public_lookups (
 id uuid primary key default gen_random_uuid(), prescription_id uuid not null references public.prescriptions(id), expected_version timestamptz not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '10 minutes', check(expires_at>created_at)
);
create index public_lookups_rx on rx_private.public_lookups(prescription_id);
create table rx_private.public_dispensing_receipts (
 request_id uuid primary key, lookup_id uuid not null unique references rx_private.public_lookups(id), prescription_id uuid not null unique references public.prescriptions(id),
 dispensation_id uuid not null unique references public.dispensations(id), identity_confirmed boolean not null check(identity_confirmed), full_confirmed boolean not null check(full_confirmed)
);
alter table rx_private.public_lookups enable row level security;
alter table rx_private.public_dispensing_receipts enable row level security;
revoke all on rx_private.public_lookups,rx_private.public_dispensing_receipts from public,anon,authenticated,service_role;
create trigger immutable_public_lookup before update or delete on rx_private.public_lookups for each row execute function rx_private.guard_audit_history();
create trigger immutable_public_receipt before update or delete on rx_private.public_dispensing_receipts for each row execute function rx_private.guard_audit_history();

-- Least-privilege executor: it can only see/lock/complete the ONE prescription the proof established in this transaction.
create role rx_public_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant rx_public_executor to current_user with inherit false,set true;
grant usage on schema public,rx_private to rx_public_executor;
grant select,insert on rx_private.public_lookups,rx_private.public_dispensing_receipts to rx_public_executor;
grant select(id,patient_id,status,updated_at,issued_at,expires_at) on public.prescriptions to rx_public_executor;
grant update(status) on public.prescriptions to rx_public_executor; -- solely for the parent row lock (FOR UPDATE); never used to change status
grant select(id,name) on public.patients to rx_public_executor;
grant select on public.prescription_items,public.dispensations to rx_public_executor;
grant insert(prescription_id,dispensed_at,access_method,pharmacy_label) on public.dispensations to rx_public_executor;
grant execute on function rx_private.public_scope(),rx_private.public_failure(text),rx_private.consume_public_limit(text,text,integer,interval),rx_private.public_digest(text),rx_private.public_resolve(text,text),rx_private.normalize_il_id(text) to rx_public_executor;
create policy public_lookup_read on rx_private.public_lookups for select to rx_public_executor using(true);
create policy public_lookup_insert on rx_private.public_lookups for insert to rx_public_executor with check(prescription_id=rx_private.public_scope());
create policy public_receipt_read on rx_private.public_dispensing_receipts for select to rx_public_executor using(true);
create policy public_receipt_insert on rx_private.public_dispensing_receipts for insert to rx_public_executor with check(prescription_id=rx_private.public_scope());
create policy public_rx_read on public.prescriptions for select to rx_public_executor using(id=rx_private.public_scope());
create policy public_rx_lock on public.prescriptions for update to rx_public_executor using(id=rx_private.public_scope()) with check(id=rx_private.public_scope());
create policy public_item_read on public.prescription_items for select to rx_public_executor using(prescription_id=rx_private.public_scope());
create policy public_patient_read on public.patients for select to rx_public_executor using(exists(select 1 from public.prescriptions p where p.patient_id=patients.id and p.id=rx_private.public_scope()));
create policy public_dispensation_read on public.dispensations for select to rx_public_executor using(prescription_id=rx_private.public_scope());
create policy public_dispensation_insert on public.dispensations for insert to rx_public_executor with check(prescription_id=rx_private.public_scope() and access_method='public_code');

create function public.public_lookup_prescription(p_identifier text,p_code text,p_client text default null) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare nid text; resolved record; p record; token uuid; completion timestamptz; checked timestamptz; items jsonb; patient jsonb; sid text;
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
  insert into rx_private.public_lookups(prescription_id,expected_version) values(resolved.id,resolved.version) returning id into token;
  select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=resolved.id for update;
  checked:=clock_timestamp();
  select dispensed_at into completion from public.dispensations where prescription_id=p.id;
  if completion is not null then return jsonb_build_object('state','dispensed','dispensed_at',completion,'database_time',checked); end if;
  if p.status='cancelled' then return jsonb_build_object('state','cancelled','database_time',checked); end if;
  if p.status<>'issued' or p.expires_at is null or p.expires_at<=checked then return jsonb_build_object('state','expired','database_time',checked); end if;
  select jsonb_build_object('name',name) into patient from public.patients where id=p.patient_id;
  select jsonb_agg(jsonb_build_object('medication_name',medication_name,'strength',strength,'dose',dose,'frequency',frequency,'duration',duration,'quantity',quantity,'special_instructions',special_instructions) order by sort_order,id) into items from public.prescription_items where prescription_id=p.id;
  return jsonb_build_object('state','eligible','prescription_id',p.id,'lookup_id',token,'confirmation_expires_at',(select expires_at from rx_private.public_lookups where id=token),'issued_at',p.issued_at,'expires_at',p.expires_at,'database_time',checked,'patient',patient,'items',items);
end;
$$;

create function public.public_dispense_prescription(p_lookup_id uuid,p_prescription_id uuid,p_request_id uuid,p_identity_confirmed boolean,p_full_confirmed boolean,p_pharmacy_label text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare l rx_private.public_lookups; r rx_private.public_dispensing_receipts; p record; d public.dispensations; checked timestamptz; label text:=nullif(btrim(coalesce(p_pharmacy_label,'')),'');
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  if not rx_private.consume_public_limit('public_dispense_global','all',600,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  if p_lookup_id is not null and not rx_private.consume_public_limit('public_dispense_lookup',p_lookup_id::text,20,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  begin
    if p_lookup_id is null or p_prescription_id is null or p_request_id is null or p_identity_confirmed is distinct from true or p_full_confirmed is distinct from true
      or (label is not null and (length(label)>120 or label ~ '[[:cntrl:]]')) then raise exception 'Invalid confirmation' using errcode='22023'; end if;
    select * into l from rx_private.public_lookups where id=p_lookup_id;
    if not found or l.prescription_id<>p_prescription_id then raise exception 'Confirmation changed' using errcode='PT409'; end if;
    perform set_config('rx.public_rx',l.prescription_id::text,true);
    select * into r from rx_private.public_dispensing_receipts where prescription_id=p_prescription_id;
    if found then
      if (r.request_id,r.lookup_id) is distinct from (p_request_id,p_lookup_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      select * into d from public.dispensations where id=r.dispensation_id;
      return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',true);
    end if;
    if l.expires_at<=clock_timestamp() then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=p_prescription_id for update;
    if not found then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    select * into r from rx_private.public_dispensing_receipts where prescription_id=p_prescription_id;
    if found then
      if (r.request_id,r.lookup_id) is distinct from (p_request_id,p_lookup_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      select * into d from public.dispensations where id=r.dispensation_id;
      return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',true);
    end if;
    checked:=clock_timestamp();
    if p.status<>'issued' or p.updated_at<>l.expected_version or p.expires_at is null or p.expires_at<=checked or exists(select 1 from public.dispensations where prescription_id=p.id) then
      raise exception 'Prescription no longer eligible' using errcode='PT409'; end if;
    insert into public.dispensations(prescription_id,dispensed_at,access_method,pharmacy_label) values(p.id,checked,'public_code',label) returning * into d;
    insert into rx_private.public_dispensing_receipts(request_id,lookup_id,prescription_id,dispensation_id,identity_confirmed,full_confirmed) values(p_request_id,p_lookup_id,p.id,d.id,true,true);
    return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',false);
  exception when sqlstate 'PT409' or unique_violation or check_violation then return rx_private.public_failure('PT409');
    when invalid_parameter_value then return rx_private.public_failure('22023');
  end;
end;
$$;

create function public.public_recover_dispensing(p_request_id uuid,p_lookup_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare l rx_private.public_lookups; r rx_private.public_dispensing_receipts; d public.dispensations;
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  if not rx_private.consume_public_limit('public_dispense_global','all',600,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  if p_lookup_id is null or p_request_id is null then return rx_private.public_failure('PT404'); end if;
  if not rx_private.consume_public_limit('public_dispense_lookup',p_lookup_id::text,20,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  select * into l from rx_private.public_lookups where id=p_lookup_id;
  if not found then return rx_private.public_failure('PT404'); end if;
  perform set_config('rx.public_rx',l.prescription_id::text,true);
  select * into r from rx_private.public_dispensing_receipts where request_id=p_request_id and lookup_id=p_lookup_id;
  if not found then return rx_private.public_failure('PT404'); end if;
  select * into d from public.dispensations where id=r.dispensation_id;
  return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',true);
end;
$$;
revoke all on function public.public_lookup_prescription(text,text,text),public.public_dispense_prescription(uuid,uuid,uuid,boolean,boolean,text),public.public_recover_dispensing(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.public_lookup_prescription(text,text,text),public.public_dispense_prescription(uuid,uuid,uuid,boolean,boolean,text),public.public_recover_dispensing(uuid,uuid) to anon,authenticated;
grant create on schema public to rx_public_executor;
alter function public.public_lookup_prescription(text,text,text) owner to rx_public_executor;
alter function public.public_dispense_prescription(uuid,uuid,uuid,boolean,boolean,text) owner to rx_public_executor;
alter function public.public_recover_dispensing(uuid,uuid) owner to rx_public_executor;
revoke create on schema public from rx_public_executor;
revoke rx_public_executor from current_user;

-- ---------------------------------------------------------------------------
-- 4. Username/password sign-in throttle (Supabase Auth owns credentials; no username directory exists).
-- ---------------------------------------------------------------------------
create function public.consume_login_attempt(p_username text,p_client text default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_username is null or p_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
   return rx_private.consume_public_limit('login_global','all',3000,interval '15 minutes') and false;
 end if;
 return rx_private.consume_public_limit('login_global','all',3000,interval '15 minutes')
  and rx_private.consume_public_limit('login_user',encode(extensions.digest(p_username,'sha256'),'hex'),12,interval '15 minutes')
  and (p_client is null or p_client !~ '^[0-9a-f]{64}$' or rx_private.consume_public_limit('login_client',p_client,40,interval '15 minutes'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Access-surface changes.
-- National ID alone must not disclose prescriptions: close the authenticated ID-only search.
-- Public self-activation/OTP admission is removed from the normal workflow.
-- ---------------------------------------------------------------------------
revoke execute on function public.search_pharmacy_identity(text,text,text,integer) from authenticated;
revoke execute on function public.request_prescriber_access(text,text,text,text) from anon,authenticated;
revoke all on function rx_private.normalize_il_id(text),rx_private.consume_public_limit(text,text,integer,interval),rx_private.public_digest(text),rx_private.public_resolve(text,text),rx_private.public_failure(text),rx_private.public_scope() from public,anon,authenticated,service_role;
revoke all on function public.consume_login_attempt(text,text) from public,anon,authenticated,service_role;
grant execute on function public.consume_login_attempt(text,text) to anon,authenticated;
commit;
