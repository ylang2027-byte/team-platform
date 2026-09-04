-- ============================================================
-- 0004_product_variant.sql
--   · 정상가(list_price) 칸 추가
--   · 제품 가격 연동 (예: 캔버스 롱 = 캔버스 숏 + 2,000원)
-- Supabase SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- 0003 은 실행 안 하셨으면 건너뛰어도 됩니다.
-- ============================================================

alter table products add column if not exists list_price integer;               -- 정상가(우리 공식가)
alter table products add column if not exists base_product_id uuid references products(id) on delete set null;
alter table products add column if not exists price_offset integer not null default 0;
