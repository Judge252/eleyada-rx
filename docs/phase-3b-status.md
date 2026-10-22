# Phase 3B — real authentication and role access verified

Verified on 19 October 2026 against **Eleyada RX**, project `fckdsiozmufyhbnignet`. The user explicitly approved the reviewed authentication migration; it is applied remotely. No Phase 4 work, deployment, Git push, new Supabase project or clinical data operations were performed.

## Approved accounts

| Identity | Application membership | Supabase Auth role | Active |
| --- | --- | --- | --- |
| `tclinic65@gmail.com` | Sole doctor; no pharmacy | `authenticated` | Yes |
| `ahmedhany2522006@gmail.com` | Pharmacist; pharmacy **Ahmed** | `authenticated` | Yes |

Both emails are confirmed and both accounts passed real browser email/password sign-in. Passwords were supplied by the owner and entered through non-echoed stdin into trusted processes; none were generated or stored in source/configuration files. A temporary administrator key was held only in the provisioning process memory. No privileged key was added to the app, and neither account received PostgreSQL administrator or service-role privileges. Public signup remains disabled.

## Applied database change

`supabase/migrations/20261019155321_authentication_access.sql` was applied **unchanged after explicit approval**. Its SHA-256 is `B7BC5383FAEC688DDA08EECA5F16780230C6418EFDB177A2EF4D8E9C1709189E`.

- Adds `pharmacist_read_own_pharmacy`: an active pharmacist can select only their own active pharmacy through their current `app_users` mapping. No clinical-table permissions or role-assignment restrictions were weakened.
- Adds private `rx_private.has_active_session()`: a fixed-search-path, read-only helper checks only the verified caller UID and signed session ID against `auth.sessions`, including expiry.
- Exposes a read-only **security-invoker** `public.has_active_session()` wrapper. It takes no identity arguments, returns one boolean, and is executable by `authenticated`, not `anon`. It cannot provision users or change roles.
- Both local/remote migration histories now contain `20261019141747` and `20261019155321`. A final dry run reports the hosted database is up to date.
- Hosted introspection confirms all seven tables retain RLS, the new own-pharmacy predicate is correct, and the RPC execution/security flags match the intended grants.

The foundation migration remains unchanged: SHA-256 `8EABE79310C86284EB2890DD02F6E398AE869CEA0E474C108877865498111A71`.

## Application behavior

Real sign-in runs through a server action and ordinary Supabase SSR clients. Cookies are HttpOnly, Secure in production, SameSite=Lax and scoped to `/`. The Next.js 16 Proxy refreshes sessions and forwards refreshed cookies to Server Components and responses. Identity requests and protected responses use `no-store`; no localStorage authority or privileged browser key is used.

Every protected layout **and page**, including nested prescription routes, verifies the current Supabase identity, live session and active database membership. Pharmacists additionally need their assigned active pharmacy. Editable metadata, form roles and redirect parameters are not trusted. Wrong-role navigation returns to the account's authorized home; missing/inactive memberships and provider failures deny access. Login bypasses and role-switching preview links were removed.

Global sign-out clears sessions and cookies and invalidates the router cache. Browser restoration checks and no-store responses prevent protected content from being restored after logout. The live-session check rejects an old cookie even while its JWT has not expired. This immediate session check is enforced by the application's server boundaries; direct Supabase APIs continue to follow Supabase JWT validity and their database RLS policies.

The UI displays the actual account email and assigned pharmacy name. Original logo, Arabic RTL, navy/green branding and clinical layouts are preserved. **Prescriptions, lookup and dispensing remain mock-only**, with explicit warnings. No prescription CRUD, real issuance, reference generation, lookup or dispensing API was added.

## Verification results

| Check | Evidence |
| --- | --- |
| TypeScript | Passed after the auth/test changes |
| ESLint | Passed, zero warnings |
| Production build | Passed; login, all protected pages and session endpoint are dynamic; Proxy present |
| Local database suite | **24/24 passed**: original 22 cases plus own-pharmacy and session-revocation/expiry assertions |
| Local database advisors | Passed with no findings |
| Complete protected browser regression | **19/19 passed** in one run: real UI login for both roles, wrong credentials, all unauthenticated/nested routes, cross-role denial, refresh, cookie flags, sign-out, Back, revoked-cookie replay, signed pharmacist API restrictions and all 13 adapted clinical UI cases |
| Forced session refresh | **Passed**: aged only SDK storage expiry metadata while retaining real signed tokens; Proxy refreshed through hosted Auth, rotated the refresh token, persisted fresh HttpOnly/Secure cookies and survived another page reload |
| Live inactivity checks | **Passed**: approved pharmacist deactivation denied an existing browser session and fresh correct-password login; inactive pharmacy also denied access. Both were restored in `finally`; a fresh pharmacist login/sign-out then passed |
| Responsive/clinical mock UI | Passed Arabic RTL, font/logo checks, mock doctor/pharmacy workflows, print behavior and 320/768/1440 px layouts |
| Hosted Auth/API | Both real account logins and `getUser()` identities passed; own active membership and pharmacy identity verified; role/membership/activation writes denied (`42501`); audit/digest reads denied; pharmacist clinical reads return no rows; live-session RPC returns true only for the current session |
| Public connection | Correct publishable key accepted; Auth settings HTTP 200; public signup disabled; anonymous reads denied for all seven tables; `rx_private` excluded from the Data API |
| Final hosted state | Exactly two Auth users, one doctor and one pharmacist, both memberships active and pharmacy active; zero patients/prescriptions/dispensations |
| Hosted security advisor | **1 WARN**: leaked-password protection disabled; expected audit-table INFO remains. Command exits nonzero at warning threshold; this is not reported as a clean advisor result |

There are **21 distinct passing browser cases across the complete run and the two additional checks**. An initial inactivity test's sign-in wait expired while the form was still pending; the helper's provider-network allowance was increased from 5 to 20 seconds, and the focused rerun passed. No security policy was weakened. A prior wrong-password test selector was narrowed to avoid matching Next.js's route announcer; its rerun and full suite passed. No unresolved application/test failure remains in the scenarios above.

Inactive/unassigned database identities are covered by the 24-test SQL suite. The live inactive-account test also exercises the server's missing-visible-membership branch because RLS hides inactive mappings. **A separate real Auth account with no `app_users` row was not created or tested in the browser**; no extra account/email was authorized. That distinct hosted scenario is the remaining account-coverage limitation, rather than a claim that synthetic SQL identities are end-to-end Auth tests.

Leaked-password protection is documented by Supabase as available on Pro and above. No paid plan change or charge was authorized or made. Its advisor warning remains a platform hardening item; browser/auth functionality above passed with existing provider protections and rate limits intact.

## Repeatable checks and administration

See [account-administration.md](account-administration.md) for trusted account creation, reviewed UUID/role mapping, deactivation and access-reset instructions. No public signup or user-management endpoint exists.

```powershell
npm run typecheck
npm run lint
npm run build
npm run test:db
node scripts/run-auth-tests.mjs
node scripts/verify-hosted-auth.mjs
node --env-file=.env.local --experimental-strip-types scripts/hosted-connection.mjs
node node_modules/supabase/dist/supabase.js migration list --linked --project-ref fckdsiozmufyhbnignet --agent no --output-format text
```

The two authenticated verification scripts read approved account credentials as JSON through **non-echoed stdin**, hold them only in process memory and do not record them. The normal browser run excludes the operator-only inactivity check. To repeat that one deliberately, run `node scripts/run-auth-tests.mjs tests/membership-access.spec.ts` with the same private credential object plus `adminChecks: true`; it requires authenticated CLI access and temporarily deactivates/restores only the approved pharmacist/pharmacy. Never run it concurrently with other account tests. Do not rerun provisioning for existing users.

Playwright traces, videos and automatic screenshots are disabled. Explicit clinical screenshots contain mock data and the signed-in account label, not passwords. No auth/session state files or privileged application environment values are used.

## Files changed

- `src/lib/auth/{access,server,actions}.ts`; `src/proxy.ts`; `src/app/api/auth/session/route.ts`.
- `src/lib/supabase/{server,client}.ts`; generated `src/types/database.ts`; public-only `.env.example` comments.
- Doctor/pharmacy layouts and four protected pages; login page/form; app shell; session controls; pharmacy identity; demo notice; narrow CSS changes for real account/sign-out controls.
- Approved authentication migration; local-only Auth bootstrap; 24-test database suite; browser suites/helpers and recording settings.
- Trusted provisioning, private-input, hosted-auth and test-launch scripts; README, database boundaries, account-administration guide and this report.

No additional environment values or account-provisioning steps are required for the approved doctor/pharmacist to use real login. Phase 3B implementation and the approved-account flows are verified to the extent stated above. Review here; **Phase 4 has not started**.
