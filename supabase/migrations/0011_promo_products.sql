-- ============================================================
-- 0011_promo_products.sql  —  기획전 할인 구조 + 참여 상품·신청가
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

alter table promos add column if not exists discount_rate    integer;  -- 즉시할인 %
alter table promos add column if not exists coupon_rate       integer;  -- 쿠폰 %
alter table promos add column if not exists min_discount_rate integer;  -- (구버전 호환, 미사용)

create table if not exists promo_products (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references promos(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  apply_price integer,                       -- 신청가 (쿠폰 전)
  created_at  timestamptz not null default now(),
  unique (promo_id, product_id)
);

create index if not exists idx_promo_products_promo on promo_products(promo_id);

alter table promo_products enable row level security;
drop policy if exists "team all promo_products" on promo_products;
create policy "team all promo_products" on promo_products for all to authenticated using (true) with check (true);
