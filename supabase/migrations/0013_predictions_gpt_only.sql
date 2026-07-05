-- The Poisson statistical model has been retired — GPT is now the sole
-- predictor (given formation, lineup, fatigue, discipline, H2H, form, and
-- standings directly, rather than blended against a separate model
-- afterward). stat_prob_*/stat_score_* have nothing to store anymore;
-- relax their NOT NULL constraints so predict-due can leave them null.
-- stat_xg_home/away stay populated as a reference expected-goals hint fed
-- into GPT's prompt (already nullable).
alter table predictions alter column stat_prob_home drop not null;
alter table predictions alter column stat_prob_draw drop not null;
alter table predictions alter column stat_prob_away drop not null;
alter table predictions alter column stat_score_home drop not null;
alter table predictions alter column stat_score_away drop not null;
