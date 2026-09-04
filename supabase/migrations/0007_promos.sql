-- ============================================================
-- 0007_promos.sql  —  기획전 관리
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists promos (
  id          uuid primary key default gen_random_uuid(),
  channel     text,
  title       text not null,
  status      text not null default 'review',  -- review|applied|confirmed|running|done|skip
  submit_due  date,                             -- 자료 제출 마감
  start_date  date,
  end_date    date,
  discount    text,                             -- 할인 조건 (자유 입력)
  assignee    text,
  memo        text,
  link        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_promos_due on promos(submit_due);

alter table promos enable row level security;
drop policy if exists "team all promos" on promos;
create policy "team all promos" on promos for all to authenticated using (true) with check (true);

drop trigger if exists promos_set_updated on promos;
create trigger promos_set_updated before update on promos
  for each row execute function set_updated_at();
