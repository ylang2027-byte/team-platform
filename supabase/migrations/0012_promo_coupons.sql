-- ============================================================
-- 0012_promo_coupons.sql  —  기획전 쿠폰 스택
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists promo_coupons (
  id           uuid primary key default gen_random_uuid(),
  promo_id     uuid not null references promos(id) on delete cascade,
  name         text not null,
  kind         text not null default 'percent',   -- percent | fixed
  value        integer not null default 0,         -- % 또는 원
  max_discount integer,                            -- 정률 쿠폰 최대 할인액
  min_order    integer,                            -- 최소 주문금액
  grp          text not null default 'stack',      -- base(택1) | stack(중복)
  our_share    integer not null default 0,         -- 우리 분담률 %
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_promo_coupons_promo on promo_coupons(promo_id);

alter table promo_coupons enable row level security;
drop policy if exists "team all promo_coupons" on promo_coupons;
create policy "team all promo_coupons" on promo_coupons for all to authenticated using (true) with check (true);
