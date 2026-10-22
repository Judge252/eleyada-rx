-- Phase 2 only. No accounts, reference-code generator, issuance RPC or dispensing RPC.
-- Apply to the dedicated clinic project as the trusted migration/database owner.
begin;

create schema rx_private;
revoke all on schema rx_private from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

create type public.app_role as enum ('doctor', 'pharmacist');
create type public.prescription_status as enum ('draft', 'issued', 'cancelled', 'expired');

create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  contact_info text check (contact_info is null or length(btrim(contact_info)) between 1 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.app_users (
  id uuid primary key references auth.users(id) on delete restrict,
  role public.app_role not null,
  pharmacy_id uuid references public.pharmacies(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint app_users_role_pharmacy check (
    (role = 'doctor' and pharmacy_id is null) or
    (role = 'pharmacist' and pharmacy_id is not null)
  ),
  constraint app_users_identity_pharmacy unique (id, pharmacy_id)
);
-- This single-clinic pilot has exactly one possible doctor identity, even if inactive.
create unique index app_users_single_doctor on public.app_users(role) where role = 'doctor';
create index app_users_pharmacy_idx on public.app_users(pharmacy_id);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  -- Opaque, optional, deliberately not a national-ID-specific format or unique key.
  patient_identifier text check (patient_identifier is null or length(btrim(patient_identifier)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_user_id uuid not null references public.app_users(id) on delete restrict,
  status public.prescription_status not null default 'draft',
  issued_at timestamptz,
  expires_at timestamptz,
  doctor_notes text check (doctor_notes is null or length(doctor_notes) <= 4000),
  -- Later: hex HMAC-SHA-256 lookup digest, generated server-side with a secret key.
  -- No plaintext patient-facing code or predictable substitute is stored.
  reference_digest text unique check (reference_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prescriptions_lifecycle_fields check (
    (status = 'draft' and issued_at is null and reference_digest is null and expires_at is null) or
    (status <> 'draft' and issued_at is not null and reference_digest is not null)
  ),
  constraint prescriptions_expiration_order check (expires_at is null or expires_at > issued_at),
  constraint prescriptions_timestamp_order check (updated_at >= created_at)
);
create index prescriptions_patient_idx on public.prescriptions(patient_id);
create index prescriptions_doctor_created_idx on public.prescriptions(doctor_user_id, created_at desc);
create index prescriptions_issued_expiry_idx on public.prescriptions(expires_at) where status = 'issued';

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  medication_name text not null check (length(btrim(medication_name)) between 1 and 200),
  strength text not null check (length(btrim(strength)) between 1 and 120),
  dose text not null check (length(btrim(dose)) between 1 and 200),
  frequency text not null check (length(btrim(frequency)) between 1 and 200),
  duration text not null check (length(btrim(duration)) between 1 and 120),
  quantity integer not null check (quantity > 0),
  special_instructions text check (special_instructions is null or length(special_instructions) <= 2000)
);
create index prescription_items_prescription_idx on public.prescription_items(prescription_id);

create table public.dispensations (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete restrict,
  pharmacy_id uuid not null references public.pharmacies(id) on delete restrict,
  pharmacist_user_id uuid not null,
  dispensed_at timestamptz not null default now(),
  -- Authoritative all-or-nothing completion record, including across concurrent requests.
  constraint dispensations_one_per_prescription unique (prescription_id),
  constraint dispensations_pharmacist_membership foreign key (pharmacist_user_id, pharmacy_id)
    references public.app_users(id, pharmacy_id) on delete restrict
);
create index dispensations_pharmacy_idx on public.dispensations(pharmacy_id, dispensed_at desc);
create index dispensations_pharmacist_idx on public.dispensations(pharmacist_user_id, pharmacy_id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on delete restrict,
  event_type text not null check (length(event_type) between 1 and 100),
  entity_type text not null check (entity_type in (
    'pharmacies', 'app_users', 'patients', 'prescriptions', 'prescription_items', 'dispensations'
  )),
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  -- Deliberately tiny allowlist: never names, identifiers, medications, notes or codes.
  constraint audit_events_safe_metadata check (
    jsonb_typeof(metadata) = 'object' and
    metadata - array['old_status', 'new_status']::text[] = '{}'::jsonb and
    (not (metadata ? 'old_status') or (
      jsonb_typeof(metadata->'old_status') = 'string' and
      metadata->>'old_status' in ('draft', 'issued', 'cancelled', 'expired')
    )) and
    (not (metadata ? 'new_status') or (
      jsonb_typeof(metadata->'new_status') = 'string' and
      metadata->>'new_status' in ('draft', 'issued', 'cancelled', 'expired')
    ))
  )
);
create index audit_events_actor_idx on public.audit_events(actor_user_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id, occurred_at desc);

-- The only callable authorization helper returns a boolean for the *current* identity.
-- Definer is necessary to read the private role assignment without recursive RLS.
-- No JWT user_metadata/app_metadata role claims are trusted.
create function rx_private.is_active_doctor() returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_users u
    where u.id = (select auth.uid()) and u.role = 'doctor' and u.is_active
  );
$$;

create function rx_private.guard_app_user_identity() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.id, new.role, new.pharmacy_id, new.created_at)
     is distinct from (old.id, old.role, old.pharmacy_id, old.created_at) then
    raise exception 'Application role and membership are immutable; use reviewed provisioning migrations'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_app_user_identity before update on public.app_users
for each row execute function rx_private.guard_app_user_identity();

create function rx_private.guard_patient_identity() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.id, new.created_at) is distinct from (old.id, old.created_at) then
    raise exception 'Patient identity keys and creation timestamp are immutable' using errcode = '23514';
  end if;
  if (new.name, new.patient_identifier) is distinct from (old.name, old.patient_identifier)
     and exists (select 1 from public.prescriptions p where p.patient_id = old.id and p.issued_at is not null) then
    raise exception 'Patient verification fields linked to issued prescriptions are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_patient_identity before update on public.patients
for each row execute function rx_private.guard_patient_identity();

create function rx_private.guard_prescription() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not rx_private.is_active_doctor() then
    raise exception 'Not authorized for the clinic prescription workflow' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Issued prescription history cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (new.id, new.doctor_user_id, new.created_at) is distinct from (old.id, old.doctor_user_id, old.created_at) then
      raise exception 'Prescription identity and doctor are immutable' using errcode = '23514';
    end if;
    if old.status <> 'draft' then
      if (to_jsonb(new) - array['status', 'updated_at']) is distinct from
         (to_jsonb(old) - array['status', 'updated_at']) then
        raise exception 'Issued prescription contents are immutable; cancel and replace'
          using errcode = '23514';
      end if;
      if new.status <> old.status and not (old.status = 'issued' and new.status in ('cancelled', 'expired')) then
        raise exception 'Invalid prescription lifecycle transition' using errcode = '23514';
      end if;
      if new.status <> old.status and exists (
        select 1 from public.dispensations d where d.prescription_id = old.id
      ) then
        raise exception 'Dispensed prescription history cannot change lifecycle' using errcode = '23514';
      end if;
    end if;
    new.updated_at := greatest(old.updated_at, clock_timestamp());
  end if;

  if not exists (select 1 from public.app_users u
                 where u.id = new.doctor_user_id and u.role = 'doctor' and u.is_active) then
    raise exception 'Prescription doctor must be the active assigned doctor' using errcode = '23514';
  end if;
  -- Same patient row lock as a patient update, so future issuance cannot race identity edits.
  -- No issuance operation/RPC is introduced here; non-draft fixtures require trusted SQL.
  perform p.id from public.patients p where p.id = new.patient_id for update;
  if new.status <> 'draft' and not exists (
    select 1 from public.prescription_items i where i.prescription_id = new.id
  ) then
    raise exception 'A non-draft prescription must contain at least one medication' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_prescription before insert or update or delete on public.prescriptions
for each row execute function rx_private.guard_prescription();

create function rx_private.guard_prescription_item() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  parent_id uuid;
  parent_status public.prescription_status;
begin
  if current_user = 'authenticated' and not rx_private.is_active_doctor() then
    raise exception 'Not authorized for the clinic prescription workflow' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.prescription_id) is distinct from (old.id, old.prescription_id) then
    raise exception 'Medication identity and prescription link are immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then parent_id := old.prescription_id;
  else parent_id := new.prescription_id;
  end if;
  -- Serialize edits with any future lifecycle operation on the same prescription.
  select p.status into parent_status from public.prescriptions p where p.id = parent_id for update;
  if not found then
    -- A permitted draft parent delete cascades after its row has been removed.
    if tg_op = 'DELETE' then return old; end if;
    if current_user = 'authenticated' then
      raise exception 'No writable draft prescription is available' using errcode = '42501';
    end if;
    raise exception 'Prescription parent does not exist' using errcode = '23503';
  end if;
  if parent_status <> 'draft' then
    raise exception 'Medication contents of issued prescriptions are immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_prescription_item before insert or update or delete on public.prescription_items
for each row execute function rx_private.guard_prescription_item();

create function rx_private.guard_dispensation() returns trigger
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
  if not exists (select 1 from public.app_users u join public.pharmacies ph on ph.id = u.pharmacy_id
    where u.id = new.pharmacist_user_id and u.pharmacy_id = new.pharmacy_id
      and u.role = 'pharmacist' and u.is_active and ph.is_active) then
    raise exception 'Dispensation requires an active pharmacist in the matching active pharmacy'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_dispensation before insert or update or delete on public.dispensations
for each row execute function rx_private.guard_dispensation();

-- Append only, allowlisted audit summaries written by internal triggers, never by a client RPC.
create function rx_private.write_audit_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  row_id uuid;
  actor_id uuid;
  event_metadata jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then row_id := old.id; else row_id := new.id; end if;
  if auth.uid() is not null then
    select u.id into actor_id from public.app_users u where u.id = (select auth.uid());
  end if;
  if tg_table_name = 'prescriptions' then
    if tg_op <> 'INSERT' then event_metadata := jsonb_build_object('old_status', to_jsonb(old)->>'status'); end if;
    if tg_op <> 'DELETE' then event_metadata := event_metadata || jsonb_build_object('new_status', to_jsonb(new)->>'status'); end if;
  end if;
  insert into public.audit_events(actor_user_id, event_type, entity_type, entity_id, metadata)
  values (actor_id, tg_table_name || '.' || lower(tg_op), tg_table_name, row_id, event_metadata);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function rx_private.guard_audit_history() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'Audit history is append-only' using errcode = '23514';
end;
$$;
create trigger guard_audit_history before update or delete on public.audit_events
for each row execute function rx_private.guard_audit_history();

create trigger audit_pharmacies after insert or update or delete on public.pharmacies
for each row execute function rx_private.write_audit_event();
create trigger audit_app_users after insert or update or delete on public.app_users
for each row execute function rx_private.write_audit_event();
create trigger audit_patients after insert or update or delete on public.patients
for each row execute function rx_private.write_audit_event();
create trigger audit_prescriptions after insert or update or delete on public.prescriptions
for each row execute function rx_private.write_audit_event();
create trigger audit_prescription_items after insert or update or delete on public.prescription_items
for each row execute function rx_private.write_audit_event();
create trigger audit_dispensations after insert or update or delete on public.dispensations
for each row execute function rx_private.write_audit_event();

alter table public.pharmacies enable row level security;
alter table public.app_users enable row level security;
alter table public.patients enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;
alter table public.dispensations enable row level security;
alter table public.audit_events enable row level security;

-- Remove Supabase legacy automatic grants explicitly; new-project defaults vary.
revoke all on public.pharmacies, public.app_users, public.patients, public.prescriptions,
  public.prescription_items, public.dispensations, public.audit_events
  from public, anon, authenticated, service_role;
revoke all on all functions in schema rx_private from public, anon, authenticated, service_role;
grant usage on schema public, rx_private to authenticated;
grant execute on function rx_private.is_active_doctor() to authenticated;

grant select on public.app_users, public.pharmacies, public.patients, public.prescription_items, public.dispensations to authenticated;
-- Even the doctor's user-scoped Data API client cannot read reference digests.
grant select (id, patient_id, doctor_user_id, status, issued_at, expires_at, doctor_notes, created_at, updated_at)
  on public.prescriptions to authenticated;
grant insert (name, patient_identifier), update (name, patient_identifier) on public.patients to authenticated;
grant insert (patient_id, doctor_user_id, doctor_notes), update (patient_id, doctor_notes), delete
  on public.prescriptions to authenticated;
grant insert (prescription_id, medication_name, strength, dose, frequency, duration, quantity, special_instructions),
  update (medication_name, strength, dose, frequency, duration, quantity, special_instructions), delete
  on public.prescription_items to authenticated;

create policy app_users_read_self on public.app_users for select to authenticated
  using (id = (select auth.uid()) and is_active);
create policy doctor_read_pharmacies on public.pharmacies for select to authenticated
  using ((select rx_private.is_active_doctor()));
create policy doctor_read_patients on public.patients for select to authenticated
  using ((select rx_private.is_active_doctor()));
create policy doctor_insert_patients on public.patients for insert to authenticated
  with check ((select rx_private.is_active_doctor()));
create policy doctor_update_patients on public.patients for update to authenticated
  using ((select rx_private.is_active_doctor()))
  with check ((select rx_private.is_active_doctor()));
create policy doctor_read_prescriptions on public.prescriptions for select to authenticated
  using ((select rx_private.is_active_doctor()) and doctor_user_id = (select auth.uid()));
create policy doctor_insert_drafts on public.prescriptions for insert to authenticated
  with check ((select rx_private.is_active_doctor()) and doctor_user_id = (select auth.uid()) and status = 'draft');
create policy doctor_update_drafts on public.prescriptions for update to authenticated
  using ((select rx_private.is_active_doctor()) and doctor_user_id = (select auth.uid()) and status = 'draft')
  with check ((select rx_private.is_active_doctor()) and doctor_user_id = (select auth.uid()) and status = 'draft');
create policy doctor_delete_drafts on public.prescriptions for delete to authenticated
  using ((select rx_private.is_active_doctor()) and doctor_user_id = (select auth.uid()) and status = 'draft');
create policy doctor_read_items on public.prescription_items for select to authenticated
  using ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid())
  ));
create policy doctor_insert_draft_items on public.prescription_items for insert to authenticated
  with check ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid()) and p.status = 'draft'
  ));
create policy doctor_update_draft_items on public.prescription_items for update to authenticated
  using ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid()) and p.status = 'draft'
  ))
  with check ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid()) and p.status = 'draft'
  ));
create policy doctor_delete_draft_items on public.prescription_items for delete to authenticated
  using ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid()) and p.status = 'draft'
  ));
create policy doctor_read_dispensations on public.dispensations for select to authenticated
  using ((select rx_private.is_active_doctor()) and exists (
    select 1 from public.prescriptions p where p.id = prescription_id and p.doctor_user_id = (select auth.uid())
  ));
-- No pharmacy clinical-read policies, audit client policies, provisioning policies,
-- lifecycle-write grants, or dispensation-write grants. Those workflows remain closed.

comment on column public.prescriptions.reference_digest is
  'Later-phase server-generated HMAC-SHA-256 hex lookup digest only; never a plaintext code.';
comment on table public.dispensations is
  'Only completion source: presence of one row means fully dispensed. No duplicate status field.';
comment on table public.app_users is
  'Trusted database-owner provisioning only; never assigned from signup/user metadata.';
comment on schema rx_private is
  'Internal authorization/invariant/audit helpers. Never expose this schema through the Data API.';
commit;
