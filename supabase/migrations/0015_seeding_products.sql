-- 시딩: 발송 제품을 여러 개 담을 수 있게 (등록 제품 이름 배열)
alter table public.seedings add column if not exists products jsonb not null default '[]'::jsonb;

-- 기존 단일 product 텍스트 → 배열로 이전 (한 번만)
update public.seedings
set products = jsonb_build_array(product)
where product is not null and btrim(product) <> '' and products = '[]'::jsonb;
