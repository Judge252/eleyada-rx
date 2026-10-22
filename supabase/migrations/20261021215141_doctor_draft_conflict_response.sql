-- Phase 4A corrective migration: REVIEW REQUIRED; not approved for hosted application.
-- Application conflicts must return HTTP 409, not SQL serialization_failure.
-- Avoid PostgREST 14 retry loops; preserve signatures, invoker execution, RLS,
-- fixed search paths, validation, atomicity, locking and existing explicit grants.
begin;
create or replace function public.save_doctor_draft(
  p_request_id uuid, p_patient jsonb, p_items jsonb, p_doctor_notes text,
  p_prescription_id uuid default null, p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  target_id uuid;
  target_patient uuid;
  target_updated timestamptz;
  existing_notes text;
  existing_items jsonb;
  same_patient boolean;
  item jsonb;
  field text;
  limit_length integer;
  ordinal integer;
begin
  if current_user <> 'authenticated' or not rx_private.is_active_doctor()
     or not rx_private.has_active_session() then
    raise exception 'Draft access denied' using errcode='42501';
  end if;
  if p_request_id is null or p_patient is null or jsonb_typeof(p_patient) <> 'object'
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 30
     or p_doctor_notes is null or length(p_doctor_notes) > 4000 then
    raise exception 'Invalid draft input' using errcode='22023';
  end if;
  if p_patient ? 'id' then
    if p_patient - 'id' <> '{}'::jsonb or jsonb_typeof(p_patient->'id') <> 'string'
       or p_patient->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid patient selection' using errcode='22023';
    end if;
  elsif p_patient - array['name','patient_identifier'] <> '{}'::jsonb
     or jsonb_typeof(p_patient->'name') is distinct from 'string'
     or length(btrim(p_patient->>'name')) not between 1 and 200
     or jsonb_typeof(p_patient->'patient_identifier') is distinct from 'string'
     or length(btrim(p_patient->>'patient_identifier')) > 120 then
    raise exception 'Invalid new patient' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' or item - array['medication_name','strength','dose','frequency','duration','quantity','special_instructions'] <> '{}'::jsonb then
      raise exception 'Invalid medication input' using errcode='22023';
    end if;
    foreach field in array array['medication_name','strength','dose','frequency','duration','special_instructions'] loop
      limit_length := case field when 'strength' then 120 when 'duration' then 120 when 'special_instructions' then 2000 else 200 end;
      if jsonb_typeof(item->field) is distinct from 'string'
         or length(item->>field) > limit_length
         or (field <> 'special_instructions' and length(btrim(item->>field)) < 1) then
        raise exception 'Invalid medication field' using errcode='22023';
      end if;
    end loop;
    if jsonb_typeof(item->'quantity') is distinct from 'number'
       or item->>'quantity' !~ '^[1-9][0-9]{0,6}$'
       or (item->>'quantity')::numeric > 1000000 then
      raise exception 'Invalid medication quantity' using errcode='22023';
    end if;
  end loop;

  -- Serialize create retries across real connections before inserting a patient.
  if p_prescription_id is null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text,0));
    select p.id,p.patient_id,p.updated_at,p.doctor_notes
      into target_id,target_patient,target_updated,existing_notes
      from public.prescriptions p where p.draft_request_id=p_request_id
        and p.doctor_user_id=auth.uid() and p.status='draft' for update;
    if target_id is null and exists(select 1 from public.prescriptions where draft_request_id=p_request_id) then
      raise exception 'Draft retry conflict' using errcode='PT409';
    end if;
  else
    if p_expected_updated_at is null then raise exception 'Missing draft version' using errcode='22023'; end if;
    select p.id,p.patient_id,p.updated_at,p.doctor_notes
      into target_id,target_patient,target_updated,existing_notes
      from public.prescriptions p where p.id=p_prescription_id
        and p.doctor_user_id=auth.uid() and p.status='draft' for update;
    if target_id is null then raise exception 'Writable draft unavailable' using errcode='42501'; end if;
  end if;

  if target_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'medication_name',i.medication_name,'strength',i.strength,'dose',i.dose,
      'frequency',i.frequency,'duration',i.duration,'quantity',i.quantity,
      'special_instructions',coalesce(i.special_instructions,'')) order by i.sort_order,i.id),'[]'::jsonb)
      into existing_items from public.prescription_items i where i.prescription_id=target_id;
    select case when p_patient ? 'id' then target_patient=(p_patient->>'id')::uuid
      else pt.name=btrim(p_patient->>'name') and coalesce(pt.patient_identifier,'')=btrim(p_patient->>'patient_identifier') end
      into same_patient from public.patients pt where pt.id=target_patient;
    if same_patient and coalesce(existing_notes,'')=p_doctor_notes and existing_items=p_items then
      return jsonb_build_object('id',target_id,'updated_at',target_updated,'replayed',true);
    end if;
    if p_prescription_id is null or target_updated <> p_expected_updated_at then
      raise exception 'Draft changed; reload before saving' using errcode='PT409';
    end if;
  end if;

  -- Select existing patient without mutating shared/historical identity fields.
  if p_patient ? 'id' then
    select id into target_patient from public.patients where id=(p_patient->>'id')::uuid for update;
    if target_patient is null then raise exception 'Patient unavailable' using errcode='42501'; end if;
  else
    insert into public.patients(name,patient_identifier)
      values(btrim(p_patient->>'name'),nullif(btrim(p_patient->>'patient_identifier'),'')) returning id into target_patient;
  end if;
  if target_id is null then
    insert into public.prescriptions(patient_id,doctor_user_id,doctor_notes,draft_request_id)
      values(target_patient,auth.uid(),nullif(p_doctor_notes,''),p_request_id) returning id,updated_at into target_id,target_updated;
  else
    update public.prescriptions set patient_id=target_patient,doctor_notes=nullif(p_doctor_notes,'')
      where id=target_id returning updated_at into target_updated;
    delete from public.prescription_items where prescription_id=target_id;
  end if;
  ordinal := 0;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.prescription_items(prescription_id,medication_name,strength,dose,frequency,duration,quantity,special_instructions,sort_order)
      values(target_id,item->>'medication_name',item->>'strength',item->>'dose',item->>'frequency',item->>'duration',
        (item->>'quantity')::integer,nullif(item->>'special_instructions',''),ordinal);
    ordinal := ordinal+1;
  end loop;
  return jsonb_build_object('id',target_id,'updated_at',target_updated,'replayed',false);
end;
$$;

create or replace function public.delete_doctor_draft(p_id uuid,p_expected_updated_at timestamptz) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare version timestamptz;
begin
  if current_user <> 'authenticated' or not rx_private.is_active_doctor()
    or not rx_private.has_active_session() then raise exception 'Draft access denied' using errcode='42501'; end if;
  if p_id is null or p_expected_updated_at is null then raise exception 'Invalid draft deletion' using errcode='22023'; end if;
  select updated_at into version from public.prescriptions
    where id=p_id and doctor_user_id=auth.uid() and status='draft' for update;
  if version is null then raise exception 'Writable draft unavailable' using errcode='42501'; end if;
  if version <> p_expected_updated_at then raise exception 'Draft changed; reload before deleting' using errcode='PT409'; end if;
  delete from public.prescriptions where id=p_id;
  -- Keep the patient record; deletion is scoped to this draft and cascading items.
  return true;
end;
$$;
revoke all on function public.save_doctor_draft(uuid,jsonb,jsonb,text,uuid,timestamptz),
  public.delete_doctor_draft(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_doctor_draft(uuid,jsonb,jsonb,text,uuid,timestamptz),
  public.delete_doctor_draft(uuid,timestamptz) to authenticated;
commit;
