-- ============================================================
-- 0014_notifications.sql  —  앱 내 알림
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_name  text not null,        -- 받는 사람 (profiles.name)
  type       text,                 -- apply_request | apply_approved | apply_rejected ...
  title      text not null,
  body       text,
  link       text,                 -- 앱 내 경로 (예: /promos?apply=<id>)
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notif_user on notifications(user_name, created_at desc);

alter table notifications enable row level security;
drop policy if exists "team read notif" on notifications;
drop policy if exists "team write notif" on notifications;
create policy "team read notif"  on notifications for select to authenticated using (true);
create policy "team write notif" on notifications for all    to authenticated using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
