-- Partial dispensing + cross-pharmacy dispensing history for the open (no-login) pharmacy portal.
-- Capability is unchanged: Israeli ID + patient-held code open exactly one prescription. With that proof a pharmacy
-- now sees what was already dispensed (when, by which pharmacy as entered, how much of each medication) and records
-- what it hands out now. Each fill is append-only, idempotent per request, checked under the prescription row lock,
-- never exceeds the remaining quantity and is rejected when another fill happened after the lookup.
-- When nothing remains, one completion row is written to public.dispensations (existing "dispensed" semantics).
-- Also (re)defines rx_private.public_sheet so lookups return the doctor and clinic names on hosted projects too.
begin;

-- ---------------------------------------------------------------------------
-- 1. Append-only fill history.
-- ---------------------------------------------------------------------------
create table rx_private.fills (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  lookup_id uuid not null references rx_private.public_lookups(id),
  prescription_id uuid not null references public.prescriptions(id),
  filled_at timestamptz not null default clock_timestamp(),
  pharmacy_label text not null check (length(pharmacy_label) between 2 and 120 and pharmacy_label !~ '[[:cntrl:]]'),
  completes boolean not null,
  identity_confirmed boolean not null check (identity_confirmed)
);
create index fills_prescription_idx on rx_private.fills(prescription_id, filled_at);
create table rx_private.fill_items (
  fill_id uuid not null references rx_private.fills(id),
  item_id uuid not null references public.prescription_items(id),
  quantity integer not null check (quantity between 1 and 1000000),
  primary key (fill_id, item_id)
);
create index fill_items_item_idx on rx_private.fill_items(item_id);
alter table rx_private.fills enable row level security;
alter table rx_private.fill_items enable row level security;
revoke all on rx_private.fills, rx_private.fill_items from public, anon, authenticated, service_role;
create trigger immutable_fill before update or delete on rx_private.fills
  for each row execute function rx_private.guard_audit_history();
create trigger immutable_fill_item before update or delete on rx_private.fill_items
  for each row execute function rx_private.guard_audit_history();

-- A fill item must belong to the filled prescription.
create function rx_private.guard_fill_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from rx_private.fills f join public.prescription_items i on i.prescription_id = f.prescription_id
                 where f.id = new.fill_id and i.id = new.item_id) then
    raise exception 'Fill item does not belong to the prescription' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function rx_private.guard_fill_item() from public, anon, authenticated, service_role;
create trigger fill_item_belongs before insert on rx_private.fill_items
  for each row execute function rx_private.guard_fill_item();

-- The lookup remembers how many fills it saw, so a fill based on stale numbers is refused.
alter table rx_private.public_lookups add column fills_seen integer check (fills_seen is null or fills_seen >= 0);

-- ---------------------------------------------------------------------------
-- 2. Read helpers (definer, read-only). Callers have already proven the capability and set rx.public_rx.
-- ---------------------------------------------------------------------------
create or replace function rx_private.public_sheet(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('doctor_name',coalesce(f.result->>'doctor_name',d.display_name),'clinic_name',coalesce(f.result->>'clinic_name',c.name))
  from public.prescriptions p
  left join public.prescribers d on d.user_id=p.doctor_user_id
  left join rx_private.patient_clinics pc on pc.patient_id=p.patient_id
  left join public.clinics c on c.id=pc.clinic_id
  left join rx_private.form_receipts f on f.prescription_id=p.id
  where p.id=p_id;
$$;

-- Items with prescribed/filled/remaining quantities, the dispensing history and the completion flag.
-- A legacy completion (before partial fills existed) counts as everything dispensed.
create function rx_private.public_fill_state(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with legacy as (
    select d.dispensed_at, coalesce(d.pharmacy_label, ph.name) as label
    from public.dispensations d left join public.pharmacies ph on ph.id = d.pharmacy_id
    where d.prescription_id = p_id and not exists (select 1 from rx_private.fills f where f.prescription_id = p_id)
  ), items as (
    select i.id, i.sort_order, i.medication_name, i.strength, i.dose, i.frequency, i.duration, i.quantity, i.special_instructions,
      case when exists (select 1 from legacy) then i.quantity
           else coalesce((select sum(fi.quantity) from rx_private.fill_items fi where fi.item_id = i.id), 0)::integer end as filled
    from public.prescription_items i where i.prescription_id = p_id
  ), history as (
    select f.filled_at as at, f.pharmacy_label as pharmacy, f.completes as complete,
      (select jsonb_agg(jsonb_build_object('medication_name', i.medication_name, 'quantity', fi.quantity) order by i.sort_order, i.id)
       from rx_private.fill_items fi join public.prescription_items i on i.id = fi.item_id where fi.fill_id = f.id) as items
    from rx_private.fills f where f.prescription_id = p_id
    union all
    select l.dispensed_at, l.label, true,
      (select jsonb_agg(jsonb_build_object('medication_name', i.medication_name, 'quantity', i.quantity) order by i.sort_order, i.id)
       from public.prescription_items i where i.prescription_id = p_id)
    from legacy l
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'medication_name', medication_name, 'strength', strength, 'dose', dose, 'frequency', frequency,
        'duration', duration, 'quantity', quantity, 'special_instructions', special_instructions,
        'filled', least(filled, quantity), 'remaining', greatest(quantity - filled, 0)) order by sort_order, id) from items), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'pharmacy', pharmacy, 'complete', complete, 'items', coalesce(items, '[]'::jsonb)) order by at) from history), '[]'::jsonb),
    'fills', (select count(*) from rx_private.fills where prescription_id = p_id),
    'complete', exists (select 1 from public.dispensations where prescription_id = p_id),
    'dispensed_at', (select dispensed_at from public.dispensations where prescription_id = p_id)
  );
$$;

-- Receipt for one fill, only within the proven prescription scope.
create function rx_private.public_fill_receipt(p_fill uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'state', case when f.completes then 'dispensed' else 'partial' end,
    'id', f.id, 'prescription_id', f.prescription_id, 'filled_at', f.filled_at, 'dispensed_at', f.filled_at,
    'pharmacy_label', f.pharmacy_label, 'completes', f.completes,
    'items', (select jsonb_agg(jsonb_build_object('item_id', fi.item_id, 'medication_name', i.medication_name, 'quantity', fi.quantity) order by i.sort_order, i.id)
              from rx_private.fill_items fi join public.prescription_items i on i.id = fi.item_id where fi.fill_id = f.id))
  from rx_private.fills f where f.id = p_fill and f.prescription_id = rx_private.public_scope();
$$;
revoke all on function rx_private.public_sheet(uuid), rx_private.public_fill_state(uuid), rx_private.public_fill_receipt(uuid)
  from public, anon, authenticated, service_role;
grant execute on function rx_private.public_sheet(uuid), rx_private.public_fill_state(uuid), rx_private.public_fill_receipt(uuid)
  to rx_public_executor;

-- ---------------------------------------------------------------------------
-- 3. Narrow executor access, always scoped to the single proven prescription.
-- ---------------------------------------------------------------------------
grant select, insert on rx_private.fills, rx_private.fill_items to rx_public_executor;
create policy public_fill_read on rx_private.fills for select to rx_public_executor
  using (prescription_id = rx_private.public_scope());
create policy public_fill_insert on rx_private.fills for insert to rx_public_executor
  with check (prescription_id = rx_private.public_scope());
create policy public_fill_item_read on rx_private.fill_items for select to rx_public_executor
  using (exists (select 1 from rx_private.fills f where f.id = fill_id and f.prescription_id = rx_private.public_scope()));
create policy public_fill_item_insert on rx_private.fill_items for insert to rx_public_executor
  with check (exists (select 1 from rx_private.fills f where f.id = fill_id and f.prescription_id = rx_private.public_scope()));

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
  -- Lock first so the fill count recorded with the lookup is exact.
  select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=resolved.id for update;
  checked:=clock_timestamp();
  sheet:=rx_private.public_sheet(p.id);
  st:=rx_private.public_fill_state(p.id);
  insert into rx_private.public_lookups(prescription_id,expected_version,fills_seen) values(p.id,p.updated_at,(st->>'fills')::integer) returning id into token;
  select jsonb_build_object('name',name) into patient from public.patients where id=p.patient_id;
  detail:=jsonb_build_object('issued_at',p.issued_at,'expires_at',p.expires_at,'database_time',checked,'patient',patient,
    'items',st->'items','history',st->'history','doctor_name',sheet->>'doctor_name','clinic_name',sheet->>'clinic_name');
  if (st->>'complete')::boolean then return detail||jsonb_build_object('state','dispensed','dispensed_at',st->'dispensed_at'); end if;
  if p.status='cancelled' then return detail||jsonb_build_object('state','cancelled'); end if;
  if p.status<>'issued' or p.expires_at is null or p.expires_at<=checked then return detail||jsonb_build_object('state','expired'); end if;
  return detail||jsonb_build_object('state',case when (st->>'fills')::integer>0 then 'partial' else 'eligible' end,
    'prescription_id',p.id,'lookup_id',token,'confirmation_expires_at',(select expires_at from rx_private.public_lookups where id=token));
end;
$$;

create function public.public_fill_prescription(p_lookup_id uuid,p_prescription_id uuid,p_request_id uuid,p_identity_confirmed boolean,p_items jsonb,p_pharmacy_label text)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare l rx_private.public_lookups; f rx_private.fills; p record; st jsonb; it jsonb; checked timestamptz; fill uuid; rem integer; requested integer:=0; left_total integer;
  label text:=nullif(btrim(coalesce(p_pharmacy_label,'')),'');
begin
  perform set_config('response.headers','[{"Cache-Control":"private, no-store, max-age=0"},{"Pragma":"no-cache"}]',true);
  if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then
    raise exception 'Request preferences are not supported' using errcode='42501';
  end if;
  if not rx_private.consume_public_limit('public_dispense_global','all',600,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  if p_lookup_id is not null and not rx_private.consume_public_limit('public_dispense_lookup',p_lookup_id::text,20,interval '1 hour') then return rx_private.public_failure('PT429'); end if;
  begin
    if p_lookup_id is null or p_prescription_id is null or p_request_id is null or p_identity_confirmed is distinct from true
      or label is null or length(label)<2 or length(label)>120 or label ~ '[[:cntrl:]]'
      or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then
      raise exception 'Invalid fill' using errcode='22023'; end if;
    for it in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(it)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(it) k)<>array['item_id','quantity']
        or jsonb_typeof(it->'item_id')<>'string' or (it->>'item_id')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(it->'quantity')<>'number' or (it->>'quantity')!~'^[0-9]{1,7}$' or (it->>'quantity')::integer<1 then
        raise exception 'Invalid fill item' using errcode='22023'; end if;
    end loop;
    if (select count(distinct value->>'item_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then
      raise exception 'Duplicate fill item' using errcode='22023'; end if;
    select * into l from rx_private.public_lookups where id=p_lookup_id;
    if not found or l.prescription_id<>p_prescription_id then raise exception 'Confirmation changed' using errcode='PT409'; end if;
    perform set_config('rx.public_rx',l.prescription_id::text,true);
    select * into f from rx_private.fills where request_id=p_request_id;
    if found then
      if (f.lookup_id,f.prescription_id) is distinct from (p_lookup_id,p_prescription_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      return rx_private.public_fill_receipt(f.id)||jsonb_build_object('replayed',true);
    end if;
    if l.expires_at<=clock_timestamp() then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    select id,status,updated_at,expires_at into p from public.prescriptions where id=p_prescription_id for update;
    if not found then raise exception 'Confirmation expired' using errcode='PT409'; end if;
    select * into f from rx_private.fills where request_id=p_request_id;
    if found then
      if (f.lookup_id,f.prescription_id) is distinct from (p_lookup_id,p_prescription_id) then raise exception 'Request conflict' using errcode='PT409'; end if;
      return rx_private.public_fill_receipt(f.id)||jsonb_build_object('replayed',true);
    end if;
    checked:=clock_timestamp();
    st:=rx_private.public_fill_state(p.id);
    if p.status<>'issued' or p.updated_at<>l.expected_version or p.expires_at is null or p.expires_at<=checked
      or (st->>'complete')::boolean or l.fills_seen is null or (st->>'fills')::integer<>l.fills_seen then
      raise exception 'Prescription changed since lookup' using errcode='PT409'; end if;
    for it in select value from jsonb_array_elements(p_items) loop
      select (x->>'remaining')::integer into rem from jsonb_array_elements(st->'items') x where x->>'id'=it->>'item_id';
      if rem is null or (it->>'quantity')::integer>rem then raise exception 'Quantity exceeds remaining' using errcode='22023'; end if;
      requested:=requested+(it->>'quantity')::integer;
    end loop;
    select coalesce(sum((x->>'remaining')::integer),0)-requested into left_total from jsonb_array_elements(st->'items') x;
    insert into rx_private.fills(request_id,lookup_id,prescription_id,filled_at,pharmacy_label,completes,identity_confirmed)
      values(p_request_id,p_lookup_id,p.id,checked,label,left_total=0,true) returning id into fill;
    insert into rx_private.fill_items(fill_id,item_id,quantity)
      select fill,(value->>'item_id')::uuid,(value->>'quantity')::integer from jsonb_array_elements(p_items);
    if left_total=0 then
      insert into public.dispensations(prescription_id,dispensed_at,access_method,pharmacy_label) values(p.id,checked,'public_code',label);
    end if;
    return rx_private.public_fill_receipt(fill)||jsonb_build_object('replayed',false);
  exception when sqlstate 'PT409' or unique_violation or check_violation or foreign_key_violation then return rx_private.public_failure('PT409');
    when invalid_parameter_value then return rx_private.public_failure('22023');
  end;
end;
$$;

create function public.public_recover_fill(p_request_id uuid,p_lookup_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare l rx_private.public_lookups; f rx_private.fills;
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
  select * into f from rx_private.fills where request_id=p_request_id and lookup_id=p_lookup_id;
  if not found then return rx_private.public_failure('PT404'); end if;
  return rx_private.public_fill_receipt(f.id)||jsonb_build_object('replayed',true);
end;
$$;
reset role;
revoke create on schema public from rx_public_executor;
revoke rx_public_executor from current_user;

revoke all on function public.public_fill_prescription(uuid,uuid,uuid,boolean,jsonb,text), public.public_recover_fill(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.public_fill_prescription(uuid,uuid,uuid,boolean,jsonb,text), public.public_recover_fill(uuid,uuid)
  to anon, authenticated;
-- Hardening: the keyed short-code digest is an internal helper (used only by definer functions owned by the
-- migration role); it must not inherit the default PUBLIC execute privilege.
revoke all on function rx_private.short_digest(uuid,text) from public, anon, authenticated, service_role;
-- The all-or-nothing public endpoint ignored partial history; it is closed in favour of public_fill_prescription.
revoke execute on function public.public_dispense_prescription(uuid,uuid,uuid,boolean,boolean,text), public.public_recover_dispensing(uuid,uuid)
  from anon, authenticated;
commit;
