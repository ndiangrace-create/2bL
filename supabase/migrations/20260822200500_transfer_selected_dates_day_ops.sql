-- Future transfers only; no historical data update.
create or replace function public.ensure_transfer_registration_day_ops() returns trigger language plpgsql security definer set search_path=public as $$
declare v_item jsonb; v_date date; v_last date;
begin
  if new.tenant_id <> 'tuibile' then return new; end if;
  if new.transferred_from_registration_id is null then return new; end if;
  select max((case when jsonb_typeof(x)='object' then coalesce(x->>'date',x->>'value',x->>'key') else trim(both '"' from x::text) end)::date) into v_last
  from jsonb_array_elements(coalesce(new.selected_dates_json,'[]'::jsonb)) x
  where (case when jsonb_typeof(x)='object' then coalesce(x->>'date',x->>'value',x->>'key') else trim(both '"' from x::text) end) ~ '^\d{4}-\d{2}-\d{2}$';
  for v_item in select value from jsonb_array_elements(coalesce(new.selected_dates_json,'[]'::jsonb)) loop
    begin v_date := (case when jsonb_typeof(v_item)='object' then coalesce(v_item->>'date',v_item->>'value',v_item->>'key') else trim(both '"' from v_item::text) end)::date; exception when others then continue; end;
    insert into public.registration_day_ops(tenant_id,session_id,registration_id,activity_date,participation_status,checkin_status,teardown_status,deposit_status,equipment_json,created_at,updated_at)
    values(new.tenant_id,new.session_id,new.id,v_date,'參加','未報到','未撤場',case when v_date=v_last and coalesce(new.deposit,0)>0 then '未退押金' else '不適用' end,'{}'::jsonb,coalesce(new.created_at,now()),now())
    on conflict (tenant_id,registration_id,activity_date) do nothing;
  end loop; return new;
end;$$;
drop trigger if exists trg_transfer_registration_day_ops on public.registrations;
create trigger trg_transfer_registration_day_ops after insert on public.registrations for each row when (new.transferred_from_registration_id is not null) execute function public.ensure_transfer_registration_day_ops();
revoke all on function public.ensure_transfer_registration_day_ops() from public, anon, authenticated;
grant execute on function public.ensure_transfer_registration_day_ops() to service_role;
