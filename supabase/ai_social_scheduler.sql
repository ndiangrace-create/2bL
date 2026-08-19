-- 2BL AI 貼文排程小幫手（成本控制第一版）
-- 正式資料只保存於 Supabase；第一版不自動呼叫任何付費圖片 API。

begin;

create table if not exists public.social_partners (
  id text primary key,
  tenant_id text not null references public.tenants(id) on update cascade on delete restrict,
  name text not null,
  facebook_page_url text null,
  facebook_page_id text null,
  instagram_username text null,
  instagram_user_id text null,
  account_status jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists social_partners_tenant_active_idx
  on public.social_partners (tenant_id, is_active, name);

create table if not exists public.social_campaigns (
  id text primary key,
  tenant_id text not null references public.tenants(id) on update cascade on delete restrict,
  source_type text not null check (source_type in ('session','manual')),
  source_event_id text null,
  source_session_id text null,
  title text not null,
  event_date text null,
  event_time text null,
  location text null,
  description text null,
  organizer text null,
  co_organizer text null,
  important_info text null,
  notes text null,
  partner_ids jsonb not null default '[]'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  requested_mode text not null check (requested_mode in ('5','10','14','20','until_end')),
  requested_count integer null check (requested_count between 1 and 20),
  status text not null default 'draft' check (status in ('draft','generating','review','scheduled','completed','generation_failed')),
  ai_model text null,
  ai_response_id text null,
  ai_usage jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_campaigns_tenant_updated_idx
  on public.social_campaigns (tenant_id, updated_at desc);

create table if not exists public.social_posts (
  id text primary key,
  tenant_id text not null references public.tenants(id) on update cascade on delete restrict,
  campaign_id text not null references public.social_campaigns(id) on update cascade on delete cascade,
  sequence_no integer not null check (sequence_no between 1 and 20),
  angle text not null,
  facebook_text text not null,
  instagram_text text not null,
  hashtags jsonb not null default '[]'::jsonb,
  fixed_hashtags jsonb not null default '[]'::jsonb,
  topic_hashtags jsonb not null default '[]'::jsonb,
  facebook_partner_ids jsonb not null default '[]'::jsonb,
  instagram_partner_ids jsonb not null default '[]'::jsonb,
  mention_status jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz null,
  platforms jsonb not null default '["facebook","instagram"]'::jsonb,
  image_prompt text not null,
  image_style_meta jsonb not null default '{}'::jsonb,
  image_url text null,
  image_storage_path text null,
  status text not null default 'draft' check (status in ('draft','scheduled','publishing','published','failed','cancelled')),
  platform_status jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  revision integer not null default 1,
  ai_model text null,
  ai_response_id text null,
  ai_usage jsonb not null default '{}'::jsonb,
  published_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, campaign_id, sequence_no)
);

create index if not exists social_posts_due_idx
  on public.social_posts (status, scheduled_at)
  where status = 'scheduled';
create index if not exists social_posts_campaign_idx
  on public.social_posts (tenant_id, campaign_id, sequence_no);

create table if not exists public.social_meta_connections (
  id text primary key,
  tenant_id text not null references public.tenants(id) on update cascade on delete restrict,
  status text not null default 'connected' check (status in ('connected','expired','disconnected','error')),
  encrypted_user_token text not null,
  encrypted_page_token text null,
  token_expires_at timestamptz null,
  available_accounts jsonb not null default '[]'::jsonb,
  selected_page_id text null,
  selected_page_name text null,
  selected_instagram_id text null,
  selected_instagram_name text null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create table if not exists public.social_publish_attempts (
  id text primary key,
  tenant_id text not null references public.tenants(id) on update cascade on delete restrict,
  post_id text not null references public.social_posts(id) on update cascade on delete cascade,
  platform text not null check (platform in ('facebook','instagram')),
  idempotency_key text not null,
  status text not null default 'processing' check (status in ('processing','published','failed','unknown')),
  attempt_count integer not null default 1,
  remote_id text null,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, post_id, platform),
  unique (idempotency_key)
);

alter table public.social_partners enable row level security;
alter table public.social_campaigns enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_meta_connections enable row level security;
alter table public.social_publish_attempts enable row level security;

revoke all on public.social_partners from anon, authenticated;
revoke all on public.social_campaigns from anon, authenticated;
revoke all on public.social_posts from anon, authenticated;
revoke all on public.social_meta_connections from anon, authenticated;
revoke all on public.social_publish_attempts from anon, authenticated;
grant all on public.social_partners to service_role;
grant all on public.social_campaigns to service_role;
grant all on public.social_posts to service_role;
grant all on public.social_meta_connections to service_role;
grant all on public.social_publish_attempts to service_role;

-- 整批排程使用單一交易。任何一篇缺資料時，整批不寫入並回傳該篇缺漏。
create or replace function public.schedule_social_campaign(
  p_tenant_id text,
  p_campaign_id text,
  p_posts jsonb,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  post_row public.social_posts%rowtype;
  missing jsonb := '[]'::jsonb;
  platforms jsonb;
  scheduled_ts timestamptz;
begin
  if p_tenant_id is null or p_campaign_id is null or jsonb_typeof(p_posts) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if not exists (
    select 1 from public.social_campaigns
    where id = p_campaign_id and tenant_id = p_tenant_id
  ) then
    raise exception 'campaign_not_found';
  end if;

  for item in select value from jsonb_array_elements(p_posts)
  loop
    select * into post_row
      from public.social_posts
      where id = item->>'id'
        and tenant_id = p_tenant_id
        and campaign_id = p_campaign_id
      for update;
    if not found then
      missing := missing || jsonb_build_array(jsonb_build_object('id', item->>'id', 'fields', jsonb_build_array('貼文不存在')));
      continue;
    end if;
    platforms := coalesce(item->'platforms', '[]'::jsonb);
    begin
      scheduled_ts := nullif(item->>'scheduledAt','')::timestamptz;
    exception when others then
      scheduled_ts := null;
    end;
    if post_row.status in ('publishing','published') or scheduled_ts is null or scheduled_ts < now() - interval '2 minutes' or jsonb_array_length(platforms) = 0 or jsonb_array_length(coalesce(item->'hashtags','[]'::jsonb)) = 0 or coalesce(item->>'imageUrl','') = ''
       or coalesce(item->>'facebookText','') = '' or coalesce(item->>'instagramText','') = '' then
      missing := missing || jsonb_build_array(jsonb_build_object(
        'id', post_row.id,
        'sequenceNo', post_row.sequence_no,
        'fields', (
          select coalesce(jsonb_agg(field), '[]'::jsonb)
          from jsonb_array_elements(jsonb_build_array(
            case when scheduled_ts is null then '日期時間' when scheduled_ts < now() - interval '2 minutes' then '日期時間需晚於現在' end,
            case when post_row.status in ('publishing','published') then '發布中或已發布，不可重新排程' end,
            case when jsonb_array_length(platforms) = 0 then '發布平台' end,
            case when jsonb_array_length(coalesce(item->'hashtags','[]'::jsonb)) = 0 then 'Hashtag' end,
            case when coalesce(item->>'imageUrl','') = '' then '圖片' end,
            case when coalesce(item->>'facebookText','') = '' then 'Facebook 文章' end,
            case when coalesce(item->>'instagramText','') = '' then 'Instagram 文章' end
          )) as fields(field)
          where field <> 'null'::jsonb
        )
      ));
    end if;
  end loop;

  if jsonb_array_length(missing) > 0 then
    return jsonb_build_object('ok', false, 'missing', missing);
  end if;

  for item in select value from jsonb_array_elements(p_posts)
  loop
    update public.social_posts set
      facebook_text = item->>'facebookText',
      instagram_text = item->>'instagramText',
      hashtags = coalesce(item->'hashtags','[]'::jsonb),
      fixed_hashtags = coalesce(item->'fixedHashtags','[]'::jsonb),
      topic_hashtags = coalesce(item->'topicHashtags','[]'::jsonb),
      facebook_partner_ids = coalesce(item->'facebookPartnerIds','[]'::jsonb),
      instagram_partner_ids = coalesce(item->'instagramPartnerIds','[]'::jsonb),
      mention_status = coalesce(item->'mentionStatus','{}'::jsonb),
      scheduled_at = (item->>'scheduledAt')::timestamptz,
      platforms = item->'platforms',
      image_url = item->>'imageUrl',
      image_storage_path = nullif(item->>'imageStoragePath',''),
      status = 'scheduled',
      missing_fields = '[]'::jsonb,
      last_error = null,
      revision = revision + 1,
      updated_at = now()
    where id = item->>'id'
      and tenant_id = p_tenant_id
      and campaign_id = p_campaign_id
      and status not in ('publishing','published');
  end loop;

  update public.social_campaigns
    set status = 'scheduled', updated_at = now()
    where id = p_campaign_id and tenant_id = p_tenant_id;

  insert into public.audit_logs
    (id, tenant_id, actor_email, actor_role, action, target_table, target_id, before_json, after_json, meta_json, created_at)
  values
    ('AUD_' || replace(gen_random_uuid()::text,'-',''), p_tenant_id, p_actor_email, 'admin',
     'schedule_social_campaign', 'social_campaigns', p_campaign_id, '{}'::jsonb,
     jsonb_build_object('status','scheduled'), jsonb_build_object('post_count',jsonb_array_length(p_posts)), now());

  return jsonb_build_object('ok', true, 'scheduledCount', jsonb_array_length(p_posts));
end;
$$;

revoke all on function public.schedule_social_campaign(text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.schedule_social_campaign(text,text,jsonb,text) to service_role;

-- 到期貼文原子認領，避免兩個排程執行個體同時重複發布。
create or replace function public.claim_due_social_posts(
  p_tenant_id text,
  p_limit integer default 20
) returns setof public.social_posts
language sql
security definer
set search_path = ''
as $$
  update public.social_posts p
     set status = 'publishing', updated_at = now()
   where p.id in (
     select id from public.social_posts
      where tenant_id = p_tenant_id
        and status = 'scheduled'
        and scheduled_at <= now()
      order by scheduled_at asc
      for update skip locked
      limit greatest(1, least(coalesce(p_limit,20),50))
   )
   returning p.*;
$$;

revoke all on function public.claim_due_social_posts(text,integer) from public, anon, authenticated;
grant execute on function public.claim_due_social_posts(text,integer) to service_role;

commit;
