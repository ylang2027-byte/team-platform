# 팀 플랫폼

패션 브랜드 팀이 함께 쓰는 내부 업무 플랫폼.
가격 비교 · 기획전(신청가·쿠폰·승인) · 인플루언서 시딩 · 일정 · 대시보드 · 설정.

## 기술 스택

- **프론트엔드**: React + Vite
- **로그인 · DB**: Supabase (Auth + Postgres + Edge Functions + pg_cron)
- **배포**: Vercel (GitHub 연동 자동 배포)
- **디자인**: 화이트 · 그레이 · 블랙 / Pretendard

## 로컬에서 실행

```bash
npm install
npm run dev
```

→ http://localhost:5173

## 환경 변수

`.env.example` 를 `.env` 로 복사해서 Supabase 값 입력.

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## DB 마이그레이션

`supabase/migrations/` 의 SQL을 번호 순서대로 Supabase SQL Editor에서 실행.
Edge Function은 `supabase/functions/` — Supabase CLI로 배포하고 필요한 시크릿 등록.
