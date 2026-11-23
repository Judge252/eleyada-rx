-- Allergy test: the doctor records, per prescription, whether the patient has had an allergy test.
-- true = performed, false = not performed, null = not recorded (prescriptions issued before this field existed).
-- It is part of the issued prescription: immutable after issuance like every other prescription column
-- (guard_prescription compares the whole row), printed on the sheet and shown to the pharmacy.
begin;

alter table public.prescriptions add column allergy_test_done boolean;
grant insert(allergy_test_done) on public.prescriptions to rx_form_executor;

-- Issuance: optional boolean "allergy_test" in the form payload (absent => not recorded, so older clients keep working).
grant rx_form_executor to current_user with inherit false,set true;
grant create on schema public to rx_form_executor;
set local role rx_form_executor;
create or replace function public.issue_form_prescription(p_request_id uuid,p_payload jsonb,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare actor uuid:=rx_private.lifecycle_actor_id(); clinic uuid; identity jsonb; patient uuid; prescription uuid; version timestamptz; item jsonb; field text; n integer:=0; fingerprint text; receipt rx_private.form_receipts; result jsonb; review jsonb; allergy boolean;
begin
 clinic:=rx_private.assert_clinic_access(false);
 if p_request_id is null or p_confirmed is distinct from true or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['name','identifier','notes','items','allergy_test']<>'{}'::jsonb or jsonb_typeof(p_payload->'identifier') is distinct from 'string' then raise exception 'Invalid form' using errcode='22023'; end if;
 if p_payload ? 'allergy_test' and jsonb_typeof(p_payload->'allergy_test') is distinct from 'boolean' then raise exception 'Invalid form' using errcode='22023'; end if;
 allergy:=(p_payload->>'allergy_test')::boolean;
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
 insert into public.prescriptions(patient_id,doctor_user_id,doctor_notes,allergy_test_done) values(patient,actor,nullif(p_payload->>'notes',''),allergy) returning id,updated_at into prescription,version;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
   insert into public.prescription_items(prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order) values(prescription,item->>'medication_name',item->>'strength',item->>'dose',item->>'frequency',item->>'duration',(item->>'quantity')::integer,nullif(item->>'special_instructions',''),n);
   n:=n+1;
 end loop;
 review:=rx_private.review_payload(prescription);
 result:=public.issue_doctor_prescription(prescription,version,encode(extensions.digest(review::text,'sha256'),'hex'),p_request_id)-'reference';
 result:=result||jsonb_build_object('doctor_id',actor,'clinic_id',clinic,'doctor_name',(select display_name from public.prescribers where user_id=actor),'clinic_name',(select name from public.clinics where id=clinic),'allergy_test_done',allergy);
 insert into rx_private.form_receipts values(actor,p_request_id,fingerprint,prescription,clinic,result);
 return result;
exception when unique_violation then raise exception 'Request conflict' using errcode='PT409';
end;
$$;
reset role;
revoke create on schema public from rx_form_executor;
revoke rx_form_executor from current_user;

-- Printable sheet / pharmacy lookup (the lookup merges this object): adds allergy_test_done.
create or replace function rx_private.public_sheet(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('doctor_name',coalesce(d.display_name,f.result->>'doctor_name'),'clinic_name',coalesce(c.name,f.result->>'clinic_name'),
    'doctor_name_he',d.display_name_he,'doctor_name_en',d.display_name_en,'clinic_name_he',c.name_he,'clinic_name_en',c.name_en,
    'allergy_test_done',p.allergy_test_done)
  from public.prescriptions p
  left join public.prescribers d on d.user_id=p.doctor_user_id
  left join rx_private.patient_clinics pc on pc.patient_id=p.patient_id
  left join public.clinics c on c.id=pc.clinic_id
  left join rx_private.form_receipts f on f.prescription_id=p.id
  where p.id=p_id;
$$;
commit;
