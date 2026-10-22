import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { requireSafe, MAX_FRAME } from "./recovery-archive.mjs";
export const APP_TABLES = [
  "public.pharmacies",
  "public.app_users",
  "public.patients",
  "public.prescriptions",
  "public.prescription_items",
  "public.dispensations",
  "public.audit_events",
  "rx_private.issuance_receipts",
  "rx_private.cancellation_receipts",
];
const DURABLE = new Set(["users", "identities", "audit_log_entries"]);
const TRANSIENT = new Set([
  "sessions",
  "refresh_tokens",
  "flow_state",
  "mfa_amr_claims",
  "mfa_challenges",
  "saml_relay_states",
  "one_time_tokens",
  "oauth_authorizations",
  "oauth_client_states",
  "webauthn_challenges",
  "scim_tokens",
]);
const UNSUPPORTED = new Set([
  "instances",
  "custom_oauth_providers",
  "oauth_clients",
  "oauth_consents",
  "sso_domains",
  "sso_providers",
  "saml_providers",
  "scim_users",
  "mfa_factors",
  "mfa_recovery_code_sets",
  "mfa_recovery_codes",
  "webauthn_credentials",
]);
const TOKEN_FIELDS = new Set([
  "confirmation_token",
  "recovery_token",
  "email_change_token_new",
  "email_change_token_current",
  "reauthentication_token",
  "phone_change_token",
]);
export const qid = (s) => {
  requireSafe(
    typeof s === "string" && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(s),
    "UNSUPPORTED_IDENTIFIER",
  );
  return `"${s}"`;
};
export const qualified = (s) => s.split(".").map(qid).join(".");
export function disposition(table) {
  if (APP_TABLES.includes(table)) return "restore";
  if (table === "vault.secrets") return "ciphertext_archive_only";
  if (table === "supabase_migrations.schema_migrations")
    return "migration_history";
  const [schema, name] = table.split(".");
  requireSafe(schema === "auth", "UNKNOWN_TABLE");
  if (name === "schema_migrations") return "platform_schema_version";
  if (DURABLE.has(name)) return "restore";
  if (TRANSIENT.has(name)) return "omit_live_auth";
  requireSafe(UNSUPPORTED.has(name), "UNKNOWN_AUTH_TABLE");
  return "unsupported_must_be_empty";
}
export function rowExpression(table) {
  let expression = "to_jsonb(t)";
  if (table.name === "auth.users") {
    const tokens = table.columns.filter((c) => TOKEN_FIELDS.has(c.name));
    // Remove usable confirmation/recovery/reauthentication tokens, retain identity and historical timestamps.
    for (const c of tokens) {
      requireSafe(
        ["text", "character varying(255)", "character varying"].includes(
          c.type,
        ),
        "AUTH_TOKEN_COLUMN_TYPE",
      );
      expression += ` || jsonb_build_object('${c.name}','')`;
    }
  }
  return `(${expression})::text`;
}
export async function migrationFiles() {
  const files = (await readdir("supabase/migrations"))
    .filter((f) => /^\d{14}_[a-z_]+\.sql$/.test(f))
    .sort();
  return Promise.all(
    files.map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(`supabase/migrations/${name}`))
        .digest("hex"),
    })),
  );
}
// Only schema/permission metadata; definitions are compared, never executed from an archive.
const TABLE_SQL = `select n.nspname||'.'||c.relname as name,c.relowner::regrole::text as owner,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,c.relacl::text as acl,
 (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
 (select jsonb_agg(jsonb_build_object('name',co.conname,'type',co.contype,'definition',pg_get_constraintdef(co.oid,true),'deferrable',co.condeferrable,'reference',case when co.confrelid<>0 then co.confrelid::regclass::text end) order by co.conname) from pg_constraint co where co.conrelid=c.oid) as constraints,
 (select jsonb_agg(a.attname order by x.i) from pg_index ix cross join lateral unnest(ix.indkey) with ordinality x(num,i) join pg_attribute a on a.attrelid=ix.indrelid and a.attnum=x.num where ix.indrelid=c.oid and ix.indisprimary) as pk,
 (select jsonb_agg(jsonb_build_object('name',p.polname,'roles',(select jsonb_agg(case when role=0 then 'PUBLIC' else role::regrole::text end order by role::regrole::text) from unnest(p.polroles) role),'command',p.polcmd,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid) as policies,
 (select jsonb_agg(jsonb_build_object('name',case when t.tgisinternal then co.conname||':'||t.tgtype::text else t.tgname end,'enabled',t.tgenabled,'internal',t.tgisinternal,'definition',case when t.tgisinternal then co.conname else pg_get_triggerdef(t.oid,true) end) order by t.tgisinternal,co.conname,t.tgtype,t.tgname) from pg_trigger t left join pg_constraint co on co.oid=t.tgconstraint where t.tgrelid=c.oid) as triggers,
 (select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname=n.nspname and tablename=c.relname) as indexes
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('public','rx_private','auth') or (n.nspname='vault' and c.relname='secrets') or (n.nspname='supabase_migrations' and c.relname='schema_migrations')) order by n.nspname,c.relname`;
export async function catalog(c, { adapter = false } = {}) {
  await c.query(
    "set local search_path=''; set local timezone='UTC'; set local datestyle='ISO,YMD'; set local extra_float_digits=3",
  );
  const version = (
    await c.query(
      "select current_setting('server_version_num')::int/10000 as major,current_user as owner",
    )
  ).rows[0];
  requireSafe(
    version.major === 17 && version.owner === "postgres",
    "UNSUPPORTED_SERVER_OR_OPERATOR",
  );
  const logging = (
    await c.query(
      "select current_setting('log_statement') as statements,current_setting('log_min_duration_statement') as duration,current_setting('log_min_duration_sample') as sample,current_setting('log_parameter_max_length_on_error') as error_parameters,current_setting('pgaudit.log',true) as audit",
    )
  ).rows[0];
  requireSafe(
    ["none", "ddl"].includes(logging.statements) &&
      logging.duration === "-1" &&
      logging.sample === "-1" &&
      logging.error_parameters === "0" &&
      [null, "none", ""].includes(logging.audit),
    "UNSAFE_DATABASE_LOGGING",
  );
  const extensions = (
    await c.query(
      "select extname as name,extversion as version from pg_extension order by extname",
    )
  ).rows;
  requireSafe(
    !extensions.some((e) =>
      ["pg_cron", "pg_net", "wrappers", "pgaudit"].includes(e.name),
    ),
    "UNREVIEWED_EXTERNAL_OR_AUDIT_EXTENSION",
  );
  const native = extensions.some((e) => e.name === "supabase_vault");
  requireSafe(adapter ? !native : native, "VAULT_MODE_MISMATCH");
  const tables = (await c.query(TABLE_SQL)).rows;
  requireSafe(tables.length <= 64, "TABLE_INVENTORY_LIMIT");
  for (const name of ["storage.objects", "storage.buckets"]) {
    const exists = (
      await c.query("select to_regclass($1) is not null as exists", [name])
    ).rows[0].exists;
    if (exists)
      requireSafe(
        (await c.query(`select count(*)::text as n from ${qualified(name)}`))
          .rows[0].n === "0",
        "UNSUPPORTED_STORAGE_CONTENT",
      );
  }
  const foreignSchemas = (
    await c.query(
      "select count(*)::int as n from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema','public','rx_private','auth','vault','extensions','graphql','graphql_public','realtime','storage','supabase_migrations')",
    )
  ).rows[0].n;
  requireSafe(foreignSchemas === 0, "UNREVIEWED_USER_SCHEMA");
  for (const t of tables) {
    t.disposition = disposition(t.name);
    requireSafe(t.pk?.length > 0, "TABLE_REQUIRES_PRIMARY_KEY");
    if (t.disposition === "restore")
      requireSafe(
        !t.columns.some(
          (col) => col.identity || col.default?.includes("nextval("),
        ),
        "DURABLE_SEQUENCE_UNSUPPORTED",
      );
  }
  requireSafe(
    APP_TABLES.every((name) => tables.some((t) => t.name === name)) &&
      tables.some((t) => t.name === "auth.users") &&
      tables.some((t) => t.name === "auth.identities") &&
      tables.some((t) => t.name === "auth.schema_migrations") &&
      tables.some((t) => t.name === "supabase_migrations.schema_migrations"),
    "REQUIRED_TABLE_MISSING",
  );
  const otherKinds = (
    await c.query(
      "select count(*) as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','rx_private','auth') and c.relkind in ('p','f','m')",
    )
  ).rows[0];
  requireSafe(+otherKinds.n === 0, "UNSUPPORTED_RELATION_KIND");
  const sequences = (
    await c.query(
      "select n.nspname||'.'||c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','rx_private','auth') and c.relkind='S' order by 1",
    )
  ).rows;
  requireSafe(
    sequences.every((s) => s.name === "auth.refresh_tokens_id_seq"),
    "DURABLE_SEQUENCE_UNSUPPORTED",
  );
  const functions = (
    await c.query(
      "select p.oid::regprocedure::text as name,p.proowner::regrole::text as owner,p.prosecdef as definer,p.proconfig as config,p.proacl::text as acl,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','rx_private') and p.prokind='f' order by 1",
    )
  ).rows;
  const roles = (
    await c.query(
      "select rolname as name,rolsuper as superuser,rolinherit as inherit,rolcreaterole as createrole,rolcreatedb as createdb,rolcanlogin as login,rolreplication as replication,rolbypassrls as bypass from pg_roles where rolname in ('anon','authenticated','service_role','rx_lifecycle_executor') order by rolname",
    )
  ).rows;
  const executor = roles.find((r) => r.name === "rx_lifecycle_executor");
  requireSafe(
    executor &&
      !executor.superuser &&
      !executor.inherit &&
      !executor.createrole &&
      !executor.createdb &&
      !executor.login &&
      !executor.replication &&
      !executor.bypass,
    "EXECUTOR_SECURITY_MISMATCH",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    const rights = (
      await c.query(
        "select has_schema_privilege($1,'vault','USAGE') as vault,has_column_privilege($1,'public.prescriptions','reference_digest','SELECT') as digest,pg_has_role($1,'rx_lifecycle_executor','SET') as assume,has_function_privilege($1,'rx_private.recover_reference(uuid)','EXECUTE') as helper",
        [role],
      )
    ).rows[0];
    requireSafe(
      !rights.digest &&
        !rights.assume &&
        !rights.helper &&
        (role === "service_role" || !rights.vault),
      "APP_PERMISSION_BROADENING",
    );
  }
  requireSafe(
    tables
      .filter((t) => APP_TABLES.includes(t.name))
      .every((t) => t.rls && t.owner === "postgres"),
    "APP_OWNER_OR_RLS_MISMATCH",
  );
  requireSafe(
    tables
      .filter((t) => t.name.startsWith("auth."))
      .every((t) => (t.triggers ?? []).every((g) => g.internal)),
    "UNREVIEWED_AUTH_USER_TRIGGER",
  );
  const memberships = (
    await c.query(
      "select roleid::regrole::text as role,member::regrole::text as member,admin_option,inherit_option,set_option from pg_auth_members where roleid='rx_lifecycle_executor'::regrole or member='rx_lifecycle_executor'::regrole order by 1,2",
    )
  ).rows;
  const schemas = (
    await c.query(
      "select nspname as name,nspowner::regrole::text as owner,nspacl::text as acl from pg_namespace where nspname in ('public','rx_private') order by 1",
    )
  ).rows;
  const authVersion = (
    await c.query(
      "select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text as value from auth.schema_migrations t",
    )
  ).rows[0].value;
  const migrationRows = (
    await c.query(
      "select coalesce(jsonb_agg(to_jsonb(t) order by version),'[]'::jsonb)::text as value from supabase_migrations.schema_migrations t",
    )
  ).rows[0].value;
  const files = await migrationFiles();
  requireSafe(
    JSON.stringify(JSON.parse(migrationRows).map((r) => r.version)) ===
      JSON.stringify(files.map((f) => f.name.slice(0, 14))),
    "MIGRATION_HISTORY_MISMATCH",
  );
  const counts = {};
  for (const t of tables)
    counts[t.name] = (
      await c.query(`select count(*)::text as n from ${qualified(t.name)}`)
    ).rows[0].n;
  for (const t of tables.filter(
    (t) => t.disposition === "unsupported_must_be_empty",
  ))
    requireSafe(
      counts[t.name] === "0",
      "UNSUPPORTED_AUTH_CONFIGURATION_NOT_EMPTY",
    );
  const profile = {
    major: version.major,
    vault: adapter ? "LOCAL_ADAPTER_NOT_NATIVE" : "native",
    extensions,
    tables,
    functions,
    roles,
    memberships,
    schemas,
    authVersion,
    files,
  };
  requireSafe(
    Buffer.byteLength(JSON.stringify(profile)) < MAX_FRAME / 2,
    "CATALOG_SIZE_LIMIT",
  );
  return { profile, counts, migrationRows };
}
export function restoreOrder(tables) {
  const restorable = tables.filter((t) => t.disposition === "restore");
  const pending = new Map(restorable.map((t) => [t.name, t]));
  const done = [];
  while (pending.size) {
    let found = false;
    for (const [name, t] of pending) {
      const refs = (t.constraints ?? [])
        .filter((c) => c.type === "f" && c.reference !== name)
        .map((c) => c.reference.replaceAll('"', ""));
      if (refs.some((r) => pending.has(r))) continue;
      done.push(t);
      pending.delete(name);
      found = true;
    }
    requireSafe(found, "UNSUPPORTED_FOREIGN_KEY_CYCLE");
  }
  return done;
}
export async function* rows(c, table, { mapVaultIds = false } = {}) {
  let expression = rowExpression(table);
  if (mapVaultIds && table.name === "rx_private.issuance_receipts")
    expression =
      "(to_jsonb(t)||jsonb_build_object('vault_secret_id',(select old_id from pg_temp.rx_restore_map where new_id=t.vault_secret_id)))::text";
  const order = table.pk.map(qid).join(",");
  await c.query(
    `declare rx_capture no scroll cursor for select case when octet_length(${expression})<=${MAX_FRAME / 2} then ${expression} end as data from ${qualified(table.name)} t order by ${order}`,
  );
  try {
    while (true) {
      const batch = (await c.query("fetch 1 from rx_capture")).rows;
      if (!batch.length) break;
      requireSafe(typeof batch[0].data === "string", "ROW_SIZE_LIMIT");
      yield batch[0].data;
    }
  } finally {
    await c.query("close rx_capture").catch(() => {});
  }
}
