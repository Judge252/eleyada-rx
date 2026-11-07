-- Read-only, aggregate/boolean output only. Never emit codes, digests, keys or clinical contents.
begin read only;
set local statement_timeout='5s';
with fixtures as (select id,status,doctor_notes from public.prescriptions where doctor_notes in ('SYNTHETIC PHASE 5B A ACCEPTANCE ONLY','SYNTHETIC PHASE 5B B ACCEPTANCE ONLY'))
select jsonb_build_object(
 'patients',(select count(*) from public.patients),
 'prescriptions',(select count(*) from public.prescriptions),
 'items',(select count(*) from public.prescription_items),
 'dispensations',(select count(*) from public.dispensations),
 'audit_events',(select count(*) from public.audit_events),
 'vault_records',(select count(*) from vault.secrets),
 'issuance_receipts',(select count(*) from rx_private.issuance_receipts),
 'cancellation_receipts',(select count(*) from rx_private.cancellation_receipts),
 'dispensing_receipts',(select count(*) from rx_private.dispensing_receipts),
 'lookup_capabilities',(select count(*) from rx_private.pharmacy_lookups),
 'rate_buckets',(select count(*) from rx_private.pharmacy_rate_limits),
 'new_prescriptions',(select count(*) from fixtures),
 'new_two_medications',(select count(*)=2 and bool_and(n=2) from (select f.id,count(i.id) n from fixtures f left join public.prescription_items i on i.prescription_id=f.id group by f.id) counts),
 'new_statuses',(select jsonb_object_agg(status,n) from (select status::text,count(*) n from fixtures group by status) s),
 'new_dispensations',(select count(*) from public.dispensations where prescription_id in(select id from fixtures)),
 'none_cancelled_dispensed',not exists(select 1 from public.prescriptions p join public.dispensations d on d.prescription_id=p.id where p.status<>'issued'),
 'previous_histories_preserved',(select count(*)=4 and count(*) filter(where status='issued')=2 and count(*) filter(where status='cancelled')=2 from public.prescriptions where id in ('423504eb-b50d-4d09-b19a-2009c4d92911','4bbcd887-f4d1-4ae3-a7c7-cbdefdaec3a1','df9be40c-edd3-4aeb-9717-bf416743a9d9','2e3ea390-4335-461b-9f44-a9e93c3ba085')),
 'previous_dispensation_preserved',(select count(*)=1 and bool_and(prescription_id='df9be40c-edd3-4aeb-9717-bf416743a9d9'::uuid) from public.dispensations where prescription_id not in(select id from fixtures)),
 'new_values_order_valid',(select count(*)=4 and bool_and(i.sort_order in(0,1) and i.medication_name='SYNTHETIC 5B '||case when f.doctor_notes='SYNTHETIC PHASE 5B A ACCEPTANCE ONLY' then 'A' else 'B' end||' ITEM '||(i.sort_order+1)::text and i.strength='test '||(i.sort_order+1)::text and i.dose='test '||(i.sort_order+1)::text and i.frequency='test '||(i.sort_order+1)::text and i.duration='test '||(i.sort_order+1)::text and i.quantity=i.sort_order+3 and i.special_instructions='SYNTHETIC SOFTWARE TEST ONLY') from public.prescription_items i join fixtures f on f.id=i.prescription_id),
 'receipt_identity_valid',not exists(select 1 from rx_private.dispensing_receipts r join public.dispensations d on d.id=r.dispensation_id where (r.prescription_id,r.actor_id,r.pharmacy_id) is distinct from (d.prescription_id,d.pharmacist_user_id,d.pharmacy_id) or not r.identity_confirmed or not r.full_confirmed),
 'no_partial_completions',(select count(*) from public.dispensations)=(select count(*) from rx_private.dispensing_receipts),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference|lookup_pharmacy_prescription|dispense_pharmacy_prescription)'),
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as final;
commit;
