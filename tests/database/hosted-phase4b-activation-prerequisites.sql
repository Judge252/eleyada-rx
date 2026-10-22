-- Read-only definitions/permissions/structure/aggregates. Never reads secret values.
select jsonb_build_object(
  'postgres_version',current_setting('server_version'),
  'role_timeouts',(select jsonb_agg(jsonb_build_object('name',rolname,'config',rolconfig)) from pg_roles where rolname in ('postgres','authenticated','authenticator')),
  'native_vault_functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',p.proowner::regrole::text,
    'definer',p.prosecdef,'config',p.proconfig,'postgres_execute',has_function_privilege(current_user,p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'definition',pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace='vault'::regnamespace and p.proname in ('create_secret','update_secret')),
  'vault_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='vault' and table_name='secrets'),
  'vault_relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner::regrole::text,'postgres_select',has_table_privilege(current_user,c.oid,'SELECT'))) from pg_class c where c.relnamespace='vault'::regnamespace and c.relname in ('secrets','decrypted_secrets')),
  'extension_dump_tables',(select jsonb_agg(jsonb_build_object('extension',e.extname,'config',e.extconfig::regclass[]::text,'conditions',e.extcondition)) from pg_extension e where extname='supabase_vault'),
  'secret_record_count',(select count(*) from vault.secrets),
  'vault_key_helpers',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',p.proowner::regrole::text)) from pg_proc p where p.pronamespace='vault'::regnamespace and p.proname like '%key%'),
  'auth_table_inventory',(select jsonb_agg(jsonb_build_object('name',c.relname,'postgres_select',has_table_privilege(current_user,c.oid,'SELECT')) order by c.relname) from pg_class c where c.relnamespace='auth'::regnamespace and c.relkind in ('r','p')),
  'replica_restore_privilege',has_parameter_privilege(current_user,'session_replication_role','SET'),
  'external_extensions',(select jsonb_agg(extname) from pg_extension where extname in ('pg_cron','pg_net','wrappers'))
) as prerequisites;
