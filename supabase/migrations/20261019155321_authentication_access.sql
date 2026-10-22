-- Phase 3B: read only the signed-in pharmacy's own active identity.
-- Existing clinical-data policies, grants and doctor assignment remain intact.
begin;

create policy pharmacist_read_own_pharmacy on public.pharmacies
for select to authenticated
using (is_active and exists (
  select 1 from public.app_users u
  where u.id = (select auth.uid()) and u.role = 'pharmacist'
    and u.is_active and u.pharmacy_id = pharmacies.id
));

-- getUser verifies the JWT/user; this also rejects replay after global sign-out.
-- Read only the current identity's session. No caller-supplied user/session ID.
create function rx_private.has_active_session() returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from auth.sessions s
    where s.user_id = (select auth.uid())
      and s.id::text = (select auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function rx_private.has_active_session() from public, anon, authenticated, service_role;
grant execute on function rx_private.has_active_session() to authenticated;

-- Exposed wrapper has no elevated privileges; the private helper returns one boolean.
create function public.has_active_session() returns boolean
language sql stable security invoker set search_path = ''
as $$ select rx_private.has_active_session(); $$;
revoke all on function public.has_active_session() from public, anon, authenticated, service_role;
grant execute on function public.has_active_session() to authenticated;
comment on function public.has_active_session() is
  'Checks only the verified caller session, including revocation; no role assignment or clinical access.';
commit;
