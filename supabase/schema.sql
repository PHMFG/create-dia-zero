-- create / Dia 0. Apply to a dedicated Supabase project as the database owner.
-- No service_role key is required by the application. Projects use the visitor JWT.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.create_projects (
  id text primary key check (char_length(id) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  constraint create_project_document_id check (document->>'id' = id),
  constraint create_project_document_version check ((document->>'version')::integer = version),
  constraint create_project_document_size check (octet_length(document::text) <= 3000000)
);
create index if not exists create_projects_owner_updated_idx on public.create_projects(owner_id, updated_at desc);
alter table public.create_projects enable row level security;
revoke all on public.create_projects from public, anon, authenticated;
grant select, insert, update, delete on public.create_projects to authenticated;

drop policy if exists create_projects_select on public.create_projects;
create policy create_projects_select on public.create_projects for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists create_projects_insert on public.create_projects;
create policy create_projects_insert on public.create_projects for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists create_projects_update on public.create_projects;
create policy create_projects_update on public.create_projects for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists create_projects_delete on public.create_projects;
create policy create_projects_delete on public.create_projects for delete to authenticated using ((select auth.uid()) = owner_id);

-- These ledgers are deliberately outside the exposed API schema. Quota reservation
-- needs privileges unavailable to clients; only narrow, identity-checked RPCs write them.
create table if not exists private.create_runs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null check (char_length(run_id) between 10 and 100),
  project_id text references public.create_projects(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'complete', 'failed', 'cancelled', 'expired')),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object' and octet_length(usage::text) <= 8000),
  research_reserved_at timestamptz,
  research_credits integer not null default 0 check (research_credits in (0, 3)),
  primary key (owner_id, run_id)
);
create index if not exists create_runs_date_idx on private.create_runs(created_at);
create index if not exists create_runs_owner_date_idx on private.create_runs(owner_id, created_at);
create index if not exists create_runs_project_idx on private.create_runs(project_id);
create index if not exists create_runs_research_date_idx on private.create_runs(research_reserved_at) where research_reserved_at is not null;

create table if not exists private.create_run_locks (
  project_id text primary key references public.create_projects(id) on delete cascade,
  owner_id uuid not null,
  run_id text not null,
  expires_at timestamptz not null,
  foreign key (owner_id, run_id) references private.create_runs(owner_id, run_id) on delete cascade
);
create index if not exists create_run_locks_owner_run_idx on private.create_run_locks(owner_id, run_id);
alter table private.create_runs enable row level security;
alter table private.create_run_locks enable row level security;
revoke all on private.create_runs, private.create_run_locks from public, anon, authenticated;

-- The insertion cap is enforced in PostgreSQL as well as the application, so parallel
-- inserts and direct Data API requests cannot create more than three projects.
create or replace function private.create_project_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new.owner_id <> auth.uid() then
    raise exception 'project owner required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:projects:' || new.owner_id::text, 0));
  if (select count(*) from public.create_projects where owner_id = new.owner_id) >= 3 then
    raise exception 'project limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.create_project_cap() from public, anon, authenticated;
drop trigger if exists create_project_cap on public.create_projects;
create trigger create_project_cap before insert on public.create_projects for each row execute function private.create_project_cap();

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
  -- A single transaction lock serializes quota reservations globally. The AI runs
  -- outside this transaction; this lock is held only while checking small ledgers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:quota-reservation', 0));
  if not exists (select 1 from public.create_projects where id = p_project_id and owner_id = v_owner) then
    raise exception 'project not found' using errcode = '42501';
  end if;
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

create or replace function private.create_finish_run(p_project_id text, p_run_id text, p_status text, p_usage jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'authenticated session required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('complete', 'failed', 'cancelled') or p_usage is null or jsonb_typeof(p_usage) <> 'object' or octet_length(p_usage::text) > 8000 then
    raise exception 'invalid completion' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:quota-reservation', 0));
  if not exists (select 1 from public.create_projects where id = p_project_id and owner_id = v_owner) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  update private.create_runs set status = p_status, usage = p_usage, finished_at = pg_catalog.clock_timestamp()
    where owner_id = v_owner and run_id = p_run_id and project_id = p_project_id and status = 'running';
  -- A delayed completion cannot release the lock belonging to a newer request.
  delete from private.create_run_locks where project_id = p_project_id and owner_id = v_owner and run_id = p_run_id;
  return found;
end;
$$;

create or replace function private.create_reserve_research(p_run_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_day timestamptz := pg_catalog.date_trunc('day', v_now at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_month timestamptz := pg_catalog.date_trunc('month', v_now at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if v_owner is null then raise exception 'authenticated session required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create:quota-reservation', 0));
  if not exists (
    select 1 from private.create_runs r join public.create_projects p on p.id = r.project_id
    join private.create_run_locks l on l.project_id = r.project_id and l.owner_id = r.owner_id and l.run_id = r.run_id
    where r.owner_id = v_owner and r.run_id = p_run_id and r.status = 'running' and p.owner_id = v_owner and l.expires_at > v_now
  ) then return false; end if;
  -- Exactly one reservation per run. Even failures retain credits because a timeout
  -- cannot prove that the external service did not charge for a request.
  if exists (select 1 from private.create_runs where owner_id = v_owner and run_id = p_run_id and research_reserved_at is not null) then return false; end if;
  if (select count(*) from private.create_runs where owner_id = v_owner and research_reserved_at >= v_day) >= 5 then return false; end if;
  if (select count(*) from private.create_runs where research_reserved_at >= v_day) >= 25 then return false; end if;
  if (select coalesce(sum(research_credits), 0) from private.create_runs where research_reserved_at >= v_month) + 3 > 750 then return false; end if;
  update private.create_runs set research_reserved_at = v_now, research_credits = 3 where owner_id = v_owner and run_id = p_run_id;
  return true;
end;
$$;

-- API wrappers remain SECURITY INVOKER. Privileged helpers are unexposed and check
-- auth.uid() and project ownership themselves; they grant no table access to users.
create or replace function public.create_reserve_run(p_project_id text, p_run_id text)
returns boolean language sql security invoker set search_path = '' as $$ select private.create_reserve_run(p_project_id, p_run_id); $$;
create or replace function public.create_finish_run(p_project_id text, p_run_id text, p_status text, p_usage jsonb default '{}'::jsonb)
returns boolean language sql security invoker set search_path = '' as $$ select private.create_finish_run(p_project_id, p_run_id, p_status, p_usage); $$;
create or replace function public.create_reserve_research(p_run_id text)
returns boolean language sql security invoker set search_path = '' as $$ select private.create_reserve_research(p_run_id); $$;

revoke all on function private.create_reserve_run(text,text), private.create_finish_run(text,text,text,jsonb), private.create_reserve_research(text) from public, anon, authenticated;
revoke all on function public.create_reserve_run(text,text), public.create_finish_run(text,text,text,jsonb), public.create_reserve_research(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.create_reserve_run(text,text), private.create_finish_run(text,text,text,jsonb), private.create_reserve_research(text) to authenticated;
grant execute on function public.create_reserve_run(text,text), public.create_finish_run(text,text,text,jsonb), public.create_reserve_research(text) to authenticated;

comment on schema private is 'Internal create quotas. Do not add this schema to the Supabase Data API exposed schemas.';
comment on table public.create_projects is 'Visitor-owned create projects. RLS applies to the owner UUID, including anonymous Auth users.';
notify pgrst, 'reload schema';
commit;
