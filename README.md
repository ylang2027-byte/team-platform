# 팀 플랫폼

패션 브랜드 팀(5명)이 함께 쓰는 내부 업무 플랫폼.
가격 비교 · 업무 보드 · (이후) 주문 · 재고 · 배송 · CS.

## 기술 스택

- **프론트엔드**: React + Vite
- **로그인 · DB**: Supabase (2단계에서 연결)
- **배포**: Vercel (GitHub 연동 자동 배포)
- **디자인**: 화이트 · 그레이 · 블랙 / Pretendard

## 로컬에서 실행

```bash
npm install
npm run dev
```

→ http://localhost:5173

## 현재 상태 (1단계)

- [x] 프로젝트 뼈대, 라우팅, 디자인 토큰
- [x] 로그인 페이지 (데모 모드 — Supabase 연결 전이라 아무 계정으로 로그인됨)
- [x] 로그인 후 레이아웃(상단 내비) + 각 화면 자리
- [ ] 2단계: Supabase 프로젝트 연결, 실제 로그인, 팀원 5명 계정
- [ ] 3단계: 가격 비교 화면 (제품 × 채널, 링크에서 가격 추출)
- [ ] 4단계: 업무 보드 이식

## 환경 변수

`.env.example` 를 `.env` 로 복사해서 Supabase 값 입력 (2단계).

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```
