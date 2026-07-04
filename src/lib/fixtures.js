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
    home: { id: row.home_team.id, name: row.home_team.name, logoUrl: row.home_team.logo_url },
    away: { id: row.away_team.id, name: row.away_team.name, logoUrl: row.away_team.logo_url },
    actualScore:
      row.status === 'finished' && row.home_score_actual != null && row.away_score_actual != null
        ? { home: row.home_score_actual, away: row.away_score_actual }
        : null,
    homeFormation: row.home_formation ?? null,
    awayFormation: row.away_formation ?? null,
    hasPrediction: !!p,
    generatedAt: p?.generated_at ?? null,
    score: p ? { home: p.final_score_home, away: p.final_score_away } : null,
    prob: p ? { home: round1(p.final_prob_home), draw: round1(p.final_prob_draw), away: round1(p.final_prob_away) } : null,
    confidence: p?.confidence ?? null,
    factors: p?.factors ?? [],
    h2h: p?.h2h ?? row.quick_h2h ?? [],
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
  id, league, kickoff_at, status, venue, home_score_actual, away_score_actual,
  home_formation, away_formation, estimated_lineup_fetched_at,
  quick_h2h, quick_odds_home, quick_odds_draw, quick_odds_away, quick_info_fetched_at,
  home_team:home_team_id(id, name, logo_url),
  away_team:away_team_id(id, name, logo_url),
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
    .select('team_id, source, shirt_number, grid_row, grid_col, player:player_id(name, position, api_football_id)')
    .eq('fixture_id', fixtureId)
    .eq('is_starting', true);
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
