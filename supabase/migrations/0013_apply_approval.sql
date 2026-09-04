-- ============================================================
-- 0013_apply_approval.sql  —  기획전 신청가 승인 워크플로
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

alter table promos add column if not exists apply_status       text not null default 'draft';  -- draft | pending | approved
alter table promos add column if not exists apply_requested_by text;
alter table promos add column if not exists apply_requested_at  timestamptz;
alter table promos add column if not exists apply_approved_by   text;
alter table promos add column if not exists apply_approved_at   timestamptz;
alter table promos add column if not exists apply_note          text;
