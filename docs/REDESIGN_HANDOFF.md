# Clinic RX — localization and activation handoff

2026-11-06. This request superseded the earlier phase-stop boundary and authorized the reviewed existing-project migration. **Localization, database activation and the bounded authenticated hosted workflow checks are complete. Delivered email OTP verification remains blocked by the provider configuration below.** The user subsequently authorized committing and pushing this implementation to the existing GitHub repository. No manual deployment was requested.

## Product and language implementation

- Exact text wordmark: **Clinic RX**. Hebrew is the default (`he`, RTL), English is secondary (`en`, LTR). Navigation, login, metadata, protected screens, error/validation/loading states, onboarding, receipts, accessibility labels and print text use the common system.
- `src/lib/i18n/` contains parallel Hebrew/English dictionaries (705 keys, including deterministic country names), a canonical source alias catalog, server cookie readers, a client language provider, explicit UI text/attribute translators and the accessible switcher. This translates identified interface text only; it does not recursively translate database results, DOM contents or patient/medication fields.
- Initial server rendering reads `clinic_rx_language`. Switching updates language/direction and the preference cookie in place, without navigating, submitting or replacing the form. Clinical fields, review state, errors and request UUIDs survive the switch. Arabic remains supported as entered/historical content and digit input, not as an interface language.
- Noto Sans Hebrew/Latin is served locally through the installed font package. Existing teal/ink/blue styling is retained; logical positioning, directional arrows, bidi handling, warning colors and language-specific print wording are applied.
- The form stays public and requires individual email verification, as clarified by the user. Pharmacy password authentication is retained. No patient accounts, payment integration, partial dispensing, refill support, shared prescriber identity or source-code publication/license change was added.

## Exact database activation

Target verified before application: **`fckdsiozmufyhbnignet`**. The linked reference and configured application URL matched privately. `.env.local` was inspected without printing values and still contains the existing public URL/publishable-key configuration only; no replacement environment file or privileged application key was created.

The seven earlier remote versions matched the repository. After the local regression checks and successful linked dry run, the following exact migration was applied once:

| Migration | SHA-256 |
| --- | --- |
| `supabase/migrations/20261106120000_multiclinic_form.sql` | `EA53D97B0249101EE2858EAD6A773D046DB3B4418E305FC6AB74A791E883260A` |

Post-application remote history matches all eight local versions:

`20261019141747`, `20261019155321`, `20261021210732`, `20261021215141`, `20261022010926`, `20261022024957`, `20261022173000`, `20261106120000`.

The applied migration adds clinic membership, approval/entitlement context, additive patient identity mappings, atomic form issuance/recovery, exact paginated pharmacy identity lookup and selected-prescription grants. It retains existing lifecycle/immutability/session/rate-limit/dispensing safeguards and extends clinic isolation to legacy routes. No applied migration was rewritten, history repaired, database reset/reseeded or existing clinical record deleted/merged.

Hosted postchecks confirmed the form RPC exists, public tables have RLS enabled, restrictive clinic policies and dispensing uniqueness exist, anonymous issue/search/private-identity access is denied, and client provisioning is denied. The legacy clinic and approved prescriber mapping exist. Following explicit user authorization, only the designated test clinic received a finite test entitlement: **2026-11-06 02:50:49.334722 UTC through 2026-11-13 02:50:49.334722 UTC**, exactly seven days. This is a test grant, not evidence of payment. Existing professional display names and historical attribution were preserved.

## Auth configuration: attempted, rejected, not enabled

Prepared a bilingual Clinic RX email-code template in `supabase/templates/magic-link.html` using `{{ .Token }}`, and a narrow existing-project CLI operator tool in `scripts/clinic-auth-config.mjs`. The tool previews only explicitly declared Auth changes, preserves unrelated settings and uses the existing CLI credential mechanism without exposing credentials.

The provider rejected the Auth update with HTTP 400 / `ConfigPushAuthUpdateStatusError`:

> Email template modification is not available for free tier projects using the default email provider. Please upgrade your plan or configure a custom SMTP provider.

Committed configuration was reinspected after the failure: the requested email-signup/template changes remain pending. No upgrade, purchase, SMTP credential change or password reset was attempted. The existing pharmacy accounts/passwords were not changed. The prepared template was **not** activated.

Actual public Auth settings were separately checked: unrestricted signup is disabled, email Auth is enabled, and anonymous users are disabled. The proposed template content is not a substitute for actual provider delivery evidence.

`RX_PASSWORDLESS_ENABLED` remains unset/false because the required token-template delivery configuration is not available. The application fails closed instead of reporting a sent code or successful verification. No OTP email was sent. The user explicitly approved a recipient already present as the approved prescriber, private code entry, a seven-day test grant, and one synthetic second pharmacy identity.

Environment inspection found no SMTP credentials/service available for reuse. A read-only linked configuration comparison confirmed that the existing project has no custom SMTP sender configured. No service was purchased and no sender settings were changed.

## Actual verification this run

| Evidence | Result |
| --- | --- |
| Typecheck, lint, production build, `git diff --check` | Passed |
| Existing clinical database regression suite | 72 tests passed |
| Redesign SQL and real local PostgREST workflow | 12 tests passed |
| Passwordless/validation unit suite | 5 tests passed; Auth mocked |
| Localization catalog/source checks | 3 tests passed |
| Focused connected-experience browser checks | 10 passed; authenticated API responses mocked, anonymous/CSRF checks use the real app endpoint |
| Hebrew/English browser verification | 7 passed: three widths per language plus state/UUID/error/receipt/print persistence |
| Responsive routes | Doctor form, pharmacy portal and login checked at 360, 768 and 1440px; no horizontal overflow or hydration errors observed |
| Actual hosted anonymous RPC requests | Issuance and national-ID search both denied with HTTP 401 |
| Actual hosted metadata/access checks | Passed as described above; eight migrations applied/matched |
| Actual authenticated hosted acceptance | 10 grouped checks passed; real provider-issued sessions, application UI/API and hosted database; email delivery excluded |
| Local server against configured project | `/`, `/portal`, `/login` return HTTP 200 with Hebrew SSR; anonymous issue/search denied with localized errors; OTP gate returns unavailable without requesting an email |

The successful local PostgREST scenario commits synthetic issuance → exact national-ID lookup → explicit selection → full dispensing → second-pharmacy rejection, plus retries and receipt recovery. Local SQL also covers changed-payload conflicts, cross-clinic access, inactive membership/entitlement, cancellation/expiry races and immutable history. These are **local** results, not hosted success or real OTP delivery.

### Bounded hosted acceptance after user approval

`scripts/clinic-hosted-acceptance.mjs` exercised the local production application against the actual configured hosted Supabase project. Existing operator authorization was confined to provisioning, test entitlement/scoping metadata and provider-issued test sessions. Session tokens stayed in memory and HTTP-only browser cookies. Clinical mutations used ordinary authenticated application handlers and protected user-scoped RPCs, never privileged clinical inserts. The provider's admin `generateLink` followed by token-hash verification creates real sessions without sending email; this **does not verify delivered OTP or the public code-entry flow**.

Actual successful hosted checks:

- Approved prescriber context and exact seven-day entitlement; real doctor UI filled with synthetic data, review and explicit issuance confirmation.
- Two synthetic prescriptions with two nonclinical medication items each; leading zeros and Arabic/Persian digit normalization; identical issuance replay, changed-payload conflict and receipt recovery.
- Real pharmacy UI exact country/type/identifier lookup, two matches, explicit selection, immutable medication review and both required confirmations.
- One atomic full dispensation; identical replay/recovery; a separately authenticated synthetic pharmacy rejected when attempting to dispense it again; search grants isolated between actors.
- Second prescription cancelled through the authorized lifecycle handler; its previously selected dispensing grant rejected. An existing expired issued record was checked without backdating or editing history: lifecycle was expired and pharmacy lookup exposed no clinical contents.
- Cross-clinic prescription RLS and legacy lifecycle RPC denied access; the legacy document rendered Next.js's not-found fallback with no test patient/medication content; issuance without entitlement denied. Anonymous and pharmacist issuance denied.
- Exactly two form receipts remain: one issued prescription with exactly one dispensation and one cancelled prescription without a dispensation. No duplicate clinical writes were made during resumed verification.

The first pass stopped at an overly strict HTTP-404 assertion. Committed state was inspected before retrying: issuance/dispensing/cancellation were already correct. Installed Next.js documentation confirms streamed `notFound()` responses retain HTTP 200. The remaining verification checked the explicit `NEXT_HTTP_ERROR_FALLBACK;404` marker, `noindex`, and absence of clinical content; it then completed without issuing or dispensing again. One read-only fixture guard initially referenced a nonexistent column; it was corrected to the private patient-clinic mapping before continuing. These were operator-test assertion/query issues; no application or database safeguard was bypassed.

The synthetic second pharmacy and its app-user access were disabled after testing, with audit links retained. The existing pharmacy password, activity and membership were preserved. Temporary doctor membership changes for the cross-clinic denial check were restored and verified; the empty synthetic clinic was deactivated. No patient history was reset or deleted. A UUID/status-only ignored local ledger records committed state and cleanup, without credentials, OTPs or clinical payloads. The test entitlement remains active only until the finite end above.

## Changed files

- New `src/lib/i18n/{core,client,server}` modules and `he.json`, `en.json`, `sources.json` dictionaries; `src/app/layout.tsx` metadata/provider/font wiring.
- Doctor/pharmacy/login/shared/session components and legacy record/document views; server-page UI text wrappers; `src/app/{globals,experience}.css`; UI-only date/number formatting helpers in `src/lib/mock-data.ts` (fixture/clinical contents retained).
- Experience and legacy prescription API response localization, restricted to system `message`/`errors` fields, never clinical `result` data.
- Font dependency/lockfile, localization script entry and tests; localized selectors in focused experience tests.
- Prepared Auth template/operator tool and bounded hosted acceptance operator script; this handoff. The reviewed migration bytes are unchanged. Pre-existing unrelated local changes and historical hosted scripts were preserved and not executed.

No clinical values, national IDs, OTPs, passwords, sessions or provider error payloads are logged by the application or stored by the language system. Existing UUID-only recovery storage remains. No backup/disaster-recovery work was initiated. No legal digital-signature, real-billing, production-readiness or hosted end-to-end claim is made.

## Running local review and concrete next step

The local production server is left running at:

- Doctor form: **http://127.0.0.1:3210/**
- Pharmacy portal: **http://127.0.0.1:3210/portal**
- Existing pharmacy sign-in: **http://127.0.0.1:3210/login**

Doctor and portal browser panels were requested through Codex; the app returned queued openings. The URLs remain directly usable.

The remaining action is to configure an existing usable SMTP sender privately in this project's Supabase Auth email settings. The approved recipient, finite test period and second-pharmacy authorization have already been supplied; do not ask for them again. No passwords or keys are needed in chat.

Once SMTP is configured, apply only the prepared Auth changes, verify the code template, enable the server-only passwordless flag and run the actual email delivery/private code-entry check using the existing approval. The authenticated hosted clinical scenario above does not need duplicate prescriptions. Do not reapply the already applied migration, reset passwords, deploy or create new cloud resources. Public doctor signup remains a verification/onboarding request requiring operator approval and entitlement; unrestricted signup is disabled.
