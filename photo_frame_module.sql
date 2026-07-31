begin;

alter table public.photo_frames
  add column if not exists slug text,
  add column if not exists page_title text,
  add column if not exists page_content text,
  add column if not exists hashtag text,
  add column if not exists reward_text text;

update public.photo_frames
set slug = lower(
  regexp_replace(
    regexp_replace(coalesce(nullif(trim(slug),''), 'photo-' || substr(md5(id),1,8)), '[^a-zA-Z0-9-]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  )
)
where slug is null or trim(slug)='';

update public.photo_frames
set page_title = coalesce(nullif(trim(page_title),''), name)
where page_title is null or trim(page_title)='';

alter table public.photo_frames
  alter column slug set not null;

create unique index if not exists ux_photo_frames_slug
  on public.photo_frames (lower(slug));

create index if not exists ix_photo_frames_tenant_active
  on public.photo_frames (tenant_id, is_active, updated_at desc);

commit;

select
  count(*) filter (where slug is null or trim(slug)='') as missing_slug,
  count(*) filter (where page_title is null or trim(page_title)='') as missing_page_title
from public.photo_frames;
