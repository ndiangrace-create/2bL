-- 提案檔：尚未套用正式 Supabase。
-- 目的：五個 SECURITY DEFINER RPC 只允許 Worker 使用的 service_role 執行。
-- 套用前仍須再次比對正式函式簽名與備份權限。

begin;

alter function public.claim_session_slot(text, text, integer)
  set search_path = public, pg_temp;
alter function public.release_session_slot(text, text, integer)
  set search_path = public, pg_temp;
alter function public.complete_deposit_refund_atomic(text, text, date, text, text, text, timestamptz, text)
  set search_path = public, pg_temp;
alter function public.complete_partial_day_refund_atomic(text, text, jsonb, numeric, numeric, numeric, numeric, boolean, text, text, text, timestamptz, text)
  set search_path = public, pg_temp;
alter function public.complete_registration_refund_atomic(text, jsonb, text, text, text, timestamptz, text, text)
  set search_path = public, pg_temp;

revoke execute on function public.claim_session_slot(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.release_session_slot(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_deposit_refund_atomic(text, text, date, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.complete_partial_day_refund_atomic(text, text, jsonb, numeric, numeric, numeric, numeric, boolean, text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.complete_registration_refund_atomic(text, jsonb, text, text, text, timestamptz, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_session_slot(text, text, integer)
  to service_role;
grant execute on function public.release_session_slot(text, text, integer)
  to service_role;
grant execute on function public.complete_deposit_refund_atomic(text, text, date, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.complete_partial_day_refund_atomic(text, text, jsonb, numeric, numeric, numeric, numeric, boolean, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.complete_registration_refund_atomic(text, jsonb, text, text, text, timestamptz, text, text)
  to service_role;

commit;

-- 套用後驗證：anon/authenticated 應為 false，service_role 應為 true。
select
  p.oid::regprocedure::text as function_name,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_session_slot',
    'release_session_slot',
    'complete_deposit_refund_atomic',
    'complete_partial_day_refund_atomic',
    'complete_registration_refund_atomic'
  )
order by p.proname;
