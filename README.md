# Al-Eyada Rx — العيادة

**Revised Phase 4B scope:** the owner explicitly excludes backup/disaster-recovery acceptance; this is an accepted limitation, not a blocker. That work is stopped and unused tooling stays unchanged. Normal Vault-backed issuance/reference retrieval/reprinting remains in scope.

**Phase4B COMPLETE within revised bounded synthetic software acceptance (22 October2026):** see the [final consultant handoff](docs/phase-4b-native-activation-status.md). The specifically authorized existing pharmacist password reset resolved sign-in; memberships are unchanged. Real hosted issuance, same-reference retrieval/reprinting, retries/conflicts, cancellation, authorization/session denial, immutable history and pharmacy-simulation isolation passed staged browser/API/SQL acceptance. Two synthetic issued histories remain, one cancelled; no dispensing. Test-harness failures, one remediated test-session-cookie diagnostic exposure and untested hardware/expiry/account-state cases are disclosed in the report. Older activation/recovery reports are historical.

**Phase 5A COMPLETE within approved bounded synthetic hosted acceptance:** see the [final native handoff](docs/phase-5a-native-status.md). Real pharmacy lookup, confirmations, atomic full dispensing, retries/conflicts, cancellation race, session denial, persistent throttling and doctor completion display passed using native hosted Supabase. One new synthetic prescription was dispensed and one cancelled. The two Phase 4B histories remain unchanged and undispensed. No simulation fallback. The application is not deployed; Phase 5B awaits consultant review and hosting access/URL inputs.

## Run locally

Use Node.js 22.14 or newer (type generation requires at least 22.12). Real application access requires the hosted public URL/publishable key in ignored `.env.local`, an approved active account and the reviewed authentication migration applied to Supabase.

```powershell
Set-Location -LiteralPath 'D:\my  business\el-eyada-rx'
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root redirects to `/login`. Protected routes require a real approved active account and the configured hosted project; there are no development login bypasses. The ignored `.env.local` supplies the public URL/publishable key. The doctor goes to `/doctor`; the authorized pharmacist goes to `/pharmacy` with the assigned pharmacy name.

## Completed routes

| Route                              | Current behavior                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/login`                           | Real email/password sign-in, loading/errors, no public signup or development bypasses                                                      |
| `/doctor`                          | Authorized database records/counts; 25-record pages with explicitly page-local search/status filters                                       |
| `/doctor/prescriptions/new`        | New/existing patient, ordered medications, validation, review and atomic draft-save action                                                 |
| `/doctor/prescriptions/[id]`       | Saved drafts and immutable issued/cancelled records; native authorized reference retrieval/reprinting and reasoned cancellation            |
| `/doctor/prescriptions/[id]/issue` | Database-saved review/fingerprint, explicit confirmation and atomic hosted issuance with safe retries                                      |
| `/doctor/prescriptions/[id]/edit`  | Reopen/edit an owned draft, protect newer changes using exact version token                                                                |
| `/pharmacy`                        | Authenticated POST reference lookup, two explicit confirmations, atomic full dispensing and safe retry; native synthetic acceptance passed |

Doctor and pharmacy pages do not resolve mock IDs or fixture codes. Historical unused fixture modules are outside the real pharmacy workflow.

## Current phase boundaries

- Doctor counts/records come from the authorized database, not demo fixtures. Use synthetic patients and non-actionable medication text for verification. Signed-in account and pharmacy identities are real.
- Doctor/pharmacy routes now require server-verified identity, live session and active database membership. The development preview bypasses have been removed.
- Form edits/review remain unsaved until explicit save succeeds. The hosted RPC transaction inserts patient/header/items together; existing patients are selected without identity edits. Final-source saving/editing/deletion, safe retries and returning stale conflicts passed acceptance after the approved correction. Saved drafts have no dispensing code and are never represented as issued.
- The hosted pharmacy migration supplies persistent per-actor/per-pharmacy limits, session-bound confirmation and one immutable full-completion receipt. Clinical access is limited to the looked-up prescription; there is no browsing endpoint. Approved bounded native synthetic acceptance passed.
- Authentication uses server actions, SSR cookies and current membership/session checks. Draft invoker RPCs are unchanged. Hosted issuance/recoverable references/cancellation passed Phase 4B acceptance. Phase 5A adds narrow pharmacy RPCs without exposing Vault or digest access. Legally recognized digital signatures and deployment remain outside this phase.
- Printed documents retain a clear demo warning and are not legally valid prescriptions.
- The original root `logo.png` is preserved. Its public copy is byte-identical.

## Structure

```text
src/app/                   App Router routes, layouts and global CSS
src/components/ui.tsx      Shared brand, buttons, fields, badges and notices
src/components/app-shell.tsx  Responsive role navigation
src/components/doctor/     Real draft form/table/document/delete controls; separate pharmacy demo document
src/components/pharmacy/   Real lookup, identity/full confirmation and safe dispensing retry
src/types/                 Strict TypeScript domain types
src/lib/mock-data.ts       Fictional fixtures and display formatters
src/lib/supabase/          Separate typed browser/server clients; server cookie integration
src/lib/auth/              Verified identity, role authorization and sign-in/sign-out actions
src/lib/drafts/            Server data access/actions and strict shared draft validation
src/proxy.ts               Session refresh and private/no-store responses
src/types/database.ts      Generated PostgreSQL types (separate from mock UI types)
supabase/                  Local configuration and versioned SQL migration
scripts/                   Local database tools and read-only hosted connection probe
public/branding/logo.png   Unmodified supplied logo copy
tests/                     Essential browser workflows and responsive checks
docs/                      Design lock and verification evidence
```

Stack: Next.js App Router, React, strict TypeScript, Tailwind CSS with shared semantic component styles, Lucide, and a locally served Arabic font. No global state library or unnecessary services. Native controls are used where a shadcn dependency would add little value.

## Verification commands

```powershell
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:postgrest:setup
npm run test:clinical-db
npm run test:draft-validation
node --test --test-name-pattern='origin check|issuance validator|cancel categories' tests/issuance-validation.test.mjs
npm run test:issuance-ui
npm run test:pharmacy-validation
npm run test:pharmacy-ui
node --test tests/pharmacy-api-boundaries.test.mjs
npm run db:advisors
npm run db:migrations:check
npm run db:types:check
```

The browser suite starts the production build on `127.0.0.1:3107` and stops its server afterward. Build first and keep this port free. Protected tests use transient credentials through `node scripts/run-auth-tests.mjs` and non-echoed stdin; never store passwords in a file. Traces/video/screenshots and automatic DOM failure snapshots are disabled. The operator-only deactivation test requires separate `adminChecks` approval and was not run in Phase 4A. Synthetic writes/deletion remain default-off (`draftWritesApproved`); compound acceptance additionally requires `draftConflictFixApplied` after verified target/history/correction application. Both were explicitly approved for the completed run. Future hosted writes need their own authorized scope. Non-writing regression command: `node scripts/run-auth-tests.mjs --grep-invert 'inactive pharmacist and inactive pharmacy|persisted draft:'`. Dashboard tests expect no prescriptions and compare retained-patient count to the real API. Never run this suite against real patient data. Requests are bounded; a timeout requires safe server-side inspection before any further conflicts, not blind retries.

For a manual production preview, run `npm run build` then `npm start`.

`test:db`, `db:advisors`, `db:migrations:check` and `db:types` each create their own clean, loopback-only PostgreSQL 17.10 test cluster, apply the migrations, and stop and remove that cluster afterward. They never read remote database URLs or connect to a linked project. Tests create fictional SQL identity/session rows, not usable login accounts. Docker is not needed for these SQL tests; the full local Supabase services do require Docker.

See [database boundaries](docs/database.md), historical [Phase 2](docs/phase-2-verification.md)/[Phase 3A](docs/phase-3a-status.md)/[Phase 3B](docs/phase-3b-status.md), completed [Phase 4A handoff](docs/phase-4a-status.md), [final Phase 4B handoff](docs/phase-4b-native-activation-status.md), [final Phase 5A evidence](docs/phase-5a-native-status.md) and [trusted account administration](docs/account-administration.md). This checkout is linked to `fckdsiozmufyhbnignet`; seven reviewed migrations through `20261022173000_pharmacy_full_dispensing.sql` are hosted. `.env.local` is unchanged, ignored and public-only. No privileged application key or signup was added. The approved two new synthetic histories are retained; previous Phase 4B records remain unchanged/undispensed. No deployment or recovery work.

Implementation follows the [Next.js installation guidance](https://nextjs.org/docs/app/getting-started/installation), [Tailwind Next.js integration](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Supabase SSR client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client). `docs/verification.md` retains the historical Phase 1 evidence.
