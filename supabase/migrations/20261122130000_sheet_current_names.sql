-- Printable sheet / pharmacy lookup: show the clinic's and doctor's CURRENT names (a renamed clinic is the same clinic),
-- falling back to the names stored with the issuance receipt only when the live row is unavailable.
begin;
create or replace function rx_private.public_sheet(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('doctor_name',coalesce(d.display_name,f.result->>'doctor_name'),'clinic_name',coalesce(c.name,f.result->>'clinic_name'))
  from public.prescriptions p
  left join public.prescribers d on d.user_id=p.doctor_user_id
  left join rx_private.patient_clinics pc on pc.patient_id=p.patient_id
  left join public.clinics c on c.id=pc.clinic_id
  left join rx_private.form_receipts f on f.prescription_id=p.id
  where p.id=p_id;
$$;
commit;
