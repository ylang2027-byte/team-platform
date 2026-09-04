-- ============================================================
-- 0003_listing_options.sql  —  채널 칸에 옵션별 가격
-- Supabase SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- ============================================================

-- options 예시:
-- [{"name":"SHORT","price":86000,"coupon_price":null},
--  {"name":"LONG","price":88000,"coupon_price":79000}]
alter table listings add column if not exists options jsonb;
