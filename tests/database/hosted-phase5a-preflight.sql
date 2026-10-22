-- READ ONLY. Aggregate/configuration metadata; no patient contents or reference/key values.
begin read only;
set local statement_timeout='5s';
set local lock_timeout='1s';
select jsonb_build_object(
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'new_role_exists',exists(select 1 from pg_roles where rolname='rx_pharmacy_executor'),
 'new_lookup_rpc_absent',to_regprocedure('public.lookup_pharmacy_prescription(text)') is null,
 'new_dispense_rpc_absent',to_regprocedure('public.dispense_pharmacy_prescription(uuid,uuid,uuid,boolean,boolean)') is null,
 'new_rate_table_absent',to_regclass('rx_private.pharmacy_rate_limits') is null,
 'patients',(select count(*) from public.patients),
 'prescriptions',(select count(*) from public.prescriptions),
 'items',(select count(*) from public.prescription_items),
 'dispensations',(select count(*) from public.dispensations),
 'audit_events',(select count(*) from public.audit_events),
 'vault_records',(select count(*) from vault.secrets),
 'lookup_key_exists',(select count(*)=1 from vault.secrets where name='al_eyada_rx.lookup.v1'),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference|lookup_pharmacy_prescription|dispense_pharmacy_prescription)'),
 'digest_grants_unchanged',not has_column_privilege('authenticated','public.prescriptions','reference_digest','SELECT') and not has_column_privilege('anon','public.prescriptions','reference_digest','SELECT'),
 'native_auth_delegation_unavailable',not has_schema_privilege(current_user,'auth','USAGE WITH GRANT OPTION'),
 'logging',jsonb_build_object('statement',current_setting('log_statement'),'parameters',current_setting('log_parameter_max_length'),'error_parameters',current_setting('log_parameter_max_length_on_error'),'audit_parameters',current_setting('pgaudit.log_parameter',true),'slow_duration',current_setting('log_min_duration_statement'),'sample_duration',current_setting('log_min_duration_sample'),'transaction_sample_rate',current_setting('log_transaction_sample_rate'))
) as preflight;
commit;
