-- Read-only aggregates/authorization metadata only. Never return references, keys or clinical contents.
select jsonb_build_object(
 'patients',(select count(*) from public.patients),
 'prescriptions',(select count(*) from public.prescriptions),
 'statuses',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status::text,count(*) n from public.prescriptions group by status) s),
 'items',(select count(*) from public.prescription_items),
 'dispensations',(select count(*) from public.dispensations),
 'audit_events',(select count(*) from public.audit_events),
 'issuance_receipts',(select count(*) from rx_private.issuance_receipts),
 'cancellation_receipts',(select count(*) from rx_private.cancellation_receipts),
 'vault_records',(select count(*) from vault.secrets),
 'lookup_v1_records',(select count(*) from vault.secrets where name='al_eyada_rx.lookup.v1'),
 'vault_probe_remnants',(select count(*) from vault.secrets where name like 'al_eyada_rx.probe.%'),
 'probe_function_absent',to_regprocedure('public.phase4b_deadline_probe()') is null,
 'probe_table_absent',to_regclass('rx_private.phase4b_deadline_probe_marks') is null,
 'active_probe_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like '%phase4b_deadline_probe%'),
 'active_account_inspections',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like '%pharmacist_auth_accounts%'),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference)'),
 'receipt_links_valid',not exists(select 1 from rx_private.issuance_receipts r left join vault.secrets s on s.id=r.vault_secret_id where s.id is null),
 'native_reference_digest_integrity',(select coalesce(bool_and(p.reference_digest=rx_private.reference_digest(rx_private.recover_reference(p.id))),true) from public.prescriptions p join rx_private.issuance_receipts r on r.prescription_id=p.id),
 'synthetic_medication_values_order_valid',(select count(*)=4 and bool_and(sort_order in (0,1) and medication_name='SYNTHETIC 4B TEST ITEM '||(sort_order+1)::text and strength='test '||(sort_order+1)::text and dose='test '||(sort_order+1)::text and frequency='test '||(sort_order+1)::text and duration='test '||(sort_order+1)::text and quantity=sort_order+3 and special_instructions='SYNTHETIC SOFTWARE TEST ONLY') from public.prescription_items where prescription_id in ('423504eb-b50d-4d09-b19a-2009c4d92911','4bbcd887-f4d1-4ae3-a7c7-cbdefdaec3a1')),
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as final_verification;
