-- Formation-aware lineup display: API-Football's lineup response includes a
-- formation string per side and a "row:col" grid position per starter,
-- which is what lets the UI draw players on a pitch instead of a flat list.
alter table lineups
  add column if not exists shirt_number integer,
  add column if not exists grid_row integer,
  add column if not exists grid_col integer;

alter table fixtures
  add column if not exists home_formation text,
  add column if not exists away_formation text;
