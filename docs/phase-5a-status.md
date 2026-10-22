# Phase 5A — pharmacy lookup and full dispensing

**Historical local activation package. Hosted activation and approved acceptance are now COMPLETE; see [final native handoff](phase-5a-native-status.md). The original evidence and approval request below are retained as their historical checkpoint.**

22 October 2026. **PARTIAL: local implementation and verification pass; hosted SQL activation and real hosted Auth/browser acceptance require approval.** Target: Eleyada RX / `fckdsiozmufyhbnignet`. Phase 5B/deployment has not started. Backup/disaster recovery remains explicitly excluded, an accepted limitation rather than an activation prerequisite.

## Implemented behavior

The real pharmacy page no longer imports simulation data or returns fixture success. It sends same-origin authenticated POST requests with private no-store responses. Missing hosted RPCs produce an unavailable state. The page shows the assigned pharmacy, minimal patient verification fields and ordered read-only medication values. Cancelled, expired and completed results omit patient/medication details. Identity verification and explicit full-dispensing confirmation are both required. No partial dispensing or medication editing exists.

References are ephemeral input, cleared before lookup and on page hiding/navigation; no query string, storage, analytics, console or test artifact receives them. Responses do not echo references or digests. Retrying an uncertain submission preserves the original request UUID, prescription and confirmation token. Explicit new lookup starts a new review. Doctor list/statistics/document views show database dispensing separately from the issued/cancelled/expired lifecycle.

Both RPCs independently check current Auth session, active pharmacist membership and assigned active pharmacy. A random, immutable ten-minute lookup capability binds actor, pharmacy, session, prescription and exact version. An unfinished confirmation cannot cross sessions or prescriptions. An already-completed identical receipt can replay after fresh login, but still requires current authorization. Changed requests return PT409/HTTP409. Dispensing takes the existing prescription-parent lock, then rechecks authorization, expiry, version and state using fresh database time. It inserts one completion, confirmation receipt and existing transactional audit together. Contents and historical identity stay immutable; no prescription lifecycle value is repurposed as a dispensing flag.

Persistent fixed-window limits, shared across instances, are:

| Operation      | Actor/minute | Actor/hour | Pharmacy/minute | Pharmacy/hour |
| -------------- | -----------: | ---------: | --------------: | ------------: |
| Lookup         |           10 |        100 |              30 |           300 |
| Dispense/retry |           20 |        200 |              60 |           600 |

Handled invalid/missing references and confirmation conflicts consume committed budgets. Clinical mutations run inside a rollback subtransaction. RPC failures on these handled paths use a standard code envelope plus `response.status`; the Next route also rejects error envelopes explicitly. Raw SQL callers must inspect the envelope; they do not receive an exception on handled PT409 paths. Unexpected SQL errors abort the entire transaction. Nonempty PostgREST `Prefer` headers are rejected, including `tx=rollback`, so a client cannot obtain lookup data while rolling back its rate counter. See [PostgREST transactions](https://docs.postgrest.org/en/v14/references/transactions.html) for transaction and response-status behavior.

## Exact migration and permissions for approval

Only new migration: `supabase/migrations/20261022173000_pharmacy_full_dispensing.sql`.

```text
SHA256 9399DBD031A0B8BDA5D9E3656A6B5AB8FF7EC1DB99AF05DB57EF47F276A52F64
```

Previous six migrations are preserved; their known hashes remain unchanged. This migration is applied only to disposable local databases so far.

- Creates `rx_pharmacy_executor`: NOLOGIN, NOINHERIT, NOBYPASSRLS, no superuser/role/database/replication authority. Neither authenticated, anon nor service_role can assume it. Two public SECURITY DEFINER RPCs are owned by this role and executable only by authenticated users. Every RPC checks application authorization; authenticated EXECUTE alone does not authorize a doctor.
- Adds three private RLS tables: rate buckets, immutable lookup capabilities and immutable dispensing receipts. No application role receives direct table access.
- Grants the executor scoped clinical SELECT, only six prescription columns (excluding reference digest), minimal patient/identity columns, completion INSERT and `UPDATE(status)` solely for `FOR UPDATE`. RPCs never update prescription status. New RLS policies apply to this executor only and require a valid capability/current identity; ordinary pharmacist clinical SELECT/INSERT permissions remain unchanged.
- Trusted-owner private helpers expose only current identity/session authorization, exact HMAC resolution and capability predicates to this executor. The executor receives no Auth/Vault schema access, lookup key access, digest SELECT, generic secret helper, service role or public schema CREATE privilege.
- All added functions have fixed empty search paths. Public RPC metadata retains UTC, 3-second lock timeout and 8-second statement timeout. Function metadata alone is not proof of an outer deadline: local real PostgREST hoisting is verified; verify the native new RPC configuration after activation. The 10-second application abort/12-second browser abort are client bounds, not evidence that SQL stopped.
- Temporary creator SET membership/schema CREATE used for ownership transfer are revoked by migration end. Native PostgreSQL can retain creator ADMIN-only membership; local native-ownership tests assert no final SET/INHERIT ability. Check hosted membership/owners/grants after activation.
- No secret creation/rotation, Vault root operation, existing record change, account change, auth setting change or timeout setting change is included.

## Changed files

Application: `src/app/api/pharmacy/prescriptions/route.ts`, `src/lib/pharmacy/validation.ts`, `src/components/pharmacy/pharmacy-dashboard.tsx`, `src/proxy.ts`, `src/app/globals.css`; doctor integration in `src/lib/drafts/data.ts`, `src/lib/drafts/validation.ts`, `src/app/doctor/page.tsx`, `src/components/doctor/prescription-table.tsx`, `src/components/doctor/issued-document.tsx`; shared pilot notice in `src/components/ui.tsx`; regenerated `src/types/database.ts`.

Migration: the one file/hash above. Test support: `tests/database/pharmacy.test.mjs`, `pharmacy-http.test.mjs`, `postgrest-server.mjs`, `hosted-phase5a-preflight.sql`, updated `native-auth-compatibility.test.mjs`; `tests/pharmacy-validation.test.mjs`, `tests/pharmacy-api-boundaries.test.mjs`, `tests/sanitize-test-errors.mjs`, `tests/ui/pharmacy-ui.mjs`, updated `tests/ui/entry.tsx` and `tests/ui/issuance-ui.mjs`. Commands in `package.json`; documentation in `README.md`, `docs/database.md` and this report. There is no Git metadata in this workspace, so this is a file inventory, not a Git diff assertion.

## Executed checks and actual results

| Check                                                                                                                      | Result / scope                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                        | PASS final source                                                                                                                                                                                                                   |
| `npm run lint`                                                                                                             | PASS, zero warnings                                                                                                                                                                                                                 |
| `npm run build`                                                                                                            | PASS production build including new route/proxy and doctor changes                                                                                                                                                                  |
| `npm run test:clinical-db`                                                                                                 | **72/72 PASS**, final migration; 157.15 seconds; real disposable PostgreSQL 17.10 and real local PostgREST 14.18                                                                                                                    |
| `node --test tests/database/effective-timeout.test.mjs`                                                                    | **3/3 PASS** independently; function-only timeout gap reproduced; outer deadlines/lock timeout roll back, independent activity/lock inspection confirms execution ended                                                             |
| `npm run test:pharmacy-validation`                                                                                         | **3/3 PASS**, strict payloads, IDs, confirmations, limits and sanitized errors                                                                                                                                                      |
| `npm run test:draft-validation`                                                                                            | **4/4 PASS**, including reopening persisted item projections; existing Node type-stripping/module-format warnings only                                                                                                              |
| `node --test --test-name-pattern='origin check\|issuance validator\|cancel categories' tests/issuance-validation.test.mjs` | **3/3 PASS**, existing clinical/origin validators                                                                                                                                                                                   |
| `npm run test:pharmacy-ui`                                                                                                 | **31 assertions PASS**, actual isolated component + controlled HTTP; confirmations, duplicate click, lost response, identical retry, repeated conflicts, terminal/unavailable states, ephemeral reference, maximum-length 320px RTL |
| `npm run test:issuance-ui`                                                                                                 | **27 assertions PASS**, actual isolated doctor components + controlled HTTP, including separate completion display and cancellation ineligibility                                                                                   |
| `node --test tests/pharmacy-api-boundaries.test.mjs`                                                                       | **1/1 PASS** against final production Next server; anonymous POST denied, cross/missing origin denied, GET/HEAD/PUT/PATCH/DELETE denied, no-store, pharmacy page redirects to login                                                 |
| `node scripts/database-types.mjs` and foundation introspection check                                                       | Generated types; final 72-case suite confirms they match clean migrated SQL                                                                                                                                                         |
| linked hosted dry run                                                                                                      | PASS, exactly the single new pharmacy migration; no seeds/extra roles files; no SQL applied                                                                                                                                         |
| explicit-target hosted metadata query                                                                                      | PASS, read-only baseline/configuration below                                                                                                                                                                                        |

The 72-case suite includes the unchanged draft/issuance/foundation contracts and fourteen new pharmacy SQL cases plus actual two-instance PostgREST coverage. It proves minimal ordered lookup, no clinical browsing, anonymous/doctor/inactive/unassigned/revoked/forged-metadata denial, shared/hour quotas, persisted failed budgets, session/prescription/actor/pharmacy binding, identical concurrent retries, changed conflicts, cross-pharmacy competition, both cancellation lock orders, expiry, authorization/expiry changes while waiting, actual request-key collision, injected late receipt/audit failures, immutability and correct doctor completion. The local ownership reproduction applies the new migration as a non-superuser CREATEROLE owner without native Auth grant delegation and successfully looks up/dispenses.

Failure disclosure: an earlier full run was 71/72 because the existing timeout test's local PostgREST startup readiness check failed while build/UI work was running. No timeout assertion was weakened or production behavior changed. Isolated rerun passed 3/3; the final quiet full run passed 72/72. Initial development failures in SQL expectations/normalization were corrected before that final run. Component and local SQL evidence are not hosted Auth/browser acceptance.

The legacy `test:issuance-validation` command was also run once: five tests passed, including two existing in-memory synthetic escrow/parser unit cases bundled with its clinical validators. No provider export, backup, filesystem staging, restore or real secret operation occurred. They were not needed for this phase; the selective command above and README now exclude those cases. Existing unused recovery tooling is unchanged; no recovery acceptance is claimed.

## Hosted evidence and untouched records

Read-only checks explicitly targeted `fckdsiozmufyhbnignet`; linked reference agrees. Current hosted history:

```text
20261019141747
20261019155321
20261021210732
20261021215141
20261022010926
20261022024957
```

Counts before and after this phase's read-only checks: **1 retained synthetic patient, 2 prescriptions, 4 medication items, 0 dispensations, 147 public audit events, 3 Vault records**. Lookup key exists; its value was not read/exported. New RPCs, executor and rate table are absent. No active clinical calls were found. Auth delegation remains unavailable, as anticipated by the purpose-limited helper model. Ordinary digest SELECT remains denied.

Logging inspection: `log_statement=ddl`, slow statement/sample logging disabled, transaction sampling zero, error parameter logging zero and pgAudit parameter logging off. Normal parameter length is unlimited if logging were enabled; no settings were changed. Recheck this before hosted reference traffic and do not enable request-body/parameter logging. Provider gateway/log retention has not been exhaustively audited from this metadata query.

**Hosted changes this phase: none. No credentials used, no account changes, no key provisioning, no issued-history dispensing, no permanent synthetic writes or deletion.** Existing Phase 4B histories were preserved. Local fixtures/secrets exist only in disposable test databases; tests stop/remove their own clusters. No reference values, clinical contents, cookies or passwords are included in this report or browser traces/screenshots/HAR.

## One bounded hosted activation/acceptance approval request

Approve the exact migration/hash above on Eleyada RX and the following test scope together, or approve schema activation separately. Before applying, repeat target/hash/six-entry history, fresh exact-one dry run, logging and zero unexpected active-call checks; stop on mismatch. After application, inspect owners/membership, fixed paths, RLS, grants/digest/Vault isolation, history, RPC availability/timeout hoisting and removal of temporary authority. No new secret/configuration operation is proposed.

For native functional acceptance, authorize **two NEW synthetic two-medication prescriptions**, using the already retained synthetic patient and existing doctor/pharmacist accounts. **The retained Phase 4B issued prescription is explicitly excluded from dispensing.** No new patient/account/pharmacy is needed, and no existing record is rewritten or deleted.

1. New prescription A: real doctor draft/issue; pharmacist login, normalized reference lookup, compare medication values/order privately, identity and full confirmation, duplicate click/lost-response retry, original completion/time replay, changed UUID/payload PT409. Reload/fresh login/relookup must report completed without patient details; unfinished cross-session capability must be rejected. Doctor list/count/document shows completion and no cancellation eligibility. References compared only in process memory.
2. New prescription B: bounded concurrent cancellation versus full dispensing; one parent-serialized winner, never both. Test stale/mismatched capability before the race and terminal lookup afterward. Local tests already cover both scheduling orders; do not create more immutable records just to force an opposite native race outcome. A guarantees one completion; B leaves either one cancellation or a second completion.
3. Bounded invalid lookup set (at most eleven, accounting for prior attempts) proves generic404 and persisted429; inspect aggregate counters rather than clearing them. Respect minute budgets and wait for natural reset. Direct SDK API/Next/browser probes verify no-store/POST restrictions, anonymous and doctor denial, revoked test-session denial after normal sign-out, no direct clinical browsing, no Vault/digest visibility or fixture fallback. Use fresh test sessions only; never deactivate accounts or touch unrelated sessions. Do not capture raw request failures, references, cookies, screenshots, traces, HAR or payload logs.
4. Native requests use bounded timeouts. If any request hangs, stop retries and independently inspect activity/locks/record counts; client abort alone does not prove termination. Finish with aggregate counts and zero lingering pharmacy RPC calls. Retain all new issued/completion/cancellation/audit/capability history by design.

Expected retained totals after this authorization: **1 patient, 4 prescriptions, 8 items, 1–2 dispensations, 5 Vault records**; existing two Phase 4B histories unchanged. Private issuance receipts increase by two; one new dispensing receipt per completed prescription. One or zero new cancellation receipts according to the race winner. Rate/capability and audit counts depend on actual successful operations and must be reported exactly after execution. No extra deletable draft is required by this plan.

## Acceptance gaps and next action

Local criteria above pass. Required native hosted Auth/browser lookup → confirmation → dispensing → reload/new-session behavior, doctor embedded completion queries under native PostgREST, two-instance native rate behavior, real direct HTTP conflicts, native parent-lock race and fresh-session revocation remain **NOT TESTED for Phase 5A**, because activation/writes are not yet approved. Local SQL and controlled components do not substitute for these checks.

Inactive/unassigned/inactive-pharmacy denial and multiple distinct pharmacists are verified locally, not through newly provisioned/deactivated hosted accounts; such account changes remain unauthorized. Expiry is verified using local database timestamps, including after lock waits; no hosted timestamp backdating or seven-day waiting test is proposed. Real hardware print/mobile devices, public deployed URL, platform logging audit and deployment are outside this local acceptance and remain later checks. No claim of legal digital signature or clinical approval is made.

**Next required owner action:** approve the exact single migration and bounded two-new-prescription hosted plan above. Implementation is ready for that staged activation; no account, secret, recovery or paid action is requested. Do not mark Phase 5A complete until native functional acceptance passes. Stop before Phase 5B.

## Copyable consultant handoff

**Phase 5A: PARTIAL.** Real pharmacy POST lookup and atomic full dispensing are implemented locally, with live session/active pharmacist+pharmacy checks, HMAC resolution without secret exposure, persistent actor/pharmacy quotas, minimal disclosures, version/session-bound confirmation, parent-lock cancellation serialization, immutable full-completion receipts and PT409 safe retries. Doctor views show dispensing independently. Simulation is removed from the real pharmacy workflow. Final checks: typecheck/lint/production build PASS; real local SQL/PostgREST 72/72; pharmacy validation3/3; draft validation4/4; selected issuance validation3/3; pharmacy component31 and doctor component27 assertions; final built anonymous API1/1. One earlier local startup failure resolved on isolated/full rerun; no assertion weakening. Native hosted5A is untested/pending approval, not complete. New migration `20261022173000_pharmacy_full_dispensing.sql`, SHA256 `9399DBD031A0B8BDA5D9E3656A6B5AB8FF7EC1DB99AF05DB57EF47F276A52F64`; dry run lists exactly it. Hosted read-only baseline: six migrations,1patient/2prescriptions/4items/0dispensations/147audit/3Vault, zero active clinical calls. No hosted writes, account/settings/secret changes or retained4B dispensing. Approve the exact migration plus two NEW synthetic two-medication issuances (one normal full completion, one cancellation/dispensing race), retain immutable history, then finish native browser/API acceptance. Recovery excluded; Phase5B/deployment not started.
