-- Phase 4B. Requires the project's existing pgcrypto + Supabase Vault installation.
-- No key provisioning, account changes, historical rewrites or pharmacy API.
begin;
do $$ begin
  if to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
    or to_regclass('vault.decrypted_secrets') is null
    or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Phase 4B requires reviewed Vault and pgcrypto prerequisites';
  end if;
end $$;

create role rx_lifecycle_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- PostgreSQL 17 CREATEROLE creators do not automatically have SET ROLE. The trusted
-- migration owner temporarily needs it to transfer function ownership, then loses it.
grant rx_lifecycle_executor to current_user with inherit false, set true;
-- Non-secret hashing for the invoker review RPC; no access to Vault or HMAC keys.
grant usage on schema extensions to authenticated;
grant execute on function extensions.digest(text,text) to authenticated;
grant usage on schema public,rx_private,auth,extensions to rx_lifecycle_executor;
grant execute on function auth.uid(),auth.jwt(),rx_private.is_active_doctor(),rx_private.has_active_session()
  to rx_lifecycle_executor;
grant select on public.patients,public.prescriptions,public.prescription_items,public.dispensations to rx_lifecycle_executor;
grant select (id,role,is_active) on public.app_users to rx_lifecycle_executor;
-- UPDATE(name) is necessary for the existing patient FOR UPDATE guard. This role
-- cannot log in or be assumed by application roles. No RPC changes patient identity.
grant update(name) on public.patients to rx_lifecycle_executor;
grant update(status,issued_at,expires_at,reference_digest) on public.prescriptions to rx_lifecycle_executor;
create policy lifecycle_user_read on public.app_users for select to rx_lifecycle_executor
  using (id=(select auth.uid()) and is_active);
create policy lifecycle_patient_read on public.patients for select to rx_lifecycle_executor
  using ((select rx_private.is_active_doctor()));
create policy lifecycle_patient_lock on public.patients for update to rx_lifecycle_executor
  using ((select rx_private.is_active_doctor())) with check ((select rx_private.is_active_doctor()));
create policy lifecycle_prescription_read on public.prescriptions for select to rx_lifecycle_executor
  using ((select rx_private.is_active_doctor()) and doctor_user_id=(select auth.uid()));
create policy lifecycle_prescription_write on public.prescriptions for update to rx_lifecycle_executor
  using ((select rx_private.is_active_doctor()) and doctor_user_id=(select auth.uid()))
  with check ((select rx_private.is_active_doctor()) and doctor_user_id=(select auth.uid()));
create policy lifecycle_items_read on public.prescription_items for select to rx_lifecycle_executor
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())));
create policy lifecycle_dispensation_read on public.dispensations for select to rx_lifecycle_executor
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())));

create table rx_private.issuance_receipts (
  prescription_id uuid primary key references public.prescriptions(id) on delete restrict,
  request_id uuid not null unique,
  draft_version timestamptz not null,
  review_fingerprint text not null check(review_fingerprint ~ '^[0-9a-f]{64}$'),
  key_version integer not null check(key_version=1),
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp()
);
create table rx_private.cancellation_receipts (
  prescription_id uuid primary key references public.prescriptions(id) on delete restrict,
  request_id uuid not null unique,
  issued_version timestamptz not null,
  actor_user_id uuid not null references public.app_users(id),
  reason text not null check(reason in ('entered_in_error','duplicate_prescription','treatment_changed','other_administrative_reason')),
  cancelled_at timestamptz not null default clock_timestamp()
);
revoke all on rx_private.issuance_receipts,rx_private.cancellation_receipts from public,anon,authenticated,service_role;
grant select,insert on rx_private.issuance_receipts,rx_private.cancellation_receipts to rx_lifecycle_executor;
alter table rx_private.issuance_receipts enable row level security;
alter table rx_private.cancellation_receipts enable row level security;
create policy lifecycle_issuance_receipt on rx_private.issuance_receipts to rx_lifecycle_executor
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())))
  with check (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())));
create policy lifecycle_cancellation_receipt on rx_private.cancellation_receipts to rx_lifecycle_executor
  using (exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())))
  with check (actor_user_id=(select auth.uid()) and exists(select 1 from public.prescriptions p where p.id=prescription_id and p.doctor_user_id=(select auth.uid())));
create trigger immutable_issuance before update or delete on rx_private.issuance_receipts
  for each row execute function rx_private.guard_audit_history();
create trigger immutable_cancellation before update or delete on rx_private.cancellation_receipts
  for each row execute function rx_private.guard_audit_history();

create function rx_private.assert_lifecycle_doctor() returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' or auth.uid() is null
    or not rx_private.is_active_doctor() or not rx_private.has_active_session() then
    raise exception 'Doctor session required' using errcode='42501';
  end if;
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"}]',true);
end;
$$;

-- Pure canonical payload: no digests, references, clinical data in audits, or client hashes.
-- One SQL snapshot covers the header, identity and ordered item IDs/content.
create function rx_private.review_payload(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('id',p.id,'patient_id',p.patient_id,'doctor_user_id',p.doctor_user_id,
    'updated_at',p.updated_at,'doctor_notes',p.doctor_notes,'patient',
    jsonb_build_object('id',pt.id,'name',pt.name,'patient_identifier',pt.patient_identifier),
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order,i.id),'[]'::jsonb)
      from public.prescription_items i where i.prescription_id=p.id))
  from public.prescriptions p join public.patients pt on pt.id=p.patient_id
  where p.id=p_id and p.doctor_user_id=auth.uid();
$$;

-- Strict ASCII only. RX1 = format; K1 = HMAC key version; 160 random bits in 32 symbols.
create function rx_private.normalize_reference(p_code text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare normalized text;
begin
  if p_code is null or length(p_code)>80 or p_code !~ '^[A-Za-z0-9 -]+$' then
    raise exception 'Invalid reference format' using errcode='22023';
  end if;
  normalized:=upper(translate(p_code,' -',''));
  if normalized !~ '^RX1K1[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{32}$' then
    raise exception 'Invalid reference format' using errcode='22023';
  end if;
  return normalized;
end;
$$;
create function rx_private.new_reference() returns text
language plpgsql volatile security invoker set search_path='' as $$
declare bytes bytea:=extensions.gen_random_bytes(20); result text:=''; bits integer:=0; accumulator integer:=0; n integer;
begin
  for n in 0..19 loop
    accumulator:=(accumulator << 8) | get_byte(bytes,n); bits:=bits+8;
    while bits>=5 loop
      bits:=bits-5;
      result:=result || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',((accumulator >> bits) & 31)+1,1);
    end loop;
    accumulator:=accumulator & ((1 << bits)-1);
  end loop;
  return 'RX1-K1-' || substr(result,1,4)||'-'||substr(result,5,4)||'-'||substr(result,9,4)||'-'||substr(result,13,4)||'-'||substr(result,17,4)||'-'||substr(result,21,4)||'-'||substr(result,25,4)||'-'||substr(result,29,4);
end;
$$;

-- Only these purpose-limited helpers cross into Vault; no application role can call them.
create function rx_private.reference_digest(p_code text) returns text
language plpgsql security definer set search_path='' as $$
declare key_hex text;
begin
  select decrypted_secret into key_hex from vault.decrypted_secrets where name='al_eyada_rx.lookup.v1';
  if key_hex is null or key_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Reference key unavailable' using errcode='PT503';
  end if;
  return encode(extensions.hmac(convert_to('al-eyada-rx|reference|v1|' || rx_private.normalize_reference(p_code),'UTF8'),decode(key_hex,'hex'),'sha256'),'hex');
exception when sqlstate 'PT503' then raise;
  when others then raise exception 'Reference key unavailable' using errcode='PT503';
end;
$$;
create function rx_private.store_reference(p_id uuid,p_code text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  perform rx_private.normalize_reference(p_code);
  return vault.create_secret(p_code,'al_eyada_rx.reference.'||p_id::text,'Prescription reference recovery');
exception when others then raise exception 'Encrypted reference storage unavailable' using errcode='PT503';
end;
$$;
create function rx_private.recover_reference(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare code text; digest text;
begin
  select v.decrypted_secret,p.reference_digest into code,digest
    from rx_private.issuance_receipts r join public.prescriptions p on p.id=r.prescription_id
    join vault.decrypted_secrets v on v.id=r.vault_secret_id where r.prescription_id=p_id and r.key_version=1;
  if code is null or rx_private.reference_digest(code) is distinct from digest then
    raise exception 'Reference recovery unavailable' using errcode='PT503';
  end if;
  return code;
exception when others then raise exception 'Reference recovery unavailable' using errcode='PT503';
end;
$$;

create function public.get_doctor_issue_review(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare payload jsonb;
begin
  perform rx_private.assert_lifecycle_doctor();
  if not exists(select 1 from public.prescriptions where id=p_id and doctor_user_id=auth.uid() and status='draft') then
    raise exception 'Saved draft unavailable' using errcode='42501';
  end if;
  payload:=rx_private.review_payload(p_id);
  return jsonb_build_object('payload',payload,'fingerprint',encode(extensions.digest(payload::text,'sha256'),'hex'));
end;
$$;

create function public.issue_doctor_prescription(p_id uuid,p_expected_updated_at timestamptz,p_review_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; r rx_private.issuance_receipts; payload jsonb; code text; digest text;
  artifact uuid; issued timestamptz; collision_constraint text;
begin
  perform rx_private.assert_lifecycle_doctor();
  if p_id is null or p_request_id is null or p_expected_updated_at is null
    or p_review_fingerprint is null or p_review_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid issuance request' using errcode='22023';
  end if;
  select * into p from public.prescriptions where id=p_id and doctor_user_id=auth.uid() for update;
  if not found then raise exception 'Prescription unavailable' using errcode='42501'; end if;
  perform id from public.patients where id=p.patient_id for update;
  perform rx_private.assert_lifecycle_doctor();
  select * into r from rx_private.issuance_receipts where prescription_id=p_id;
  if found then
    if (r.request_id,r.draft_version,r.review_fingerprint) is distinct from (p_request_id,p_expected_updated_at,p_review_fingerprint) then
      raise exception 'Issuance request conflict' using errcode='PT409';
    end if;
    code:=rx_private.recover_reference(p_id);
    return jsonb_build_object('id',p.id,'reference',code,'issued_at',p.issued_at,'expires_at',p.expires_at,'status',p.status,'replayed',true);
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
      return jsonb_build_object('id',p.id,'reference',code,'issued_at',p.issued_at,'expires_at',p.expires_at,'status',p.status,'replayed',false);
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

create function public.get_doctor_lifecycle(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; cancellation jsonb; checked timestamptz;
begin
  perform rx_private.assert_lifecycle_doctor();
  select * into p from public.prescriptions where id=p_id and doctor_user_id=auth.uid();
  if not found then raise exception 'Prescription unavailable' using errcode='42501'; end if;
  select jsonb_build_object('reason',reason,'cancelled_at',cancelled_at) into cancellation
    from rx_private.cancellation_receipts where prescription_id=p_id;
  checked:=clock_timestamp();
  return jsonb_build_object('status',case when p.status='issued' and p.expires_at<=checked then 'expired' else p.status::text end,
    'issued_at',p.issued_at,'expires_at',p.expires_at,'cancellation',cancellation,
    'dispensed',exists(select 1 from public.dispensations where prescription_id=p_id),'database_time',checked);
end;
$$;
create function public.reveal_doctor_reference(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; code text; lifecycle jsonb;
begin
  perform rx_private.assert_lifecycle_doctor();
  select * into p from public.prescriptions where id=p_id and doctor_user_id=auth.uid() for update;
  if not found or p.status='draft' then raise exception 'Issued prescription unavailable' using errcode='42501'; end if;
  perform rx_private.assert_lifecycle_doctor();
  code:=rx_private.recover_reference(p_id);
  lifecycle:=public.get_doctor_lifecycle(p_id);
  insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata)
    values(auth.uid(),'prescriptions.reference_retrieved','prescriptions',p_id,'{}'::jsonb);
  return lifecycle || jsonb_build_object('id',p_id,'reference',code);
end;
$$;
create function public.cancel_doctor_prescription(p_id uuid,p_expected_updated_at timestamptz,p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare p public.prescriptions; r rx_private.cancellation_receipts; cancelled timestamptz;
begin
  perform rx_private.assert_lifecycle_doctor();
  if p_id is null or p_request_id is null or p_expected_updated_at is null or p_reason is null
    or p_reason not in ('entered_in_error','duplicate_prescription','treatment_changed','other_administrative_reason') then
    raise exception 'Invalid cancellation request' using errcode='22023';
  end if;
  select * into p from public.prescriptions where id=p_id and doctor_user_id=auth.uid() for update;
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
    values(p_id,p_request_id,p_expected_updated_at,auth.uid(),p_reason,cancelled) returning * into r;
  update public.prescriptions set status='cancelled' where id=p_id;
  return jsonb_build_object('id',p_id,'cancelled_at',r.cancelled_at,'reason',r.reason,'replayed',false);
exception when unique_violation then raise exception 'Cancellation request conflict' using errcode='PT409';
end;
$$;

grant insert(actor_user_id,event_type,entity_type,entity_id,metadata) on public.audit_events to rx_lifecycle_executor;
create policy lifecycle_reference_audit on public.audit_events for insert to rx_lifecycle_executor
  with check(actor_user_id=(select auth.uid()) and entity_type='prescriptions' and event_type='prescriptions.reference_retrieved'
    and metadata='{}'::jsonb and exists(select 1 from public.prescriptions p where p.id=entity_id and p.doctor_user_id=(select auth.uid())));

-- Keep the actual Vault owner helpers owned by the trusted migration owner.
revoke all on function rx_private.assert_lifecycle_doctor(),rx_private.review_payload(uuid),rx_private.normalize_reference(text),
  rx_private.new_reference(),rx_private.reference_digest(text),rx_private.store_reference(uuid,text),rx_private.recover_reference(uuid)
  from public,anon,authenticated,service_role;
grant execute on function rx_private.assert_lifecycle_doctor(),rx_private.review_payload(uuid) to authenticated,rx_lifecycle_executor;
grant execute on function rx_private.normalize_reference(text),rx_private.new_reference(),rx_private.reference_digest(text),
  rx_private.store_reference(uuid,text),rx_private.recover_reference(uuid) to rx_lifecycle_executor;
revoke all on function public.get_doctor_issue_review(uuid),public.issue_doctor_prescription(uuid,timestamptz,text,uuid),
  public.get_doctor_lifecycle(uuid),public.reveal_doctor_reference(uuid),public.cancel_doctor_prescription(uuid,timestamptz,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_doctor_issue_review(uuid),public.issue_doctor_prescription(uuid,timestamptz,text,uuid),
  public.get_doctor_lifecycle(uuid),public.reveal_doctor_reference(uuid),public.cancel_doctor_prescription(uuid,timestamptz,uuid,text)
  to authenticated,rx_lifecycle_executor;
grant create on schema public to rx_lifecycle_executor;
alter function public.issue_doctor_prescription(uuid,timestamptz,text,uuid) owner to rx_lifecycle_executor;
alter function public.get_doctor_lifecycle(uuid) owner to rx_lifecycle_executor;
alter function public.reveal_doctor_reference(uuid) owner to rx_lifecycle_executor;
alter function public.cancel_doctor_prescription(uuid,timestamptz,uuid,text) owner to rx_lifecycle_executor;
revoke create on schema public from rx_lifecycle_executor;
revoke rx_lifecycle_executor from current_user;
comment on role rx_lifecycle_executor is 'Non-login, non-bypass role only for narrowly authorized Phase 4B RPCs. Never grant membership to application roles.';
commit;
