-- PREPARED ONLY. Approved diagnostic cleanup after independent execution-end check.
begin;
set local lock_timeout='1s';
set local statement_timeout='5s';
do $$begin
 if exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like '%phase4b_deadline_probe%') then
   raise exception 'Active diagnostic call; inspect and wait, never terminate it';
 end if;
end$$;
drop function public.phase4b_deadline_probe();
drop table rx_private.phase4b_deadline_probe_marks;
commit;
notify pgrst,'reload schema';
