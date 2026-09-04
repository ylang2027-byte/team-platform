-- ============================================================
-- 0008_calendar.sql  —  일정(캘린더) : 구글 캘린더 iCal 연동 설정
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists app_config (
  id             text primary key,
  gcal_ical_url  text,
  updated_at     timestamptz not null default now()
);

alter table app_config enable row level security;
drop policy if exists "team read config" on app_config;
drop policy if exists "team write config" on app_config;
create policy "team read config"  on app_config for select to authenticated using (true);
create policy "team write config" on app_config for all    to authenticated using (true) with check (true);

drop trigger if exists app_config_set_updated on app_config;
create trigger app_config_set_updated before update on app_config
  for each row execute function set_updated_at();

-- 콘크리트앤캔버스 캘린더 (참여 기획전 및 주요 일정)
insert into app_config (id, gcal_ical_url)
values (
  'main',
  'https://calendar.google.com/calendar/ical/458632a42e2e07579bdf634ceedc42bbf7af50df2d084ba62f3ee6e985a4370c%40group.calendar.google.com/public/basic.ics'
)
on conflict (id) do update set gcal_ical_url = excluded.gcal_ical_url;
