-- TEST ONLY. Allows unchanged clinical regression scenarios to run under new clinic scope.
update public.clinic_entitlements set is_active=true;
create function rx_private.fixture_doctor() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='doctor' then
 insert into public.prescribers(user_id,display_name,approved) values(new.id,'SYNTHETIC LEGACY DOCTOR',true);
 insert into public.clinic_memberships(user_id,clinic_id) select new.id,clinic_id from public.clinic_entitlements limit 1;
 end if; return new;
end;$$;
create trigger fixture_doctor after insert on public.app_users for each row execute function rx_private.fixture_doctor();
create function rx_private.fixture_patient() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then
 insert into rx_private.patient_clinics select new.id,clinic_id from public.clinic_entitlements limit 1;
 end if; return new;
end;$$;
create trigger fixture_patient before insert on public.patients for each row execute function rx_private.fixture_patient();
revoke all on function rx_private.fixture_patient(),rx_private.fixture_doctor() from public,anon,authenticated,service_role;
