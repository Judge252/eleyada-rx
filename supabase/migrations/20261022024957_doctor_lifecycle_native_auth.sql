-- Phase 4B additive correction. Preserve the frozen original issuance migration.
-- Hosted postgres cannot delegate USAGE on the platform-owned auth schema.
-- Keep the executor out of auth and broker only the current signed actor/assertion.
begin;

create function rx_private.lifecycle_actor_id() returns uuid
language sql stable security definer set search_path='' as $$
  select auth.uid();
$$;
revoke all on function rx_private.lifecycle_actor_id() from public,anon,authenticated,service_role;
grant execute on function rx_private.lifecycle_actor_id() to authenticated,rx_lifecycle_executor;
-- Existing zero-input assertion: owner already has auth USAGE; no data/role writes.
alter function rx_private.assert_lifecycle_doctor() security definer;

create or replace function rx_private.review_payload(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('id',p.id,'patient_id',p.patient_id,'doctor_user_id',p.doctor_user_id,
    'updated_at',p.updated_at,'doctor_notes',p.doctor_notes,'patient',
    jsonb_build_object('id',pt.id,'name',pt.name,'patient_identifier',pt.patient_identifier),
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order,i.id),'[]'::jsonb)
      from public.prescription_items i where i.prescription_id=p.id))
  from public.prescriptions p join public.patients pt on pt.id=p.patient_id
  where p.id=p_id and p.doctor_user_id=rx_private.lifecycle_actor_id();
$$;

alter policy lifecycle_user_read on public.app_users
  using (id=(select rx_private.lifecycle_actor_id()) and is_active);
alter policy lifecycle_prescription_read on public.prescriptions
  using ((select rx_private.is_active_doctor()) and doctor_user_id=(select rx_private.lifecycle_actor_id()));
alter policy lifecycle_prescription_write on public.prescriptions
  using ((select rx_private.is_active_doctor()) and doctor_user_id=(select rx_private.lifecycle_actor_id()))
  with check ((select rx_private.is_active_doctor()) and doctor_user_id=(select rx_private.lifecycle_actor_id()));
alter policy lifecycle_items_read on public.prescription_items
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())));
alter policy lifecycle_dispensation_read on public.dispensations
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())));
alter policy lifecycle_issuance_receipt on rx_private.issuance_receipts
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())))
  with check (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())));
alter policy lifecycle_cancellation_receipt on rx_private.cancellation_receipts
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())))
  with check (actor_user_id=(select rx_private.lifecycle_actor_id()) and exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())));
alter policy lifecycle_reference_audit on public.audit_events
  with check(actor_user_id=(select rx_private.lifecycle_actor_id()) and entity_type='prescriptions' and event_type='prescriptions.reference_retrieved'
    and metadata='{}'::jsonb and exists(select 1 from public.prescriptions p where p.id=entity_id and p.doctor_user_id=(select rx_private.lifecycle_actor_id())));

-- Preserve the restricted RPC owner; temporarily SET that role to replace its bodies.
select set_config('rx.correction_owner',current_user,true);
grant rx_lifecycle_executor to current_user with inherit false, set true;
grant create on schema public to rx_lifecycle_executor;
set local role rx_lifecycle_executor;

create or replace function public.issue_doctor_prescription(p_id uuid,p_expected_updated_at timestamptz,p_review_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; r rx_private.issuance_receipts; payload jsonb; code text; digest text;
  artifact uuid; issued timestamptz; collision_constraint text;
begin
  perform rx_private.assert_lifecycle_doctor();
  if p_id is null or p_request_id is null or p_expected_updated_at is null
    or p_review_fingerprint is null or p_review_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid issuance request' using errcode='22023';
  end if;
  select * into p from public.prescriptions where id=p_id and doctor_user_id=rx_private.lifecycle_actor_id() for update;
  if not found then raise exception 'Prescription unavailable' using errcode='42501'; end if;
  perform id from public.patients where id=p.patient_id for update;
  perform rx_private.assert_lifecycle_doctor();
  select * into r from rx_private.issuance_receipts where prescription_id=p_id;
  if found then
    if (r.request_id,r.draft_version,r.review_fingerprint) is distinct from (p_request_id,p_expected_updated_at,p_review_fingerprint) then
      raise exception 'Issuance request conflict' using errcode='PT409';
    end if;
    code:=rx_private.recover_reference(p_id);
    return jsonb_build_object('id',p.id,'reference',code,'issued_at',p.issued_at,'expires_at',p.expires_at,'status',case when p.status='issued' and p.expires_at<=clock_timestamp() then 'expired' else p.status::text end,'replayed',true);
  end if;
  if p.status<>'draft' or p.updated_at<>p_expected_updated_at then
    raise exception 'Saved draft changed' using errcode='PT409';
  end if;
  payload:=rx_private.review_payload(p_id);
  if encode(extensions.digest(payload::text,'sha256'),'hex')<>p_review_fingerprint then
    raise exception 'Reviewed contents changed' using errcode='PT409';
  end if;
  if jsonb_array_length(payload->'items') not between 1 and 30 or exists(
    select 1 from public.prescription_items i where i.prescription_id=p_id and (i.quantity>1000000 or i.sort_order not between 0 and 29))
    or (select count(distinct sort_order) from public.prescription_items where prescription_id=p_id)<>jsonb_array_length(payload->'items') then
    raise exception 'Draft is incomplete' using errcode='22023';
  end if;
  -- All writes are in this transaction. Retry ONLY the digest's unique constraint.
  for attempt in 1..3 loop
    begin
      code:=rx_private.new_reference(); digest:=rx_private.reference_digest(code);
      issued:=clock_timestamp();
      update public.prescriptions set status='issued',issued_at=issued,expires_at=issued+interval '168 hours',reference_digest=digest
        where id=p_id returning * into p;
      artifact:=rx_private.store_reference(p_id,code);
      insert into rx_private.issuance_receipts(prescription_id,request_id,draft_version,review_fingerprint,key_version,vault_secret_id,created_at)
        values(p_id,p_request_id,p_expected_updated_at,p_review_fingerprint,1,artifact,issued);
      return jsonb_build_object('id',p.id,'reference',code,'issued_at',p.issued_at,'expires_at',p.expires_at,'status',case when p.status='issued' and p.expires_at<=clock_timestamp() then 'expired' else p.status::text end,'replayed',false);
    exception when unique_violation then
      get stacked diagnostics collision_constraint=constraint_name;
      if collision_constraint<>'prescriptions_reference_digest_key' then
        raise exception 'Issuance request conflict' using errcode='PT409';
      end if;
    end;
  end loop;
  raise exception 'Reference allocation unavailable' using errcode='PT503';
end;
$$;

create or replace function public.get_doctor_lifecycle(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; cancellation jsonb; checked timestamptz;
begin
  perform rx_private.assert_lifecycle_doctor();
  select * into p from public.prescriptions where id=p_id and doctor_user_id=rx_private.lifecycle_actor_id();
  if not found then raise exception 'Prescription unavailable' using errcode='42501'; end if;
  select jsonb_build_object('reason',reason,'cancelled_at',cancelled_at) into cancellation
    from rx_private.cancellation_receipts where prescription_id=p_id;
  checked:=clock_timestamp();
  return jsonb_build_object('status',case when p.status='issued' and p.expires_at<=checked then 'expired' else p.status::text end,
    'issued_at',p.issued_at,'expires_at',p.expires_at,'cancellation',cancellation,
    'dispensed',exists(select 1 from public.dispensations where prescription_id=p_id),'database_time',checked);
end;
$$;

create or replace function public.reveal_doctor_reference(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; code text; lifecycle jsonb;
begin
  perform rx_private.assert_lifecycle_doctor();
  select * into p from public.prescriptions where id=p_id and doctor_user_id=rx_private.lifecycle_actor_id() for update;
  if not found or p.status='draft' then raise exception 'Issued prescription unavailable' using errcode='42501'; end if;
  perform rx_private.assert_lifecycle_doctor();
  code:=rx_private.recover_reference(p_id);
  lifecycle:=public.get_doctor_lifecycle(p_id);
  insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata)
    values(rx_private.lifecycle_actor_id(),'prescriptions.reference_retrieved','prescriptions',p_id,'{}'::jsonb);
  return lifecycle || jsonb_build_object('id',p_id,'reference',code);
end;
$$;

create or replace function public.cancel_doctor_prescription(p_id uuid,p_expected_updated_at timestamptz,p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; r rx_private.cancellation_receipts; cancelled timestamptz;
begin
  perform rx_private.assert_lifecycle_doctor();
  if p_id is null or p_request_id is null or p_expected_updated_at is null or p_reason is null
    or p_reason not in ('entered_in_error','duplicate_prescription','treatment_changed','other_administrative_reason') then
    raise exception 'Invalid cancellation request' using errcode='22023';
  end if;
  select * into p from public.prescriptions where id=p_id and doctor_user_id=rx_private.lifecycle_actor_id() for update;
  if not found then raise exception 'Prescription unavailable' using errcode='42501'; end if;
  perform id from public.patients where id=p.patient_id for update;
  perform rx_private.assert_lifecycle_doctor();
  select * into r from rx_private.cancellation_receipts where prescription_id=p_id;
  if found then
    if (r.request_id,r.issued_version,r.reason) is distinct from (p_request_id,p_expected_updated_at,p_reason) then
      raise exception 'Cancellation request conflict' using errcode='PT409';
    end if;
    return jsonb_build_object('id',p_id,'cancelled_at',r.cancelled_at,'reason',r.reason,'replayed',true);
  end if;
  cancelled:=clock_timestamp();
  if p.status<>'issued' or p.updated_at<>p_expected_updated_at or p.expires_at is null or p.expires_at<=cancelled
    or exists(select 1 from public.dispensations where prescription_id=p_id) then
    raise exception 'Prescription is no longer cancellable' using errcode='PT409';
  end if;
  insert into rx_private.cancellation_receipts(prescription_id,request_id,issued_version,actor_user_id,reason,cancelled_at)
    values(p_id,p_request_id,p_expected_updated_at,rx_private.lifecycle_actor_id(),p_reason,cancelled) returning * into r;
  update public.prescriptions set status='cancelled' where id=p_id;
  return jsonb_build_object('id',p_id,'cancelled_at',r.cancelled_at,'reason',r.reason,'replayed',false);
exception when unique_violation then raise exception 'Cancellation request conflict' using errcode='PT409';
end;
$$;

-- SET ROLE is checked against session authority; restore the exact original owner.
do $$ begin perform set_config('role',current_setting('rx.correction_owner'),true); end $$;
revoke create on schema public from rx_lifecycle_executor;
revoke rx_lifecycle_executor from current_user;
commit;
