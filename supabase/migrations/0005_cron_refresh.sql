-- ============================================================
-- 0005_cron_refresh.sql  —  가격 하루 2회 자동 갱신
-- 선행 조건:
--   1) refresh-prices Edge Function 배포 (Verify JWT 끄기)
--   2) Edge Function Secrets 에 CRON_SECRET 추가
--      값: cron_KhthRxn_swE5CWdOewhRvHiM
-- 그 다음 이 SQL 을 SQL Editor 에서 Run (재실행해도 안전)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 기존 잡 제거 (재실행 대비)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-prices-2x-daily') then
    perform cron.unschedule('refresh-prices-2x-daily');
  end if;
end $$;

-- 매일 00:00 · 09:00 UTC  =  한국시간 09:00 · 18:00
select cron.schedule(
  'refresh-prices-2x-daily',
  '0 0,9 * * *',
  $job$
  select net.http_post(
    url     := 'https://joixnxbrpfdkisokvxjk.supabase.co/functions/v1/refresh-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key',   'cron_KhthRxn_swE5CWdOewhRvHiM'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- 확인용 (필요할 때 따로 실행):
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select id, status_code, content from net._http_response order by created desc limit 5;
