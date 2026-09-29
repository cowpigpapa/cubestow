-- 알고리즘 점검 기록 요청 제한(남용 방지).
-- 브라우저(클라이언트 ID)마다 하루 10건, 로그인 사용자도 하루 10건, 전체 하루 500건까지만 기록한다.
-- 한도를 넘으면 기록하지 않고 'limit'(전체 한도는 'global-limit')을 돌려주며, 화면은 이 값을 보고 사용자에게 안내한다.
-- 같은 지문(fingerprint)은 'duplicate', 정상 기록은 'ok'. 클라이언트 ID는 브라우저가 만든 16~64자리 16진수이며 개인 정보가 아니다.
alter table public.algorithm_flags add column if not exists client_id text check (client_id ~ '^[0-9a-f]{16,64}$');
create index if not exists algorithm_flags_client_day on public.algorithm_flags (client_id, created_at);
create index if not exists algorithm_flags_user_day on public.algorithm_flags (user_id, created_at);

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
