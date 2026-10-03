-- Run after schema.sql and cancellation.sql via an owner connection. No external requests are made.
-- All fixtures and reservations roll back. Any failed assertion raises an error.
begin;
insert into auth.users(id, aud, role, is_anonymous, created_at, updated_at) values
 ('cf8424c1-1001-4000-8000-000000000001', 'authenticated', 'authenticated', true, now(), now()),
 ('cf8424c1-1001-4000-8000-000000000002', 'authenticated', 'authenticated', true, now(), now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cf8424c1-1001-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select set_config('request.jwt.claim.sub', 'cf8424c1-1001-4000-8000-000000000001', true);
insert into public.create_projects(id, owner_id, document, version) values
 ('test_security_a1', 'cf8424c1-1001-4000-8000-000000000001', '{"id":"test_security_a1","version":0}', 0),
 ('test_security_a2', 'cf8424c1-1001-4000-8000-000000000001', '{"id":"test_security_a2","version":0}', 0),
 ('test_security_a3', 'cf8424c1-1001-4000-8000-000000000001', '{"id":"test_security_a3","version":0}', 0);
do $$ declare i integer; begin
  if (select count(*) from public.create_projects) <> 3 then raise exception 'RLS own SELECT failed'; end if;
  begin
    insert into public.create_projects(id,owner_id,document,version) values ('test_security_a4','cf8424c1-1001-4000-8000-000000000001','{"id":"test_security_a4","version":0}',0);
    raise exception 'three-project cap failed';
  exception when raise_exception then
    if sqlerrm <> 'project limit reached' then raise; end if;
  end;
  if not public.create_reserve_run('test_security_a1','test_run_a_first') then raise exception 'first reservation failed'; end if;
  if public.create_reserve_run('test_security_a1','test_run_a_first') then raise exception 'idempotency failed'; end if;
  if public.create_is_run_cancel_requested('test_security_a1','test_run_a_first') then raise exception 'new run unexpectedly cancelled'; end if;
  begin
    perform public.create_reserve_run('test_security_a1','test_run_a_second');
    raise exception 'active run lock failed';
  exception when object_not_in_prerequisite_state then null; end;
  if not public.create_reserve_research('test_run_a_first') then raise exception 'research reservation failed'; end if;
  if public.create_reserve_research('test_run_a_first') then raise exception 'research one-per-run failed'; end if;
  -- A cancellation can beat the reserve RPC. Its tombstone blocks that run ID
  -- without creating a run row, taking a lease, or consuming message quota.
  if not public.create_request_run_cancel('test_security_a2','test_cancel_before_reserve') then raise exception 'pre-reservation cancellation was not recorded'; end if;
  if public.create_is_run_cancel_requested('test_security_a2','test_cancel_before_reserve') then raise exception 'unreserved cancellation reported as a running handler'; end if;
  if public.create_reserve_run('test_security_a2','test_cancel_before_reserve') then raise exception 'cancelled request was reserved'; end if;
  for i in 1..29 loop
    if not public.create_request_run_cancel('test_security_a2','test_cancel_pre_' || i::text) then raise exception 'pre-reservation cancel quota denied early'; end if;
  end loop;
  begin
    perform public.create_request_run_cancel('test_security_a2','test_cancel_pre_over');
    raise exception 'pre-reservation cancellation quota failed';
  exception when raise_exception then
    if sqlerrm <> 'user run cancellation limit reached' then raise; end if;
  end;
  -- Already-running work remains cancellable after the tombstone abuse cap.
  if not public.create_request_run_cancel('test_security_a1','test_run_a_first') then raise exception 'active run cancellation was not recorded'; end if;
  if not public.create_is_run_cancel_requested('test_security_a1','test_run_a_first') then raise exception 'active cancellation marker not readable'; end if;
  if not public.create_request_run_cancel('test_security_a1','test_run_a_first') then raise exception 'repeated cancellation was not idempotent'; end if;
  begin
    perform public.create_reserve_run('test_security_a1','test_run_a_second');
    raise exception 'cancellation request released active lock';
  exception when object_not_in_prerequisite_state then null; end;
  -- A mismatched run must not release the actual lock.
  if public.create_finish_run('test_security_a1','test_missing_run','complete','{}') then raise exception 'wrong run released lock'; end if;
  begin
    perform public.create_reserve_run('test_security_a1','test_run_a_second');
    raise exception 'mismatched finish released active run';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform count(*) from private.create_runs;
    raise exception 'quota ledger is readable by visitor';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"cf8424c1-1001-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
select set_config('request.jwt.claim.sub', 'cf8424c1-1001-4000-8000-000000000002', true);
insert into public.create_projects(id,owner_id,document,version) values ('test_security_b1','cf8424c1-1001-4000-8000-000000000002','{"id":"test_security_b1","version":0}',0);
do $$ begin
  if (select count(*) from public.create_projects) <> 1 then raise exception 'RLS SELECT leaked other owner'; end if;
  if exists (select 1 from public.create_projects where id = 'test_security_a1') then raise exception 'cross-owner project visible'; end if;
  update public.create_projects set version=1,document='{"id":"test_security_a1","version":1}' where id='test_security_a1';
  if found then raise exception 'cross-owner UPDATE succeeded'; end if;
  delete from public.create_projects where id='test_security_a1';
  if found then raise exception 'cross-owner DELETE succeeded'; end if;
  begin
    insert into public.create_projects(id,owner_id,document,version) values ('test_security_stolen','cf8424c1-1001-4000-8000-000000000001','{"id":"test_security_stolen","version":0}',0);
    raise exception 'cross-owner INSERT succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.create_projects set owner_id='cf8424c1-1001-4000-8000-000000000001' where id='test_security_b1';
    raise exception 'owner reassignment succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_reserve_run('test_security_a1','test_run_stolen');
    raise exception 'cross-owner RPC reserve succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_finish_run('test_security_a1','test_run_a_first','complete','{}');
    raise exception 'cross-owner RPC finish succeeded';
  exception when insufficient_privilege then null; end;
  if public.create_request_run_cancel('test_security_a1','test_run_a_first') then raise exception 'cross-owner cancellation request succeeded'; end if;
  if public.create_is_run_cancel_requested('test_security_a1','test_run_a_first') then raise exception 'cross-owner cancellation marker leaked'; end if;
  if public.create_reserve_research('test_run_a_first') then raise exception 'cross-owner research succeeded'; end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"cf8424c1-1001-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select set_config('request.jwt.claim.sub', 'cf8424c1-1001-4000-8000-000000000001', true);
do $$ declare i integer; run_id text; begin
  if not public.create_finish_run('test_security_a1','test_run_a_first','cancelled','{"model":"test","inputTokens":0,"outputTokens":0}') then raise exception 'cancelled finish did not release lock'; end if;
  if public.create_is_run_cancel_requested('test_security_a1','test_run_a_first') then raise exception 'finished run still reported active cancellation'; end if;
  for i in 1..29 loop
    run_id := 'test_quota_run_' || i::text;
    if not public.create_reserve_run('test_security_a1',run_id) then raise exception 'message reservation prematurely denied'; end if;
    if i <= 4 and not public.create_reserve_research(run_id) then raise exception 'research reservation prematurely denied'; end if;
    if i = 5 and public.create_reserve_research(run_id) then raise exception 'five-per-user research cap failed'; end if;
    perform public.create_finish_run('test_security_a1',run_id,'complete','{}');
  end loop;
  begin
    perform public.create_reserve_run('test_security_a1','test_quota_run_31');
    raise exception 'thirty-per-user message cap failed';
  exception when raise_exception then
    if sqlerrm <> 'user message limit reached' then raise; end if;
  end;
end $$;

set local role anon;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform count(*) from public.create_projects;
    raise exception 'anon can read projects';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_reserve_run('test_security_a1','test_anon_run');
    raise exception 'anon can execute reservation';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_request_run_cancel('test_security_a1','test_anon_run');
    raise exception 'anon can request run cancellation';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_is_run_cancel_requested('test_security_a1','test_anon_run');
    raise exception 'anon can inspect run cancellation';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'create security assertions passed; fixtures rolled back' as result;
