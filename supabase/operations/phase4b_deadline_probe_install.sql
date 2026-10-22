-- PREPARED ONLY. Separate approval on a named isolated target, then source if approved.
-- Temporary bounded diagnostic, not an application endpoint or a migration.
begin;
set local lock_timeout='1s';
set local statement_timeout='5s';
create table rx_private.phase4b_deadline_probe_marks(id uuid primary key);
alter table rx_private.phase4b_deadline_probe_marks enable row level security;
revoke all on rx_private.phase4b_deadline_probe_marks from public,anon,authenticated,service_role;
create function public.phase4b_deadline_probe() returns boolean
language plpgsql security definer set search_path='' set statement_timeout='100ms' as $$
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or not rx_private.is_active_doctor() or not rx_private.has_active_session() then
   raise exception 'Doctor session required' using errcode='42501';
 end if;
 insert into rx_private.phase4b_deadline_probe_marks values(gen_random_uuid());
 perform pg_sleep(0.4);
 return true; -- Reaching here means the 100ms hoisted deadline did NOT enforce cancellation.
end;
$$;
revoke all on function public.phase4b_deadline_probe() from public,anon,authenticated,service_role;
grant execute on function public.phase4b_deadline_probe() to authenticated;
commit;
notify pgrst,'reload schema';
-- After one ordinary doctor JWT POST, expect SQLSTATE 57014; inspect zero marks/
-- active probe calls independently before cleanup. Do not loop on a client timeout.
