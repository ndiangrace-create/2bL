begin;
-- 主題前台開關
alter table public.events add column if not exists frontend_visible boolean not null default true;

-- 團購場次／商品補充欄位
alter table public.sessions add column if not exists feature_modules_json jsonb not null default '{}'::jsonb;
alter table public.session_products add column if not exists original_price numeric not null default 0;
alter table public.session_products add column if not exists supply_cost numeric not null default 0;
alter table public.session_products add column if not exists quantity_tiers_json jsonb not null default '[]'::jsonb;

-- 團購主申請資料
alter table public.session_manager_applications add column if not exists social_profiles_json jsonb not null default '[]'::jsonb;
alter table public.session_manager_applications add column if not exists audience_size integer;
alter table public.session_manager_applications add column if not exists avg_reach integer;
alter table public.session_manager_applications add column if not exists group_buy_experience text not null default '';
alter table public.session_manager_applications add column if not exists preferred_categories text not null default '';

-- 團購主 × 指定團購場次 × 專屬連結/價格
create table if not exists public.session_promoters (
  id text primary key,
  tenant_id text not null references public.tenants(id),
  session_id text not null references public.sessions(id),
  member_id text not null,
  referral_code text not null,
  status text not null default 'active' check(status in ('active','paused','revoked')),
  promoter_base_price_json jsonb not null default '{}'::jsonb,
  customer_price_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,session_id,member_id),
  unique(tenant_id,referral_code)
);

create table if not exists public.session_referral_visits (
  token text primary key,
  tenant_id text not null references public.tenants(id),
  session_id text not null references public.sessions(id),
  promoter_id text not null references public.session_promoters(id),
  referral_code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- 訂單履約與來源快照
alter table public.session_orders add column if not exists recipient_postal_code text not null default '';
alter table public.session_orders add column if not exists fulfillment_note text not null default '';
alter table public.session_orders add column if not exists transfer_status text not null default 'pending';
alter table public.session_orders add column if not exists tracking_no text not null default '';
alter table public.session_orders add column if not exists transferred_at timestamptz;
alter table public.session_orders add column if not exists transferred_by text;
alter table public.session_orders add column if not exists shipped_at timestamptz;
alter table public.session_orders add column if not exists promoter_id text;
alter table public.session_orders add column if not exists promoter_member_id text;
alter table public.session_orders add column if not exists referral_code text not null default '';
alter table public.session_orders add column if not exists referral_token text not null default '';

alter table public.session_order_items add column if not exists list_price numeric;
alter table public.session_order_items add column if not exists promoter_base_price numeric;
alter table public.session_order_items add column if not exists promoter_earning numeric not null default 0;

create table if not exists public.session_promoter_ledger (
  id text primary key,
  tenant_id text not null references public.tenants(id),
  session_id text not null references public.sessions(id),
  order_id text not null references public.session_orders(id),
  promoter_id text not null references public.session_promoters(id),
  promoter_member_id text not null,
  direction text not null check(direction in ('credit','debit')),
  earning_amount numeric not null default 0,
  status text not null default 'pending' check(status in ('pending','effective','reversed','settled')),
  created_at timestamptz not null default now()
);

create index if not exists session_promoters_member_idx on public.session_promoters(tenant_id,member_id,status);
create index if not exists session_orders_promoter_idx on public.session_orders(tenant_id,promoter_member_id,created_at desc);
create index if not exists session_promoter_ledger_idx on public.session_promoter_ledger(tenant_id,promoter_member_id,created_at desc);

alter table public.session_promoters enable row level security;
alter table public.session_referral_visits enable row level security;
alter table public.session_promoter_ledger enable row level security;

-- 舊版 RPC 可能存在，移除避免參數歧義
DROP FUNCTION IF EXISTS public.place_session_product_order(text,text,text,text,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.place_session_product_order(text,text,text,text,text,text,text,text,text,jsonb,text);

create or replace function public.place_session_product_order(
 p_tenant_id text,
 p_session_id text,
 p_member_id text,
 p_member_email text,
 p_idempotency_key text,
 p_fulfillment_type text,
 p_recipient_name text,
 p_recipient_phone text,
 p_recipient_postal_code text,
 p_shipping_address text,
 p_fulfillment_note text,
 p_items jsonb,
 p_referral_token text default ''
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 s public.sessions%rowtype; settings jsonb; existing public.session_orders%rowtype; oid text;
 item jsonb; prod public.session_products%rowtype; qty int; subtotal numeric:=0; ship numeric:=0; total numeric:=0;
 tier jsonb; effective_unit_price numeric; promoter_base numeric:=0; earning numeric:=0; earning_total numeric:=0;
 visit public.session_referral_visits%rowtype; promoter public.session_promoters%rowtype;
 customer_prices jsonb:='{}'::jsonb; promoter_prices jsonb:='{}'::jsonb;
 now_ts timestamptz:=now(); start_at timestamptz; end_at timestamptz;
begin
 if p_tenant_id<>'tuibile' then raise exception 'invalid tenant'; end if;
 select * into s from public.sessions where tenant_id=p_tenant_id and id=p_session_id for update;
 if not found or not s.group_buy_enabled then raise exception '此場次未開啟團購商品模組'; end if;
 settings:=coalesce(s.group_buy_settings_json,'{}'::jsonb);
 if nullif(settings->>'saleStartAt','') is not null then start_at=(settings->>'saleStartAt')::timestamptz; end if;
 if nullif(settings->>'saleEndAt','') is not null then end_at=(settings->>'saleEndAt')::timestamptz; end if;
 if start_at is not null and now_ts<start_at then raise exception '此團購尚未開始'; end if;
 if end_at is not null and now_ts>end_at then raise exception '此團購已截止'; end if;
 if p_fulfillment_type='shipping' and coalesce((settings->>'shippingEnabled')::boolean,false)=false then raise exception '此場次未開放宅配'; end if;
 if p_fulfillment_type='pickup' and coalesce((settings->>'pickupEnabled')::boolean,true)=false then raise exception '此場次未開放現場取貨'; end if;
 if p_fulfillment_type='shipping' and (btrim(coalesce(p_recipient_name,''))='' or btrim(coalesce(p_recipient_phone,''))='' or btrim(coalesce(p_recipient_postal_code,''))='' or btrim(coalesce(p_shipping_address,''))='') then raise exception '宅配請完整填寫收件人、電話、郵遞區號與地址'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '請選擇商品'; end if;
 select * into existing from public.session_orders where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
 if found then return jsonb_build_object('order_id',existing.id,'product_amount',existing.product_amount,'shipping_fee',existing.shipping_fee,'total_amount',existing.total_amount,'reused',true); end if;

 if btrim(coalesce(p_referral_token,''))<>'' then
   select * into visit from public.session_referral_visits where token=p_referral_token and tenant_id=p_tenant_id and session_id=p_session_id and expires_at>now_ts for update;
   if found then
     select * into promoter from public.session_promoters where id=visit.promoter_id and tenant_id=p_tenant_id and session_id=p_session_id and status='active';
     if found then customer_prices:=coalesce(promoter.customer_price_json,'{}'::jsonb); promoter_prices:=coalesce(promoter.promoter_base_price_json,'{}'::jsonb); end if;
   end if;
 end if;

 oid:='SO_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
 insert into public.session_orders(id,tenant_id,session_id,member_id,member_email,idempotency_key,fulfillment_type,recipient_name,recipient_phone,recipient_postal_code,shipping_address,fulfillment_note,promoter_id,promoter_member_id,referral_code,referral_token)
 values(oid,p_tenant_id,p_session_id,p_member_id,coalesce(p_member_email,''),p_idempotency_key,p_fulfillment_type,coalesce(p_recipient_name,''),coalesce(p_recipient_phone,''),coalesce(p_recipient_postal_code,''),coalesce(p_shipping_address,''),coalesce(p_fulfillment_note,''),case when promoter.id is null then null else promoter.id end,case when promoter.id is null then null else promoter.member_id end,case when promoter.id is null then '' else promoter.referral_code end,case when promoter.id is null then '' else p_referral_token end);

 for item in select value from jsonb_array_elements(p_items) loop
   qty:=greatest(0,coalesce((item->>'quantity')::int,0)); if qty<1 then raise exception '商品數量錯誤'; end if;
   select * into prod from public.session_products where tenant_id=p_tenant_id and session_id=p_session_id and id=item->>'product_id' and status='active' for update;
   if not found then raise exception '商品不存在或已下架'; end if;
   if prod.stock_qty is not null and prod.stock_qty<qty then raise exception '% 庫存不足',prod.name; end if;
   if prod.per_member_limit is not null and qty>prod.per_member_limit then raise exception '% 超過單次限購數量',prod.name; end if;

   effective_unit_price:=prod.price;
   for tier in select value from jsonb_array_elements(coalesce(prod.quantity_tiers_json,'[]'::jsonb)) order by coalesce((value->>'minQty')::int,0) asc loop
     if qty>=coalesce((tier->>'minQty')::int,999999) then effective_unit_price:=greatest(0,coalesce((tier->>'unitPrice')::numeric,effective_unit_price)); end if;
   end loop;

   if promoter.id is not null and nullif(customer_prices->>prod.id,'') is not null then
     effective_unit_price:=least(effective_unit_price,greatest(0,(customer_prices->>prod.id)::numeric));
   end if;
   promoter_base:=0; earning:=0;
   if promoter.id is not null and nullif(promoter_prices->>prod.id,'') is not null then
     promoter_base:=greatest(0,(promoter_prices->>prod.id)::numeric);
     if promoter_base>effective_unit_price then raise exception '% 團購主結算價不可高於消費者成交價',prod.name; end if;
     earning:=(effective_unit_price-promoter_base)*qty;
   end if;
   earning_total:=earning_total+earning;
   subtotal:=subtotal+(effective_unit_price*qty);

   insert into public.session_order_items(tenant_id,session_id,order_id,product_id,product_name,quantity,unit_price,line_total,list_price,promoter_base_price,promoter_earning)
   values(p_tenant_id,p_session_id,oid,prod.id,prod.name,qty,effective_unit_price,effective_unit_price*qty,case when prod.original_price>0 then prod.original_price else prod.price end,case when promoter_base>0 then promoter_base else null end,earning);
   if prod.stock_qty is not null then update public.session_products set stock_qty=stock_qty-qty,updated_at=now(),status=case when stock_qty-qty<=0 then 'sold_out' else status end where id=prod.id; end if;
 end loop;

 if p_fulfillment_type='shipping' then
   ship:=greatest(0,coalesce((settings->>'shippingFee')::numeric,0));
   if coalesce((settings->>'freeShippingThreshold')::numeric,0)>0 and subtotal>=((settings->>'freeShippingThreshold')::numeric) then ship:=0; end if;
 end if;
 total:=subtotal+ship;
 update public.session_orders set product_amount=subtotal,shipping_fee=ship,total_amount=total,updated_at=now() where id=oid;
 if promoter.id is not null and earning_total>0 then
   insert into public.session_promoter_ledger(id,tenant_id,session_id,order_id,promoter_id,promoter_member_id,direction,earning_amount,status)
   values('SPL_'||substr(replace(gen_random_uuid()::text,'-',''),1,20),p_tenant_id,p_session_id,oid,promoter.id,promoter.member_id,'credit',earning_total,'pending');
   update public.session_referral_visits set used_at=now_ts where token=p_referral_token;
 end if;
 return jsonb_build_object('order_id',oid,'product_amount',subtotal,'shipping_fee',ship,'total_amount',total,'promoter_earning',earning_total,'reused',false);
end $$;
commit;