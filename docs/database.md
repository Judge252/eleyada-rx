# Database foundation and current Phase 5A boundary

**Current authority:** [Phase 5A final native acceptance](phase-5a-native-status.md) and [final Phase 4B acceptance](phase-4b-native-activation-status.md). Seven migrations are hosted, including exact approved `20261022173000_pharmacy_full_dispensing.sql`. Native pharmacy acceptance passed within the approved two-record synthetic scope. Backup/disaster recovery remains explicitly excluded. Older activation/recovery documents are historical, not instructions to resume that work. Function metadata alone does not establish an outer SQL deadline; existing native authenticated/authenticator timeout metadata was preserved, without repeating the completed Phase4B slow probe.

The new pharmacy executor is a non-login, non-bypass role with capability-scoped RLS, narrow column grants and two authenticated public RPCs. It cannot read reference digests or use Auth/Vault schemas. Purpose-limited trusted-owner helpers verify live sessions and resolve the existing HMAC; no key provisioning or broad service role is introduced. Ordinary pharmacists still cannot directly read clinical tables. Actor/pharmacy budgets persist across API instances, including handled invalid/conflicting requests. Confirmations bind a prescription version, actor, pharmacy and session for ten minutes; completed identical receipts can replay after fresh sign-in. Full dispensing uses the same parent lock as cancellation and records database time without changing prescription lifecycle.

The foundation sections below describe the earlier database contracts. Where they describe missing issuance/dispensing or pending Phase 4B activation, consult the current reports above: Phases 4B and 5A are hosted and complete within their approved synthetic scopes. One clinic/doctor, partner pharmacies, full dispensing only. Stop before Phase 5B/deployment.

## Connection status

This checkout is linked to existing **Eleyada RX** (`fckdsiozmufyhbnignet`). Foundation, authentication and original draft migrations are registered remotely; all seven tables retain RLS. The ignored `.env.local` configures ordinary clients with public URL/publishable key; no privileged application key. Public signup remains disabled. Doctor data is real; pharmacy simulation uses only isolated fixtures. Historical [Phase 3A evidence](phase-3a-status.md) describes that earlier checkpoint. The local config project identifier is a development label, not a remote reference.

Supabase CLI is installed and initialized. Docker and a PostgreSQL service were unavailable, so verification uses native, isolated PostgreSQL 17.10 binaries through the development-only `embedded-postgres` package. Each run creates a clean cluster inside ignored `.local/`, uses a randomly chosen loopback port and an ephemeral random password, then stops/removes only its own cluster. Remote connection environment variables are not consumed by this harness. Directory containment is checked before handing the directory to automatic cleanup.

`tests/database/bootstrap.sql` supplies only the Auth ID table, non-login API roles and the `auth.uid()` claim accessor needed by standalone PostgreSQL tests. It is never included in migrations and must never be run on an existing database or Supabase project. The real hosted migration uses Supabase's existing `auth.users`, `auth.uid()`, `anon`, `authenticated` and `service_role` objects.

## Tables

| Table                | Purpose and invariants                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pharmacies`         | UUID, name, optional contact information, active flag, timestamp                                                                        |
| `app_users`          | Auth user FK, database-managed role and membership, active flag; doctor has no pharmacy, pharmacist must have one                       |
| `patients`           | UUID, name, optional opaque identifier, timestamp; no national-ID format, uniqueness assumption or patient account                      |
| `prescriptions`      | Patient/doctor FKs, lifecycle, issue/expiry timestamps, notes, digest, creation/update timestamps                                       |
| `prescription_items` | Prescription FK and required medication fields; positive integer quantity, optional instructions                                        |
| `dispensations`      | Prescription/pharmacy/pharmacist FKs and timestamp; one unique completion record per prescription                                       |
| `audit_events`       | Actor when known, entity/event IDs/types, timestamp, tightly allowlisted lifecycle metadata; no copied prescription or patient contents |

Foreign keys use restriction for historical identities/records. Only draft prescription deletion cascades to its medication items. All FK lookup paths are indexed. A partial unique index permits only one doctor identity, including inactive identities; role and pharmacy links are immutable after provisioning. A future doctor-account replacement requires a reviewed migration, not deleting historical identities.

The database lifecycle is `draft`, `issued`, `cancelled`, `expired`. There is **no** separate `dispensed` status column. Full completion is `EXISTS (SELECT 1 FROM dispensations WHERE prescription_id = ...)`. A unique database constraint enforces this across pharmacies and concurrent transactions; a UI-only check would not suffice. Expiry must also be checked by timestamp, even if a future expiry task has not changed an `issued` status yet.

Only a unique 64-character lowercase HMAC-SHA-256 lookup digest is stored in the prescription header. The local Phase 4B migration generates a 160-bit reference inside the DB, stores its code encrypted in Vault and links an immutable private issuance receipt. No plaintext code column, browser key or browser persistence. Hosted generation remains unavailable until separately approved migration/key activation. `DEMO-*` fixtures remain outside real data. Local tests use disposable synthetic records and a pgcrypto-encrypted Vault **adapter**, which is not Supabase's native Vault AEAD/root recovery.

## Access matrix

| Identity                                  | Allowed database access                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous `anon`                          | No application table access or helper execution                                                                                                                        |
| Authenticated but unassigned/inactive     | No clinical access; role metadata cannot grant access                                                                                                                  |
| Active assigned doctor                    | Read clinic patients/partner pharmacies and own prescriptions/items/dispensations; insert/update allowed patient fields; create/edit/delete own drafts and draft items |
| Active pharmacist                         | Read own active `app_users` row and own active pharmacy identity (Phase 3B); clinical records remain denied                                                            |
| `service_role`                            | No grants on these application tables; no provisioning, issuance or dispensing privileges are prepared for a service-key client                                        |
| Trusted database owner/migration operator | Provision identities and maintain schema; integrity/immutability triggers still enforce ordinary SQL invariants                                                        |

All seven public tables have RLS; the two proposed private receipt tables also have RLS. Ordinary table grants still prohibit membership/lifecycle/reference/timestamp/digest/dispensing/audit writes or digest reads. The **local-only** dedicated non-login lifecycle role has narrow additional table/column permissions and RLS, reachable only through authorized fixed-path RPCs. Vault helpers remain trusted-owner functions with purpose-limited EXECUTE only for that role. Existing authenticated grants/policies and atomic draft invoker contracts are preserved. Draft conflicts remain PT409/HTTP409. The activation runbook enumerates every new privilege, private artifact and temporary owner SET grant.

Column SELECT grants on `prescriptions` intentionally exclude `reference_digest`. Future doctor queries must select permitted columns explicitly; `select('*')` will fail. Generated Row/Insert/Update types describe SQL structure, **not authorization**. RLS and column privileges remain authoritative.

Authorization reads current `app_users` rows rather than editable JWT metadata. The private `rx_private.is_active_doctor()` returns a boolean about the current UID; its narrow definer execution avoids recursive role-table RLS. Phase 3B's private live-session helper is also a read-only definer function checking only the current UID/session. The audit definer is an uncallable trigger writing minimal metadata. All use fixed empty search paths. The new Phase 4A save/delete functions are **invoker** functions, retain RLS and explicitly check both active doctor membership and the live session. `rx_private` remains unexposed to the Data API.

Application provisioning is database-owner-only: after the separately approved Auth setup in Phase 3, a trusted operator may insert an existing Auth UUID and its reviewed role/pharmacy into `app_users`. There is no automatic signup trigger, metadata-based role assignment or provisioning RPC. Nobody receives credentials in Phase 2. Active flags can be managed through trusted SQL; authenticated users cannot reactivate themselves.

## Immutability and history

- Issued and terminal prescription content, item contents, doctor/identity links and creation timestamps cannot be rewritten or deleted through ordinary SQL. Draft items lock their parent row so they serialize with future lifecycle operations.
- Patient verification fields linked to any issued history also freeze, including after cancellation/expiry, so changing a shared patient row cannot silently rewrite an original prescription. Corrections require an explicitly reviewed replacement workflow later.
- Only narrowly permitted lifecycle changes can retain existing immutable content. No client receives permission to perform them. Once dispensed, lifecycle cannot silently change.
- Any non-draft record needs issue fields, a digest and at least one medication. This is an integrity guard, not an issuance service or electronic approval mechanism.
- Dispensation rows are append-only. Integrity guards reject non-issued, expired, inactive/mismatched pharmacy/pharmacist and invalid timestamp combinations; the composite membership FK and prescription UNIQUE constraint are final backstops. There is no executable dispensing workflow in the app.
- Auditing is transactional: successful table changes create summaries in the same transaction; rolled-back work rolls back its audit rows. Allowed metadata consists only of old/new lifecycle statuses. Audit rows are append-only and clients cannot spoof event inserts. Read-access, failed authentication and lookup-attempt auditing must be added at the appropriate authenticated service boundary later.

These controls do not constitute a legally recognized digital signature or clinical approval.

## Reproduce local verification

From the project root, with Node 22.14+:

```powershell
npm ci
npm run test:db
npm run db:advisors
npm run db:migrations:check
npm run db:types:check
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The database suite performs RLS assertions under `SET LOCAL ROLE authenticated` or `anon`, with transaction-local synthetic UID claims. It asserts the authenticated role has no BYPASSRLS privilege and row security is enabled. Owner SQL is used only for fixture setup, introspection and constraint/concurrency tests; it is not used as evidence that RLS denies a client. There is no Auth/JWT gateway in the standalone harness, so token verification/login/PostgREST behavior must be verified on the intended Supabase stack later.

`npm run db:types` regenerates `src/types/database.ts` from a clean applied migration using the pinned official `@supabase/typegen` generator and PostgreSQL introspection. The test suite compares this output to the checked-in types. This works without Docker or hosted access. Mock UI types remain in `src/types/prescription.ts` and must not be confused with the database lifecycle.

`npm run db:advisors` runs Supabase's CLI security advisor against the same kind of disposable local database. The CLI may print "Connecting to remote database" for its `--db-url` option; the generated URL is always `127.0.0.1`. The temporary database password is passed through the child environment rather than command arguments/logs. These results do not cover hosted Auth/platform configuration.

`npm run db:migrations:check` separately starts a clean test database, applies the versioned SQL through **Supabase CLI `db push`** with an explicit loopback URL and `--skip-vault`, verifies `supabase_migrations.schema_migrations`, and confirms local file/history versions match through `migration list`. It has no linked-project or external-URL input. All seven tables must have RLS after application.

If the full local Supabase services are desired later, install/run Docker and use `node node_modules/supabase/dist/supabase.js start`. This path was not executed in this environment. Local signup is disabled, synthetic test bootstrap is not seeded, and optional Realtime/Storage features are disabled in the prepared config.

## Hosted setup procedure — completed in Phase 3A

1. Identify the existing dedicated clinic Supabase project and confirm its project reference. Do not create another project or reuse a shared unrelated project. Check PostgreSQL major version against config (17) and inspect existing migration history/schema before any application.
2. Authenticate the CLI with `node node_modules/supabase/dist/supabase.js login` and link only the confirmed project. Allow the CLI to request credentials interactively; do not paste secrets into commands, chat, source or logs.
3. Review migration history and the dry run. For a confirmed empty/dedicated target, the operator commands are:

```powershell
node node_modules/supabase/dist/supabase.js link --project-ref YOUR_CONFIRMED_PROJECT_REF
node node_modules/supabase/dist/supabase.js migration list --linked
node node_modules/supabase/dist/supabase.js db push --linked --dry-run --skip-vault
```

After reviewing the **exact target and pending SQL**, the operator may apply with `node node_modules/supabase/dist/supabase.js db push --linked --skip-vault`. This was performed on the confirmed empty Eleyada RX project in Phase 3A. Do not use reset/clean, `--include-all`, migration-history repair or destructive schema replacement to force application to a nonempty database. Resolve naming/history conflicts through reviewed additive migrations.

4. Copy `.env.example` to `.env.local` and set the project's HTTPS API URL and **publishable** key. Do not use a service-role/secret key. No privileged application key is required here. The prepared client factory rejects legacy/secret key formats. Keep `.env.local` out of Git.
5. Confirm hosted RLS, grants, database advisors, disabled public signup and intended API schemas. Phase 3A verified real non-BYPASSRLS SQL roles with rollback-only synthetic identities and the anonymous HTTPS API. Signed-user login/session/API integration is deferred to Phase 3B. The local TOML does not automatically change hosted Auth or Data API settings; hosted signup was explicitly disabled through a reviewed sparse configuration push.

Phase 3B uses the `server-only` client with the publishable key and HttpOnly user cookies, Proxy refresh, verified identity and server role checks. The browser factory remains unused by the app. Public connection variables are required for login/protected requests. The user approved `20261019155321_authentication_access.sql`; it is applied and registered on the same hosted project. Active pharmacists may read only their own active pharmacy; a read-only session check protects server routes against revoked-cookie replay. Clinical table policies and role-assignment restrictions remain unchanged. See [Phase 3B implementation and hosted verification](phase-3b-status.md).

## Future migration discipline

Do not edit this foundation migration after it is applied to a persistent shared target. Create the next file through `supabase migration new <name>`, inspect/test SQL on a disposable database, regenerate types, run negative RLS tests and advisors, inspect the target/dry run, and apply only the reviewed migration. Back up and review any change involving clinical history. Database-owner access is trusted and can always alter/disable database protections; it must never become an application/client credential.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [PostgreSQL constraints](https://www.postgresql.org/docs/17/ddl-constraints.html), [PostgreSQL locking](https://www.postgresql.org/docs/17/explicit-locking.html).
