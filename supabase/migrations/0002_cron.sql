-- Scheduled refresh: pg_cron fires pg_net HTTP calls into the Edge
-- Functions. The service role key itself is NOT embedded here (this file
-- is committed to git) — it's pulled at call-time from Supabase Vault.
-- Before this cron actually works, run once in the SQL editor (not part of
-- version control):
--
--   select vault.create_secret('<your service_role_key>', 'service_role_key');
--
-- (see README.md for the full one-time setup step). Also replace
-- YOUR_PROJECT_REF below with your own Supabase project ref (Project
-- Settings -> General -> Reference ID) before applying this migration.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Discover newly-added fixtures for the tracked leagues every 6 hours.
select cron.schedule(
  'sync-leagues-every-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-leagues',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Recompute predictions for fixtures that are due (no prediction yet, or
-- stale, or within the lineup-confirmation window) every 30 minutes — this
-- is what picks up confirmed lineups once clubs release them close to
-- kickoff.
select cron.schedule(
  'predict-due-every-30m',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/predict-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
