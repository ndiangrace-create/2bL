-- 系列管理者不可取得全租戶或平台範圍。
-- Worker 仍會逐次驗證 event 是否存在與 session 是否屬於該 event；此約束提供資料庫最後一道防線。
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_organizer_admin_event_scope_chk'
      and conrelid = 'public.staff'::regclass
  ) then
    alter table public.staff
      add constraint staff_organizer_admin_event_scope_chk
      check (
        coalesce(normalized_role, role, '') <> 'organizer_admin'
        or (
          scope_type = 'event'
          and nullif(btrim(scope_event_id), '') is not null
        )
      ) not valid;
  end if;
end
$$;

alter table public.staff
  validate constraint staff_organizer_admin_event_scope_chk;
