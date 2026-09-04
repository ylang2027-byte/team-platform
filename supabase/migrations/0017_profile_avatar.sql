-- 팀원 프로필 사진 (작게 리사이즈한 이미지를 data URL 문자열로 저장)
alter table public.profiles add column if not exists avatar_url text;
