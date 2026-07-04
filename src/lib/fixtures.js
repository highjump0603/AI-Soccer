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
    home: { name: row.home_team.name, logoUrl: row.home_team.logo_url },
    away: { name: row.away_team.name, logoUrl: row.away_team.logo_url },
    hasPrediction: !!p,
    generatedAt: p?.generated_at ?? null,
    score: p ? { home: p.final_score_home, away: p.final_score_away } : null,
    prob: p ? { home: round1(p.final_prob_home), draw: round1(p.final_prob_draw), away: round1(p.final_prob_away) } : null,
    confidence: p?.confidence ?? null,
    factors: p?.factors ?? [],
    h2h: p?.h2h ?? [],
    playerNotes: p?.player_notes ?? [],
    gptSummary: p?.gpt_summary ?? '',
    odds: {
      book: { home: p?.odds_book_home ?? null, draw: p?.odds_book_draw ?? null, away: p?.odds_book_away ?? null },
      ai: { home: p?.odds_ai_home ?? null, draw: p?.odds_ai_draw ?? null, away: p?.odds_ai_away ?? null },
    },
  };
}

const FIXTURE_SELECT = `
  id, league, kickoff_at, status,
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
