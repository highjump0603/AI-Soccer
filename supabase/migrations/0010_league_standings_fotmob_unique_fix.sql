-- The partial unique index from 0008 doesn't match a plain
-- `ON CONFLICT (fotmob_league_id, season, fotmob_team_id)` clause (Postgres
-- requires the ON CONFLICT target to reference a constraint/index with the
-- exact same predicate, and the Supabase client's upsert() doesn't support
-- specifying one). Replace it with a non-partial unique index — safe even
-- for old rows with null fotmob_* columns, since NULL is never considered
-- equal to NULL in a unique index, so those rows just never conflict with
-- anything.
drop index if exists league_standings_fotmob_idx;
create unique index if not exists league_standings_fotmob_idx
  on league_standings (fotmob_league_id, season, fotmob_team_id);
