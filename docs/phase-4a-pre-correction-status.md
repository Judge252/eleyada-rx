# Historical Phase 4A pre-correction checkpoint — superseded

Historical checkpoint before corrective-migration approval/application. Its pending-approval statements and failed attempts describe that earlier state. See [current correction and final-source acceptance evidence](phase-4a-status.md). The earlier failures below are retained for review; they are not the current result.

## Hosted application and security evidence

Before application, CLI inventory confirmed the exact linked target. Hosted history contained only `20261019141747` and `20261019155321`. A fresh dry run listed **exactly** `20261021210732_doctor_draft_workflow.sql`, with the approved SHA-256:

`D0CD71D1F1CA295E9E3C7AD82BF406C596DE2C08BBA250409C40C3455F20C6E0`

That file was applied successfully and remains byte-identical. Hosted history now contains exactly those **three** migrations. Both earlier migrations are unchanged. No history repair, reset, reseed or schema replacement occurred.

Hosted inspection verified both draft RPCs are **SECURITY INVOKER**, `search_path=''`, authenticated-only execution; no PUBLIC/anon/service-role execution. They check live session, active doctor membership and `auth.uid()` ownership. All seven tables retain RLS; policy count is 15. Anon/authenticated remain non-superuser/non-BYPASSRLS. New request/order column grants exist; status/doctor-identity UPDATE privileges remain absent. `reference_digest` SELECT is denied to anon, authenticated and service_role. User-scoped application clients and existing authentication remain intact.

## Blocking defect and corrective migration for review

The approved functions raise SQLSTATE **40001** for three application conflicts. Hosted stale browser requests remained pending. A direct ordinary-doctor API probe reproduced the hang independently of the UI. [Supabase's official troubleshooting guidance](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) documents PostgREST 14 retry loops for custom 40001 exceptions and recommends standard exceptions or `PT409`. The exact hosted PostgREST version was not independently established; observed behavior matches the documented defect.

Deleting only the affected synthetic draft through an ordinary doctor RPC ended the final stale probe with `42501` (record unavailable). This is cleanup evidence, **not** a passing conflict test. Final inspection found **zero active draft calls**. No backend termination or project restart occurred. The current hosted functions can still cause repeated rollbacks/load on future conflicts; avoid further hosted conflict tests/use until corrected.

**Prepared, not applied hosted:** `supabase/migrations/20261021215141_doctor_draft_conflict_response.sql`.

SHA-256: **`62474A94F78CEA62351EAF563A02F2386E0CE1C24323FA82E8EBAC175B3132D7`**.

Exact purpose: `CREATE OR REPLACE` the same two functions, changing **only three application conflict codes from `40001` to `PT409` (HTTP 409)**. Everything else in their definitions is preserved: signatures, invoker execution, fixed search paths, live-session/active-doctor/ownership checks, input validation, atomicity, locking, patient-identity protection and explicit restricted privileges. No table, policy, Auth, account or secret change. A local regression compares the complete replacement SQL against the approved definitions with only these expected substitutions.

The correction was applied **only to disposable loopback PostgreSQL**. A fresh hosted **dry run only** listed exactly this correction. It has **not** been approved/applied to Eleyada RX. The already applied migration was not rewritten.

## Implemented behavior and changed files

Doctor-only reads/actions, strict validation, real dashboard/counts/filters, new/existing patient selection, ordered medications, atomic draft save/edit/delete, review/unsaved states and unissued print warnings remain implemented. No reference generation, issuance or real pharmacy workflow. Selecting a patient never silently edits identity; deleting a draft retains patient/audit history. The Arabic RTL/navy/green branding remains intact. Full original file inventory: [historical implementation review](phase-4a-implementation-review.md).

Main implementation paths: `src/lib/drafts/{actions,data,validation}.ts`, `src/components/doctor/{prescription-form,prescription-table,draft-document,delete-draft,print-button}.tsx`, doctor dashboard/new/detail/edit/loading/error routes, and `src/types/database.ts`.

Activation changes:

- `src/components/doctor/prescription-form.tsx`: pin original editor request token/version across action response renders. `src/app/doctor/prescriptions/[id]/edit/page.tsx`: stable record key. These preserve the original conflict precondition and unsaved state until explicit reload/navigation.
- `src/components/doctor/delete-draft.tsx`, detail page: retain the displayed delete version, with stable record key. A rejected delete must not silently adopt a newer version for retry.
- `src/lib/drafts/actions.ts`: recognize `PT409` as well as current `40001` conflicts. Authorization remains at every mutation boundary. Temporary diagnostics were removed.
- `tests/draft-workflow.spec.ts`: real lifecycle test and cumulative metadata-only ledger. `tests/draft-hosted-acceptance.spec.ts`: lost-response/replay, values/order, stale browser/API, live-draft pharmacy and revoked-session acceptance. It now requires both explicit write approval and a separate confirmed-correction gate.
- `tests/doctor-interface.spec.ts`: compare retained-patient count to ordinary API data; unique nonmatching patient-search test. `tests/database/drafts.test.mjs`: PT409 assertions and exact correction-contract regression.
- `tests/database/hosted-phase4a-inspection.sql`: read-only metadata/count inspection.
- `scripts/{run-auth-tests,hosted-connection,verify-hosted-draft-failures}.mjs`: correction gate, anonymous RPC denial and real-user negative RPC checks.
- README/database/current report updated; prior implementation report preserved as historical. New additive corrective migration above. No dependency/version or environment-secret changes.

The existing edit DTO projection fix is present in `src/lib/drafts/validation.ts`: database-only item ordering metadata is removed before strict input validation. It was included in the build used for the successful normal browser edit.

## Tests actually executed

| Check | Actual result and boundary |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` | **Passed** final application source, including edit projection, stable version/request state and PT409 error mapping. No deployment. |
| `npm run test:draft-validation` | **4/4 passed**, shared actual validator: count/quantity/length/identifier bounds, precise timestamps and edit projection. |
| `npm run test:db` before correction | **35/35 passed**, actual local PostgreSQL with original three migrations. Did not cover hosted PostgREST retry behavior. |
| `npm run test:db` after correction | **36/36 passed**, fresh local PostgreSQL 17.10 with four migrations, including correction equivalence, conflicts/retries, rollback and historical protections. |
| `npm run db:advisors` | Passed, no findings against fresh **local** DB including correction; not a hosted/platform advisor result. |
| `npm run db:migrations:check` | Passed: actual CLI application/history of **four** migrations on isolated loopback DB only. |
| `node scripts/run-auth-tests.mjs --grep-invert 'inactive pharmacist and inactive pharmacy\|persisted draft:'` | **20/20 passed twice** after hosted activation, including final-source rerun (1.4 minutes). Real hosted Auth/API through local production app, no clinical writes. |
| `node scripts/run-auth-tests.mjs tests/draft-workflow.spec.ts` with approved private opt-in | **1/1 passed (47 seconds)**: UI create new synthetic patient/two medications/double click → reload → sign out/in → search/reopen → edit quantity → reload → UI delete → missing detail. Predates later version-state hardening; includes edit-projection fix. |
| `tests/draft-hosted-acceptance.spec.ts` | **Seven compound attempts failed; never passed.** Before conflict: existing-patient selection/create, complete medication values/order, lost-response UI retry and simultaneous identical API replays succeeded. Browser stale calls hung. Final direct stale API probe hung too. Later stale-delete/live-draft pharmacy/session assertions were not reached. |
| `node scripts/verify-hosted-auth.mjs` | Passed both real logins, verified identities/memberships/own pharmacy/live session; role/membership writes and audit/digest reads denied; pharmacist clinical access denied. Only denied updates attempted; no deactivation. |
| `node --env-file=.env.local --experimental-strip-types scripts/hosted-connection.mjs` | Passed correct target/key, signup disabled, seven anonymous table reads denied, private schema unexposed and anonymous execution of both draft RPCs denied. |
| `node scripts/verify-hosted-draft-failures.mjs` | Passed hosted quantity-zero `22023` and unavailable selected patient `42501`; patient/header/item counts unchanged. Real pharmacist cannot read retained synthetic patient or call save/delete (`42501`). |
| Hosted read-only CLI SQL | Three applied migrations; invoker/grants/RLS/digest checks passed; counts below; zero active draft calls. |
| Private credential exposure scan | Passed: 91 source/documentation/artifact/frontend files plus `.env.local`, without printing supplied passwords or privileged keys. |

**SQL evidence:** actual non-BYPASSRLS roles and transactions, not mocked DB responses. Cases include anonymous/pharmacist/inactive/unassigned and revoked-session denial; issued/cancelled/expired header/item and linked-patient immutability; concurrent retry serialization; bounds/allowlists; missing patient; a forced late item trigger failure rolling back patient/header/items/audits and restoring pre-edit state. These are local SQL results, not hosted HTTP/browser certification. Local PT409 success does not establish the hosted correction works until it is approved/applied and tested there.

**Browser evidence:** the 20 regressions cover anonymous nested routes/direct actions, both real-role logins/cross-role denial, wrong password, malformed cookies, actual refresh-token rotation, secure HttpOnly cookies, global logout/Back/old-cookie replay, role-write denial, dashboard/form/filter/print states, RTL/logo/overflow at 320/768/1440 px, mock doctor-ID rejection and isolated fixture lookup/full-dispensing simulation. No traces/screenshots/video/auth storage files/DOM failure snapshots. SDK malformed-cookie warnings contain no token values.

**Failed checks disclosed:** the first compound run had an ambiguous alert selector (fixed); two runs timed out awaiting conflict feedback; one diagnostic attempt failed reading a response after navigation; two further browser runs still hung; the final direct RPC probe hung, then cleanup encountered the already separately deleted test draft. A new test tuple typing error was corrected before final passing checks. The initial UI-reset diagnosis was provisional; direct RPC evidence later identified the gateway retry loop. The implemented version-state hardening is **not yet browser-verified on a returning conflict response**.

## Synthetic records and cleanup

Exactly **one synthetic patient retained**: `a02a3704-67cc-489d-b8f2-9f23a15d0570`.

Exactly **eight synthetic drafts** created across the successful lifecycle and compound investigations; **all deleted with cascading items**:

```text
dee9269c-1919-42e5-af8c-236049bff534
5a3f7003-86a0-4c07-9f60-3007713f500a
09ad5fa5-3179-4e02-899a-c571e32315a4
9dd83928-4eda-422d-942c-a32938033644
5e9c900d-50be-4592-bea2-21a52804a5de
f7718c84-cffb-415d-b9c3-9d30e7a7818b
130f49f7-82bd-45df-8316-44cdfc30ea8d
58d7dc4d-c6a3-464a-ac32-d3ba3b06a431
```

Final hosted counts: **patients 1; prescriptions 0; items 0; dispensations 0; audits 94** (10 before testing, **84 new**). Patient/audit history retained. Failed calls/replays produced no extra patients or surviving partial drafts/items. Ignored metadata-only ledger: `.local/phase4a-acceptance-records.json`. No clinical contents or credentials in the ledger/report. Cleanup used ordinary doctor authority, scoped to these IDs; no patient/audit or unrelated record was deleted.

## Remaining gaps and next action

**Required:** consultant review and separate approval of `20261021215141_doctor_draft_conflict_response.sql` at the exact hash above. Then recheck target/hash/history/fresh exact-one dry run, apply only that correction, and finish final-source lifecycle plus compound hosted HTTP/browser acceptance. Verify prompt PT409/HTTP409 for changed-payload retries and stale edits/deletes, repeated stale clicks preserving unsaved state, live-draft pharmacist/simulation isolation, revoked-session RPC denial and metadata-only cleanup/counts. The correction is local-only; acceptance criteria are **not fully met**.

Forced late database failure and issued/terminal-history immutability were tested locally only; no hosted issuance/failure trigger/destructive historical test. Real inactive/unassigned browser mutations remain pending because they require account/state changes outside this approval; SQL denial passes. Full local Supabase/PostgREST services were not run. The historical hosted leaked-password-protection warning was not remediated or freshly certified; no paid-plan change.

Passwords entered via transient private stdin/process memory only; never source, reports or env files. No new secret, privileged application key, signup, permission weakening, account/pharmacy provisioning/deactivation, backend termination, project restart, deployment, Git push or Phase 4B work. No Git metadata in this checkout, so no commit checkpoint claimed. Stop for consultant review.

## Copyable consultant handoff

```text
Phase 4A activation/acceptance: PARTIAL. Hosted conflict acceptance fails.
Project Eleyada RX / fckdsiozmufyhbnignet. Approved migration
20261021210732_doctor_draft_workflow.sql applied unchanged after exact target/hash/history/dry-run checks.
SHA256 D0CD71D1F1CA295E9E3C7AD82BF406C596DE2C08BBA250409C40C3455F20C6E0.
Invoker/search paths/grants/all-seven RLS/digest exclusions verified. Normal real browser lifecycle
create(2 meds)→reload→signout/in→reopen→edit→reload→delete passed. Existing-patient saving,
values/order, lost-response retry and identical API replays worked before conflict failures.
Seven compound attempts failed: custom 40001 conflicts hang through documented PostgREST retries.
Prepared correction 20261021215141_doctor_draft_conflict_response.sql changes only three
application conflicts to PT409/HTTP409, preserving authorization/atomicity/locking/grants.
SHA256 62474A94F78CEA62351EAF563A02F2386E0CE1C24323FA82E8EBAC175B3132D7.
Correction LOCAL ONLY, not applied hosted; separate approval required. Local 36 SQL + 4 validators
pass; typecheck/lint/build/local advisors/migration harness pass. Final 20 real Auth/RTL/pharmacy
regressions pass. Hosted anonymous/pharmacist/invalid-RPC and auth/API checks pass.
Pending: returning stale browser/API conflicts, stale delete, live-draft pharmacy isolation and
final corrected lifecycle. Inactive/unassigned browser tests not authorized; local SQL denial passes.
One synthetic patient retained; eight test drafts/all items deleted; audits retained (94 total/84 new).
Final hosted patients1/prescriptions0/items0/dispensations0; zero active draft calls.
No unrelated records/accounts/secrets/permissions changed; no reset/reseed/history rewrite/deploy/push.
Acceptance NOT complete. Review/approve correction separately, then finish Phase 4A acceptance only.
Phase 4B NOT STARTED. Stop for consultant review.
```
