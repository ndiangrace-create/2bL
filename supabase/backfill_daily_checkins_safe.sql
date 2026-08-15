-- 安全保留活動中的既有報到：只補每日紀錄，不刪除、不改金額。
-- 正式執行前，先跑 preview 查詢核對筆數。
begin;

create temporary table daily_checkin_backfill_preview on commit drop as
select
  r.tenant_id,
  r.session_id,
  r.id as registration_id,
  (r.checkin_at at time zone 'Asia/Taipei')::date as activity_date,
  r.checkin_at
from public.registrations r
where r.checkin_status='已報到'
  and r.checkin_at is not null
  and exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(r.selected_dates_json)='array' then r.selected_dates_json
        when jsonb_typeof(r.selected_dates_json)='string' then coalesce(nullif(r.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) d(value)
    where value=(r.checkin_at at time zone 'Asia/Taipei')::date::text
  );

-- 預覽：正式套用時要先記錄這個結果。
select tenant_id,session_id,activity_date,count(*) as records_to_preserve
from daily_checkin_backfill_preview
group by tenant_id,session_id,activity_date
order by activity_date,session_id;

insert into public.registration_day_ops(
  tenant_id,session_id,registration_id,activity_date,
  participation_status,checkin_status,checkin_at,created_at,updated_at
)
select
  tenant_id,session_id,registration_id,activity_date,
  '參加','已報到',checkin_at,now(),now()
from daily_checkin_backfill_preview
on conflict(tenant_id,registration_id,activity_date) do update
set checkin_status='已報到',
    checkin_at=coalesce(public.registration_day_ops.checkin_at,excluded.checkin_at),
    updated_at=now()
where coalesce(public.registration_day_ops.checkin_status,'')<>'已報到';

commit;
