-- Same bug as 0010's league_standings fix, but for the other tables from
-- 0007: partial unique indexes (`where col is not null`) don't match a
-- plain `ON CONFLICT (col)` clause, which is all the Supabase client's
-- upsert() can express. Every FotMob-based upsert path (sync-leagues,
-- predict-due/cache.ts, backfill) needs these to be plain unique indexes
-- instead. Safe for existing null-valued rows — NULL is never equal to
-- NULL in a unique index, so old rows never spuriously conflict.
drop index if exists teams_fotmob_id_idx;
create unique index if not exists teams_fotmob_id_idx on teams (fotmob_id);

drop index if exists fixtures_fotmob_id_idx;
create unique index if not exists fixtures_fotmob_id_idx on fixtures (fotmob_id);

drop index if exists team_recent_results_fotmob_idx;
create unique index if not exists team_recent_results_fotmob_idx on team_recent_results (team_id, fotmob_match_id);

drop index if exists players_fotmob_id_idx;
create unique index if not exists players_fotmob_id_idx on players (fotmob_id);
