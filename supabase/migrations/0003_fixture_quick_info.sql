-- Lightweight h2h/odds cache on fixtures, populated on-demand by the
-- quick-match-info Edge Function when someone opens a match detail page
-- before the full prediction pipeline has run. Kept separate from
-- `predictions` because it's fetched lazily per-viewer, not by the cron
-- pipeline, and shouldn't imply a prediction exists.
alter table fixtures
  add column if not exists quick_h2h jsonb not null default '[]',
  add column if not exists quick_odds_home numeric,
  add column if not exists quick_odds_draw numeric,
  add column if not exists quick_odds_away numeric,
  add column if not exists quick_info_fetched_at timestamptz;
