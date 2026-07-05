# MatchAI — 축구 경기 AI 예측 사이트

FotMob의 실제 경기 데이터(최근 폼, 라인업, 상대 전적, 리그 순위, 경기 통계)를 모아
GPT에 넘겨 승/무/패 확률과 예상 스코어를 예측하는 사이트입니다. React + Vite
프론트엔드와 Supabase(Postgres + Edge Functions)로 구성되어 있고, 별도 서버 없이
정적 호스팅(Vercel/Netlify 등)만으로 배포됩니다.

## 주요 기능

- **경기 목록 / 상세 페이지** — 추적 중인 리그의 예정/종료 경기, 팀별 최근 폼, 포메이션
  기반 예상 라인업(공식 라인업 발표 전에는 최근 출전 데이터로 추정), 상대 전적,
  리그 순위, 경기 통계(기대득점 등), 배당률(1xBet)을 보여줍니다.
- **GPT 단일 예측 모델** — 별도의 통계 모델을 혼합하지 않고, 포메이션·예상 라인업·
  피로도·카드 누적·최근 폼·상대 전적·리그 순위·참고용 기대득점을 모두 프롬프트에
  담아 GPT가 직접 확률과 스코어를 추론합니다. 예측 신뢰도는 GPT가 낸 확률 중 가장
  높은 값을 그대로 퍼센트로 노출합니다(별도 휴리스틱 아님).
- **백테스팅** — 이미 끝난 과거 경기를 골라, 그 경기의 킥오프 시점 이전 데이터만
  사용해 다시 예측을 돌리고 실제 결과와 비교합니다. 승부 적중률/스코어 적중률과
  함께 GPT가 짧게 "왜 맞았는지/틀렸는지"를 분석한 코멘트를 남겨 모델 보정에 참고할
  수 있게 합니다. `/admin` 페이지에서 리그+시즌 단위로 실행할 수 있습니다.
- **관리자 페이지(`/admin`)** — 추적 리그 동기화, 개별/전체 경기 재예측, 순위표
  갱신, 백테스트 실행을 수동으로 트리거할 수 있습니다. Supabase Auth 로그인이
  필요하며(아래 [관리자 인증 설정하기](#관리자-인증-설정하기) 참고), 이 화면에서
  쓰는 Edge Function들은 프론트엔드가 아니라 함수 자체에서 로그인 여부를
  검증합니다.

## 기술 스택 / 아키텍처

- **프론트엔드**: React 19 + Vite, `react-router-dom`으로 클라이언트 라우팅
  (`/`, `/match/:id`, `/admin`). Supabase JS 클라이언트로 브라우저에서 직접
  Postgres(읽기 전용 RLS)와 Edge Functions를 호출합니다 — 별도 백엔드 서버 없음.
- **데이터베이스**: Supabase Postgres. 스키마는 `supabase/migrations/`에 순서대로
  정의되어 있습니다(teams/fixtures/team_recent_results/players/lineups/
  predictions/league_standings/match_stats/backtest_results 등, 모두 공개 읽기
  전용 RLS — 쓰기는 Edge Function을 통해서만).
- **Edge Functions** (Deno, `supabase/functions/`):
  - `sync-leagues` — 추적 리그의 예정 경기를 FotMob에서 가져와 teams/fixtures에
    upsert (6시간마다 cron).
  - `predict-due` — 예측이 없거나 오래된 경기에 대해 최근 폼/라인업/상대 전적/
    순위/통계를 모아 GPT로 예측 (30분마다 cron, 확정 라인업이 나오는 킥오프
    직전에는 더 자주 재계산).
  - `fetch-standings`, `quick-match-info`, `estimate-lineup` — 순위표/배당률·H2H
    스니펫/예상 라인업을 온디맨드로 채웁니다.
  - `backtest`, `clear-backtest-results` — 백테스팅 실행 및 결과 초기화.
  - `untrack-fixture` — 관리자 페이지에서 특정 경기 추적 해제.
  - `_shared/` — FotMob API 클라이언트(`fotmob.ts`), GPT 호출(`openai.ts`),
    예측 입력값 수집(`predictionInputs.ts`, 예측/백테스트가 공유 — 백테스트는
    `excludeAtOrAfter` 컷오프로 해당 경기 킥오프 이후 데이터를 완전히 배제해
    "미래 데이터 유출"을 막습니다), 매핑/캐시 유틸, 관리자 인증(`auth.ts`).
  - `sync-leagues`/`predict-due`/`untrack-fixture`/`backtest`/
    `clear-backtest-results`는 관리자 전용입니다 — `fetch-standings`/
    `quick-match-info`/`estimate-lineup`은 일반 방문자가 경기 상세 페이지를 볼 때
    자동으로 호출되므로 그대로 공개로 둡니다.
- **데이터 소스**: [FotMob](https://www.fotmob.com)의 비공식 JSON API(경기 일정,
  라인업, 순위, 폼, H2H, 경기 통계, 1xBet 배당률). 인증 없이 공개 엔드포인트를
  씁니다 — 요청 빈도나 스키마는 예고 없이 바뀔 수 있으니 프로덕션에서 그대로
  의존할 경우 이 점을 감안하세요.
- **예측**: OpenAI `gpt-4o-mini`, `response_format: json_schema`로 구조화된
  응답(확률/스코어/근거/코멘트)을 강제합니다.

## 시작하기

### 1. 프론트엔드 설치

```
npm install
cp .env.example .env
```

`.env`에 Supabase 프로젝트의 URL과 publishable(anon) 키를 채웁니다
(Supabase 대시보드 → Project Settings → API).

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon/publishable key>
```

### 2. Supabase CLI 설치 및 프로젝트 연결

```
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

`supabase/migrations/0002_cron.sql`에 있는 `YOUR_PROJECT_REF`를 실제 프로젝트
ref로 바꿔주세요 (`sync-leagues`/`predict-due`를 주기적으로 호출하는 cron
job의 URL입니다).

### 3. 데이터베이스 스키마 적용

```
supabase db push
```

`0001`~`0014` 마이그레이션이 순서대로 적용되어 테이블/RLS/cron 스케줄이
만들어집니다. cron이 실제로 동작하려면(Vault에 서비스 키가 없으면 실패),
Supabase SQL Editor에서 한 번만 아래를 실행하세요 (버전 관리되는 마이그레이션에
넣지 않은 이유는 실제 키가 노출되기 때문입니다):

```sql
select vault.create_secret('<your service_role_key>', 'service_role_key');
```

(service_role 키는 Project Settings → API에서 확인)

### 4. Edge Function 시크릿 설정

```
supabase secrets set OPENAI_API_KEY=<your OpenAI API key>
```

(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 모든 Edge Function에
자동으로 주입하므로 직접 설정할 필요 없습니다 — 예약된 이름이라 설정하면 오류가
납니다.)

### 5. Edge Functions 배포

```
supabase functions deploy sync-leagues
supabase functions deploy predict-due
supabase functions deploy fetch-standings
supabase functions deploy quick-match-info
supabase functions deploy estimate-lineup
supabase functions deploy backtest
supabase functions deploy clear-backtest-results
supabase functions deploy untrack-fixture
```

### 6. 최초 동기화 수동 실행

Cron이 처음 돌 때까지 기다리지 않고 바로 데이터를 채우려면:

```
supabase functions invoke sync-leagues
supabase functions invoke predict-due
```

### 7. 프론트엔드 실행

```
npm run dev
```

`/` (경기 목록), `/match/:id` (상세), `/admin` (추적 관리/재예측/백테스팅)을
확인하세요.

### 8. 프론트엔드 배포

정적 빌드(`npm run build` → `dist/`)이며 브라우저에서 Supabase에 직접
접속하므로 어떤 정적 호스팅에도 배포할 수 있습니다. `react-router-dom`
클라이언트 라우팅을 쓰므로 모든 경로를 `index.html`로 리라이트해야 합니다
(`vercel.json`, `public/_redirects`에 이미 설정됨).

**Vercel**:
```
npm install -g vercel
vercel link
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod
```

GitHub 저장소를 Vercel/Netlify 대시보드에 연결하면 `main` 브랜치 푸시마다
자동 배포되도록 설정할 수 있습니다.

## 관리자 인증 설정하기

`/admin`은 Supabase Auth 이메일/비밀번호 로그인으로 보호됩니다. 프론트엔드는
로그인 여부로 화면만 가리고, 실제 접근 제어는 5개의 관리자 전용 Edge Function
(`sync-leagues`, `predict-due`, `untrack-fixture`, `backtest`,
`clear-backtest-results`) 안에서 `_shared/auth.ts`의 `requireAdmin`이 호출자의
Supabase 세션 토큰을 검증하고 이메일을 허용 목록과 대조하는 방식으로
이뤄집니다 — 로그인하지 않고 함수를 직접 호출해도 거부됩니다.

1. **관리자 계정 생성** — Supabase 대시보드 → Authentication → Users →
   "Add user"에서 이메일/비밀번호로 계정을 만듭니다 (또는 Auth Admin API로
   생성).
2. **허용 이메일 등록** — 만든 계정의 이메일을 `ADMIN_EMAILS` 시크릿으로
   등록합니다 (여러 명이면 쉼표로 구분):
   ```
   supabase secrets set ADMIN_EMAILS=you@example.com
   ```
3. `/admin`에서 방금 만든 계정으로 로그인하면 화면이 열립니다.

(cron이 서비스 역할 키로 `sync-leagues`/`predict-due`를 직접 호출하는 경로는
`requireAdmin`이 별도로 신뢰하므로 위 설정과 무관하게 계속 동작합니다.)

## 추적 리그 변경하기

`supabase/functions/_shared/leagues.ts`의 `TRACKED_LEAGUES`에서 FotMob
리그 ID를 추가/삭제하면 됩니다. ID는 `https://www.fotmob.com/api/data/leagues?id=<id>`
로 직접 확인할 수 있습니다.

## 알려진 한계

- **FotMob은 비공식 API입니다** — 공식 문서가 없고, 스키마나 요청 제한이 예고
  없이 바뀔 수 있습니다. 프로덕션에서 장기간 의존할 경우 모니터링이 필요합니다.
- **리그 순위표는 항상 "현재" 시점 기준**입니다 — 백테스팅에서 과거 경기를
  재현할 때도 그 경기 당시가 아닌 현재 순위를 참고하게 되므로, 순위 변수는
  백테스트 결과 해석 시 감안해야 합니다.
- **날씨/고도/심판 성향/대륙별 상성 등은 반영되지 않습니다** — FotMob 응답에
  경기장 위치(위경도)와 심판 이름 정도는 있지만, 날씨나 심판의 성향(경기당 평균
  카드 수 등) 통계는 별도 데이터 소스 없이는 계산할 수 없어 이번 구현에는
  포함하지 않았습니다.
- **경기 중 변수(퇴장, 부상, 교체)는 정의상 사전 예측에 포함될 수 없습니다** —
  이 사이트의 예측은 킥오프 이전 데이터만 사용하는 사전 예측입니다.
- **부상/징계 선수 명단 소스가 없습니다** — 예상 라인업은 최근 출전 데이터로
  추정한 것이며, 실제 결장 사유(부상 등)를 반영하지 않습니다.

## 라이선스

[MIT](LICENSE)
