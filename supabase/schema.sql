-- MatchAI schema. Run this once in the Supabase SQL editor
-- (Project -> SQL Editor -> New query -> paste -> Run) after creating a
-- fresh Supabase project.

create table if not exists matches (
  id bigint generated always as identity primary key,
  league text not null,
  match_date text not null default '',
  home_name text not null,
  away_name text not null,
  score_home integer not null default 0,
  score_away integer not null default 0,
  prob_home integer not null default 0,
  prob_draw integer not null default 0,
  prob_away integer not null default 0,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  odds_book_home numeric not null default 0,
  odds_book_draw numeric not null default 0,
  odds_book_away numeric not null default 0,
  odds_ai_home numeric not null default 0,
  odds_ai_draw numeric not null default 0,
  odds_ai_away numeric not null default 0,
  factors text[] not null default '{}',
  h2h text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table matches enable row level security;

-- These policies leave the table fully open to anyone holding the anon key
-- (which ships inside the client bundle, so effectively anyone on the
-- internet) — there's no login gating the admin page, matching the
-- prototype's design (the "관리자" nav item is just a route, not an
-- authenticated area). Fine for a demo/personal project; before treating
-- this as production, add Supabase Auth and scope insert/update/delete to
-- authenticated admins only.
create policy "public read" on matches for select using (true);
create policy "public insert" on matches for insert with check (true);
create policy "public update" on matches for update using (true);
create policy "public delete" on matches for delete using (true);

-- Seed data — mirrors the 8 example matches from the Claude Design prototype.
insert into matches
  (league, match_date, home_name, away_name, score_home, score_away, prob_home, prob_draw, prob_away, confidence,
   odds_book_home, odds_book_draw, odds_book_away, odds_ai_home, odds_ai_draw, odds_ai_away, factors, h2h)
values
  ('프리미어리그', '7/6 (일) 21:00', '맨체스터 시티', '리버풀', 2, 1, 44, 26, 30, 'high',
   2.05, 3.6, 3.4, 2.27, 3.85, 3.33,
   array['홈팀 최근 5경기 4승 1무, 득점력 상승세', '원정팀 주전 수비수 1명 부상 결장', '홈 구장 최근 10경기 무패'],
   array['W', 'D', 'W', 'L', 'W']),

  ('프리미어리그', '7/6 (일) 23:30', '아스널', '첼시', 1, 1, 38, 29, 33, 'medium',
   2.4, 3.3, 2.9, 2.63, 3.45, 3.03,
   array['양 팀 최근 맞대결 3경기 모두 무승부', '홈팀 공격수 경고 누적으로 다음 경기 출전 불가', '원정팀 원정 경기 득점력 상위권'],
   array['D', 'D', 'D', 'W', 'L']),

  ('라리가', '7/7 (월) 04:00', '레알 마드리드', '바르셀로나', 2, 2, 41, 24, 35, 'medium',
   2.3, 3.7, 2.7, 2.44, 4.17, 2.86,
   array['엘 클라시코 최근 5경기 득점 평균 3.2골', '홈팀 핵심 미드필더 컨디션 저하', '원정팀 최근 6경기 무패 행진'],
   array['L', 'W', 'D', 'W', 'L']),

  ('분데스리가', '7/6 (일) 22:30', '바이에른 뮌헨', '도르트문트', 3, 1, 58, 22, 20, 'high',
   1.55, 4.4, 5.2, 1.72, 4.55, 5.0,
   array['홈팀 홈 경기 12연승 중', '원정팀 주전 스트라이커 부상 이탈', '홈팀 최근 5경기 평균 득점 2.8골'],
   array['W', 'W', 'D', 'W', 'W']),

  ('세리에A', '7/7 (월) 02:45', '인터 밀란', '유벤투스', 1, 0, 39, 31, 30, 'low',
   2.5, 3.2, 3.0, 2.56, 3.23, 3.33,
   array['양 팀 최근 폼이 비슷한 수준', '홈팀 로테이션 가능성으로 변수 존재', '원정팀 원정 경기 무실점 3경기 연속'],
   array['W', 'L', 'D', 'D', 'W']),

  ('K리그1', '7/5 (토) 19:00', '울산 HD', '전북 현대', 2, 0, 48, 28, 24, 'high',
   1.9, 3.5, 4.0, 2.08, 3.57, 4.17,
   array['홈팀 최근 6경기 5승, 리그 선두', '원정팀 주전 골키퍼 부상', '홈팀 홈 무실점 경기 3경기 연속'],
   array['W', 'W', 'L', 'D', 'W']),

  ('K리그1', '7/6 (일) 19:30', '포항 스틸러스', '광주 FC', 1, 1, 35, 33, 32, 'low',
   2.7, 3.1, 3.0, 2.86, 3.03, 3.13,
   array['양 팀 최근 5경기 승점 차이 근소', '홈팀 핵심 공격수 로테이션 예상', '원정팀 최근 3경기 연속 무승부'],
   array['D', 'D', 'W', 'L', 'D']),

  ('국가대표', '7/8 (화) 03:00', '대한민국', '일본', 1, 1, 36, 30, 34, 'medium',
   2.6, 3.2, 2.85, 2.78, 3.33, 2.94,
   array['최근 A매치 5경기 중 3경기 무승부', '주장급 수비수 소속팀 부상에서 복귀 직후', '상대 전적 최근 5경기 균형적'],
   array['L', 'W', 'D', 'W', 'L']);
