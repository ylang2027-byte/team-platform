-- ============================================================
-- 0010_profiles.sql  —  팀원(프로필) + 역할
-- Supabase SQL Editor 에 붙여넣고 Run (재실행해도 안전)
-- ============================================================

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'member',  -- member | admin
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- 관리자 확인 헬퍼 (RLS 재귀 방지용)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

drop policy if exists "read all profiles" on profiles;
drop policy if exists "update own or admin" on profiles;
create policy "read all profiles" on profiles for select to authenticated using (true);
create policy "update own or admin" on profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 새 계정 생기면 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated on profiles;
create trigger profiles_set_updated before update on profiles
  for each row execute function set_updated_at();

-- 기존 계정 backfill
insert into public.profiles (id, email, name)
select id, email, coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

-- 가장 먼저 만든 계정을 관리자로
update public.profiles set role = 'admin'
where id = (select id from auth.users order by created_at asc limit 1);
