# Phase 4B — issuance, reference recovery, printing and cancellation

> **Final authority:** [Phase4B final consultant handoff](phase-4b-native-activation-status.md) records COMPLETE within revised bounded synthetic acceptance, current hosted data and explicit limitations. This report and its continuation links below are historical.

> **Current continuation report:** [timeout correction and local recovery acceptance](phase-4b-local-timeout-recovery.md). Earlier test counts and recovery-preparation limits below are historical. No standalone eight-second guarantee follows from function settings; actual local PostgREST deadline evidence and current recovery-tool limits are in the linked package. Overall Phase 4B remains PARTIAL.

> **Later prerequisite review:** see the self-contained [activation package](phase-4b-activation-package.md) for fresh native permission findings, the separate additive correction, current two-migration dry run, recovery blockers and latest local checks. This report's one-migration dry run and earlier counts/tests are historical; they do not establish current hosted activation or recovery. The frozen original hash below is unchanged.

**Status: PARTIAL — local implementation is prepared; hosted activation and end-to-end issuance acceptance are pending separate approval.** This does not declare the application deployed or ready for real prescribing. Phase 5A has not started. Date: 22 October 2026.

Workspace: `D:\my  business\el-eyada-rx`. Hosted target: **Eleyada RX / fckdsiozmufyhbnignet**. Existing source, README, database documentation, four migrations and final Phase 4A acceptance report were inspected. Historical reports were not treated as fresh runtime evidence. No applicable AGENTS instructions were found. Phase 4A contracts/migrations are preserved.

## Prepared change and exact migration

`D:\my  business\el-eyada-rx\supabase\migrations\20261022010926_prescription_issuance.sql`

SHA-256: **`0CA80078C4120FDC056EBCBD7C4F7FC8AF0C0BE819AC9CA72FBECFE6A16049B4`**

**Applied only to disposable local PostgreSQL databases, never hosted.** Fresh linked hosted dry run listed exactly this migration. Four historical migration hashes remain unchanged:

| Migration | SHA-256 |
|---|---|
| `20261019141747_database_foundation.sql` | `8EABE79310C86284EB2890DD02F6E398AE869CEA0E474C108877865498111A71` |
| `20261019155321_authentication_access.sql` | `B7BC5383FAEC688DDA08EECA5F16780230C6418EFDB177A2EF4D8E9C1709189E` |
| `20261021210732_doctor_draft_workflow.sql` | `D0CD71D1F1CA295E9E3C7AD82BF406C596DE2C08BBA250409C40C3455F20C6E0` |
| `20261021215141_doctor_draft_conflict_response.sql` | `62474A94F78CEA62351EAF563A02F2386E0CE1C24323FA82E8EBAC175B3132D7` |

The new migration adds an authenticated invoker review RPC, four narrow lifecycle RPCs owned by a dedicated NOLOGIN/NOBYPASSRLS role, purpose-limited trusted-owner Vault helpers, two private RLS-protected append-only receipt tables and role-specific policies/grants. Ordinary application table grants and digest exclusion remain. The internal role needs `UPDATE(name)` solely to obtain the existing patient row lock; no RPC modifies identity. Application roles cannot SET/inherit it. The migration temporarily grants trusted-owner SET authority for function ownership, then removes that grant. PostgreSQL can retain a non-superuser creator's automatic ADMIN-only membership; local tests verify no inherited/SET authority remains. No broad service-role app client.

Issuance locks the owned header and patient, checks live session/active doctor and exact version plus a DB-generated fingerprint of patient/header/ordered item IDs and contents. It uses 20 CSPRNG bytes (160 bits), strict ASCII Crockford reference format `RX1/K1`, domain-separated HMAC-SHA-256, uniqueness and at most three digest-collision retries. It atomically writes the header, encrypted Vault reference, receipt and minimal audit. Fixed provisional validity is **168 hours** from DB-controlled issuance time, independent of daylight saving. Identical retries recover the original code/times; changed requests return PT409. Issued items/header/patient identity stay protected. Cancellation uses the same parent lock as the existing future-dispensing guard, exact version, eligibility checks, confirmation/category and append-only actor/time/reason receipt. Expiry is enforced by DB timestamp without a status job.

The doctor opens a saved draft review, then confirms issuance separately from unsaved form review. Reveal/reprint uses authenticated same-origin POST with no-store headers. Codes remain transient, outside URLs/logs/analytics/browser storage and retained test artifacts. Reprint fetches current status and the same reference/time; cancelled/expired copies are marked. Direct/manual printing before reveal is blocked by print CSS. Each copy includes last DB verification time and pilot/legal limitations; existing branding/account email only. No invented professional credentials, signature or stamp.

## Files changed

Paths below are relative to the fixed workspace above; no source/configuration/secret changes were made outside this checkout.

- Database/operator: `supabase/migrations/20261022010926_prescription_issuance.sql`; `supabase/operations/provision_lookup_key_v1.sql` (prepared, **not executed**; SHA-256 `D6D0F5F9419E899FD1322C4BC281B4BD45AC84D39C34F6A1F11F1B886258236E`); generated `src/types/database.ts`.
- Server/data: `src/lib/issuance/data.ts`, `src/lib/issuance/validation.ts`; `src/lib/drafts/data.ts`, `src/lib/drafts/validation.ts` (explicit permitted issuance/expiry projections/types); `src/app/api/doctor/prescriptions/[id]/lifecycle/route.ts`; `src/proxy.ts` (new API's refresh/private headers).
- Doctor UI: `src/app/doctor/prescriptions/[id]/issue/page.tsx`, `src/app/doctor/prescriptions/[id]/page.tsx`, `src/app/doctor/page.tsx`; `src/components/doctor/issue-confirmation.tsx`, `src/components/doctor/issued-document.tsx`; `src/components/ui.tsx`, `src/components/app-shell.tsx`, `src/app/globals.css`.
- Recovery tooling: `scripts/vault-recovery.mjs` (prepared operator-only encrypted root escrow/export/import; no real root/API execution).
- SQL verification: `tests/database/issuance.test.mjs`, `tests/database/issuance-owner.test.mjs`, `tests/database/vault-adapter.sql`, `tests/database/local-postgres.mjs`, `tests/database/foundation.test.mjs`, `tests/database/hosted-phase4b-inspection.sql`.
- Validation/browser: `tests/issuance-validation.test.mjs`, `tests/issuance-boundaries.spec.ts`, `tests/ui/entry.tsx`, `tests/ui/router-shim.ts`, `tests/ui/ts-loader.cjs`, `tests/ui/issuance-ui.mjs`; commands in `package.json`.
- Documentation: `README.md`, `docs/database.md`, `docs/phase-4b-activation.md`, this report. Historical phase reports untouched. No dependency changes, env changes, existing migration edits, account/pharmacy changes, deployment or Git push.

## Checks actually run

| Check | Actual result / evidence boundary |
|---|---|
| `npm run typecheck` | Passed, final source; route generation and TypeScript. |
| `npm run lint` | Passed, zero warnings. |
| `npm run build` | Passed after the origin fix; production routes include review and lifecycle POST. |
| `npm run test:db` | **52/52 passed**, final expanded suite in 64.8 seconds, including late cancellation-audit rollback and all-RPC revoked/inactive-doctor checks. Disposable native PostgreSQL 17.10, real transactions/RLS/concurrent connections; fictional SQL Auth contexts and a local pgcrypto Vault adapter. **Not native hosted Vault/Auth/PostgREST acceptance.** |
| `npm run test:draft-validation` | **4/4 passed**, unchanged strict draft contracts. Node's experimental strip-types/module-format notices are non-failing. |
| `npm run test:issuance-validation` | **4/4 passed**: exact payload/confirmation/category/origin checks, forgery rejection, encrypted root escrow round-trip/randomness/tamper/wrong-passphrase rejection. Real root export/import not run. |
| `npm run test:issuance-ui` | **24 checks passed** in Chromium using actual components and final built CSS, controlled HTTP/router fixtures. Includes frozen retry payload/version after prop refresh, synchronous duplicate click suppression, hidden/default and fresh reveal/print behavior, cancelled/expired warnings, order/count, no browser storage/URL reference, 320/768/1440 px overflow, cancellation confirmation/retry/category pinning. **UI evidence only**, not persistence/Auth acceptance; no PDF/physical print produced. |
| `node scripts/run-auth-tests.mjs --grep-invert 'inactive pharmacist and inactive pharmacy\|persisted draft:'` | **23/23 passed in 1.6 minutes**, final production source, real hosted Auth and ordinary user clients; one worker/no retries/no selected skips. Hosted clinical writes disabled. |
| `npm run db:advisors` | Passed, no security findings; explicitly targeted disposable loopback database, despite generic CLI wording “remote database”. |
| `npm run db:migrations:check` | Passed; actual CLI push/history verification for all five migrations on a new disposable loopback DB, not hosted. |
| Generated types | Regenerated through `npm run db:types`; SQL suite verifies exact introspection match. |
| Hosted read-only inspection / `db push --linked --dry-run` | Confirmed four-entry history, installed extensions/permissions/aggregate counts; exactly one proposed migration; no apply. |
| Private exposure scan | Passed after the report was written: 112 source/doc/artifact/frontend files plus public-only `.env.local` contained no supplied passwords or privileged keys. Credentials entered only through non-echo stdin/process memory. |

Real Auth/browser/API coverage: both role logins, incorrect login, malformed cookie rejection, token refresh/rotation, cookie flags, logout/Back/old-cookie replay, denied clinical/membership access, draft malformed action denial, real empty counts/filters, unsaved form and print warning, patient-search empty state, RTL/logo/overflow, isolated pharmacy fixtures. New API cases verify anonymous/pharmacist denial, doctor malformed/forged/cross-origin input rejection, GET405, no-store headers, missing hosted activation failing clearly, review page without an actionable issue button when unavailable, and globally revoked doctor-cookie rejection. These **do not** prove successful hosted issuance/recovery/cancellation or RPC HTTP409 behavior after activation.

Local SQL coverage: unchanged foundation/drafts, closed grants/role attributes and non-superuser migration ownership; every RPC denies anonymous/pharmacist/inactive/unassigned/revoked/inactive-doctor contexts; direct lifecycle/digest/Vault/receipt forgery denied; complete two-item issuance and unchanged item values/order; exact 168-hour duration; original recovery on another connection/retry; changed-payload conflicts; raw patient/item/order/header review changes; missing key/corrupt artifact/late Vault/receipt/audit failure rollback; bounded collisions; cancellation categories/eligibility/retries; immutability and safe audits; no-job expiry; competing issue/edit/delete; cancellation/dispensing races in both orders. A blocked call returned database lock timeout within five seconds and active issuance execution was zero afterward. Dispensing race fixtures were trusted local SQL only; no dispensing service was added.

### Failures found and resolved

- Initial SQL regressions: generated-type drift and the historical helper allowlist needed updating. New SQL suite initially exposed missing invoker schema permission for non-secret fingerprint hashing; corrected and rerun.
- Migration-owner fixture initially tried to demote/reassign PostgreSQL's protected bootstrap superuser; replaced with an actual separate non-superuser owner. Test also distinguishes residual creator ADMIN-only membership from SET/inherited authority.
- Isolated browser harness needed a browser environment definition and an unambiguous warning selector. The CommonJS-only test loader needed a narrowly justified lint exemption. Final component suite/lint pass.
- First real browser suite stopped at **19 passed / 1 failed / 3 not run**: API rejected a valid original origin because Next's internal URL used a different hostname. Fixed comparison to original Host/protocol, added negative origin tests, rebuilt and reran: **23/23 pass**. Malformed-cookie tests emit expected SDK warnings without cookie contents. No unresolved runtime failure from this selected suite.
- A read-only CLI invocation initially omitted required `--linked` with `--project-ref`; it failed before querying, then reran correctly. No migration was applied as a workaround.

## Hosted state and synthetic records

Fresh read-only inspection after browser regressions: **patients 1; prescriptions 0; items 0; dispensations 0; audit_events 122; active clinical RPC calls 0**. The existing retained synthetic patient/audits remain. **This phase created/deleted zero hosted clinical records and zero Vault secrets.** Auth testing created/revoked ordinary sessions only. All local synthetic rows, ephemeral keys and isolated test databases were removed by their harnesses; no local clinical exports or issued references retained.

Hosted state: four prior migrations only; zero Phase 4B functions and zero lifecycle role. All seven public tables retain RLS; anon/authenticated cannot read decrypted Vault secrets or reference digests. Platform service_role retains its pre-existing Vault privileges; the application neither configures nor broadens them. Installed native Vault **0.3.1** / pgcrypto **1.3**. Hosted postgres is non-superuser/CREATEROLE/BYPASSRLS; the non-superuser owner path was locally tested. Native provider behavior still needs activation acceptance. Temporary test server stopped; no project restart/backend termination/reset/reseed/history repair was performed.

## Acceptance assessment and remaining gates

| Criterion | Assessment |
|---|---|
| Saved-only review/confirmation, exact version/fingerprint and raw mutation detection | Implemented; SQL and isolated UI verified. Successful hosted review/issue flow pending. |
| CSPRNG/HMAC/normalization/collision handling | Implemented; local SQL verified. Hosted generated reference/digest acceptance pending. |
| Protected recoverable reference and same-code/time retry/reprint | Implemented; local SQL/crypto/component verified. Native Vault integration, root escrow/API access and isolated restore drill pending. |
| Live doctor/ownership/RLS/restricted grants; no direct lifecycle/digest/secret authority | SQL verified; real API role/revocation/input denial verified. Direct hosted lifecycle RPC success/conflict/denial after migration remains pending. |
| Atomicity, retries, concurrency, history/patient immutability | Real local SQL transactions/locks/rollback verified; no destructive hosted failures attempted. Hosted safe duplicate/concurrent checks pending. |
| Cancellation/expiry, future dispensing race contract | Implemented and SQL verified; hosted cancellation/history/natural expiry acceptance pending. No pharmacy implementation. |
| No-store POST, transient reveal, state-marked printing/RTL | New real API error/denial headers and component print media/interactions verified. Successful issued copy over real Auth, PDF pagination/physical print/professional details pending. |
| Existing auth/draft/pharmacy isolation regressions | Selected real browser/API checks and unchanged SQL draft lifecycle pass. Hosted persisted create/edit/delete was intentionally not rerun without new write approval. While-issued pharmacy denial verified locally; same case hosted pending fixture approval. |
| Inactive/unassigned browser identities | **Still untested**; SQL denies them. No unauthorized account provisioning/deactivation used to close this inherited gap. |

No new app runtime secrets. Required Vault name: **`al_eyada_rx.lookup.v1`**; per-reference encrypted names **`al_eyada_rx.reference.<UUID>`**; root key stays outside DB/app. Operator SQL/tooling and the [activation runbook](phase-4b-activation.md) specify provisioning, offline encrypted custody, backup contents, restore sequencing, failures, version retention and future additive rotation. None of those real secret operations has run. Root portability's documented API is experimental; successful custodian export and isolated restore/decrypt drill are activation gates. Loss of root or old HMAC key can prevent recovery; do not replace an existing reference.

Separate owner gates: provisional seven-day/168-hour policy needs clinical/legal approval; verified professional name/license/clinic contact details and paper authentication are missing; application approval is not legally recognized digital signing. Backup custodians/retention/RPO/RTO, actual printer/PDF acceptance and data-use approval remain. Paper-first only, no delivery integrations.

Recommended next step: consultant review of the exact migration/source/runbook, then **separate explicit approval** for hosted application, key provisioning/escrow and a bounded synthetic acceptance set. Proposed set: reuse retained synthetic patient; issue two two-item drafts (one retained issued for recovery and natural expiry, one cancelled); at most one extra unissued draft for stale-review/edit/delete then delete it. Issued/cancelled headers/items, Vault artifacts/receipts, cancellation receipt and audits must remain by immutable history. No real dispensing, account changes or hosted time manipulation. Do not request removal of these histories after acceptance.

## Copyable consultant handoff

```text
Phase 4B: PARTIAL. Local issuance/recovery/print/cancellation implementation prepared.
Hosted target Eleyada RX / fckdsiozmufyhbnignet unchanged; no 4B apply/keys/clinical writes.
Proposed migration: 20261022010926_prescription_issuance.sql
SHA256: 0CA80078C4120FDC056EBCBD7C4F7FC8AF0C0BE819AC9CA72FBECFE6A16049B4
Fresh hosted dry run lists exactly this one additive migration; prior four hashes unchanged.
Local SQL: 52/52 pass, including late issuance/cancellation rollback and lock/race tests.
Draft validator 4/4; issuance/security/escrow validator 4/4; actual-component UI 24 checks.
Final-source production build/typecheck/lint pass; 23/23 real Auth/browser/API non-writing checks pass.
Local advisors/types/CLI migration history pass. UI fixtures and Vault adapter are explicitly separate
from native hosted issuance acceptance. Initial origin-rejection defect fixed and full suite rerun.
Hosted: patients 1, prescriptions/items/dispensations 0, audits 122; active clinical RPC calls 0.
Hosted records created/deleted this phase: 0. Existing patient/audits retained. No secrets provisioned.
Pending: exact hosted migration approval, key/custodian/root escrow and restore drill, successful
hosted review/issue/relogin/recovery/print/cancel/retry/conflict acceptance; real printer/professional
details; inherited inactive/unassigned browser gap. Seven days is provisional software policy only.
Proposed separately approved hosted fixtures: 2 permanently retained issued histories (1 cancelled),
optional 1 deletable unissued draft; same retained patient, no real dispensing/account changes.
Review docs/phase-4b-activation.md and source. No deployment/push/paid/reset/reseed/account changes.
Stop for consultant review. Phase 5A has not started.
```
