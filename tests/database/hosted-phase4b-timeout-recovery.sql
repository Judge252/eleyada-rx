-- READ ONLY: metadata/aggregates only; no identities, secrets or query text.
select jsonb_build_object(
 'server_version',current_setting('server_version'),
 'role_configs',(select jsonb_agg(jsonb_build_object('role',rolname,'config',rolconfig)) from pg_roles where rolname in ('authenticator','authenticated','anon','postgres')),
 'database_configs',(select jsonb_agg(jsonb_build_object('role',r.rolname,'database',d.datname,'config',s.setconfig)) from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase),
 'auth_tables',(select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p')),
 'auth_sequences',(select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='S'),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion)) from pg_extension),
 'logging',(select jsonb_object_agg(name,setting) from pg_settings where name in ('log_statement','log_min_duration_statement','log_min_duration_sample','log_parameter_max_length','log_parameter_max_length_on_error','pgaudit.log')),
 'postgrest_applications',(select jsonb_agg(distinct application_name) from pg_stat_activity where application_name ilike '%postgrest%'),
 'active_clinical_calls',(select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query ~ '(save_doctor_draft|delete_doctor_draft|issue_doctor_prescription|cancel_doctor_prescription|reveal_doctor_reference)'),
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations)
) as inspection;
