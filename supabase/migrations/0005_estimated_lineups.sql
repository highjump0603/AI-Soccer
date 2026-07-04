-- Self-built "likely XI" for fixtures where API-Football hasn't published
-- an official lineup yet: built from each team's recent starting XIs plus
-- current injury/suspension info, so the detail page has something to show
-- before the club announces anything. Reuses the existing lineups table
-- (same FormationPitch rendering) with a new source value.
alter table lineups drop constraint if exists lineups_source_check;
alter table lineups add constraint lineups_source_check check (source in ('predicted', 'confirmed', 'estimated'));

alter table fixtures
  add column if not exists estimated_lineup_fetched_at timestamptz;
