-- Phase 5A. Additive; no key provisioning, account changes or historical writes.
begin;
create role rx_pharmacy_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant rx_pharmacy_executor to current_user with inherit false,set true;
grant usage on schema public,rx_private to rx_pharmacy_executor;
grant execute on function rx_private.lifecycle_actor_id() to rx_pharmacy_executor;

-- Only current verified identity; native Auth access stays with the trusted owner.
create function rx_private.pharmacy_context(p_lock boolean default false)
returns table(actor_id uuid,pharmacy_id uuid,session_id uuid)
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); pharmacy uuid; session uuid;
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  -- A client transaction/preference override must never return lookup data while
  -- rolling back its rate budget (including gateways allowing tx=rollback).
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  if auth.jwt()->>'role' is distinct from 'authenticated' or actor is null then
    raise exception 'Pharmacist session required' using errcode='42501';
  end if;
  if p_lock then
    select u.pharmacy_id into pharmacy from public.app_users u join public.pharmacies ph on ph.id=u.pharmacy_id
      where u.id=actor and u.role='pharmacist' and u.is_active and ph.is_active for share of u,ph;
  else
    select u.pharmacy_id into pharmacy from public.app_users u join public.pharmacies ph on ph.id=u.pharmacy_id
      where u.id=actor and u.role='pharmacist' and u.is_active and ph.is_active;
  end if;
  select s.id into session from auth.sessions s where s.user_id=actor and s.id::text=auth.jwt()->>'session_id'
    and (s.not_after is null or s.not_after>clock_timestamp());
  if pharmacy is null or session is null then raise exception 'Pharmacist session required' using errcode='42501'; end if;
  return query select actor,pharmacy,session;
end;
$$;
revoke all on function rx_private.pharmacy_context(boolean) from public,anon,authenticated,service_role;
grant execute on function rx_private.pharmacy_context(boolean) to rx_pharmacy_executor;

create table rx_private.pharmacy_rate_limits (
  scope text not null check(scope in ('lookup_actor_minute','lookup_actor_hour','lookup_pharmacy_minute','lookup_pharmacy_hour',
    'dispense_actor_minute','dispense_actor_hour','dispense_pharmacy_minute','dispense_pharmacy_hour')),
  subject_id uuid not null,
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 1001),
  primary key(scope,subject_id)
);
create table rx_private.pharmacy_lookups (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_users(id),
  pharmacy_id uuid not null references public.pharmacies(id),
  session_id uuid not null,
  prescription_id uuid not null references public.prescriptions(id),
  expected_version timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
  check(expires_at>created_at)
);
create index pharmacy_lookups_actor_rx on rx_private.pharmacy_lookups(actor_id,pharmacy_id,prescription_id,expires_at);
create index pharmacy_lookups_rx on rx_private.pharmacy_lookups(prescription_id);
create index pharmacy_lookups_pharmacy on rx_private.pharmacy_lookups(pharmacy_id);
create table rx_private.dispensing_receipts (
  request_id uuid primary key,
  lookup_id uuid not null unique references rx_private.pharmacy_lookups(id),
  prescription_id uuid not null unique references public.prescriptions(id),
  dispensation_id uuid not null unique references public.dispensations(id),
  actor_id uuid not null references public.app_users(id),
  pharmacy_id uuid not null references public.pharmacies(id),
  identity_confirmed boolean not null check(identity_confirmed),
  full_confirmed boolean not null check(full_confirmed)
);
create index dispensing_receipts_actor on rx_private.dispensing_receipts(actor_id,pharmacy_id);
create index dispensing_receipts_pharmacy on rx_private.dispensing_receipts(pharmacy_id);
alter table rx_private.pharmacy_rate_limits enable row level security;
alter table rx_private.pharmacy_lookups enable row level security;
alter table rx_private.dispensing_receipts enable row level security;
revoke all on rx_private.pharmacy_rate_limits,rx_private.pharmacy_lookups,rx_private.dispensing_receipts from public,anon,authenticated,service_role;
grant select,insert,update on rx_private.pharmacy_rate_limits to rx_pharmacy_executor;
grant select,insert on rx_private.pharmacy_lookups,rx_private.dispensing_receipts to rx_pharmacy_executor;
create policy pharmacy_limit_scope on rx_private.pharmacy_rate_limits to rx_pharmacy_executor
  using ((scope like '%_actor_%' and subject_id=(select rx_private.lifecycle_actor_id())) or
    (scope like '%_pharmacy_%' and subject_id=(select c.pharmacy_id from rx_private.pharmacy_context() c)))
  with check ((scope like '%_actor_%' and subject_id=(select rx_private.lifecycle_actor_id())) or
    (scope like '%_pharmacy_%' and subject_id=(select c.pharmacy_id from rx_private.pharmacy_context() c)));
create policy pharmacy_lookup_scope on rx_private.pharmacy_lookups to rx_pharmacy_executor
  using(actor_id=(select rx_private.lifecycle_actor_id()) and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c))
  with check(actor_id=(select rx_private.lifecycle_actor_id()) and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c)
    and session_id=(select c.session_id from rx_private.pharmacy_context() c));
create policy pharmacy_receipt_scope on rx_private.dispensing_receipts to rx_pharmacy_executor
  using(actor_id=(select rx_private.lifecycle_actor_id()) and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c))
  with check(actor_id=(select rx_private.lifecycle_actor_id()) and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c));
create trigger immutable_pharmacy_lookup before update or delete on rx_private.pharmacy_lookups
  for each row execute function rx_private.guard_audit_history();
create trigger immutable_dispensing_receipt before update or delete on rx_private.dispensing_receipts
  for each row execute function rx_private.guard_audit_history();

create function rx_private.pharmacy_can_read(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from rx_private.pharmacy_lookups l cross join rx_private.pharmacy_context() c
    where l.prescription_id=p_id and l.actor_id=c.actor_id and l.pharmacy_id=c.pharmacy_id
      and l.session_id=c.session_id and l.expires_at>clock_timestamp());
$$;
revoke all on function rx_private.pharmacy_can_read(uuid) from public,anon,authenticated,service_role;
grant execute on function rx_private.pharmacy_can_read(uuid) to rx_pharmacy_executor;
grant select(id,patient_id,status,updated_at,issued_at,expires_at) on public.prescriptions to rx_pharmacy_executor;
grant select(id,name,patient_identifier) on public.patients to rx_pharmacy_executor;
grant select on public.prescription_items,public.dispensations to rx_pharmacy_executor;
-- UPDATE is solely needed for parent FOR UPDATE. No function changes prescription content/status.
grant update(status) on public.prescriptions to rx_pharmacy_executor;
grant select(id,role,pharmacy_id,is_active) on public.app_users to rx_pharmacy_executor;
grant select(id,name,is_active) on public.pharmacies to rx_pharmacy_executor;
grant insert(prescription_id,pharmacy_id,pharmacist_user_id,dispensed_at) on public.dispensations to rx_pharmacy_executor;
create policy pharmacy_rx_read on public.prescriptions for select to rx_pharmacy_executor using(rx_private.pharmacy_can_read(id));
create policy pharmacy_rx_lock on public.prescriptions for update to rx_pharmacy_executor
  using(rx_private.pharmacy_can_read(id)) with check(rx_private.pharmacy_can_read(id));
create policy pharmacy_items_read on public.prescription_items for select to rx_pharmacy_executor using(rx_private.pharmacy_can_read(prescription_id));
create policy pharmacy_patient_read on public.patients for select to rx_pharmacy_executor
  using(exists(select 1 from public.prescriptions p where p.patient_id=patients.id and rx_private.pharmacy_can_read(p.id)));
create policy pharmacy_actor_read on public.app_users for select to rx_pharmacy_executor using(id=(select rx_private.lifecycle_actor_id()));
create policy pharmacy_identity_read on public.pharmacies for select to rx_pharmacy_executor
  using(id=(select c.pharmacy_id from rx_private.pharmacy_context() c));
create policy pharmacy_completion_read on public.dispensations for select to rx_pharmacy_executor
  using(rx_private.pharmacy_can_read(prescription_id) or (pharmacist_user_id=(select rx_private.lifecycle_actor_id())
    and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c)));
create policy pharmacy_completion_insert on public.dispensations for insert to rx_pharmacy_executor
  with check(rx_private.pharmacy_can_read(prescription_id) and pharmacist_user_id=(select rx_private.lifecycle_actor_id())
    and pharmacy_id=(select c.pharmacy_id from rx_private.pharmacy_context() c));

create function rx_private.consume_pharmacy_limit(p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c record; subject uuid; scope_name text; period interval; maximum integer; used integer; allowed boolean:=true; n integer;
begin
  if p_operation not in ('lookup','dispense') then raise exception 'Invalid limiter' using errcode='22023'; end if;
  select * into c from rx_private.pharmacy_context();
  for n in 1..4 loop
    subject:=case when n<=2 then c.actor_id else c.pharmacy_id end;
    scope_name:=p_operation||case when n<=2 then '_actor_' else '_pharmacy_' end||case when n in (1,3) then 'minute' else 'hour' end;
    period:=case when n in (1,3) then interval '1 minute' else interval '1 hour' end;
    maximum:=case when p_operation='lookup' then case n when 1 then 10 when 2 then 100 when 3 then 30 else 300 end
      else case n when 1 then 20 when 2 then 200 when 3 then 60 else 600 end end;
    insert into rx_private.pharmacy_rate_limits as t(scope,subject_id,window_start,attempts)
      values(scope_name,subject,clock_timestamp(),1)
      on conflict(scope,subject_id) do update set
        attempts=case when t.window_start+period<=clock_timestamp() then 1 else least(t.attempts+1,1001) end,
        window_start=case when t.window_start+period<=clock_timestamp() then clock_timestamp() else t.window_start end
      returning attempts into used;
    if used>maximum then allowed:=false; end if;
  end loop;
  return allowed;
end;
$$;
-- Error responses commit rate counters. No SQL failure escapes these handled paths.
-- PostgREST response.status yields normal PT409/HTTP409 without retryable40001.
create function rx_private.pharmacy_failure(p_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform set_config('response.status',case p_code when 'PT404' then '404' when 'PT409' then '409' when 'PT429' then '429' when 'PT503' then '503' else '400' end,true);
  return jsonb_build_object('code',p_code,'message','Pharmacy request unavailable','details',null,'hint',null);
end;
$$;
create function rx_private.resolve_pharmacy_reference(p_reference text) returns table(id uuid,version timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform rx_private.pharmacy_context();
  perform rx_private.normalize_reference(p_reference);
  return query select p.id,p.updated_at from public.prescriptions p where p.reference_digest=rx_private.reference_digest(p_reference) and p.status<>'draft';
end;
$$;
revoke all on function rx_private.consume_pharmacy_limit(text),rx_private.pharmacy_failure(text),rx_private.resolve_pharmacy_reference(text) from public,anon,authenticated,service_role;
grant execute on function rx_private.consume_pharmacy_limit(text),rx_private.pharmacy_failure(text),rx_private.resolve_pharmacy_reference(text) to rx_pharmacy_executor;

create function public.lookup_pharmacy_prescription(p_reference text) returns jsonb
language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare c record; resolved record; p record; token uuid; completion timestamptz; checked timestamptz; items jsonb; patient jsonb;
begin
  select * into c from rx_private.pharmacy_context();
  if not rx_private.consume_pharmacy_limit('lookup') then return rx_private.pharmacy_failure('PT429'); end if;
  begin
    select * into resolved from rx_private.resolve_pharmacy_reference(p_reference);
    if not found then return rx_private.pharmacy_failure('PT404'); end if;
  exception when invalid_parameter_value then return rx_private.pharmacy_failure('PT404');
    when sqlstate 'PT503' then return rx_private.pharmacy_failure('PT503');
  end;
  insert into rx_private.pharmacy_lookups(actor_id,pharmacy_id,session_id,prescription_id,expected_version)
    values(c.actor_id,c.pharmacy_id,c.session_id,resolved.id,resolved.version) returning id into token;
  select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=resolved.id for update;
  perform rx_private.pharmacy_context(true);
  checked:=clock_timestamp();
  select dispensed_at into completion from public.dispensations where prescription_id=p.id;
  if completion is not null then return jsonb_build_object('state','dispensed','dispensed_at',completion,'database_time',checked); end if;
  if p.status='cancelled' then return jsonb_build_object('state','cancelled','database_time',checked); end if;
  if p.status<>'issued' or p.expires_at is null or p.expires_at<=checked then return jsonb_build_object('state','expired','database_time',checked); end if;
  select jsonb_build_object('name',name,'patient_identifier',patient_identifier) into patient from public.patients where id=p.patient_id;
  select jsonb_agg(jsonb_build_object('medication_name',medication_name,'strength',strength,'dose',dose,'frequency',frequency,'duration',duration,
    'quantity',quantity,'special_instructions',special_instructions) order by sort_order,id) into items from public.prescription_items where prescription_id=p.id;
  return jsonb_build_object('state','eligible','prescription_id',p.id,'lookup_id',token,'confirmation_expires_at',(select expires_at from rx_private.pharmacy_lookups where id=token),
    'issued_at',p.issued_at,'expires_at',p.expires_at,'database_time',checked,'patient',patient,'items',items);
end;
$$;

create function public.dispense_pharmacy_prescription(p_lookup_id uuid,p_prescription_id uuid,p_request_id uuid,p_identity_confirmed boolean,p_full_confirmed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare c record; l rx_private.pharmacy_lookups; r rx_private.dispensing_receipts; p record; d public.dispensations; checked timestamptz;
begin
  select * into c from rx_private.pharmacy_context();
  if not rx_private.consume_pharmacy_limit('dispense') then return rx_private.pharmacy_failure('PT429'); end if;
  begin
    if p_lookup_id is null or p_prescription_id is null or p_request_id is null or p_identity_confirmed is distinct from true or p_full_confirmed is distinct from true then
      raise exception 'Invalid confirmation' using errcode='22023';
    end if;
    select * into l from rx_private.pharmacy_lookups where id=p_lookup_id and actor_id=c.actor_id and pharmacy_id=c.pharmacy_id;
    if not found or l.prescription_id<>p_prescription_id then raise exception 'Confirmation changed' using errcode='PT409'; end if;
    select * into r from rx_private.dispensing_receipts where prescription_id=p_prescription_id;
    if found then
      if (r.request_id,r.lookup_id,r.actor_id,r.pharmacy_id) is distinct from (p_request_id,p_lookup_id,c.actor_id,c.pharmacy_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      select * into d from public.dispensations where id=r.dispensation_id;
      perform rx_private.pharmacy_context(true);
      return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',true);
    end if;
    if l.session_id<>c.session_id or l.expires_at<=clock_timestamp() then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    -- Same parent lock as doctor cancellation and the existing dispensation guard.
    select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=p_prescription_id for update;
    if not found then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    perform rx_private.pharmacy_context(true);
    -- A competing commit can have completed while this call waited for the parent.
    select * into r from rx_private.dispensing_receipts where prescription_id=p_prescription_id;
    if found then
      if (r.request_id,r.lookup_id,r.actor_id,r.pharmacy_id) is distinct from (p_request_id,p_lookup_id,c.actor_id,c.pharmacy_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      select * into d from public.dispensations where id=r.dispensation_id;
      return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',true);
    end if;
    checked:=clock_timestamp();
    if l.expires_at<=checked or p.status<>'issued' or p.updated_at<>l.expected_version or p.expires_at is null or p.expires_at<=checked
      or exists(select 1 from public.dispensations where prescription_id=p.id) then raise exception 'Prescription no longer eligible' using errcode='PT409'; end if;
    insert into public.dispensations(prescription_id,pharmacy_id,pharmacist_user_id,dispensed_at)
      values(p.id,c.pharmacy_id,c.actor_id,checked) returning * into d;
    insert into rx_private.dispensing_receipts(request_id,lookup_id,prescription_id,dispensation_id,actor_id,pharmacy_id,identity_confirmed,full_confirmed)
      values(p_request_id,p_lookup_id,p.id,d.id,c.actor_id,c.pharmacy_id,p_identity_confirmed,p_full_confirmed);
    return jsonb_build_object('state','dispensed','id',d.id,'prescription_id',d.prescription_id,'dispensed_at',d.dispensed_at,'replayed',false);
  exception when sqlstate 'PT409' or unique_violation or check_violation then return rx_private.pharmacy_failure('PT409');
    when invalid_parameter_value then return rx_private.pharmacy_failure('22023');
  end;
end;
$$;
revoke all on function public.lookup_pharmacy_prescription(text),public.dispense_pharmacy_prescription(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.lookup_pharmacy_prescription(text),public.dispense_pharmacy_prescription(uuid,uuid,uuid,boolean,boolean) to authenticated;
grant create on schema public to rx_pharmacy_executor;
alter function public.lookup_pharmacy_prescription(text) owner to rx_pharmacy_executor;
alter function public.dispense_pharmacy_prescription(uuid,uuid,uuid,boolean,boolean) owner to rx_pharmacy_executor;
revoke create on schema public from rx_pharmacy_executor;
revoke rx_pharmacy_executor from current_user;
commit;
