-- fetch-standings now writes rows keyed by fotmob_league_id/fotmob_team_id
-- and no longer populates the old api_football_league_id/team_api_id
-- columns. Relax their NOT NULL constraints so new rows can be inserted
-- without them (old rows/columns are left in place, per the additive ->
-- backfill -> cleanup migration sequence in the FotMob migration plan doc).
alter table league_standings alter column api_football_league_id drop not null;
alter table league_standings alter column team_api_id drop not null;
