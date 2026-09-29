create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "users read own projects" on public.projects;
drop policy if exists "users create own projects" on public.projects;
drop policy if exists "users update own projects" on public.projects;
drop policy if exists "users delete own projects" on public.projects;

create policy "users read own projects" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "users create own projects" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users update own projects" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users delete own projects" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists projects_user_updated_idx on public.projects (user_id, updated_at desc);

create table if not exists public.visitor_counts (
  counter_key text primary key,
  count bigint not null default 0 check (count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.visitor_counts enable row level security;

drop function if exists public.increment_visitor(text, boolean);

create function public.increment_visitor(p_counter_key text, should_increment boolean default true)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_count bigint;
begin
  if p_counter_key !~ '^visitors-(total|[0-9]{4}-[0-9]{2}-[0-9]{2})$' then
    raise exception 'invalid visitor counter key';
  end if;
  if should_increment then
    insert into public.visitor_counts (counter_key, count)
    values (p_counter_key, 1)
    on conflict (counter_key) do update set count = visitor_counts.count + 1, updated_at = now()
    returning count into current_count;
  else
    select count into current_count from public.visitor_counts where visitor_counts.counter_key = p_counter_key;
  end if;
  return coalesce(current_count, 0);
end;
$$;

revoke all on function public.increment_visitor(text, boolean) from public;
grant execute on function public.increment_visitor(text, boolean) to anon, authenticated;

create table if not exists public.admin_users (
  email text primary key check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
insert into public.admin_users (email) values ('juan.hjlee@gmail.com') on conflict do nothing;
alter table public.admin_users enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.admin_users where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count bigint not null default 1 check (visit_count > 0)
);
alter table public.user_access enable row level security;
drop policy if exists "admins read access stats" on public.user_access;
drop policy if exists "admins read admin list" on public.admin_users;
create policy "admins read access stats" on public.user_access for select to authenticated using ((select public.is_admin()));
create policy "admins read admin list" on public.admin_users for select to authenticated using ((select public.is_admin()));

create or replace function public.record_user_access() returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or current_email = '' then raise exception 'authentication required'; end if;
  insert into public.user_access (user_id, email) values (auth.uid(), current_email)
  on conflict (user_id) do update set email = excluded.email, last_seen_at = now(), visit_count = user_access.visit_count + 1;
end;
$$;

create or replace function public.grant_admin(p_email text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare normalized_email text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid email'; end if;
  insert into public.admin_users (email, created_by) values (normalized_email, auth.uid()) on conflict (email) do nothing;
end;
$$;

create or replace function public.revoke_admin(p_email text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare normalized_email text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if normalized_email = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception 'cannot revoke yourself'; end if;
  delete from public.admin_users where email = normalized_email;
end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.record_user_access() from public;
revoke all on function public.grant_admin(text) from public;
revoke all on function public.revoke_admin(text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.record_user_access() to authenticated;
grant execute on function public.grant_admin(text) to authenticated;
grant execute on function public.revoke_admin(text) to authenticated;
grant select on public.user_access to authenticated;
grant select on public.admin_users to authenticated;

-- 알고리즘 점검 기록: 자동 평가(result-review.js)가 "알고리즘이 잘못했을 수 있다"고 본 결과를 모은다.
-- 누구나(비로그인 포함) 함수로만 기록할 수 있고, 읽기·삭제는 관리자만 할 수 있다.
create table if not exists public.algorithm_flags (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  app_version text not null check (char_length(app_version) <= 20),
  engine text not null check (char_length(engine) <= 60),
  settings jsonb not null,
  flags jsonb not null,
  input jsonb not null,
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{8,64}

alter table public.algorithm_flags enable row level security;

drop policy if exists "admins read algorithm flags" on public.algorithm_flags;
drop policy if exists "admins delete algorithm flags" on public.algorithm_flags;
create policy "admins read algorithm flags" on public.algorithm_flags for select to authenticated using ((select public.is_admin()));
create policy "admins delete algorithm flags" on public.algorithm_flags for delete to authenticated using ((select public.is_admin()));
grant select, delete on public.algorithm_flags to authenticated;

-- 요청 제한: 클라이언트·사용자마다 하루 10건, 전체 하루 500건(supabase/migrations/20260929120000).
drop function if exists public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text);
create or replace function public.record_algorithm_flag(p_app_version text, p_engine text, p_settings jsonb, p_flags jsonb, p_input jsonb, p_fingerprint text, p_client text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client text := case when p_client ~ '^[0-9a-f]{16,64}$' then p_client else null end;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{8,64}$' then raise exception 'invalid fingerprint'; end if;
  if jsonb_typeof(p_flags) <> 'array' or jsonb_array_length(p_flags) = 0 then raise exception 'flags required'; end if;
  if pg_column_size(p_input) > 60000 or pg_column_size(p_flags) > 8000 or pg_column_size(p_settings) > 2000 then raise exception 'payload too large'; end if;
  -- 클라이언트 ID가 없는 옛 화면(캐시)은 한도를 셀 수 없으므로 기록하지 않는다.
  if v_client is null then return 'client required'; end if;
  if exists (select 1 from public.algorithm_flags where fingerprint = p_fingerprint) then return 'duplicate'; end if;
  if (select count(*) from public.algorithm_flags where client_id = v_client and created_at > now() - interval '1 day') >= 10 then return 'limit'; end if;
  if auth.uid() is not null and (select count(*) from public.algorithm_flags where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then return 'limit'; end if;
  if (select count(*) from public.algorithm_flags where created_at > now() - interval '1 day') >= 500 then return 'global-limit'; end if;
  insert into public.algorithm_flags (user_id, client_id, app_version, engine, settings, flags, input, fingerprint)
  values (auth.uid(), v_client, left(coalesce(p_app_version,''), 20), left(coalesce(p_engine,''), 60), p_settings, p_flags, p_input, p_fingerprint)
  on conflict (fingerprint) do nothing;
  return 'ok';
end;
$$;

revoke all on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text, text) from public;
grant execute on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text, text) to anon, authenticated;

),
  client_id text check (client_id ~ '^[0-9a-f]{16,64}

alter table public.algorithm_flags enable row level security;

drop policy if exists "admins read algorithm flags" on public.algorithm_flags;
drop policy if exists "admins delete algorithm flags" on public.algorithm_flags;
create policy "admins read algorithm flags" on public.algorithm_flags for select to authenticated using ((select public.is_admin()));
create policy "admins delete algorithm flags" on public.algorithm_flags for delete to authenticated using ((select public.is_admin()));
grant select, delete on public.algorithm_flags to authenticated;

create or replace function public.record_algorithm_flag(p_app_version text, p_engine text, p_settings jsonb, p_flags jsonb, p_input jsonb, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{8,64}$' then raise exception 'invalid fingerprint'; end if;
  if jsonb_typeof(p_flags) <> 'array' or jsonb_array_length(p_flags) = 0 then raise exception 'flags required'; end if;
  if pg_column_size(p_input) > 60000 or pg_column_size(p_flags) > 8000 or pg_column_size(p_settings) > 2000 then raise exception 'payload too large'; end if;
  -- 하루 500건을 넘으면 조용히 버린다(남용 방지).
  if (select count(*) from public.algorithm_flags where created_at > now() - interval '1 day') >= 500 then return; end if;
  insert into public.algorithm_flags (user_id, app_version, engine, settings, flags, input, fingerprint)
  values (auth.uid(), left(coalesce(p_app_version,''), 20), left(coalesce(p_engine,''), 60), p_settings, p_flags, p_input, p_fingerprint)
  on conflict (fingerprint) do nothing;
end;
$$;

revoke all on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text) to anon, authenticated;
)
);
create index if not exists algorithm_flags_client_day on public.algorithm_flags (client_id, created_at);
create index if not exists algorithm_flags_user_day on public.algorithm_flags (user_id, created_at);

alter table public.algorithm_flags enable row level security;

drop policy if exists "admins read algorithm flags" on public.algorithm_flags;
drop policy if exists "admins delete algorithm flags" on public.algorithm_flags;
create policy "admins read algorithm flags" on public.algorithm_flags for select to authenticated using ((select public.is_admin()));
create policy "admins delete algorithm flags" on public.algorithm_flags for delete to authenticated using ((select public.is_admin()));
grant select, delete on public.algorithm_flags to authenticated;

create or replace function public.record_algorithm_flag(p_app_version text, p_engine text, p_settings jsonb, p_flags jsonb, p_input jsonb, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{8,64}$' then raise exception 'invalid fingerprint'; end if;
  if jsonb_typeof(p_flags) <> 'array' or jsonb_array_length(p_flags) = 0 then raise exception 'flags required'; end if;
  if pg_column_size(p_input) > 60000 or pg_column_size(p_flags) > 8000 or pg_column_size(p_settings) > 2000 then raise exception 'payload too large'; end if;
  -- 하루 500건을 넘으면 조용히 버린다(남용 방지).
  if (select count(*) from public.algorithm_flags where created_at > now() - interval '1 day') >= 500 then return; end if;
  insert into public.algorithm_flags (user_id, app_version, engine, settings, flags, input, fingerprint)
  values (auth.uid(), left(coalesce(p_app_version,''), 20), left(coalesce(p_engine,''), 60), p_settings, p_flags, p_input, p_fingerprint)
  on conflict (fingerprint) do nothing;
end;
$$;

revoke all on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text) to anon, authenticated;
