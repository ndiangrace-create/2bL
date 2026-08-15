-- 校正舊的每日顯示狀態：非最後參加日不得顯示已退／沒收／轉活動金。
-- 不刪退款交易、不改 registrations 的押金結果、不改任何金額。
begin;

create temporary table daily_deposit_status_preview on commit drop as
with reg_last as (
  select r.tenant_id,r.id,
    (
      select max(value::date)
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(r.selected_dates_json)='array' then r.selected_dates_json
          when jsonb_typeof(r.selected_dates_json)='string' then coalesce(nullif(r.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb)
          else '[]'::jsonb
        end
      ) d(value)
      where value ~ '^\d{4}-\d{2}-\d{2}$'
    ) as last_day
  from public.registrations r
)
select o.tenant_id,o.registration_id,o.activity_date,o.deposit_status
from public.registration_day_ops o
join reg_last r on r.tenant_id=o.tenant_id and r.id=o.registration_id
where o.activity_date<>r.last_day
  and o.deposit_status in ('已退押金','已隨退款退還','押金沒收','已轉活動金');

-- 預覽：正式套用時先核對影響筆數。
select tenant_id,activity_date,deposit_status,count(*) as display_rows_to_fix
from daily_deposit_status_preview
group by tenant_id,activity_date,deposit_status
order by activity_date,deposit_status;

update public.registration_day_ops o
set deposit_status='不適用',updated_at=now()
from daily_deposit_status_preview p
where o.tenant_id=p.tenant_id
  and o.registration_id=p.registration_id
  and o.activity_date=p.activity_date
  and o.deposit_status=p.deposit_status;

commit;
