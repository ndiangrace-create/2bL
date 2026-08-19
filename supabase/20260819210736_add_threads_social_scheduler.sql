-- 2BL AI 貼文排程：追加 Threads（脆）發布能力。
-- 此檔只做向前相容的欄位與 constraint 擴充，不改寫既有 FB／IG 正式資料。

begin;

alter table public.social_posts
  add column if not exists threads_text text not null default '';

alter table public.social_meta_connections
  add column if not exists threads_status text not null default 'disconnected',
  add column if not exists encrypted_threads_token text null,
  add column if not exists threads_token_expires_at timestamptz null,
  add column if not exists selected_threads_id text null,
  add column if not exists selected_threads_username text null;

alter table public.social_meta_connections
  drop constraint if exists social_meta_connections_threads_status_check;
alter table public.social_meta_connections
  add constraint social_meta_connections_threads_status_check
  check (threads_status in ('connected','expired','disconnected','error'));

alter table public.social_publish_attempts
  drop constraint if exists social_publish_attempts_platform_check;
alter table public.social_publish_attempts
  add constraint social_publish_attempts_platform_check
  check (platform in ('facebook','instagram','threads'));

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
    if jsonb_typeof(platforms) <> 'array' then
      platforms := '[]'::jsonb;
    end if;
    begin
      scheduled_ts := nullif(item->>'scheduledAt','')::timestamptz;
    exception when others then
      scheduled_ts := null;
    end;
    if post_row.status in ('publishing','published')
       or scheduled_ts is null
       or scheduled_ts < now() - interval '2 minutes'
       or jsonb_array_length(platforms) = 0
       or not (platforms <@ '["facebook","instagram","threads"]'::jsonb)
       or jsonb_array_length(coalesce(item->'hashtags','[]'::jsonb)) = 0
       or coalesce(item->>'imageUrl','') = ''
       or (platforms ? 'facebook' and coalesce(item->>'facebookText','') = '')
       or (platforms ? 'instagram' and coalesce(item->>'instagramText','') = '')
       or (platforms ? 'threads' and coalesce(item->>'threadsText','') = '') then
      missing := missing || jsonb_build_array(jsonb_build_object(
        'id', post_row.id,
        'sequenceNo', post_row.sequence_no,
        'fields', (
          select coalesce(jsonb_agg(field), '[]'::jsonb)
          from jsonb_array_elements(jsonb_build_array(
            case when scheduled_ts is null then '日期時間' when scheduled_ts < now() - interval '2 minutes' then '日期時間需晚於現在' end,
            case when post_row.status in ('publishing','published') then '發布中或已發布，不可重新排程' end,
            case when jsonb_array_length(platforms) = 0 then '發布平台' end,
            case when not (platforms <@ '["facebook","instagram","threads"]'::jsonb) then '發布平台含不支援項目' end,
            case when jsonb_array_length(coalesce(item->'hashtags','[]'::jsonb)) = 0 then 'Hashtag' end,
            case when coalesce(item->>'imageUrl','') = '' then '圖片' end,
            case when platforms ? 'facebook' and coalesce(item->>'facebookText','') = '' then 'Facebook 文章' end,
            case when platforms ? 'instagram' and coalesce(item->>'instagramText','') = '' then 'Instagram 文章' end,
            case when platforms ? 'threads' and coalesce(item->>'threadsText','') = '' then 'Threads 文章' end
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
      threads_text = coalesce(item->>'threadsText',''),
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

commit;
