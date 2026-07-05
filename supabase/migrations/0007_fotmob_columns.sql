-- Additive step of the API-Football → FotMob migration. FotMob has no
-- relationship to API-Football's numeric IDs, so every row needs a new
-- fotmob_* identifier resolved by name+date matching (see the
-- backfill-fotmob-ids function) before anything can cut over. Old
-- api_football_* columns are deliberately left in place here — this is a
-- single-production-environment migration with no staging safety net, so
-- the sequence is: add columns (this file) -> backfill -> verify -> only
-- then drop the old columns in a later cleanup migration.

alter table teams
  add column if not exists fotmob_id integer;
create unique index if not exists teams_fotmob_id_idx on teams (fotmob_id) where fotmob_id is not null;

alter table fixtures
  add column if not exists fotmob_id bigint,
  add column if not exists fotmob_league_id integer,
  add column if not exists quick_odds_source text;
create unique index if not exists fixtures_fotmob_id_idx on fixtures (fotmob_id) where fotmob_id is not null;

alter table team_recent_results
  add column if not exists fotmob_match_id bigint;
create unique index if not exists team_recent_results_fotmob_idx on team_recent_results (team_id, fotmob_match_id) where fotmob_match_id is not null;

alter table players
  add column if not exists fotmob_id integer;
create unique index if not exists players_fotmob_id_idx on players (fotmob_id) where fotmob_id is not null;

alter table league_standings
  add column if not exists fotmob_league_id integer,
  add column if not exists fotmob_team_id integer;

-- Coordinate-based lineup positions (FotMob gives percentage x/y per
-- starter instead of API-Football's "row:col" grid string). Kept alongside
-- grid_row/grid_col rather than replacing them, so FormationPitch.jsx can
-- be migrated to consume coordinates in its own follow-up step without a
-- hard dependency on this migration.
alter table lineups
  add column if not exists pos_x numeric,
  add column if not exists pos_y numeric;

-- New feature: per-fixture match statistics (xG, shots, possession, etc.)
-- from FotMob's matchDetails endpoint. One row per stat key rather than a
-- wide fixed-column table, since FotMob's exact stat-key set isn't fully
-- enumerable up front and can vary by competition/data availability.
-- Values stored as text because FotMob mixes raw integers, decimals, and
-- percentages under the same shape — parse at the read layer, not here.
create table if not exists match_stats (
  id bigint generated always as identity primary key,
  fixture_id bigint not null references fixtures(id) on delete cascade,
  stat_key text not null,
  stat_title text,
  home_value text not null,
  away_value text not null,
  stat_type text,
  fetched_at timestamptz not null default now(),
  unique (fixture_id, stat_key)
);
create index if not exists match_stats_fixture_idx on match_stats (fixture_id);

alter table match_stats enable row level security;
create policy "public read match_stats" on match_stats for select using (true);
