-- Full head-to-head match rows (date/league/score) for the detail page,
-- alongside the existing W/D/L-only quick_h2h used by the model. Populated
-- by the same getHeadToHead call quick-match-info/predict-due already make,
-- so this costs no extra API-Football quota.
alter table fixtures
  add column if not exists quick_h2h_detail jsonb not null default '[]';

-- League table, refreshed on-demand (like quick-match-info) rather than by
-- cron, since it's only worth the API call for leagues someone's actually
-- looking at. Denormalized (team name/logo stored directly) instead of FK'd
-- to `teams`, since a league table often includes clubs we haven't synced
-- fixtures for yet.
create table if not exists league_standings (
  id bigint generated always as identity primary key,
  api_football_league_id integer not null,
  season integer not null,
  team_api_id integer not null,
  team_name text not null,
  team_logo_url text,
  rank integer not null,
  played integer not null,
  win integer not null,
  draw integer not null,
  lose integer not null,
  goals_for integer not null,
  goals_against integer not null,
  points integer not null,
  form text,
  fetched_at timestamptz not null default now(),
  unique (api_football_league_id, season, team_api_id)
);
create index if not exists league_standings_league_idx on league_standings (api_football_league_id, season, rank);

alter table league_standings enable row level security;
create policy "public read league_standings" on league_standings for select using (true);
