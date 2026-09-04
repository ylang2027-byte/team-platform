-- ============================================================
-- 0016_cron_refresh_3x.sql  —  가격 하루 3회 자동 갱신 (10:00 · 13:00 · 16:00 KST)
-- 0005 의 하루 2회 잡을 대체합니다.
-- 선행 조건: refresh-prices Edge Function 배포 + CRON_SECRET 시크릿 (0005 와 동일)
-- SQL Editor 에서 Run (재실행해도 안전)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 기존 잡 제거 (0005 의 2회 잡 + 이 잡 재실행 대비)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-prices-2x-daily') then
    perform cron.unschedule('refresh-prices-2x-daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'refresh-prices-3x-daily') then
    perform cron.unschedule('refresh-prices-3x-daily');
  end if;
end $$;

-- 매일 01:00 · 04:00 · 07:00 UTC  =  한국시간 10:00 · 13:00 · 16:00
select cron.schedule(
  'refresh-prices-3x-daily',
  '0 1,4,7 * * *',
  $job$
  select net.http_post(
    url     := 'https://joixnxbrpfdkisokvxjk.supabase.co/functions/v1/refresh-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key',   '<YOUR_CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- 확인용:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
