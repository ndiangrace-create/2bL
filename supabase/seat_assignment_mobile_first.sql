-- 手機優先排位：保留既有活動、攤位與人工排位，只重建 system_batch 自動排位。
-- 同一筆報名跨日使用同一組位置；多攤依 map_order 取得連續位置。
create or replace function public.sync_seat_roster_mobile_atomic(
  p_tenant_id text,
  p_session_id text,
  p_actor_email text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_session public.sessions%rowtype;
  v_session_days date[] := '{}';
  v_days date[] := '{}';
  v_codes text[] := '{}';
  v_reg record;
  v_start record;
  v_day date;
  v_need integer;
  v_assigned integer := 0;
  v_waiting integer := 0;
  v_now timestamptz := now();
begin
  if coalesce(trim(p_tenant_id),'')='' or coalesce(trim(p_session_id),'')='' then
    raise exception '缺少租戶或場次編號';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_tenant_id||'|'||p_session_id||'|seat-mobile'));
  select * into v_session from public.sessions
  where tenant_id=p_tenant_id and id=p_session_id for update;
  if not found then raise exception '找不到場次'; end if;

  -- 先沿用既有安全名單規則補齊位置；此函式與下方重排同屬一個交易，失敗會全部回復。
  v_base := public.sync_seat_roster_atomic(p_tenant_id,p_session_id,p_actor_email);

  -- 先暫存目前的正式自動排位；重排時優先沿用第一天原位置，避免活動中無故換位。
  create temporary table if not exists seat_mobile_previous(
    activity_date date, seat_code text, registration_id text
  ) on commit drop;
  truncate table seat_mobile_previous;
  insert into seat_mobile_previous(activity_date,seat_code,registration_id)
  select activity_date,seat_code,registration_id::text
  from public.registration_day_seats
  where tenant_id=p_tenant_id and session_id=p_session_id
    and assigned_type='auto' and assigned_by='system_batch';

  select coalesce(array_agg(d order by d),'{}'::date[]) into v_session_days
  from (
    select distinct coalesce(nullif(x->>'date',''),nullif(trim(both '"' from x::text),''))::date d
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(v_session.dates_json,'[]'::jsonb))='array' then coalesce(v_session.dates_json,'[]'::jsonb)
        when jsonb_typeof(v_session.dates_json)='string' then coalesce(nullif(v_session.dates_json#>>'{}','')::jsonb,'[]'::jsonb)
        else '[]'::jsonb
      end
    ) x
    where coalesce(nullif(x->>'date',''),nullif(trim(both '"' from x::text),'')) ~ '^\d{4}-\d{2}-\d{2}$'
  ) q;
  if coalesce(array_length(v_session_days,1),0)=0 then v_session_days:=array[current_date]; end if;

  -- 人工安排與加價選位完全保留；只移除可安全重建的系統自動排位。
  delete from public.registration_day_seats
  where tenant_id=p_tenant_id and session_id=p_session_id
    and assigned_type='auto' and assigned_by='system_batch';

  for v_reg in
    select r.*,
      coalesce((select min(coalesce(p.paid_at,p.created_at)) from public.payments p
        where p.tenant_id=r.tenant_id and coalesce(p.registration_id,p.reg_id)=r.id and p.status='已確認'),r.created_at) paid_order
    from public.registrations r
    where r.tenant_id=p_tenant_id and r.session_id=p_session_id
      and coalesce(r.review_status,'')='已錄取'
      and coalesce(r.seat_choice_intent,'auto')<>'paid'
      and coalesce(r.transfer_status,'') not in ('已轉場','已轉活動金','已退費','已退款','申請退費','退費中','已取消')
      and (coalesce(r.payment_status,'')='免費' or exists(
        select 1 from public.payments p where p.tenant_id=r.tenant_id
        and coalesce(p.registration_id,p.reg_id)=r.id and p.status='已確認'))
    order by paid_order,r.created_at,r.id
  loop
    v_need:=greatest(coalesce(v_reg.stall_count,1),1)::integer;
    select coalesce(array_agg(d order by d),'{}'::date[]) into v_days
    from (
      select d from unnest(v_session_days) d
      where (
        jsonb_typeof(case when jsonb_typeof(v_reg.selected_dates_json)='string' then coalesce(nullif(v_reg.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb) else coalesce(v_reg.selected_dates_json,'[]'::jsonb) end)<>'array'
        or jsonb_array_length(case when jsonb_typeof(v_reg.selected_dates_json)='string' then coalesce(nullif(v_reg.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb) else coalesce(v_reg.selected_dates_json,'[]'::jsonb) end)=0
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_reg.selected_dates_json)='string' then coalesce(nullif(v_reg.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb) else coalesce(v_reg.selected_dates_json,'[]'::jsonb) end) z where coalesce(nullif(z->>'date',''),trim(both '"' from z::text))=d::text)
      )
      and not exists(select 1 from public.registration_day_ops o where o.tenant_id=p_tenant_id and o.registration_id=v_reg.id and o.activity_date=d and o.participation_status='已取消')
    ) selected_days;
    if coalesce(array_length(v_days,1),0)=0 then continue; end if;

    -- 優先保留這位攤商原本第一個活動日的整組位置。
    select coalesce(array_agg(seat_code order by seat_code),'{}'::text[]) into v_codes
    from seat_mobile_previous
    where registration_id=v_reg.id::text
      and activity_date=(select min(activity_date) from seat_mobile_previous where registration_id=v_reg.id::text);
    if coalesce(array_length(v_codes,1),0)<>v_need or exists(
      select 1 from public.registration_day_seats ds
      where ds.tenant_id=p_tenant_id and ds.session_id=p_session_id
        and ds.activity_date=any(v_days) and ds.seat_code=any(v_codes)
        and ds.registration_id<>v_reg.id
    ) then v_codes:='{}'; end if;

    -- 沒有可沿用的位置時，才尋找新的連續位置。
    if coalesce(array_length(v_codes,1),0)=0 then
    for v_start in
      select q.rn from (
        select row_number() over(order by s.map_order,coalesce(s.seat_code,s.stall_no)) rn
        from public.stalls s where s.tenant_id=p_tenant_id and s.session_id=p_session_id
          and s.seat_type='auto' and s.is_active is true
      ) q order by q.rn
    loop
      select coalesce(array_agg(code order by rn),'{}'::text[]) into v_codes
      from (
        select row_number() over(order by s.map_order,coalesce(s.seat_code,s.stall_no)) rn,
          coalesce(s.seat_code,s.stall_no) code
        from public.stalls s where s.tenant_id=p_tenant_id and s.session_id=p_session_id
          and s.seat_type='auto' and s.is_active is true
      ) seats where rn between v_start.rn and v_start.rn+v_need-1;
      if coalesce(array_length(v_codes,1),0)=v_need and not exists(
        select 1 from public.registration_day_seats ds
        where ds.tenant_id=p_tenant_id and ds.session_id=p_session_id
          and ds.activity_date=any(v_days) and ds.seat_code=any(v_codes)
          and ds.registration_id<>v_reg.id
      ) then exit; end if;
      v_codes:='{}';
    end loop;
    end if;

    if coalesce(array_length(v_codes,1),0)<>v_need then
      v_waiting:=v_waiting+1;
      continue;
    end if;
    foreach v_day in array v_days loop
      delete from public.registration_day_seats where tenant_id=p_tenant_id and session_id=p_session_id and activity_date=v_day and registration_id=v_reg.id and assigned_type='auto';
      insert into public.registration_day_seats(tenant_id,session_id,activity_date,seat_code,registration_id,assigned_type,assigned_by,assigned_at,created_at,updated_at)
      select p_tenant_id,p_session_id,v_day,code,v_reg.id,'auto','system_batch',v_now,v_now,v_now from unnest(v_codes) code;
      insert into public.registration_day_ops(tenant_id,session_id,registration_id,activity_date,participation_status,stall_number,created_at,updated_at)
      values(p_tenant_id,p_session_id,v_reg.id,v_day,'參加',array_to_string(v_codes,','),v_now,v_now)
      on conflict(tenant_id,registration_id,activity_date) do update set stall_number=excluded.stall_number,updated_at=v_now;
    end loop;
    update public.registrations set stall_number=array_to_string(v_codes,','),seat_choice_status='locked',seat_choice_type='auto',updated_at=v_now
    where tenant_id=p_tenant_id and id=v_reg.id;
    v_assigned:=v_assigned+1;
  end loop;

  return coalesce(v_base,'{}'::jsonb)||jsonb_build_object('samePositionAssigned',v_assigned,'samePositionWaiting',v_waiting,'mobileFirst',true);
end;
$$;

revoke all on function public.sync_seat_roster_mobile_atomic(text,text,text) from public, anon, authenticated;
grant execute on function public.sync_seat_roster_mobile_atomic(text,text,text) to service_role;
