# Clinic RX architecture memory (concise)

Graph: `graphify-out/graph.json` + `GRAPH_REPORT.md` (AST of src, tests, migrations folder; SQL is **not** parsed there, see "SQL map" below). Rebuild: stage non-secret sources, run Graphify's AST pipeline; `.env*`, `.local/`, `test-results/`, hosted SQL and operator scripts are excluded.

## Routes / UI
- `/` doctor workspace (server-guarded; redirects to `/login`) → `components/rx/doctor-workspace.tsx`
- `/login` doctor username/password → `components/login-form.tsx` → server action `lib/auth/actions.ts#signIn`
- `/portal` public pharmacy lookup → `components/rx/pharmacy-portal.tsx`
- `/api/experience` single JSON endpoint: doctor ops (`context`, `issue`, `recoverIssue`) need a Supabase session; public ops (`lookup`, `dispense`, `recoverDispense`) need none. Same-origin + JSON + 96 KB cap.
- Design system: `app/rx.css` (`cx-*`). i18n: keys `rx_*` in `lib/i18n/{he,en}.json`; Hebrew default RTL.
- `/dev-preview/doctor`: 404 unless `RX_UI_PREVIEW=1` (local test/design only).
- Legacy (untouched): `/doctor/**` draft/lifecycle pages, `/pharmacy` account dashboard, `/api/pharmacy`, `/api/doctor`.

## Auth/authorization boundaries
- Supabase Auth owns credentials. Username → `username@prescribers.clinic-rx.invalid` (`lib/auth/username.ts`); no directory. Authorization = `app_users.role` + `prescribers.approved` + `clinic_memberships` + `has_active_session()` in `rx_private.assert_clinic_access`.
- Entitlement gates **issuance only** (`assert_clinic_access(true)`); reads and cancellation do not.
- Public flow has no identity: capability = (IL national ID + patient-held RX1 code) → `rx_private.public_lookups` row (10 min) → `public_dispense_prescription`.

## SQL map (20261107120000 adds the public layer)
- Issuance: `issue_form_prescription` (forces IL / national_id; `normalize_il_id` = exactly 9 digits) → `issue_doctor_prescription` (RX1 reference, HMAC digest in `prescriptions.reference_digest`, code in Vault) → `form_receipts`. Doctor reads code via `reveal_doctor_reference` (audited).
- Public lookup: `public_lookup_prescription(id, code, client)` → `rx_private.public_resolve` (both proofs on one prescription, else generic PT404) → eligible/dispensed/cancelled/expired.
- Public dispense: `public_dispense_prescription` / `public_recover_dispensing`; executor role `rx_public_executor` sees only the proven prescription (`rx.public_rx` GUC + RLS). Receipts: `rx_private.public_dispensing_receipts`. One completion: `dispensations_one_per_prescription`.
- Attribution: `dispensations.access_method` ∈ {`pharmacy_account`,`public_code`}; public rows have NULL pharmacy/pharmacist and an unverified `pharmacy_label`.
- Budgets (persistent): `rx_private.access_limits` via `consume_public_limit` (per-ID 15/h, per-client 40/h advisory, global 2000/h; dispense per-lookup 20/h, global 600/h; login per-user 12 and per-client 40 per 15 min).
- Closed by the migration: `search_pharmacy_identity` (ID-only) for `authenticated`; `request_prescriber_access` (OTP/onboarding) for `anon`/`authenticated`.

## Tests (where evidence lives)
- DB (local PostgreSQL): `tests/database/public-pharmacy.test.mjs` (new), clinical/legacy suites, `redesign*.test.mjs` pinned to migrations ≤ `20261106120000` via `startTestDatabase({ through })`.
- Unit: `tests/experience-validation.test.mjs`. Browser (mocked API): `tests/public-flow.spec.ts`.

## External dependencies
Supabase (Auth, PostgREST, Vault) project `fckdsiozmufyhbnignet`; Next.js 16 (read `node_modules/next/dist/docs` before changing conventions); Vercel hosting (not touched).
