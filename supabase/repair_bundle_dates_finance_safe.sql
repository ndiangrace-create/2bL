-- 2BL / tuibile：早期組合報名曾把主場日期複製到另一個子場次。
-- 僅修正已確認的 7 筆歷史子報名日期與其空白日操作；不刪資料、不搬場次、不改金額／付款／退款狀態。

begin;

update public.registrations
set selected_dates_json = '["2026-08-15","2026-08-16"]'::jsonb
where tenant_id = 'tuibile'
  and session_id = 'SES_1781619409223_joi2'
  and id in ('RMRTDEII574','RMRTDVCI6LZ','RMRTJBMKV8B','RMRU1KJ3X9P','RMRVP28KRLP','RMRVP9BNQ3H')
  and selected_dates_json = '["2026-08-08","2026-08-09"]'::jsonb;

update public.registrations
set selected_dates_json = '["2026-08-08","2026-08-09"]'::jsonb
where tenant_id = 'tuibile'
  and session_id = 'SES_1781624630572_vs42'
  and id = 'RMRVP02KDAS'
  and selected_dates_json = '["2026-08-15","2026-08-16"]'::jsonb;

-- 這 14 筆皆是舊回填的空白操作狀態；只校正日期，不改報到／撤場／押金狀態。
update public.registration_day_ops
set activity_date = case activity_date
  when date '2026-08-08' then date '2026-08-15'
  when date '2026-08-09' then date '2026-08-16'
  else activity_date end,
  updated_at = now()
where tenant_id = 'tuibile'
  and session_id = 'SES_1781619409223_joi2'
  and registration_id in ('RMRTDEII574','RMRTDVCI6LZ','RMRTJBMKV8B','RMRU1KJ3X9P','RMRVP28KRLP','RMRVP9BNQ3H')
  and activity_date in (date '2026-08-08', date '2026-08-09')
  and coalesce(checkin_status,'未報到') = '未報到'
  and coalesce(teardown_status,'未撤場') = '未撤場';

update public.registration_day_ops
set activity_date = case activity_date
  when date '2026-08-15' then date '2026-08-08'
  when date '2026-08-16' then date '2026-08-09'
  else activity_date end,
  updated_at = now()
where tenant_id = 'tuibile'
  and session_id = 'SES_1781624630572_vs42'
  and registration_id = 'RMRVP02KDAS'
  and activity_date in (date '2026-08-15', date '2026-08-16')
  and coalesce(checkin_status,'未報到') = '未報到'
  and coalesce(teardown_status,'未撤場') = '未撤場';

-- 退款交易保留原場次與金額，只補上其子報名的正確活動日期供歷史對帳。
update public.refund_transactions rt
set activity_dates = r.selected_dates_json,
    updated_at = now()
from public.registrations r
where rt.tenant_id = 'tuibile'
  and r.tenant_id = rt.tenant_id
  and r.id = rt.registration_id
  and rt.refund_scope = 'full'
  and rt.status = '已退款'
  and (rt.activity_dates is null or rt.activity_dates = '[]'::jsonb)
  and jsonb_typeof(r.selected_dates_json) = 'array';

insert into public.audit_logs
  (id,tenant_id,actor_email,actor_role,action,target_table,target_id,before_json,after_json,meta_json,created_at)
values
  ('AUD_FINANCE_DATE_REPAIR_20260816','tuibile','system-repair@2b-love.com','platform_super_admin',
   'repair_bundle_child_dates_for_finance','registrations','SES_1781619409223_joi2',
   '{"mismatched_rows":7}'::jsonb,'{"mismatched_rows":0}'::jsonb,
   '{"reason":"舊組合報名子場次沿用主場日期；不改場次、金額、付款或退款狀態","highfire_dates":["2026-08-15","2026-08-16"],"meilidao_dates":["2026-08-08","2026-08-09"]}'::jsonb,
   now())
on conflict (id) do nothing;

commit;
