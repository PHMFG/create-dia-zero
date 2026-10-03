-- Apply after schema.sql as the database owner.
-- This durable marker covers both a running handler and the race where the
-- cancellation request reaches Supabase before the run reservation does.
begin;

create table if not exists private.create_run_cancellations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references public.create_projects(id) on delete cascade,
  run_id text not null check (char_length(run_id) between 10 and 100),
  requested_at timestamptz not null default now(),
  pre_reservation boolean not null default false,
  primary key (owner_id, project_id, run_id)
);
alter table private.create_run_cancellations add column if not exists pre_reservation boolean not null default false;
create index if not exists create_run_cancellations_requested_idx
  on private.create_run_cancellations(requested_at);
create index if not exists create_run_cancellations_owner_date_idx
  on private.create_run_cancellations(owner_id, requested_at desc) where pre_reservation;
alter table private.create_run_cancellations enable row level security;
revoke all on private.create_run_cancellations from public, anon, authenticated;

create or replace function private.create_request_run_cancel(p_project_id text, p_run_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day timestamptz := pg_catalog.date_trunc('day', v_now at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if v_owner is null then raise exception 'authenticated session required' using errcode = '42501'; end if;
  if p_project_id is null or p_run_id is null or char_length(p_run_id) not between 10 and 100 then
    raise exception 'invalid run' using errcode = '22023';
  end if;

  -- Serialize against reservation and completion so a late cancel cannot leave
  -- a tombstone after a completed run, and a fast cancel cannot miss a new run.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:quota-reservation', 0));
  delete from private.create_run_cancellations where requested_at <= v_now - interval '30 days';
  if not exists (select 1 from public.create_projects where id = p_project_id and owner_id = v_owner) then return false; end if;

  if exists (select 1 from private.create_runs where owner_id = v_owner and run_id = p_run_id) then
    if exists (
      select 1 from private.create_runs r
      join private.create_run_locks l on l.project_id = r.project_id and l.owner_id = r.owner_id and l.run_id = r.run_id
      where r.owner_id = v_owner and r.run_id = p_run_id and r.project_id = p_project_id
        and r.status = 'running' and l.expires_at > v_now
    ) then
      insert into private.create_run_cancellations(owner_id, project_id, run_id, requested_at, pre_reservation)
      values (v_owner, p_project_id, p_run_id, v_now, false)
      on conflict (owner_id, project_id, run_id) do update
        set requested_at = excluded.requested_at, pre_reservation = false;
      return true;
    end if;
    return false;
  end if;

  -- If no run row exists yet, this is a tombstone. create_reserve_run checks it
  -- under the same advisory lock and declines the later reservation without
  -- creating a run row, consuming quota, or holding a project lease.
  if exists (select 1 from private.create_run_cancellations where owner_id = v_owner and project_id = p_project_id and run_id = p_run_id) then return true; end if;
  if (select count(*) from private.create_run_cancellations where owner_id = v_owner and pre_reservation and requested_at >= v_day) >= 30 then
    raise exception 'user run cancellation limit reached' using errcode = 'P0001';
  end if;
  if (select count(*) from private.create_run_cancellations where pre_reservation and requested_at >= v_day) >= 200 then
    raise exception 'global run cancellation limit reached' using errcode = 'P0001';
  end if;
  insert into private.create_run_cancellations(owner_id, project_id, run_id, requested_at, pre_reservation)
  values (v_owner, p_project_id, p_run_id, v_now, true);
  return true;
end;
$$;

create or replace function private.create_is_run_cancel_requested(p_project_id text, p_run_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'authenticated session required' using errcode = '42501'; end if;
  if p_project_id is null or p_run_id is null or char_length(p_run_id) not between 10 and 100 then
    raise exception 'invalid run' using errcode = '22023';
  end if;
  return exists (
    select 1 from private.create_run_cancellations c
    join public.create_projects p on p.id = c.project_id and p.owner_id = c.owner_id
    join private.create_runs r on r.owner_id = c.owner_id and r.project_id = c.project_id and r.run_id = c.run_id
    join private.create_run_locks l on l.project_id = r.project_id and l.owner_id = r.owner_id and l.run_id = r.run_id
    where c.owner_id = v_owner and c.project_id = p_project_id and c.run_id = p_run_id
      and r.status = 'running' and l.expires_at > pg_catalog.clock_timestamp()
  );
end;
$$;

-- Keep reservation idempotency, quotas and lease semantics unchanged; only add
-- the cancellation-tombstone check before any run row or quota reservation.
create or replace function private.create_reserve_run(p_project_id text, p_run_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day timestamptz := pg_catalog.date_trunc('day', v_now at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if v_owner is null then raise exception 'authenticated session required' using errcode = '42501'; end if;
  if p_project_id is null or p_run_id is null or char_length(p_run_id) not between 10 and 100 then
    raise exception 'invalid run' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:quota-reservation', 0));
  if not exists (select 1 from public.create_projects where id = p_project_id and owner_id = v_owner) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  delete from private.create_run_cancellations where requested_at <= v_now - interval '30 days';
  if exists (
    select 1 from private.create_run_cancellations
    where owner_id = v_owner and project_id = p_project_id and run_id = p_run_id and requested_at > v_now - interval '30 days'
  ) then return false; end if;
  if exists (select 1 from private.create_runs where owner_id = v_owner and run_id = p_run_id) then return false; end if;
  update private.create_runs r set status = 'expired', finished_at = v_now
    from private.create_run_locks l
    where l.expires_at <= v_now and r.owner_id = l.owner_id and r.run_id = l.run_id and r.status = 'running';
  delete from private.create_run_locks where expires_at <= v_now;
  if exists (select 1 from private.create_run_locks where project_id = p_project_id) then
    raise exception 'active run already exists' using errcode = '55000';
  end if;
  if (select count(*) from private.create_runs where owner_id = v_owner and created_at >= v_day) >= 30 then
    raise exception 'user message limit reached' using errcode = 'P0001';
  end if;
  if (select count(*) from private.create_runs where created_at >= v_day) >= 200 then
    raise exception 'global message limit reached' using errcode = 'P0001';
  end if;
  insert into private.create_runs(owner_id, run_id, project_id, created_at) values (v_owner, p_run_id, p_project_id, v_now);
  insert into private.create_run_locks(project_id, owner_id, run_id, expires_at) values (p_project_id, v_owner, p_run_id, v_now + interval '120 seconds');
  return true;
end;
$$;

create or replace function public.create_request_run_cancel(p_project_id text, p_run_id text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.create_request_run_cancel(p_project_id, p_run_id);
$$;
create or replace function public.create_is_run_cancel_requested(p_project_id text, p_run_id text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.create_is_run_cancel_requested(p_project_id, p_run_id);
$$;

revoke all on function private.create_request_run_cancel(text,text), private.create_is_run_cancel_requested(text,text) from public, anon, authenticated;
revoke all on function public.create_request_run_cancel(text,text), public.create_is_run_cancel_requested(text,text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.create_request_run_cancel(text,text), private.create_is_run_cancel_requested(text,text) to authenticated;
grant execute on function public.create_request_run_cancel(text,text), public.create_is_run_cancel_requested(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
