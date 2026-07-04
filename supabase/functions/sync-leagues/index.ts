// Discovers upcoming fixtures for the tracked leagues and upserts the
// teams/fixtures rows the rest of the pipeline builds on. Run on a cron
// (see migrations/0002_cron.sql) — this function only ever adds/refreshes
// rows, it doesn't compute predictions (that's predict-due).
//
// Fetches by calendar date rather than league+season (see
// _shared/apiFootball.ts: getFixturesByDate for why) and filters the
// worldwide result down to TRACKED_LEAGUES client-side.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getFixturesByDate, type AfFixture } from '../_shared/apiFootball.ts';
import { TRACKED_LEAGUES } from '../_shared/leagues.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

// How many days ahead to look. The free API-Football plan only allows
// near-term dates (a handful of days out) even though the season+next
// combo it'd otherwise take to look further ahead is blocked entirely — see
// getFixturesByDate's comment. Bump this once you're on a paid plan.
const DAYS_AHEAD = 5;

const STATUS_MAP: Record<string, string> = {
  NS: 'scheduled',
  TBD: 'scheduled',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'cancelled',
};

const TRACKED_BY_ID = new Map(TRACKED_LEAGUES.map((l) => [l.id, l.name]));

async function upsertTeam(supabase: ReturnType<typeof getSupabaseAdmin>, team: { id: number; name: string; logo?: string }) {
  const { data, error } = await supabase
    .from('teams')
    .upsert({ api_football_id: team.id, name: team.name, logo_url: team.logo }, { onConflict: 'api_football_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

async function upsertFixture(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  af: AfFixture,
  leagueLabel: string,
  homeTeamRowId: number,
  awayTeamRowId: number
) {
  const { error } = await supabase.from('fixtures').upsert(
    {
      api_football_fixture_id: af.fixture.id,
      api_football_league_id: af.league.id,
      league: leagueLabel,
      season: af.league.season,
      kickoff_at: af.fixture.date,
      venue: af.fixture.venue?.name ?? null,
      status: STATUS_MAP[af.fixture.status.short] ?? 'scheduled',
      home_team_id: homeTeamRowId,
      away_team_id: awayTeamRowId,
      home_score_actual: af.goals.home,
      away_score_actual: af.goals.away,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'api_football_fixture_id' }
  );
  if (error) throw error;
}

function dateStringsAhead(days: number) {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const supabase = getSupabaseAdmin();
  const perLeagueCount: Record<string, number> = {};
  const dateErrors: Record<string, string> = {};

  for (const dateStr of dateStringsAhead(DAYS_AHEAD)) {
    try {
      const fixturesToday = await getFixturesByDate(dateStr);
      const tracked = fixturesToday.filter((af) => TRACKED_BY_ID.has(af.league.id));
      for (const af of tracked) {
        const leagueName = TRACKED_BY_ID.get(af.league.id)!;
        const homeId = await upsertTeam(supabase, af.teams.home);
        const awayId = await upsertTeam(supabase, af.teams.away);
        await upsertFixture(supabase, af, leagueName, homeId, awayId);
        perLeagueCount[leagueName] = (perLeagueCount[leagueName] ?? 0) + 1;
      }
    } catch (e) {
      dateErrors[dateStr] = e instanceof Error ? e.message : String(e);
    }
  }

  for (const league of TRACKED_LEAGUES) {
    if (!(league.name in perLeagueCount)) perLeagueCount[league.name] = 0;
  }

  return new Response(JSON.stringify({ ok: true, synced: perLeagueCount, dateErrors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
