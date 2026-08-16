begin;

-- 押金由現場人員實體收退，系統只維護交付狀態；不建立正式退款金流。
-- 舊的 deposit scope 交易保留原紀錄但改為已作廢，避免計入正式退款。
update public.refund_transactions
set status='已作廢',
    refund_note=concat_ws('｜',nullif(refund_note,''),'押金為現場實體收退，改列狀態紀錄'),
    updated_at=now()
where tenant_id='tuibile' and refund_scope='deposit' and status='已退款';

create or replace function public.set_deposit_return_status_atomic(
  p_tenant_id text,
  p_registration_id text,
  p_activity_date date,
  p_returned boolean,
  p_actor_email text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_reg public.registrations%rowtype;
  v_op public.registration_day_ops%rowtype;
  v_deposit numeric;
  v_status text;
begin
  select * into v_reg
  from public.registrations
  where tenant_id=p_tenant_id and id=p_registration_id
  for update;
  if not found then raise exception '找不到報名'; end if;

  v_deposit=greatest(coalesce(v_reg.deposit,0),0);
  if v_deposit<=0 then raise exception '此報名沒有押金'; end if;

  select * into v_op
  from public.registration_day_ops
  where tenant_id=p_tenant_id and registration_id=p_registration_id
    and activity_date=p_activity_date
  for update;
  if not found then raise exception '找不到當日現場紀錄'; end if;

  v_status=coalesce(v_reg.deposit_refunded,'未退押金');
  if p_returned then
    if v_status='已退押金' then
      return jsonb_build_object('success',true,'changed',false,'returned',true,'deposit_amount',v_deposit);
    end if;
    if v_status in ('已隨退款退還','已轉活動金','押金沒收') then
      raise exception '此押金已用其他方式結案，不可改為現場退還';
    end if;
    if coalesce(v_op.teardown_status,'')<>'已撤場' then
      raise exception '請先完成當日撤場，再退押金';
    end if;
    update public.registrations
    set deposit_refunded='已退押金'
    where tenant_id=p_tenant_id and id=p_registration_id;
    update public.registration_day_ops
    set deposit_status='已退押金',deposit_refunded_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and registration_id=p_registration_id
      and activity_date=p_activity_date;
  else
    if v_status='未退押金' then
      return jsonb_build_object('success',true,'changed',false,'returned',false,'deposit_amount',v_deposit);
    end if;
    if v_status<>'已退押金' then
      raise exception '只有現場標記的已退押金可以撤銷';
    end if;
    update public.registrations
    set deposit_refunded='未退押金'
    where tenant_id=p_tenant_id and id=p_registration_id;
    update public.registration_day_ops
    set deposit_status='未退押金',deposit_refunded_at=null,updated_at=now()
    where tenant_id=p_tenant_id and registration_id=p_registration_id
      and activity_date=p_activity_date;
  end if;

  return jsonb_build_object(
    'success',true,'changed',true,'returned',p_returned,
    'deposit_amount',v_deposit,'actor',coalesce(p_actor_email,''),'note',coalesce(p_note,'')
  );
end;
$$;

revoke all on function public.set_deposit_return_status_atomic(text,text,date,boolean,text,text)
from public,anon,authenticated;
grant execute on function public.set_deposit_return_status_atomic(text,text,date,boolean,text,text)
to service_role;

commit;
