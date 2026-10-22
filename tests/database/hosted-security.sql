-- Phase 3A hosted verification only. Run as the migration owner on the exact
-- Eleyada RX project. Never run bootstrap.sql on a hosted Supabase database.
-- All fixtures live in an exception subtransaction that is always rolled back.
-- No Auth service calls, passwords, sessions, email addresses or usable accounts.
do $verification$
declare
  doctor uuid := gen_random_uuid();
  pharmacist uuid := gen_random_uuid();
  inactive uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  pharmacy uuid := gen_random_uuid();
  patient uuid := gen_random_uuid();
  prescription uuid := gen_random_uuid();
  actor uuid;
  table_name text;
  test_case record;
  observed_state text;
  affected bigint;
  visible bigint;
  passed integer := 0;
begin
  if current_database() <> 'postgres' then
    raise exception 'Unexpected target database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                 where version = '20261019141747' and name = 'database_foundation') then
    raise exception 'Required foundation migration is missing';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and rolbypassrls) then
    raise exception 'Test roles must enforce RLS';
  end if;

  begin
    -- Only transaction-local SQL identity fixtures, with no login credentials.
    insert into auth.users(id) values (doctor), (pharmacist), (inactive), (outsider);
    insert into public.pharmacies(id,name) values (pharmacy,'SYNTHETIC Phase 3A pharmacy');
    insert into public.app_users(id,role,pharmacy_id,is_active) values
      (doctor,'doctor',null,true), (pharmacist,'pharmacist',pharmacy,true),
      (inactive,'pharmacist',pharmacy,false);
    insert into public.patients(id,name) values (patient,'SYNTHETIC Phase 3A subject');
    insert into public.prescriptions(id,patient_id,doctor_user_id)
      values (prescription,patient,doctor);
    insert into public.prescription_items(prescription_id,medication_name,strength,dose,frequency,duration,quantity)
      values (prescription,'SYNTHETIC - not for treatment','test','test','test','test',1);
    update public.prescriptions set status='issued', issued_at=now()-interval '1 hour',
      expires_at=now()+interval '1 day',
      reference_digest=replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','')
      where id=prescription;

    -- Anonymous SQL role has no table access, even when fixtures exist.
    execute 'set local role anon';
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{"role":"anon"}',true);
    foreach table_name in array array['pharmacies','app_users','patients','prescriptions',
                                    'prescription_items','dispensations','audit_events'] loop
      observed_state := null;
      begin
        execute format('select count(*) from public.%I',table_name) into visible;
      exception when others then get stacked diagnostics observed_state = returned_sqlstate;
      end;
      if observed_state is distinct from '42501' then
        raise exception 'Anonymous access was not denied for %: %',table_name,observed_state;
      end if;
      passed := passed + 1;
    end loop;
    observed_state := null;
    begin
      insert into public.patients(name) values ('SYNTHETIC anonymous denied write');
    exception when others then get stacked diagnostics observed_state = returned_sqlstate;
    end;
    if observed_state is distinct from '42501' then raise exception 'Anonymous insert allowed'; end if;
    passed := passed + 1;
    execute 'reset role';

    -- Three distinct authenticated contexts cannot read clinical rows or create patients.
    foreach actor in array array[pharmacist,inactive,outsider] loop
      perform set_config('request.jwt.claim.sub',actor::text,true);
      -- Editable metadata deliberately claims doctor; database assignments must win.
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated',
        'user_metadata',jsonb_build_object('role','doctor'))::text,true);
      execute 'set local role authenticated';
      if current_user <> 'authenticated' or rx_private.is_active_doctor() then
        raise exception 'Non-doctor context escaped authorization';
      end if;
      foreach table_name in array array['pharmacies','patients','prescriptions','prescription_items','dispensations'] loop
        execute format('select count(id) from public.%I',table_name) into visible;
        if visible <> 0 then raise exception 'Unauthorized clinical read: %',table_name; end if;
        passed := passed + 1;
      end loop;
      select count(*) into visible from public.app_users;
      if visible <> (case when actor=pharmacist then 1 else 0 end) then
        raise exception 'Own active identity policy failed';
      end if;
      passed := passed + 1;
      observed_state := null;
      begin
        insert into public.patients(name) values ('SYNTHETIC denied write');
      exception when others then get stacked diagnostics observed_state = returned_sqlstate;
      end;
      if observed_state is distinct from '42501' then raise exception 'Unauthorized patient insert allowed'; end if;
      passed := passed + 1;
      execute 'reset role';
    end loop;

    perform set_config('request.jwt.claim.sub',doctor::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',doctor,'role','authenticated')::text,true);
    execute 'set local role authenticated';
    if current_user <> 'authenticated' or not rx_private.is_active_doctor() then
      raise exception 'Doctor context missing';
    end if;
    select count(*) into visible from public.patients;
    if visible <> 1 then raise exception 'Doctor cannot read synthetic subject'; end if;
    insert into public.patients(name) values ('SYNTHETIC doctor draft subject');
    passed := passed + 1;

    -- These statements are executed as authenticated, not as owner/service_role.
    for test_case in select * from (values
      ('role provisioning',format('insert into public.app_users(id,role) values (%L,''doctor'')',outsider),'42501'),
      ('role escalation','update public.app_users set role=''doctor''','42501'),
      ('pharmacy reassignment',format('update public.app_users set pharmacy_id=%L',pharmacy),'42501'),
      ('digest read','select reference_digest from public.prescriptions','42501'),
      ('direct issuance',format('update public.prescriptions set status=''issued'' where id=%L',prescription),'42501'),
      ('audit forgery',format('insert into public.audit_events(event_type,entity_type,entity_id) values (''spoof'',''patients'',%L)',patient),'42501'),
      ('audit read','select * from public.audit_events','42501'),
      ('direct dispensing',format('insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id) values (%L,%L,%L)',prescription,pharmacy,pharmacist),'42501')
    ) as cases(label,sql,expected) loop
      observed_state := null;
      begin execute test_case.sql;
      exception when others then get stacked diagnostics observed_state = returned_sqlstate;
      end;
      if observed_state is distinct from test_case.expected then
        raise exception '%: expected %, got %',test_case.label,test_case.expected,observed_state;
      end if;
      passed := passed + 1;
    end loop;
    update public.prescriptions set doctor_notes='SYNTHETIC forbidden edit' where id=prescription;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Doctor edited an issued header'; end if;
    update public.prescription_items set quantity=2 where prescription_id=prescription;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Doctor edited an issued item'; end if;
    passed := passed + 2;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);

    -- Owner context tests invariants independently of the RLS assertions above.
    for test_case in select * from (values
      ('issued header immutability',format('update public.prescriptions set doctor_notes=''changed'' where id=%L',prescription),'23514'),
      ('issued item immutability',format('update public.prescription_items set quantity=2 where prescription_id=%L',prescription),'23514'),
      ('issued delete',format('delete from public.prescriptions where id=%L',prescription),'23514'),
      ('issued patient identity',format('update public.patients set name=''changed'' where id=%L',patient),'23514'),
      ('second doctor',format('insert into public.app_users(id,role) values (%L,''doctor'')',outsider),'23505'),
      ('membership invariant',format('update public.app_users set role=''doctor'',pharmacy_id=null where id=%L',pharmacist),'23514'),
      ('pharmacist needs pharmacy',format('insert into public.app_users(id,role) values (%L,''pharmacist'')',outsider),'23514'),
      ('auth foreign key',format('insert into public.app_users(id,role,pharmacy_id) values (%L,''pharmacist'',%L)',gen_random_uuid(),pharmacy),'23503'),
      ('patient foreign key',format('insert into public.prescriptions(patient_id,doctor_user_id) values (%L,%L)',gen_random_uuid(),doctor),'23503')
    ) as cases(label,sql,expected) loop
      observed_state := null;
      begin execute test_case.sql;
      exception when others then get stacked diagnostics observed_state = returned_sqlstate;
      end;
      if observed_state is distinct from test_case.expected then
        raise exception '%: expected %, got %',test_case.label,test_case.expected,observed_state;
      end if;
      passed := passed + 1;
    end loop;
    insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id)
      values (prescription,pharmacy,pharmacist);
    observed_state := null;
    begin
      insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id)
        values (prescription,pharmacy,pharmacist);
    exception when others then get stacked diagnostics observed_state = returned_sqlstate;
    end;
    if observed_state is distinct from '23505' then raise exception 'Duplicate dispensing not rejected'; end if;
    passed := passed + 1;
    for test_case in select * from (values
      ('audit deletion','delete from public.audit_events','23514'),
      ('dispensation deletion','delete from public.dispensations','23514'),
      ('dispensed cancellation',format('update public.prescriptions set status=''cancelled'' where id=%L',prescription),'23514')
    ) as cases(label,sql,expected) loop
      observed_state := null;
      begin execute test_case.sql;
      exception when others then get stacked diagnostics observed_state = returned_sqlstate;
      end;
      if observed_state is distinct from test_case.expected then
        raise exception '%: expected %, got %',test_case.label,test_case.expected,observed_state;
      end if;
      passed := passed + 1;
    end loop;

    -- A caught sentinel rolls back this entire fixture block, including audit rows.
    raise exception using errcode='ZX001', message='ROLLBACK_ONLY_FIXTURES_COMPLETE';
  exception when sqlstate 'ZX001' then null;
  end;

  if exists (select 1 from auth.users where id in (doctor,pharmacist,inactive,outsider))
     or exists (select 1 from public.patients where id=patient)
     or exists (select 1 from public.pharmacies where id=pharmacy)
     or exists (select 1 from public.audit_events where entity_id in (doctor,pharmacy,patient,prescription)) then
    raise exception 'Synthetic fixtures were not rolled back';
  end if;
  if passed <> 53 then raise exception 'Unexpected assertion count: %',passed; end if;
  raise notice 'PASS: % hosted assertions; all fixtures rolled back',passed;
end;
$verification$;
