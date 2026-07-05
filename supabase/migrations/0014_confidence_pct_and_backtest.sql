-- Expose GPT's own top-outcome probability directly (the "high/medium/low"
-- label was already derived from it — now showing the actual number too so
-- it's clear the confidence figure is the AI's own probability, not a
-- separate heuristic).
alter table predictions add column if not exists confidence_pct numeric;

-- Backtesting: re-run a prediction against an already-finished match using
-- only data available before its kickoff (see _shared/predictionInputs.ts's
-- excludeAtOrAfter), then compare against the real result. Not tied to the
-- `fixtures` table by foreign key — most backtest targets are historical
-- matches never tracked as a live fixture, so team/match info is stored
-- directly here instead.
create table if not exists backtest_results (
  id bigint generated always as identity primary key,
  fotmob_match_id bigint not null,
  league text,
  home_team_name text not null,
  away_team_name text not null,
  kickoff_at timestamptz not null,
  predicted_prob_home numeric not null,
  predicted_prob_draw numeric not null,
  predicted_prob_away numeric not null,
  predicted_score_home integer not null,
  predicted_score_away integer not null,
  actual_score_home integer not null,
  actual_score_away integer not null,
  outcome_correct boolean not null,
  score_correct boolean not null,
  factors text[] not null default '{}',
  analysis text,
  run_at timestamptz not null default now(),
  unique (fotmob_match_id)
);
create index if not exists backtest_results_run_at_idx on backtest_results (run_at desc);

alter table backtest_results enable row level security;
create policy "public read backtest_results" on backtest_results for select using (true);
