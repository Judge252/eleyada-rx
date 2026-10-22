-- Read-only hosted metadata/counts; no patient or medication contents.
select jsonb_build_object(
 'history',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'rpcs',(select jsonb_agg(jsonb_build_object('name',p.proname,'invoker',not p.prosecdef,
   'config',p.proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
   'anon',has_function_privilege('anon',p.oid,'execute'),'service_role',has_function_privilege('service_role',p.oid,'execute')))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('save_doctor_draft','delete_doctor_draft')),
 'rls',(select jsonb_object_agg(c.relname,c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('app_users','pharmacies','patients','prescriptions','prescription_items','dispensations','audit_events')),
 'policy_count',(select count(*) from pg_policies where schemaname='public'),
 'column_grants',jsonb_build_object(
   'draft_request_select',has_column_privilege('authenticated','public.prescriptions','draft_request_id','select'),
   'draft_request_insert',has_column_privilege('authenticated','public.prescriptions','draft_request_id','insert'),
   'item_order_select',has_column_privilege('authenticated','public.prescription_items','sort_order','select'),
   'item_order_insert',has_column_privilege('authenticated','public.prescription_items','sort_order','insert'),
   'status_update',has_column_privilege('authenticated','public.prescriptions','status','update'),
   'doctor_identity_update',has_column_privilege('authenticated','public.prescriptions','doctor_user_id','update')),
 'digest_select',jsonb_build_object('authenticated',has_column_privilege('authenticated','public.prescriptions','reference_digest','select'),
   'anon',has_column_privilege('anon','public.prescriptions','reference_digest','select'),
   'service_role',has_column_privilege('service_role','public.prescriptions','reference_digest','select')),
 'privileged_roles',(select jsonb_object_agg(rolname,rolbypassrls or rolsuper) from pg_roles where rolname in ('authenticated','anon')),
 'counts',jsonb_build_object('patients',(select count(*) from public.patients),'prescriptions',(select count(*) from public.prescriptions),
   'items',(select count(*) from public.prescription_items),'dispensations',(select count(*) from public.dispensations),'audits',(select count(*) from public.audit_events)),
 'memberships',(select jsonb_agg(jsonb_build_object('role',role,'active',is_active)) from public.app_users),
 'active_pharmacies',(select count(*) from public.pharmacies where is_active)
) as phase4a_inspection;
