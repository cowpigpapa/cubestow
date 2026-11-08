-- 알고리즘 점검 기록 기능 종료: 이전에 배포된 클라이언트도 새 기록을 만들 수 없게 한다.
revoke execute on function public.record_algorithm_flag(text, text, jsonb, jsonb, jsonb, text, text)
from anon, authenticated;
