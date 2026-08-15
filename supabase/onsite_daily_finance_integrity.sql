begin;

create table if not exists public.member_notifications (
  id text primary key,
  tenant_id text not null,
  member_email text not null,
  registration_id text,
  title text not null default '系統通知',
  message text not null default '',
  kind text not null default 'system',
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists member_notifications_member_idx
  on public.member_notifications (tenant_id, lower(member_email), created_at desc);

alter table public.member_notifications enable row level security;
revoke all on table public.member_notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.member_notifications to service_role;

create or replace function public.guard_deposit_refund_transaction()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_selected jsonb;
  v_last_day date;
  v_refund_day date;
begin
  if not coalesce(new.deposit_included,false) then return new; end if;

  select * into v_reg
  from public.registrations
  where tenant_id=new.tenant_id and id=new.registration_id;
  if not found then raise exception '找不到押金所屬報名'; end if;

  v_selected := case
    when jsonb_typeof(v_reg.selected_dates_json)='array' then v_reg.selected_dates_json
    when jsonb_typeof(v_reg.selected_dates_json)='string' then coalesce(nullif(v_reg.selected_dates_json#>>'{}','')::jsonb,'[]'::jsonb)
    else '[]'::jsonb
  end;
  select max(value::date) into v_last_day
  from jsonb_array_elements_text(v_selected) x(value)
  where value ~ '^\d{4}-\d{2}-\d{2}$';
  select max(value::date) into v_refund_day
  from jsonb_array_elements_text(coalesce(new.activity_dates,'[]'::jsonb)) x(value)
  where value ~ '^\d{4}-\d{2}-\d{2}$';

  if new.refund_scope='deposit' then
    if v_refund_day is null or v_refund_day<>v_last_day then
      raise exception '押金只能在最後一個參加日退還';
    end if;
    if not exists (
      select 1 from public.registration_day_ops d
      where d.tenant_id=new.tenant_id and d.registration_id=new.registration_id
        and d.activity_date=v_last_day and d.teardown_status='已撤場'
    ) then
      raise exception '必須先完成最後一天撤場才能退押金';
    end if;
  elsif new.refund_scope='partial_day' then
    raise exception '仍保留其他參加日，部分日期退款不可提前退押金';
  end if;

  if exists (
    select 1 from public.refund_transactions t
    where t.tenant_id=new.tenant_id and t.registration_id=new.registration_id
      and t.deposit_included and t.status='已退款' and t.id<>new.id
  ) then
    raise exception '押金已處理，不可重複退還';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_deposit_refund_transaction on public.refund_transactions;
create trigger guard_deposit_refund_transaction
before insert or update of deposit_included,status,activity_dates,refund_scope
on public.refund_transactions
for each row execute function public.guard_deposit_refund_transaction();

revoke execute on function public.guard_deposit_refund_transaction() from public, anon, authenticated;
grant execute on function public.guard_deposit_refund_transaction() to service_role;

commit;
