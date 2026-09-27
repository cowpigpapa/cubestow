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
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{8,64}$')
);

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
