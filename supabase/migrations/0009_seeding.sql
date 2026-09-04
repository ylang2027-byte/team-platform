-- ============================================================
-- 0009_seeding.sql  —  인플루언서 시딩 리스트
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists seedings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,      -- 이름 / 계정명
  handle      text,               -- @handle
  platform    text,               -- 인스타그램 / 유튜브 / 틱톡 / 블로그 / 기타
  followers   integer,
  status      text not null default 'candidate',  -- candidate|contacted|accepted|shipped|posted|done|declined
  product     text,               -- 발송 제품
  ship_date   date,
  post_date   date,
  post_url    text,
  reach       integer,            -- 도달 / 조회수
  saves       integer,            -- 저장 수
  memo        text,
  assignee    text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table seedings enable row level security;
drop policy if exists "team all seedings" on seedings;
create policy "team all seedings" on seedings for all to authenticated using (true) with check (true);

drop trigger if exists seedings_set_updated on seedings;
create trigger seedings_set_updated before update on seedings
  for each row execute function set_updated_at();
