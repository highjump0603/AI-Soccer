# MatchAI — setup

Real prediction pipeline for the `축구경기 예측 사이트` project: React + Vite
frontend, Supabase Postgres for storage, and Supabase Edge Functions that
pull data from API-Football, run a Poisson statistical model, get an
independent read from GPT, and ensemble the two. See `README.md` /
`chats/chat1.md` for the original design handoff and this session's chat
for the prediction-pipeline design decisions.

## Why you have to run the deployment steps yourself

This was built in a sandboxed environment whose outbound network access is
allowlisted to a handful of hosts (npm, github via a proxy) — `supabase.com`,
`api.openai.com`, and `v3.football.api-sports.io` are all blocked from here
(confirmed: plain `curl` to each returns a 403). That means none of this has
been deployed or run against the live APIs yet — everything below is written
against the documented API-Football v3 / Supabase / OpenAI contracts, but
you'll be the first to actually exercise it end-to-end. If something errors
on first run, paste me the error and I'll fix it.

## 1. Install the frontend

```
npm install
```

`.env` should already have your Supabase project URL + publishable
(anon) key (see `.env.example` for the shape if you need to recreate it).

## 2. Install the Supabase CLI and link the project

```
npm install -g supabase
supabase login
supabase link --project-ref aynsrteiuomwowjgzbji
```

## 3. Push the database schema

```
supabase db push
```

This runs `supabase/migrations/0001_schema.sql` (teams/fixtures/team_recent_results/
players/lineups/predictions, all read-only to the public — no more direct
public writes like the old prototype had) and `0002_cron.sql` (pg_cron +
pg_net, scheduling the two Edge Functions below). The cron migration
references a Vault secret that doesn't exist yet, so **before the cron jobs
will actually fire**, run this once in the Supabase SQL Editor (not part of
the versioned migration, since it embeds your real key):

```sql
select vault.create_secret('<your service_role_key>', 'service_role_key');
```

(Get the service_role key from Project Settings → API. It's also sitting in
`supabase/.env` locally if you still have that.)

## 4. Set Edge Function secrets

```
supabase secrets set --env-file supabase/.env.functions
```

This sets `OPENAI_API_KEY` and `API_FOOTBALL_KEY`. (`SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically into every Edge
Function by Supabase — don't set those yourself, it'll error since they're
reserved names.)

## 5. Deploy the Edge Functions

```
supabase functions deploy sync-leagues
supabase functions deploy predict-due
supabase functions deploy untrack-fixture
```

## 6. Kick off the first sync manually

Cron won't fire until the schedule hits (every 6h for `sync-leagues`, every
30min for `predict-due`), so trigger it once by hand to see data show up
immediately:

```
supabase functions invoke sync-leagues
supabase functions invoke predict-due
```

Then `npm run dev` and check `/admin` — you should see fixtures for the
tracked leagues, and after `predict-due` runs, predictions with scores/
probabilities/factors.

## 7. Run the frontend

```
npm run dev
```

Routes: `/` (home + dashboard), `/match/:id` (detail), `/admin` (tracked-
fixture management — sync now / re-predict now / untrack).

## How the prediction actually works

- **`sync-leagues`** (cron every 6h): pulls upcoming fixtures for the
  tracked leagues (see `supabase/functions/_shared/leagues.ts` — Premier
  League, La Liga, Bundesliga, Serie A, K League 1, World Cup, national-team
  friendlies) from API-Football and upserts teams/fixtures.
- **`predict-due`** (cron every 30min, or manually per-fixture from
  `/admin`): for fixtures needing a fresh prediction, pulls each team's
  recent results, head-to-head history, and lineups (once released, usually
  ~1h before kickoff) from API-Football; runs a Poisson scoreline model
  (`_shared/poisson.ts`) off team form + H2H; asks GPT independently for its
  own probabilities/score/factors given the same context
  (`_shared/openai.ts`); and ensembles the two (65% stat / 35% GPT, blended
  at the expected-goals level — `_shared/ensemble.ts`). Confidence reflects
  how much the two models agree.
- **Player-level head-to-head**: there's no API that gives real player-vs-
  player duel stats. What's actually implemented is honest but more modest:
  when both the current lineup and the last meeting between the two clubs
  have lineup data, it flags which of today's starters also played in that
  last meeting (`_shared/matchMapping.ts: computePlayerMeetingNotes`), and
  scales how much weight the H2H history gets in the model based on how much
  squad overlap there is with that history (`computeLineupOverlapRatio`) —
  a recent meeting with mostly the same players is stronger evidence than
  one where the squads have since turned over.
- **API budget**: `predict-due` caps itself at 8 fixtures per invocation and
  only fully recomputes a fixture every 6h (or more often in the last 3h
  before kickoff, to catch confirmed lineups) — tune `MAX_PER_RUN` /
  `FULL_RECOMPUTE_AFTER_MS` in `supabase/functions/predict-due/index.ts` to
  match your actual API-Football plan's rate limit, which I couldn't verify
  from the build environment.
- **League IDs**: the national-team competition IDs (`월드컵`, `국가대표`)
  in `_shared/leagues.ts` are the most likely to need adjusting — verify
  against `GET /leagues` for what your plan actually has access to.

## Known limitations

- No admin auth (same as before) — the admin page's actions call Edge
  Functions rather than writing to the DB directly now, which is tighter
  than the old fully-open RLS, but there's still no login gating who can
  trigger a resync/re-predict/untrack.
- Bookmaker odds (`odds_book_*`) come from API-Football's `/odds` endpoint
  averaged across whatever bookmakers it returns for that fixture — not
  every fixture/plan tier has odds coverage, in which case it's stored as
  null and the UI shows "—".
