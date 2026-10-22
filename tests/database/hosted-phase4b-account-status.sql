-- Read-only sanitized account/membership flags; no credentials, hashes, tokens or identity contents.
begin read only;
set local statement_timeout='5s';
set local lock_timeout='1s';
select jsonb_build_object(
 'pharmacist_auth_accounts',(select count(*) from auth.users where lower(email)='ahmedhany2522006@gmail.com'),
 'pharmacist_email_confirmed',(select coalesce(bool_and(email_confirmed_at is not null),false) from auth.users where lower(email)='ahmedhany2522006@gmail.com'),
 'pharmacist_banned',(select coalesce(bool_or(banned_until>clock_timestamp()),false) from auth.users where lower(email)='ahmedhany2522006@gmail.com'),
 'pharmacist_deleted',(select coalesce(bool_or(deleted_at is not null),false) from auth.users where lower(email)='ahmedhany2522006@gmail.com'),
 'pharmacist_memberships',(select count(*) from public.app_users a join auth.users u on u.id=a.id where lower(u.email)='ahmedhany2522006@gmail.com'),
 'pharmacist_membership_fingerprint',(select encode(extensions.digest(concat_ws('|',a.id::text,a.role::text,a.pharmacy_id::text,a.is_active::text),'sha256'),'hex') from public.app_users a join auth.users u on u.id=a.id where lower(u.email)='ahmedhany2522006@gmail.com'),
 'pharmacist_role_correct',(select coalesce(bool_and(a.role='pharmacist'),false) from public.app_users a join auth.users u on u.id=a.id where lower(u.email)='ahmedhany2522006@gmail.com'),
 'pharmacist_membership_active',(select coalesce(bool_and(a.is_active),false) from public.app_users a join auth.users u on u.id=a.id where lower(u.email)='ahmedhany2522006@gmail.com'),
 'pharmacist_pharmacy_link_present',(select coalesce(bool_and(a.pharmacy_id is not null and p.id is not null),false) from public.app_users a join auth.users u on u.id=a.id left join public.pharmacies p on p.id=a.pharmacy_id where lower(u.email)='ahmedhany2522006@gmail.com'),
 'pharmacist_pharmacy_active',(select coalesce(bool_and(p.is_active),false) from public.app_users a join auth.users u on u.id=a.id left join public.pharmacies p on p.id=a.pharmacy_id where lower(u.email)='ahmedhany2522006@gmail.com')
) as account_status;
commit;
