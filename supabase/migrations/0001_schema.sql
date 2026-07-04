-- MatchAI schema v2 — real prediction pipeline.
--
-- Replaces the earlier hand-entered `matches` table with normalized
-- tables that a server-side pipeline (Supabase Edge Functions) populates
-- from API-Football, plus the resulting model output. There is no public
-- write access anywhere here — every table is read-only to anon/
-- authenticated clients; only the service role (used exclusively by Edge
-- Functions) can insert/update/delete. The admin UI triggers Edge
-- Functions instead of writing rows directly.

drop table if exists matches;

create table if not exists teams (
  id bigint generated always as identity primary key,
  api_football_id integer not null unique,
  name text not null,
  short_name text,
  country text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists fixtures (
  id bigint generated always as identity primary key,
  api_football_fixture_id bigint not null unique,
  api_football_league_id integer not null,
  league text not null,
  season integer not null,
  kickoff_at timestamptz not null,
  venue text,
  status text not null default 'scheduled' check (status in ('scheduled', 'lineups_confirmed', 'finished', 'postponed', 'cancelled')),
  home_team_id bigint not null references teams(id),
  away_team_id bigint not null references teams(id),
  home_score_actual integer,
  away_score_actual integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fixtures_kickoff_idx on fixtures (kickoff_at);
create index if not exists fixtures_status_idx on fixtures (status);

-- Cached match log per team — the raw material for both "recent form" and
-- head-to-head (H2H is just this table filtered to games against one
-- specific opponent). Refreshed by the sync pipeline, not fetched live on
-- every page view.
create table if not exists team_recent_results (
  id bigint generated always as identity primary key,
  team_id bigint not null references teams(id),
  api_football_fixture_id bigint not null,
  played_at timestamptz not null,
  opponent_team_id bigint references teams(id),
  opponent_name text not null,
  venue text not null check (venue in ('home', 'away')),
  goals_for integer not null,
  goals_against integer not null,
  result text not null check (result in ('W', 'D', 'L')),
  competition text,
  created_at timestamptz not null default now(),
  unique (team_id, api_football_fixture_id)
);
create index if not exists team_recent_results_team_idx on team_recent_results (team_id, played_at desc);
create index if not exists team_recent_results_opponent_idx on team_recent_results (team_id, opponent_team_id, played_at desc);

create table if not exists players (
  id bigint generated always as identity primary key,
  api_football_id integer not null unique,
  name text not null,
  team_id bigint references teams(id),
  position text,
  created_at timestamptz not null default now()
);

-- Lineups for both tracked upcoming fixtures ('predicted' until the club
-- confirms it near kickoff, then 'confirmed') AND for past fixtures pulled
-- in via the head-to-head lookup — reusing this table for history lets the
-- prediction pipeline cross-reference "did this player play the last time
-- these two clubs met" without a separate structure.
create table if not exists lineups (
  id bigint generated always as identity primary key,
  fixture_id bigint not null references fixtures(id) on delete cascade,
  team_id bigint not null references teams(id),
  player_id bigint not null references players(id),
  is_starting boolean not null default true,
  source text not null default 'predicted' check (source in ('predicted', 'confirmed')),
  captured_at timestamptz not null default now(),
  unique (fixture_id, team_id, player_id)
);
create index if not exists lineups_fixture_idx on lineups (fixture_id);
create index if not exists lineups_player_idx on lineups (player_id);

-- One row per tracked fixture: the latest model output. Re-running the
-- pipeline overwrites this row (generated_at moves forward) rather than
-- keeping a history — add a fixture_id-less audit table later if you want
-- to track how a prediction drifted over time.
create table if not exists predictions (
  id bigint generated always as identity primary key,
  fixture_id bigint not null unique references fixtures(id) on delete cascade,
  generated_at timestamptz not null default now(),

  stat_prob_home numeric not null,
  stat_prob_draw numeric not null,
  stat_prob_away numeric not null,
  stat_score_home integer not null,
  stat_score_away integer not null,
  stat_xg_home numeric,
  stat_xg_away numeric,

  gpt_prob_home numeric,
  gpt_prob_draw numeric,
  gpt_prob_away numeric,
  gpt_score_home integer,
  gpt_score_away integer,
  gpt_summary text,

  final_prob_home numeric not null,
  final_prob_draw numeric not null,
  final_prob_away numeric not null,
  final_score_home integer not null,
  final_score_away integer not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),

  factors text[] not null default '{}',
  h2h text[] not null default '{}',
  player_notes jsonb not null default '[]',

  odds_book_home numeric,
  odds_book_draw numeric,
  odds_book_away numeric,
  odds_ai_home numeric,
  odds_ai_draw numeric,
  odds_ai_away numeric,

  raw_inputs jsonb,
  created_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table fixtures enable row level security;
alter table team_recent_results enable row level security;
alter table players enable row level security;
alter table lineups enable row level security;
alter table predictions enable row level security;

create policy "public read teams" on teams for select using (true);
create policy "public read fixtures" on fixtures for select using (true);
create policy "public read team_recent_results" on team_recent_results for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read lineups" on lineups for select using (true);
create policy "public read predictions" on predictions for select using (true);

-- Deliberately no insert/update/delete policies for anon/authenticated —
-- only the service_role key (used solely inside Edge Functions, never
-- shipped to the browser) can write. The admin UI calls Edge Functions
-- instead of writing rows directly, so there's no open write surface like
-- the old schema had.
