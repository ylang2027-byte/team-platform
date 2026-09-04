-- ============================================================
-- 0002_coupon_price.sql  —  쿠폰적용가 필드 추가
-- Supabase SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전)
-- ============================================================

alter table listings      add column if not exists coupon_price integer;
alter table price_history add column if not exists coupon_price integer;

-- 가격 이력: 판매가 또는 쿠폰적용가가 바뀌면 기록
create or replace function log_price_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and (new.price is not null or new.coupon_price is not null))
     or (tg_op = 'UPDATE' and (new.price is distinct from old.price
                               or new.coupon_price is distinct from old.coupon_price)) then
    insert into price_history(listing_id, price, coupon_price, source)
    values (new.id, new.price, new.coupon_price, new.price_source);
  end if;
  return new;
end $$;
