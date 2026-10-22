-- Independent read-only observation while the approved diagnostic is installed.
select jsonb_build_object(
 'timeout_probe_marks',(select count(*) from rx_private.phase4b_deadline_probe_marks),
 'vault_records',(select count(*) from vault.secrets),
 'vault_probe_remnants',(select count(*) from vault.secrets where name like 'al_eyada_rx.probe.%'),
 'active_probe_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like '%phase4b_deadline_probe%'),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference)'),
 'counts',jsonb_build_object('patients',(select count(*) from public.patients),'prescriptions',(select count(*) from public.prescriptions),'items',(select count(*) from public.prescription_items),'dispensations',(select count(*) from public.dispensations),'audit_events',(select count(*) from public.audit_events))
) as inspection;
