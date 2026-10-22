# Phase 3A — hosted foundation verified

Completed on 19 October 2026. The configured project is **Eleyada RX**, reference `fckdsiozmufyhbnignet`, URL `https://fckdsiozmufyhbnignet.supabase.co`, region `eu-west-1`, PostgreSQL 17.11. The authenticated CLI independently confirmed its name, reference, healthy status and database host. No other project was modified.

## Applied configuration

- `.env.local` contains only the correct public URL and modern publishable key. Existing `.env*` ignore rules exclude it; `.env.example` remains explicitly allowed. No privileged application key or database password was configured. CLI authorization remains in the CLI's credential storage, outside application configuration.
- Linked this checkout to the exact reference. CLI 2.121.0 commands used explicit `--agent no` and the exact `--project-ref`; the separate MCP account does not have access to this project and was not used for database operations.
- Privileged read-only preflight found no public/private application relations, functions or types, no custom schemas, no migration history and zero Auth users. The dry run listed only the existing foundation migration.
- Applied **the unchanged** `supabase/migrations/20261019141747_database_foundation.sql` using `db push --linked --project-ref fckdsiozmufyhbnignet --skip-vault`. No reset, seed, history repair or schema replacement was used. SHA-256: `8EABE79310C86284EB2890DD02F6E398AE869CEA0E474C108877865498111A71`.
- Both local and hosted migration history show version `20261019141747`, name `database_foundation`. A subsequent dry run reports no pending migrations.
- Disabled hosted public signup, which was enabled by the new project's defaults. A sparse, ignored configuration containing only `[auth] enable_signup = false` was reviewed with `config diff` and pushed to the exact project. The CLI confirmed that undeclared remote properties were left unchanged. The public Auth settings endpoint independently confirms `disable_signup: true`.
- Browser/server factories remain separate and user-scoped. The existing shared configuration validates the URL/key and rejects privileged key formats. All 25 existing source files, including the UI, client factories and generated database types, remain byte-identical. Mock routes still make no live prescription or authentication requests.

## Hosted results

| Check | Result |
| --- | --- |
| Seven tables | All present: pharmacies, app_users, patients, prescriptions, prescription_items, dispensations, audit_events |
| Structure | 39 constraints including 9 foreign keys; 20 indexes; 14 policies; RLS enabled on all seven tables |
| Migration history | Correct local/remote version and name; no pending migrations |
| Hosted role verification | **53 assertions passed** using the real `anon` and non-BYPASSRLS `authenticated` database roles with transaction-local synthetic claims |
| Access control | Anonymous reads/writes denied; pharmacist, inactive and unassigned identities cannot read clinical rows or insert patients; editable metadata claiming doctor gives no authority |
| Doctor/privilege boundaries | Assigned doctor can read/create a synthetic patient; issued header/item edits affect zero rows; provisioning, role changes, membership changes, digest reads, direct issuance, audit access/forgery and dispensing writes denied |
| Trusted SQL invariants | Issued header/item/patient identity protected; FK/membership/single-doctor constraints enforced; duplicate dispensing rejected with `23505`; audit/dispensation history append-only |
| Cleanup | A separate hosted query confirmed **zero Auth users and zero rows in all seven application tables** after testing |
| Public connection | Existing config function and Supabase SDK accepted the configured publishable key; Auth settings HTTP 200 |
| Real Data API | Anonymous reads of all seven tables return `42501` with no data; private-schema RPC attempt returns `PGRST106` |
| Security advisor | Zero warning/error findings; one expected INFO `rls_enabled_no_policy` for audit_events, which deliberately denies client access |

`tests/database/hosted-security.sql` creates only SQL fixtures inside an exception subtransaction. Its sentinel always rolls back the complete fixture block, including generated audit records. It creates no passwords, emails, sessions or usable Auth accounts. RLS statements run after `SET LOCAL ROLE anon/authenticated`; owner access is used separately for fixture setup, invariant checks and cleanup inspection. No service-role access is used as evidence of RLS.

These tests verify hosted PostgreSQL authorization and the anonymous HTTPS Data API. Signed-user login, cookie refresh and authenticated browser-to-PostgREST flows are intentionally deferred to Phase 3B. The concurrent two-connection dispensing race is verified by the existing **local** suite; hosted verification checks the same unique constraint sequentially.

## Local results with hosted environment configured

- `npm run typecheck`: passed.
- `npm run lint`: passed, zero warnings.
- `npm run build`: passed with `.env.local` loaded; all five UI routes preserved.
- `npm run test:db`: **22/22 passed**, zero failures/skips, disposable local PostgreSQL 17.10. These tests do not use the hosted database.
- `npm run test:e2e`: **13/13 passed** against the production build, including Arabic RTL and 320/768/1440 px layouts.
- The new rollback-only hosted SQL verification was first exercised on a disposable local database, then on the exact hosted project.

## Reproduce the hosted checks

The first command is read-only and requires the ignored `.env.local`. The second requires authorized CLI access and is intended for this empty Phase 3A foundation; all its synthetic rows roll back even if an assertion fails. Never run `tests/database/bootstrap.sql` remotely.

```powershell
node --env-file=.env.local --experimental-strip-types scripts/hosted-connection.mjs
node node_modules/supabase/dist/supabase.js db query --linked --project-ref fckdsiozmufyhbnignet --file tests/database/hosted-security.sql --agent no --output-format text
node node_modules/supabase/dist/supabase.js migration list --linked --project-ref fckdsiozmufyhbnignet --agent no --output-format text
node node_modules/supabase/dist/supabase.js db advisors --linked --project-ref fckdsiozmufyhbnignet --type security --level info --fail-on warn --agent no --output-format json
```

Node 22.14 emits informational experimental/module warnings for importing the existing TypeScript config into the standalone connection probe; the application build and ESLint pass. No package-wide module-mode change was made.

## Review boundary

No environment values or manual actions are missing for Phase 3A. The database foundation is ready for the separately reviewed **Phase 3B — Real Authentication**. No real accounts, real patient data, authentication implementation, live prescription operations, public lookup, deployment or Git push were added. No Phase 3B work was started. This remains a mock application, not a clinically ready prescribing system.
