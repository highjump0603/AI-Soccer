-- 0007 added fotmob_league_id/fotmob_team_id columns to league_standings
-- but no uniqueness constraint on them, so fetch-standings couldn't upsert
-- by the new identifiers yet. Still additive (old api_football_* columns
-- and their unique constraint untouched) — see the FotMob migration plan
-- doc for the overall additive -> backfill -> cleanup sequence.
create unique index if not exists league_standings_fotmob_idx
  on league_standings (fotmob_league_id, season, fotmob_team_id)
  where fotmob_league_id is not null and fotmob_team_id is not null;
