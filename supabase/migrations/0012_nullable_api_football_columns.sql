-- Every table's api_football_* identifier column was still NOT NULL from
-- the original schema, which blocks inserting any team/fixture/player that
-- is genuinely new under FotMob (never existed under API-Football) —
-- discovered when a real new team failed to upsert during predict-due
-- cutover verification. This can't wait for the final 00xx cleanup
-- migration (dropping these columns entirely) since sync-leagues/
-- predict-due need to insert brand-new rows immediately. Relax to nullable
-- now; the columns themselves are still dropped later once backfill is
-- fully verified (see migration plan doc).
alter table teams alter column api_football_id drop not null;
alter table fixtures alter column api_football_fixture_id drop not null;
alter table fixtures alter column api_football_league_id drop not null;
alter table players alter column api_football_id drop not null;
alter table team_recent_results alter column api_football_fixture_id drop not null;
