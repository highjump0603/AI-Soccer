import { supabase } from './supabaseClient';

function formatKickoff(iso) {
  const d = new Date(iso);
  const tz = 'Asia/Seoul';
  const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: tz, weekday: 'short' }).format(d);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(d);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${month}/${day} (${weekday}) ${time}`;
}

const round1 = (n) => (n == null ? 0 : Math.round(n * 10) / 10);

function rowToMatch(row) {
  // PostgREST embeds a unique-FK relation as a single object/null, but
  // depending on how it resolves the relationship it can come back as an
  // array instead ([] for none, [{...}] for one) - normalize either shape
  // so an empty array doesn't get treated as a truthy "prediction exists".
  const p = Array.isArray(row.predictions) ? (row.predictions[0] ?? null) : row.predictions;
  return {
    id: row.id,
    league: row.league,
    date: formatKickoff(row.kickoff_at),
    kickoffAt: row.kickoff_at,
    status: row.status,
    venue: row.venue,
    home: { id: row.home_team.id, fotmobId: row.home_team.fotmob_id, name: row.home_team.name, logoUrl: row.home_team.logo_url },
    away: { id: row.away_team.id, fotmobId: row.away_team.fotmob_id, name: row.away_team.name, logoUrl: row.away_team.logo_url },
    season: row.season ?? null,
    actualScore:
      row.status === 'finished' && row.home_score_actual != null && row.away_score_actual != null
        ? { home: row.home_score_actual, away: row.away_score_actual }
        : null,
    homeFormation: row.home_formation ?? null,
    awayFormation: row.away_formation ?? null,
    fotmobLeagueId: row.fotmob_league_id ?? null,
    hasPrediction: !!p,
    generatedAt: p?.generated_at ?? null,
    score: p ? { home: p.final_score_home, away: p.final_score_away } : null,
    prob: p ? { home: round1(p.final_prob_home), draw: round1(p.final_prob_draw), away: round1(p.final_prob_away) } : null,
    confidence: p?.confidence ?? null,
    confidencePct: p?.confidence_pct != null ? round1(p.confidence_pct) : null,
    factors: p?.factors ?? [],
    h2h: p?.h2h ?? row.quick_h2h ?? [],
    h2hDetail: row.quick_h2h_detail ?? [],
    playerNotes: p?.player_notes ?? [],
    gptSummary: p?.gpt_summary ?? '',
    quickInfoFetchedAt: row.quick_info_fetched_at ?? null,
    estimatedLineupFetchedAt: row.estimated_lineup_fetched_at ?? null,
    odds: {
      book: {
        home: p?.odds_book_home ?? row.quick_odds_home ?? null,
        draw: p?.odds_book_draw ?? row.quick_odds_draw ?? null,
        away: p?.odds_book_away ?? row.quick_odds_away ?? null,
      },
      ai: { home: p?.odds_ai_home ?? null, draw: p?.odds_ai_draw ?? null, away: p?.odds_ai_away ?? null },
    },
  };
}

const FIXTURE_SELECT = `
  id, league, season, kickoff_at, status, venue, home_score_actual, away_score_actual,
  home_formation, away_formation, estimated_lineup_fetched_at, fotmob_league_id,
  quick_h2h, quick_h2h_detail, quick_odds_home, quick_odds_draw, quick_odds_away, quick_info_fetched_at,
  home_team:home_team_id(id, name, logo_url, fotmob_id),
  away_team:away_team_id(id, name, logo_url, fotmob_id),
  predictions(*)
`;

export async function listUpcomingFixtures() {
  const { data, error } = await supabase
    .from('fixtures')
    .select(FIXTURE_SELECT)
    .neq('status', 'finished')
    .order('kickoff_at', { ascending: true });
  if (error) throw error;
  return data.map(rowToMatch);
}

// Recently finished matches, most recent first — shown in a separate "past
// matches" section so results don't just disappear once a fixture completes.
export async function listRecentFinishedFixtures(limit = 20) {
  const { data, error } = await supabase
    .from('fixtures')
    .select(FIXTURE_SELECT)
    .eq('status', 'finished')
    .order('kickoff_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map(rowToMatch);
}

// Starting lineups for a fixture, split by team. Lineups are populated
// server-side (predicted ahead of kickoff, confirmed closer to it) and are
// public-read, so the client can query them directly without an Edge
// Function round trip.
export async function fetchLineups(fixtureId) {
  const { data, error } = await supabase
    .from('lineups')
    .select('team_id, source, shirt_number, grid_row, grid_col, pos_x, pos_y, player:player_id(name, position, fotmob_id)')
    .eq('fixture_id', fixtureId)
    .eq('is_starting', true);
  if (error) throw error;
  return data;
}

// Per-fixture match statistics (xG, shots, possession, ...) from FotMob —
// only present once a match has started/finished, public-read like
// everything else the prediction pipeline caches.
export async function fetchMatchStats(fixtureId) {
  const { data, error } = await supabase
    .from('match_stats')
    .select('stat_key, stat_title, home_value, away_value, stat_type')
    .eq('fixture_id', fixtureId);
  if (error) throw error;
  return data;
}

// A team's own recent match results (used by the model as "form" — separate
// from h2h, which is specifically meetings between the two clubs in this
// fixture). Cached by the prediction pipeline, public-read like everything
// else.
export async function fetchRecentForm(teamId, limit = 5) {
  const { data, error } = await supabase
    .from('team_recent_results')
    .select('opponent_name, venue, goals_for, goals_against, result, played_at')
    .eq('team_id', teamId)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// Admin view includes everything, not just upcoming, so finished/cancelled
// tracked fixtures don't just silently vanish from the management screen.
export async function listAllFixturesForAdmin() {
  const { data, error } = await supabase.from('fixtures').select(FIXTURE_SELECT).order('kickoff_at', { ascending: true });
  if (error) throw error;
  return data.map(rowToMatch);
}

export async function triggerSyncLeagues() {
  const { data, error } = await supabase.functions.invoke('sync-leagues', { body: {} });
  if (error) throw error;
  return data;
}

export async function triggerPredictFixture(fixtureId) {
  const { data, error } = await supabase.functions.invoke('predict-due', { body: { fixture_id: fixtureId } });
  if (error) throw error;
  return data;
}

// Runs the same "what's due" pass predict-due's cron trigger does, but
// on-demand — used right after a manual sync so newly-discovered fixtures
// get an AI prediction immediately instead of waiting for the next
// scheduled cron tick (up to 30 minutes away).
export async function triggerPredictAllDue() {
  const { data, error } = await supabase.functions.invoke('predict-due', { body: {} });
  if (error) throw error;
  return data;
}

export async function untrackFixture(fixtureId) {
  const { data, error } = await supabase.functions.invoke('untrack-fixture', { body: { fixture_id: fixtureId } });
  if (error) throw error;
  return data;
}

// Fetches just h2h + bookmaker odds for one fixture so the detail page has
// something to show before the full prediction pipeline gets to it.
export async function fetchQuickMatchInfo(fixtureId) {
  const { data, error } = await supabase.functions.invoke('quick-match-info', { body: { fixture_id: fixtureId } });
  if (error) throw error;
  return data;
}

// Builds a best-guess starting XI + formation from each team's recent
// lineups when the club hasn't announced an official one yet. Writes
// straight to the `lineups`/`fixtures` tables server-side — callers should
// just re-run fetchLineups() afterward to pick up the new rows.
export async function triggerEstimateLineup(fixtureId) {
  const { data, error } = await supabase.functions.invoke('estimate-lineup', { body: { fixture_id: fixtureId } });
  if (error) throw error;
  return data;
}

// League table for one competition, cached in `league_standings`. Public
// read, so once fetched (see triggerFetchStandings) the client can query it
// directly.
export async function fetchStandings(fotmobLeagueId) {
  const { data, error } = await supabase
    .from('league_standings')
    .select('fotmob_team_id, team_name, team_logo_url, rank, played, win, draw, lose, goals_for, goals_against, points, form')
    .eq('fotmob_league_id', fotmobLeagueId)
    .order('rank', { ascending: true });
  if (error) throw error;
  return data;
}

// Refreshes the cached league table server-side if it's stale (see
// fetch-standings for the TTL) — callers should re-run fetchStandings()
// afterward to pick up any new rows.
export async function triggerFetchStandings(fotmobLeagueId) {
  const { data, error } = await supabase.functions.invoke('fetch-standings', { body: { fotmob_league_id: fotmobLeagueId } });
  if (error) throw error;
  return data;
}

// Runs the real prediction pipeline against a league/season's most recent
// already-finished matches, using only data from before each match's own
// kickoff, and stores the comparison against the real result in
// `backtest_results`.
export async function runBacktestForLeagueSeason(league, season, count = 5) {
  const { data, error } = await supabase.functions.invoke('backtest', { body: { league, season, count } });
  if (error) throw error;
  return data;
}

export async function runBacktestForMatch(fotmobMatchId) {
  const { data, error } = await supabase.functions.invoke('backtest', { body: { matchId: fotmobMatchId } });
  if (error) throw error;
  return data;
}

export async function clearBacktestResults() {
  const { data, error } = await supabase.functions.invoke('clear-backtest-results', { body: {} });
  if (error) throw error;
  return data;
}

export async function listBacktestLeagues() {
  const fallbackLeagues = ['프리미어리그', 'EPL', '라리가', 'La Liga', '분데스리가', 'Bundesliga', '세리에A', 'Serie A', '리그앙', 'Ligue 1', 'K리그1', '월드컵', 'World Cup'];
  const { data, error } = await supabase.from('fixtures').select('league').not('league', 'is', null).order('league', { ascending: true });
  if (error) throw error;

  const fromFixtures = (data ?? []).map((row) => row.league).filter(Boolean);
  return [...new Set([...fallbackLeagues, ...fromFixtures])].sort((a, b) => a.localeCompare(b, 'ko'));
}

export async function fetchBacktestResults(limit) {
  let query = supabase
    .from('backtest_results')
    .select(
      'id, fotmob_match_id, league, home_team_name, away_team_name, kickoff_at, predicted_prob_home, predicted_prob_draw, predicted_prob_away, predicted_score_home, predicted_score_away, actual_score_home, actual_score_away, outcome_correct, score_correct, factors, analysis, run_at'
    )
    .order('run_at', { ascending: false });

  if (typeof limit === 'number' && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
