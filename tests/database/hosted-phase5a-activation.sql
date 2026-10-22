-- Read-only metadata/aggregate checks; no reference, secret or patient content.
begin read only;
set local statement_timeout='5s';
select jsonb_build_object(
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'configuration',p.proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('lookup_pharmacy_prescription','dispense_pharmacy_prescription')),
 'role',(select jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'create_role',rolcreaterole,'create_db',rolcreatedb,'replication',rolreplication,'bypass',rolbypassrls) from pg_roles where rolname='rx_pharmacy_executor'),
 'assumable_memberships',(select count(*) from pg_auth_members where roleid='rx_pharmacy_executor'::regrole and (inherit_option or set_option)),
 'create_public',has_schema_privilege('rx_pharmacy_executor','public','CREATE'),
 'auth_usage',has_schema_privilege('rx_pharmacy_executor','auth','USAGE'),
 'vault_usage',has_schema_privilege('rx_pharmacy_executor','vault','USAGE'),
 'digest_denied',not has_column_privilege('rx_pharmacy_executor','public.prescriptions','reference_digest','SELECT') and not has_column_privilege('authenticated','public.prescriptions','reference_digest','SELECT') and not has_column_privilege('anon','public.prescriptions','reference_digest','SELECT'),
 'public_rls',(select count(*)=7 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('patients','prescriptions','prescription_items','app_users','pharmacies','dispensations','audit_events')),
 'private_rls',(select count(*)=3 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='rx_private' and c.relname in ('pharmacy_rate_limits','pharmacy_lookups','dispensing_receipts')),
 'private_direct_grants_absent',not exists(select 1 from information_schema.role_table_grants where table_schema='rx_private' and table_name in ('pharmacy_rate_limits','pharmacy_lookups','dispensing_receipts') and grantee in ('anon','authenticated','service_role','PUBLIC')),
 'private_helper_grants_absent',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rx_private' and p.proname in ('pharmacy_context','pharmacy_can_read','resolve_pharmacy_reference','consume_pharmacy_limit','pharmacy_failure') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))),
 'helper_paths_fixed',(select bool_and(coalesce(p.proconfig,'{}') @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rx_private' and p.proname in ('pharmacy_context','pharmacy_can_read','resolve_pharmacy_reference','consume_pharmacy_limit','pharmacy_failure')),
 'safe_timeout_metadata',(select jsonb_agg(jsonb_build_object('role',r.rolname,'setting',config)) from pg_roles r cross join lateral unnest(r.rolconfig) config where r.rolname in ('authenticator','authenticated') and config ~ '(statement_timeout|lock_timeout|db_hoisted_tx_settings)'),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference|lookup_pharmacy_prescription|dispense_pharmacy_prescription)'),
 'patients',(select count(*) from public.patients),
 'prescriptions',(select count(*) from public.prescriptions),
 'items',(select count(*) from public.prescription_items),
 'dispensations',(select count(*) from public.dispensations),
 'audit_events',(select count(*) from public.audit_events),
 'vault_records',(select count(*) from vault.secrets)
) as activation;
commit;
