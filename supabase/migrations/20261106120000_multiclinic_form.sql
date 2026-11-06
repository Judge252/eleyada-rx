-- Redesign Phase 2. Additive identity and clinic scope; no clinical-row rewrites.
begin;
select set_config('rx.redesign_owner',current_user,true);
drop index public.app_users_single_doctor;
create table public.clinics (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 160), is_active boolean not null default true
);
create table public.prescribers (
  user_id uuid primary key references public.app_users(id), display_name text not null check(length(btrim(display_name)) between 1 and 160), approved boolean not null default false
);
-- MVP: one clinic per individual prescriber; multiple prescribers per clinic.
create table public.clinic_memberships (
  user_id uuid primary key references public.prescribers(user_id), clinic_id uuid not null references public.clinics(id), is_active boolean not null default true
);
create table public.clinic_entitlements (
  clinic_id uuid primary key references public.clinics(id), is_active boolean not null default false, starts_at timestamptz not null default now(), ends_at timestamptz,
  check(ends_at is null or ends_at>starts_at)
);
create table rx_private.patient_clinics (
  patient_id uuid primary key references public.patients(id) deferrable initially deferred, clinic_id uuid not null references public.clinics(id)
);
-- Preserve existing attribution and patient text. Existing clinic is not presumed paid.
with legacy as (insert into public.clinics(name) values('العيادة الحالية') returning id)
insert into public.clinic_entitlements(clinic_id) select id from legacy;
insert into public.prescribers(user_id,display_name,approved) select id,'الطبيب الحالي',true from public.app_users where role='doctor';
insert into public.clinic_memberships(user_id,clinic_id) select p.user_id,e.clinic_id from public.prescribers p cross join public.clinic_entitlements e;
insert into rx_private.patient_clinics select p.id,e.clinic_id from public.patients p cross join public.clinic_entitlements e;
-- Flush the populated backfill's deferred FK events before enabling RLS/DDL.
set constraints rx_private.patient_clinics_patient_id_fkey immediate;
set constraints rx_private.patient_clinics_patient_id_fkey deferred;
alter table public.clinics enable row level security;
alter table public.prescribers enable row level security;
alter table public.clinic_memberships enable row level security;
alter table public.clinic_entitlements enable row level security;
alter table rx_private.patient_clinics enable row level security;
revoke all on public.clinics,public.prescribers,public.clinic_memberships,public.clinic_entitlements,rx_private.patient_clinics from public,anon,authenticated,service_role;

create function rx_private.doctor_clinic() returns uuid
language sql stable security definer set search_path='' as $$
 select m.clinic_id from public.app_users u join public.prescribers d on d.user_id=u.id
 join public.clinic_memberships m on m.user_id=u.id join public.clinics c on c.id=m.clinic_id
 where u.id=auth.uid() and u.role='doctor' and u.is_active and d.approved and m.is_active and c.is_active and rx_private.has_active_session();
$$;
create or replace function rx_private.is_active_doctor() returns boolean
language sql stable security definer set search_path='' as $$ select rx_private.doctor_clinic() is not null; $$;
create function rx_private.patient_in_clinic(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from rx_private.patient_clinics where patient_id=p_id and clinic_id=rx_private.doctor_clinic());
$$;
create function rx_private.assert_clinic_access(p_paid boolean default false) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or not rx_private.has_active_session() then raise exception 'Session required' using errcode='42501'; end if;
 select m.clinic_id into target from public.app_users u join public.prescribers d on d.user_id=u.id
 join public.clinic_memberships m on m.user_id=u.id join public.clinics c on c.id=m.clinic_id
 where u.id=auth.uid() and u.role='doctor' and u.is_active and d.approved and m.is_active and c.is_active for share of u,d,m,c;
 if target is null then raise exception 'Prescriber unavailable' using errcode='42501'; end if;
 if p_paid then
   perform 1 from public.clinic_entitlements where clinic_id=target and is_active and starts_at<=clock_timestamp() and (ends_at is null or ends_at>clock_timestamp()) for share;
   if not found then raise exception 'Entitlement inactive' using errcode='PT402'; end if;
 end if;
 return target;
end;
$$;
create function public.get_prescriber_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 target:=rx_private.doctor_clinic();
 if target is null then return jsonb_build_object('state','unauthorized'); end if;
 return (select jsonb_build_object('state','verified','doctor_id',d.user_id,'doctor_name',d.display_name,'clinic_id',c.id,'clinic_name',c.name,
 'entitled',exists(select 1 from public.clinic_entitlements e where e.clinic_id=c.id and e.is_active and e.starts_at<=clock_timestamp() and (e.ends_at is null or e.ends_at>clock_timestamp())))
 from public.prescribers d join public.clinics c on c.id=target where d.user_id=auth.uid());
end;
$$;
create function rx_private.scope_patient() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if auth.uid() is not null then
   target:=rx_private.assert_clinic_access(false);
   insert into rx_private.patient_clinics values(new.id,target);
 end if;
 return new;
end;
$$;
create trigger scope_patient before insert on public.patients for each row execute function rx_private.scope_patient();
create function rx_private.scope_prescription() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if auth.uid() is not null then
   target:=rx_private.assert_clinic_access(tg_op='UPDATE' and old.status='draft' and new.status='issued');
   if new.doctor_user_id<>auth.uid() or not exists(select 1 from rx_private.patient_clinics where patient_id=new.patient_id and clinic_id=target) then
     raise exception 'Clinic scope denied' using errcode='42501';
   end if;
 end if;
 return new;
end;
$$;
create trigger scope_prescription before insert or update on public.prescriptions for each row execute function rx_private.scope_prescription();
-- Restrictive policies compose with EVERY existing permissive doctor policy/RPC.
create policy clinic_patient_scope on public.patients as restrictive for all to authenticated using(rx_private.patient_in_clinic(id)) with check(rx_private.is_active_doctor());
create policy clinic_prescription_scope on public.prescriptions as restrictive for all to authenticated,rx_lifecycle_executor
 using(rx_private.patient_in_clinic(patient_id) and doctor_user_id=rx_private.lifecycle_actor_id())
 with check(rx_private.patient_in_clinic(patient_id) and doctor_user_id=rx_private.lifecycle_actor_id());
create policy clinic_item_scope on public.prescription_items as restrictive for all to authenticated,rx_lifecycle_executor
 using(exists(select 1 from public.prescriptions p where p.id=prescription_id and rx_private.patient_in_clinic(p.patient_id)))
 with check(exists(select 1 from public.prescriptions p where p.id=prescription_id and rx_private.patient_in_clinic(p.patient_id)));
-- Patient selection/editing is clinic-scoped; issued identity mapping is never mutable.
create trigger immutable_patient_clinic before update or delete on rx_private.patient_clinics for each row execute function rx_private.guard_audit_history();

create table rx_private.patient_identities (
 patient_id uuid primary key references public.patients(id), country text not null, document_type text not null, identifier text not null
);
create index patient_identity_exact on rx_private.patient_identities(country,document_type,identifier);
create trigger immutable_patient_identity before update or delete on rx_private.patient_identities for each row execute function rx_private.guard_audit_history();
create table rx_private.form_receipts (
 actor_id uuid not null references public.app_users(id), request_id uuid not null, fingerprint text not null,
 prescription_id uuid not null unique references public.prescriptions(id), clinic_id uuid not null references public.clinics(id), result jsonb not null,
 primary key(actor_id,request_id), unique(request_id)
);
create trigger immutable_form_receipt before update or delete on rx_private.form_receipts for each row execute function rx_private.guard_audit_history();
alter table rx_private.patient_identities enable row level security;
alter table rx_private.form_receipts enable row level security;
revoke all on rx_private.patient_identities,rx_private.form_receipts from public,anon,authenticated,service_role;

create function rx_private.normalize_identity(p_country text,p_type text,p_id text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare normalized text:=translate(btrim(p_id),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'); country text:=upper(btrim(p_country));
begin
 -- ISO 3166-1 alpha-2 values; no checksum or country-specific ID format.
 if country is null or position(' '||country||' ' in ' AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW ') = 0
 or length(country)<>2 or p_type is null or p_type not in ('national_id','residence','other') or normalized is null or normalized!~'^[A-Za-z0-9]{1,120}$' then
 raise exception 'Invalid identity' using errcode='22023'; end if;
 -- Internal spaces, punctuation and separators are rejected, never silently removed.
 return jsonb_build_object('country',country,'type',p_type,'identifier',normalized);
end;
$$;

create role rx_form_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant rx_form_executor to current_user with inherit false,set true;
grant usage on schema public,rx_private,extensions to rx_form_executor;
grant execute on function rx_private.lifecycle_actor_id(),rx_private.is_active_doctor(),rx_private.doctor_clinic(),rx_private.patient_in_clinic(uuid),rx_private.assert_clinic_access(boolean),rx_private.normalize_identity(text,text,text) to rx_form_executor;
grant select(id,name,patient_identifier) on public.patients to rx_form_executor;
grant insert(name,patient_identifier) on public.patients to rx_form_executor;
grant update(name) on public.patients to rx_form_executor;
grant select(id,patient_id,doctor_user_id,status,updated_at,issued_at,expires_at,doctor_notes) on public.prescriptions to rx_form_executor;
grant update(status) on public.prescriptions to rx_form_executor;
grant select on public.app_users to rx_form_executor;
grant insert(patient_id,doctor_user_id,doctor_notes) on public.prescriptions to rx_form_executor;
grant select,insert on public.prescription_items to rx_form_executor;
grant select,insert on rx_private.form_receipts,rx_private.patient_identities to rx_form_executor;
grant execute on function rx_private.review_payload(uuid) to rx_form_executor;
grant rx_lifecycle_executor to current_user with inherit false,set true;
set local role rx_lifecycle_executor;
grant execute on function public.issue_doctor_prescription(uuid,timestamptz,text,uuid) to rx_form_executor;
do $$ begin perform set_config('role',current_setting('rx.redesign_owner'),true); end $$;
revoke rx_lifecycle_executor from current_user;
grant select on public.prescribers,public.clinics to rx_form_executor;
create policy form_patient on public.patients to rx_form_executor using(rx_private.patient_in_clinic(id)) with check(rx_private.is_active_doctor());
create policy form_prescription on public.prescriptions to rx_form_executor using(doctor_user_id=rx_private.lifecycle_actor_id() and rx_private.patient_in_clinic(patient_id)) with check(doctor_user_id=rx_private.lifecycle_actor_id() and rx_private.patient_in_clinic(patient_id));
create policy form_item on public.prescription_items to rx_form_executor using(exists(select 1 from public.prescriptions p where p.id=prescription_id)) with check(exists(select 1 from public.prescriptions p where p.id=prescription_id and p.status='draft'));
create policy form_receipt on rx_private.form_receipts to rx_form_executor using(actor_id=rx_private.lifecycle_actor_id() and clinic_id=rx_private.doctor_clinic()) with check(actor_id=rx_private.lifecycle_actor_id() and clinic_id=rx_private.doctor_clinic());
create policy form_identity on rx_private.patient_identities to rx_form_executor using(rx_private.patient_in_clinic(patient_id)) with check(rx_private.patient_in_clinic(patient_id));
create policy form_prescriber on public.prescribers to rx_form_executor using(user_id=rx_private.lifecycle_actor_id());
create policy form_actor on public.app_users to rx_form_executor using(id=rx_private.lifecycle_actor_id() and is_active);
create policy form_clinic on public.clinics to rx_form_executor using(id=rx_private.doctor_clinic());

create function public.issue_form_prescription(p_request_id uuid,p_payload jsonb,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare actor uuid:=rx_private.lifecycle_actor_id(); clinic uuid; identity jsonb; patient uuid; prescription uuid; version timestamptz; item jsonb; field text; n integer:=0; fingerprint text; receipt rx_private.form_receipts; result jsonb; review jsonb;
begin
 clinic:=rx_private.assert_clinic_access(false);
 if p_request_id is null or p_confirmed is distinct from true or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['name','country','type','identifier','notes','items']<>'{}'::jsonb or jsonb_typeof(p_payload->'country') is distinct from 'string' or jsonb_typeof(p_payload->'type') is distinct from 'string' or jsonb_typeof(p_payload->'identifier') is distinct from 'string' then raise exception 'Invalid form' using errcode='22023'; end if;
 identity:=rx_private.normalize_identity(p_payload->>'country',p_payload->>'type',p_payload->>'identifier');
 if jsonb_typeof(p_payload->'name') is distinct from 'string' or length(btrim(p_payload->>'name')) not between 1 and 200 or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>4000 or jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 30 then raise exception 'Invalid form' using errcode='22023'; end if;
 fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,9));
 select * into receipt from rx_private.form_receipts where actor_id=actor and request_id=p_request_id;
 if found then
   if receipt.fingerprint<>fingerprint then raise exception 'Request changed' using errcode='PT409'; end if;
   return receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform rx_private.assert_clinic_access(true);
 -- Validate all content before any writes. Database repeats HTTP validation.
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
create function public.recover_form_receipt(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform rx_private.assert_clinic_access(false);
 perform pg_advisory_xact_lock(hashtextextended(rx_private.lifecycle_actor_id()::text||p_request_id::text,9));
 return (select result from rx_private.form_receipts where actor_id=rx_private.lifecycle_actor_id() and request_id=p_request_id);
end;
$$;
revoke all on function public.issue_form_prescription(uuid,jsonb,boolean),public.recover_form_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_form_prescription(uuid,jsonb,boolean),public.recover_form_receipt(uuid) to authenticated;
grant create on schema public to rx_form_executor;
alter function public.issue_form_prescription(uuid,jsonb,boolean) owner to rx_form_executor;
alter function public.recover_form_receipt(uuid) owner to rx_form_executor;
revoke create on schema public from rx_form_executor;
revoke rx_form_executor from current_user;

-- Persistent public admission budgets: per email/action/hour plus a global ceiling.
create table rx_private.access_limits(scope text not null,subject text not null,window_start timestamptz not null,attempts integer not null,primary key(scope,subject));
create table rx_private.onboarding_requests(email text primary key,display_name text not null,clinic_name text not null,requested_at timestamptz not null default now());
alter table rx_private.access_limits enable row level security;
alter table rx_private.onboarding_requests enable row level security;
revoke all on rx_private.access_limits,rx_private.onboarding_requests from public,anon,authenticated,service_role;
create function public.request_prescriber_access(p_email text,p_operation text,p_name text default '',p_clinic text default '') returns boolean
language plpgsql security definer set search_path='' as $$
declare key text; total integer; permitted boolean:=true;
begin
 if nullif(btrim(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'prefer','')),'') is not null then raise exception 'Preferences denied' using errcode='42501'; end if;
 if p_email is null or length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_operation not in ('challenge','verify','onboard') or p_operation is null or length(p_name)>160 or length(p_clinic)>160 then return false; end if;
 foreach key in array array['global',encode(extensions.digest(lower(btrim(p_email)),'sha256'),'hex')] loop
   insert into rx_private.access_limits values(p_operation,key,clock_timestamp(),1)
   on conflict(scope,subject) do update set attempts=case when access_limits.window_start+interval '1 hour'<=clock_timestamp() then 1 else least(access_limits.attempts+1,10001) end,window_start=case when access_limits.window_start+interval '1 hour'<=clock_timestamp() then clock_timestamp() else access_limits.window_start end returning attempts into total;
   if total>(case when key='global' then 1000 when p_operation='verify' then 10 else 5 end) then permitted:=false; end if;
 end loop;
 if permitted and p_operation='onboard' and length(btrim(p_name))>0 and length(btrim(p_clinic))>0 then
   insert into rx_private.onboarding_requests(email,display_name,clinic_name) values(lower(btrim(p_email)),btrim(p_name),btrim(p_clinic)) on conflict(email) do nothing;
 end if;
 return permitted;
end;
$$;

-- New national-ID search uses the existing pharmacy context/budgets/grants/receipts.
-- A definer broker returns only eligible IDs for one exact tuple; executor still has no directory RPC.
create function rx_private.identity_matches(p_country text,p_type text,p_identifier text,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity jsonb; result jsonb;
begin
 perform rx_private.pharmacy_context();
 identity:=rx_private.normalize_identity(p_country,p_type,p_identifier);
 if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'Invalid page' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from (
 select p.id,p.issued_at,p.expires_at,coalesce(f.result->>'doctor_name',d.display_name) doctor_name,coalesce(f.result->>'clinic_name',c.name) clinic_name
 from rx_private.patient_identities i join public.prescriptions p on p.patient_id=i.patient_id
 join rx_private.patient_clinics pc on pc.patient_id=i.patient_id join public.clinics c on c.id=pc.clinic_id
 join public.prescribers d on d.user_id=p.doctor_user_id left join rx_private.form_receipts f on f.prescription_id=p.id
 where i.country=identity->>'country' and i.document_type=identity->>'type' and i.identifier=identity->>'identifier' and p.status='issued' and p.expires_at>clock_timestamp() and not exists(select 1 from public.dispensations x where x.prescription_id=p.id)
 order by p.issued_at desc,p.id limit 21 offset p_offset) r;
 return result;
end;
$$;
create table rx_private.pharmacy_searches(id uuid primary key default gen_random_uuid(),actor_id uuid not null,pharmacy_id uuid not null,session_id uuid not null,matches uuid[] not null,expires_at timestamptz not null default clock_timestamp()+interval '5 minutes');
alter table rx_private.pharmacy_searches enable row level security;
revoke all on rx_private.pharmacy_searches from public,anon,authenticated,service_role;
grant select,insert on rx_private.pharmacy_searches to rx_pharmacy_executor;
create policy pharmacy_search_scope on rx_private.pharmacy_searches to rx_pharmacy_executor using(actor_id=rx_private.lifecycle_actor_id() and session_id=(select c.session_id from rx_private.pharmacy_context() c)) with check(actor_id=rx_private.lifecycle_actor_id() and session_id=(select c.session_id from rx_private.pharmacy_context() c));
create trigger immutable_pharmacy_search before update or delete on rx_private.pharmacy_searches for each row execute function rx_private.guard_audit_history();
create function rx_private.search_selection_version(p_search_id uuid,p_id uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare c record;
begin
 select * into c from rx_private.pharmacy_context();
 if not exists(select 1 from rx_private.pharmacy_searches where id=p_search_id and actor_id=c.actor_id and pharmacy_id=c.pharmacy_id and session_id=c.session_id and expires_at>clock_timestamp() and p_id=any(matches)) then return null; end if;
 return (select updated_at from public.prescriptions where id=p_id);
end;
$$;
revoke all on function rx_private.search_selection_version(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function rx_private.search_selection_version(uuid,uuid) to rx_pharmacy_executor;
create function public.search_pharmacy_identity(p_country text,p_type text,p_identifier text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
declare c record; matches jsonb; token uuid; page jsonb;
begin
 select * into c from rx_private.pharmacy_context();
 if not rx_private.consume_pharmacy_limit('lookup') then return rx_private.pharmacy_failure('PT429'); end if;
 begin matches:=rx_private.identity_matches(p_country,p_type,p_identifier,p_offset); exception when invalid_parameter_value then return rx_private.pharmacy_failure('PT404'); end;
 select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into page from jsonb_array_elements(matches) with ordinality r(value,ordinal) where ordinal<=20;
 insert into rx_private.pharmacy_searches(actor_id,pharmacy_id,session_id,matches) values(c.actor_id,c.pharmacy_id,c.session_id,array(select (value->>'id')::uuid from jsonb_array_elements(page))) returning id into token;
 return jsonb_build_object('search_id',token,'matches',page,'next_offset',case when jsonb_array_length(matches)>20 then p_offset+20 else null end);
end;
$$;
create function public.select_pharmacy_prescription(p_search_id uuid,p_prescription_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='3s' set statement_timeout='8s' as $$
declare c record; p record; token uuid; patient jsonb; items jsonb; version timestamptz;
begin
 select * into c from rx_private.pharmacy_context();
 if not rx_private.consume_pharmacy_limit('lookup') then return rx_private.pharmacy_failure('PT429'); end if;
 if not exists(select 1 from rx_private.pharmacy_searches where id=p_search_id and actor_id=c.actor_id and pharmacy_id=c.pharmacy_id and session_id=c.session_id and expires_at>clock_timestamp() and p_prescription_id=any(matches)) then return rx_private.pharmacy_failure('PT404'); end if;
 -- Broker is constrained to this current session's selected search result.
 version:=rx_private.search_selection_version(p_search_id,p_prescription_id);
 if version is null then return rx_private.pharmacy_failure('PT404'); end if;
 insert into rx_private.pharmacy_lookups(actor_id,pharmacy_id,session_id,prescription_id,expected_version) values(c.actor_id,c.pharmacy_id,c.session_id,p_prescription_id,version) returning id into token;
 select id,patient_id,status,updated_at,issued_at,expires_at into p from public.prescriptions where id=p_prescription_id for update;
 perform rx_private.pharmacy_context(true);
 if p.status is distinct from 'issued' or p.expires_at<=clock_timestamp() or exists(select 1 from public.dispensations where prescription_id=p.id) then return rx_private.pharmacy_failure('PT409'); end if;
 if p.updated_at<>version then return rx_private.pharmacy_failure('PT409'); end if;
 select jsonb_build_object('name',name) into patient from public.patients where id=p.patient_id;
 select jsonb_agg(jsonb_build_object('medication_name',medication_name,'strength',strength,'dose',dose,'frequency',frequency,'duration',duration,'quantity',quantity,'special_instructions',special_instructions) order by sort_order,id) into items from public.prescription_items where prescription_id=p.id;
 return jsonb_build_object('state','eligible','prescription_id',p.id,'lookup_id',token,'patient',patient,'items',items,'issued_at',p.issued_at,'expires_at',p.expires_at);
end;
$$;
create function public.recover_dispensing_receipt(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record;
begin
 select * into c from rx_private.pharmacy_context();
 if not rx_private.consume_pharmacy_limit('dispense') then return rx_private.pharmacy_failure('PT429'); end if;
 return (select jsonb_build_object('state','dispensed','prescription_id',r.prescription_id,'id',r.dispensation_id,'replayed',true) from rx_private.dispensing_receipts r where r.actor_id=c.actor_id and r.pharmacy_id=c.pharmacy_id and r.request_id=p_request_id);
end;
$$;
grant execute on function rx_private.identity_matches(text,text,text,integer) to rx_pharmacy_executor;
revoke all on function public.search_pharmacy_identity(text,text,text,integer),public.select_pharmacy_prescription(uuid,uuid),public.recover_dispensing_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_pharmacy_identity(text,text,text,integer),public.select_pharmacy_prescription(uuid,uuid),public.recover_dispensing_receipt(uuid) to authenticated;
grant rx_pharmacy_executor to current_user with inherit false,set true;
grant create on schema public to rx_pharmacy_executor;
alter function public.search_pharmacy_identity(text,text,text,integer) owner to rx_pharmacy_executor;
alter function public.select_pharmacy_prescription(uuid,uuid) owner to rx_pharmacy_executor;
alter function public.recover_dispensing_receipt(uuid) owner to rx_pharmacy_executor;
revoke create on schema public from rx_pharmacy_executor;
revoke rx_pharmacy_executor from current_user;

-- Explicit callable surface. No table writes for anonymous callers, no role escalation.
revoke all on function rx_private.doctor_clinic(),rx_private.patient_in_clinic(uuid),rx_private.assert_clinic_access(boolean),rx_private.scope_patient(),rx_private.scope_prescription(),rx_private.normalize_identity(text,text,text),rx_private.identity_matches(text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function rx_private.doctor_clinic(),rx_private.patient_in_clinic(uuid) to authenticated,rx_lifecycle_executor;
revoke all on function public.get_prescriber_context(),public.request_prescriber_access(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_prescriber_context() to authenticated;
grant execute on function public.request_prescriber_access(text,text,text,text) to anon,authenticated;
commit;

