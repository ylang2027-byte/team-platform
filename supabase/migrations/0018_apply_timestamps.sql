-- 기획전 신청가: 작성/수정 시각 기록
alter table promos add column if not exists apply_created_at timestamptz;  -- 신청가 최초 저장
alter table promos add column if not exists apply_updated_at timestamptz;  -- 신청가 마지막 수정
