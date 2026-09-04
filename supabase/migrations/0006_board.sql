-- ============================================================
-- 0006_board.sql  —  업무 보드 (칸반)
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  category    text not null default 'etc',    -- mkt|order|ship|cs|stock|promo|etc
  assignee    text,
  priority    text not null default 'normal', -- normal|high
  status      text not null default 'todo',   -- todo|doing|review|done
  sort_order  double precision not null default 0,
  due_date    date,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);

create index if not exists idx_tasks_status on tasks(status, sort_order);

alter table tasks enable row level security;
drop policy if exists "team all tasks" on tasks;
create policy "team all tasks" on tasks for all to authenticated using (true) with check (true);

drop trigger if exists tasks_set_updated on tasks;
create trigger tasks_set_updated before update on tasks
  for each row execute function set_updated_at();

-- 실시간 반영용
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table tasks;
  end if;
end $$;
