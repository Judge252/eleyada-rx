# Trusted account administration

Use only **Eleyada RX**, project `fckdsiozmufyhbnignet`. Public signup stays disabled. Application users are ordinary Supabase Auth `authenticated` users; `doctor` and `pharmacist` are application roles in `public.app_users`, not PostgreSQL roles or Supabase administrator privileges.

## Approved initial identities

- Primary and only doctor: `tclinic65@gmail.com`.
- Pharmacist: `ahmedhany2522006@gmail.com`, pharmacy **Ahmed**.

Passwords are never recorded here, in source, command arguments, environment files, screenshots, traces or application logs. The initial passwords were supplied by the owner; none were generated. The operator provisioning utility takes passwords through stdin with terminal echo disabled. It obtains a temporary administrative key from the signed-in CLI entirely in process memory, uses it only for Supabase Auth administration, and exits without storing it. Database role mapping is performed separately through trusted CLI SQL. No privileged key is added to the application.

## Create an additional pharmacist after explicit owner approval

1. Open [Eleyada RX Auth users](https://supabase.com/dashboard/project/fckdsiozmufyhbnignet/auth/users) and verify the project name/reference. Obtain the approved email, intended pharmacy and account-creation authorization from the owner.
2. Use **Add user → Create new user** for an owner-supplied password, or **Send invitation** only when the approved invitation/recovery flow and redirect URLs have been configured and tested. Do not invent passwords or send them through chat. Do not enable public signup.
3. Confirm the user's exact email and copy their UUID. Verify that the Auth role is the ordinary `authenticated` role. Do not set authorization roles in editable user metadata. Do not grant database or organization administrator privileges.
4. In the trusted SQL Editor, select the existing pharmacy by its reviewed UUID, or create a pharmacy with the approved real name. Inspect possible duplicates before inserting. Never expose privileged SQL or a role-assignment endpoint to the app.
5. Assign the membership with reviewed values, in a transaction:

```sql
begin;
-- Inspect exact email/UUID and intended active pharmacy first.
select id,email from auth.users where id = 'APPROVED_AUTH_UUID'::uuid;
select id,name,is_active from public.pharmacies where id = 'APPROVED_PHARMACY_UUID'::uuid;
insert into public.app_users(id,role,pharmacy_id)
values ('APPROVED_AUTH_UUID'::uuid,'pharmacist','APPROVED_PHARMACY_UUID'::uuid);
commit;
```

The placeholders must be replaced with verified UUIDs. A trusted operator must review the selections before committing. The database enforces pharmacy membership and a single doctor identity. Application users cannot provision, activate, change roles or switch pharmacy membership. Do not create a second doctor or remove/reassign the existing doctor's identity to bypass this invariant.

For a genuinely new approved pharmacy and new Auth identity, the optional local operator utility is:

```powershell
node scripts/provision-account.mjs APPROVED_EMAIL pharmacist "APPROVED_NEW_PHARMACY_NAME"
```

It requires the already-authorized CLI, checks the exact project, refuses existing Auth users/pharmacy names, confirms public signup remains disabled, then prompts without echo. If the Auth user was created but SQL mapping fails, inspect and map that same UUID deliberately; do not rerun user creation. This utility is not an application route, scheduled task or browser feature.

## Deactivate or revoke access

1. Confirm the exact Auth UUID/email in the dashboard and corresponding `app_users` row.
2. Use trusted SQL: `update public.app_users set is_active=false where id='VERIFIED_AUTH_UUID'::uuid;`. Do not change role or pharmacy membership. The server reads active membership on every protected request; an inactive user is denied even while their old token is cryptographically valid.
3. Revoke their sessions through trusted Supabase Auth administration (`auth.admin.signOut(accessToken, 'global')` when operating with a verified current token), and apply an Auth ban if appropriate. Do not place admin credentials or another person's access token into SQL/source/browser logs. Deactivation already closes application access immediately on the next authorized request.
4. Deactivating a pharmacy using its verified UUID blocks all its pharmacists: `update public.pharmacies set is_active=false where id='VERIFIED_PHARMACY_UUID'::uuid;`.
5. Re-enable only after explicit owner approval and a reviewed identity check. No user-facing self-reactivation endpoint exists.

## Safely reset access

Verify the owner/user's identity through the clinic's trusted process. Use trusted Auth administration to set an owner-supplied replacement password without logging it, then revoke previous sessions. The dashboard's reset/invitation email route is an option only after SMTP delivery and the application's password-recovery callback have been separately implemented and verified; this phase does not claim that email recovery works. A password change alone is not a substitute for session revocation or application deactivation during an incident.

## Session and testing boundaries

The app uses HttpOnly cookies, Supabase SSR refresh, server-verified `getUser()`, current active `app_users` membership, active pharmacy checks, and a read-only session-existence RPC. Global sign-out removes the Supabase sessions and clears the app cookies. `getUser()` by itself is insufficient proof of logout revocation because a signed JWT can outlive the removed session; the extra check rejects replayed cookies.

Browser tests take approved account credentials only through transient process environment values, provided by `scripts/run-auth-tests.mjs` through private stdin. Traces, videos and automatic screenshots are disabled; screenshots explicitly taken for the existing mock prescription UI contain no passwords. They never enable an auth bypass or create extra accounts. Do not enable Playwright request tracing while using real credentials.

The separate `tests/membership-access.spec.ts` check is opt-in through the launcher's private JSON `adminChecks: true`. It requires trusted CLI access, temporarily deactivates only the approved pharmacist and pharmacy, verifies denial through the real browser, and restores both active flags in `finally` before confirming a fresh login. It never deletes/reassigns a membership or modifies the doctor/patient data. Run it separately from other account tests. These deliberate administrative changes generate normal append-only audit events.
