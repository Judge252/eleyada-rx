# Prescriber accounts: provisioning and password recovery

Doctors sign in at `/login` with a **username and password**. Supabase Auth stores and verifies the credential (no plaintext or custom hashing in this app). There is **no self-registration, OTP or self-service reset**; an operator provisions every individual prescriber.

## How a username maps to an identity

Supabase Auth needs an email-shaped identity, so `username` maps deterministically to `username@prescribers.clinic-rx.invalid` (reserved, non-deliverable; override the domain with `RX_LOGIN_EMAIL_DOMAIN` on the server only). There is no table, RPC or endpoint that turns a username into an email, and a username is **never an authorization claim**: access still comes from `app_users` / `prescribers` / `clinic_memberships` / entitlements, checked in the database on every request.

Username rule: lowercase `a-z 0-9 . _ -`, 3–32 characters, starts with a letter or digit.

## Provision an individual prescriber (operator, owner-approved)

1. Supabase dashboard (project `fckdsiozmufyhbnignet`) → Authentication → Users → **Add user → Create new user**. Email: `<username>@prescribers.clinic-rx.invalid`. Enter an owner-supplied password (never in chat or source), tick **Auto Confirm User**. Do not enable public signup.
2. Copy the new user's UUID. In the trusted SQL editor, in one transaction, create the application identity (one user per real doctor, so attribution stays individual):

```sql
begin;
insert into public.app_users(id,role) values ('AUTH_UUID'::uuid,'doctor');
insert into public.prescribers(user_id,display_name,approved) values ('AUTH_UUID'::uuid,'APPROVED DISPLAY NAME',true);
insert into public.clinic_memberships(user_id,clinic_id) values ('AUTH_UUID'::uuid,'CLINIC_UUID'::uuid);
commit;
```

3. Entitlement is per clinic (`clinic_entitlements`); inactive entitlement blocks **new** issuance only. Records and cancellation stay available.
4. Check that the username signs in, then record nothing secret.

## Existing doctor (e.g. the legacy approved prescriber)

Do not recreate it: that would lose attribution. After owner approval, edit the existing Auth user's **email** to `<username>@prescribers.clinic-rx.invalid` (same UUID, password and history unchanged). Until then that account cannot use username sign-in. Verify, once, that the dashboard accepts the `.invalid` address; if the provider rejects it, set `RX_LOGIN_EMAIL_DOMAIN` to a domain you control and use the same value when provisioning.

## Password recovery / revocation (operator)

1. Confirm the requester's identity through the clinic's trusted process.
2. Dashboard → Users → the account → set a new owner-supplied password (not logged).
3. Revoke old sessions (Auth admin global sign-out / dashboard "Sign out user") and, if an incident, set `app_users.is_active=false` (application access closes on the next request).
4. Throttling: the app allows 12 sign-in attempts per username and 40 per client per 15 minutes (persistent, `consume_login_attempt`); Supabase Auth adds its own rate limits.
