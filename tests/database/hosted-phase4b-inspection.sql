-- READ ONLY metadata/aggregates. One result: Management API returns the last set.
-- No secret values, patient contents or backend query text.
select jsonb_build_object(
  'history',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations),
  'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',extnamespace::regnamespace::text)) from pg_extension where extname in ('supabase_vault','pgcrypto')),
  'owner',(select jsonb_build_object('role',rolname,'superuser',rolsuper,'createrole',rolcreaterole,'bypassrls',rolbypassrls) from pg_roles where rolname=current_user),
  'grants',(select jsonb_agg(jsonb_build_object('role',r,'vault_usage',has_schema_privilege(r,'vault','USAGE'),
    'vault_decrypted_select',has_table_privilege(r,'vault.decrypted_secrets','SELECT'),
    'digest_select',has_column_privilege(r,'public.prescriptions','reference_digest','SELECT'))) from unnest(array['anon','authenticated','service_role']) r),
  'protected_public_tables',(select count(*) from pg_tables where schemaname='public' and rowsecurity),
  'lifecycle_executor_roles',(select count(*) from pg_roles where rolname='rx_lifecycle_executor'),
  'phase4b_functions',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_doctor_issue_review','issue_doctor_prescription','get_doctor_lifecycle','reveal_doctor_reference','cancel_doctor_prescription')),
  'counts',jsonb_build_object('patients',(select count(*) from public.patients),'prescriptions',(select count(*) from public.prescriptions),
    'items',(select count(*) from public.prescription_items),'dispensations',(select count(*) from public.dispensations),'audit_events',(select count(*) from public.audit_events)),
  'active_clinical_rpc_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active'
    and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference)')
) as inspection;
