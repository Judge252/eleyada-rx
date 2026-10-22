# Phase 1 verification

Verified locally on 19 October 2026. Scope: mock UI only; no authentication, APIs, database, real prescription issuance, real dispensing, deployment or Phase 2 work.

## Automated results

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed: Next.js route type generation and strict TypeScript checking |
| `npm run lint` | Passed: ESLint with zero warnings allowed |
| `npm run build` | Passed: Next.js 16.4.2 production build |
| `npm run test:e2e` | Passed: 13 Chromium browser tests, final run 28.1 seconds |
| Original logo preservation | Root asset and public copy have identical SHA-256 hashes |

The build confirms `/login`, `/doctor`, `/doctor/prescriptions/new`, `/doctor/prescriptions/[id]` and `/pharmacy`. `/` redirects to `/login`; unknown routes and unknown prescription IDs display a useful not-found screen.

## Verified user flows

- All required screens render with `lang="ar"`, `dir="rtl"`, the locally served Arabic font and successfully loaded original branding. The route smoke test found no browser console errors, uncaught page exceptions or failed asset responses.
- Login shows validation, focuses the first invalid field, supports the password visibility control, and explains that authentication is unavailable. Valid-looking dummy inputs never authenticate, generate cookies or produce a network write; inputs clear after the preview submit.
- Doctor navigation opens the correct pages. Recent prescriptions filter by query and status, display an empty state, and link to the matching read-only detail page. Statistics are derived from the same mock fixtures.
- Prescription entry validates required patient/date/medication fields and positive integer quantity. Adding and removing medications works while retaining at least one medication. Review displays the local values, focuses its heading and returns to editing with values preserved.
- Reloading clears entered prescription data. No localStorage, sessionStorage or network write is used. The fixed local review placeholder is absent from pharmacy search fixtures.
- Pharmacy search handles empty, unknown and case-insensitive/trimmed codes. Medication names, strengths, doses and quantities have no editable controls.
- Draft and already-dispensed fixture states block simulation. Ready fixtures require the identity checkbox, an explicit confirmation and full dispensing. Canceling confirmation works; unchecking identity cancels the confirmation. Simulated dispensing prevents repeat simulation in the same page instance, survives searches within that instance and resets on reload. No transaction is sent or persisted.
- Print action invokes `window.print`. Print media emulation hides navigation and retains the logo, document, demo reference, non-validity warning, approval placeholder and disclaimer. This is browser print emulation, not a physical printer test.
- At 320, 768 and 1440 px, all five required screens fit the document width. Wide table content scrolls inside its own region; narrow layouts explain how to scroll to hidden status/action columns. Mobile navigation expands and collapses correctly.
- Pharmacy confirmation is exercised at all three widths. A complete 320 px prescription entry and review flow also passes without horizontal page overflow.

## Visual QA

Compared actual Chromium screenshots with the reference lock in `design.md`: navy navigation and actions, pale green canvas, white panels, original logo proportions, Arabic typography, form labels, status semantics and demo copy. Desktop login, doctor dashboard, prescription form, print view, tablet dashboard, mobile dashboard, mobile review and pharmacy confirmation were inspected. No known unresolved Phase 1 UI blockers remain.

Two observed issues were corrected: absolute screen-reader labels inside the RTL table were escaping its clipping region (fixed with a positioned scroll container); smooth scrolling during review focus could produce a misleading full-page screenshot (removed unnecessary smooth scrolling and focus scrolling). Key dashboard labels were enlarged for readability. Login retains a visible primary heading on mobile, and the skip-link target supports focus.

Screenshots from the final run are available locally in ignored `test-results/`, including:

- `phase-one-all-routes-fit-1440px-with-usable-RTL-navigation/-doctor-1440.png`
- `phase-one-all-routes-fit-320px-with-usable-RTL-navigation/-doctor-320.png`
- `phase-one-320px-prescripti-9f761--review-and-preserves-edits/mobile-review.png`
- `phase-one-all-routes-fit-320px-with-usable-RTL-navigation/pharmacy-confirmation-320.png`
- `phase-one-printing-retains-02f69-n-and-invokes-browser-print/print-preview.png`

Logo SHA-256 (both files): `1A1E12C2679DF62C63C6E9D96D90516C1409B3E21392F6A18082F06366A6366D`.

## Limits and handoff

Browser verification used Chromium on Windows with emulated viewport sizes. Safari, Firefox, physical tablets/phones and physical printing were not tested. There is deliberately no security, clinical, legal, database or deployment verification in this UI-only phase. These mock interfaces must not receive real patient data or credentials.

The temporary verification server is stopped after the suite. Run `npm run dev` and open `http://localhost:3000` for review. Phase 1 is complete and stops here for approval.
