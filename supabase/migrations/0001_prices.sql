-- ============================================================
-- 0001_prices.sql  —  가격 비교 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run
-- 여러 번 실행해도 안전하도록 작성됨
-- ============================================================

-- ---------- 채널 ----------
create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- 제품 ----------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sku         text,
  base_price  integer,               -- 자사 기준가 (원)
  image_url   text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- 리스팅 (제품 × 채널) ----------
create table if not exists listings (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  channel_id      uuid not null references channels(id) on delete cascade,
  url             text,
  price           integer,           -- 현재 판매가 (원)
  price_source    text not null default 'manual',   -- manual | auto | failed
  last_checked_at timestamptz,
  memo            text,
  updated_at      timestamptz not null default now(),
  unique (product_id, channel_id)
);

-- ---------- 가격 변동 이력 ----------
create table if not exists price_history (
  id          bigint generated always as identity primary key,
  listing_id  uuid not null references listings(id) on delete cascade,
  price       integer,
  source      text,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_listings_product on listings(product_id);
create index if not exists idx_history_listing  on price_history(listing_id, recorded_at desc);

-- ---------- updated_at 자동 갱신 ----------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists products_set_updated on products;
create trigger products_set_updated before update on products
  for each row execute function set_updated_at();

drop trigger if exists listings_set_updated on listings;
create trigger listings_set_updated before update on listings
  for each row execute function set_updated_at();

-- ---------- 가격 바뀌면 이력 자동 기록 ----------
create or replace function log_price_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.price is not null)
     or (tg_op = 'UPDATE' and new.price is distinct from old.price) then
    insert into price_history(listing_id, price, source)
    values (new.id, new.price, new.price_source);
  end if;
  return new;
end $$;

drop trigger if exists listings_log_price on listings;
create trigger listings_log_price after insert or update on listings
  for each row execute function log_price_change();

-- ============================================================
-- RLS — 로그인한 팀원(5명)은 모두 읽기/쓰기 가능
-- (역할 구분은 이후 단계에서 추가)
-- ============================================================
alter table channels      enable row level security;
alter table products      enable row level security;
alter table listings      enable row level security;
alter table price_history enable row level security;

drop policy if exists "team all channels"      on channels;
drop policy if exists "team all products"      on products;
drop policy if exists "team all listings"      on listings;
drop policy if exists "team all price_history" on price_history;

create policy "team all channels"      on channels      for all to authenticated using (true) with check (true);
create policy "team all products"      on products      for all to authenticated using (true) with check (true);
create policy "team all listings"      on listings      for all to authenticated using (true) with check (true);
create policy "team all price_history" on price_history for all to authenticated using (true) with check (true);

-- ============================================================
-- 채널 5개 시드 (이미 있으면 건너뜀)
-- ============================================================
insert into channels (name, sort_order)
select v.name, v.sort_order
from (values
  ('공홈', 1), ('무신사', 2), ('지그재그', 3), ('29CM', 4), ('W컨셉', 5)
) as v(name, sort_order)
where not exists (select 1 from channels c where c.name = v.name);
