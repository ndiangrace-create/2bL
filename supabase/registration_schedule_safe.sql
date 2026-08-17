-- 場次三階段報名排程；既有場次預設停用，維持原本手動開關行為。
alter table public.sessions
  add column if not exists registration_schedule_json jsonb
  not null
  default '{"version":1,"enabled":false,"preset":"three_stage","timezone":"Asia/Taipei","windows":[]}'::jsonb;

comment on column public.sessions.registration_schedule_json is
  'Public registration windows. Backend remains authoritative; admin manual registration is separate.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and conname = 'sessions_registration_schedule_object_chk'
  ) then
    alter table public.sessions
      add constraint sessions_registration_schedule_object_chk
      check (jsonb_typeof(registration_schedule_json) = 'object');
  end if;
end
$$;
