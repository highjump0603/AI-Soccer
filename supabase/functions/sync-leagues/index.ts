// Discovers upcoming fixtures for the tracked leagues and upserts the
// teams/fixtures rows the rest of the pipeline builds on. Run on a cron
// (see migrations/0002_cron.sql) — this function only ever adds/refreshes
// rows, it doesn't compute predictions (that's predict-due).
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getUpcomingFixtures, type AfFixture } from '../_shared/apiFootball.ts';
import { TRACKED_LEAGUES, seasonForLeague } from '../_shared/leagues.ts';

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

Deno.serve(async () => {
  const supabase = getSupabaseAdmin();
  const results: Record<string, number | string> = {};

  for (const league of TRACKED_LEAGUES) {
    try {
      const season = seasonForLeague(league);
      const fixtures = await getUpcomingFixtures(league.id, season, 20);
      for (const af of fixtures) {
        const homeId = await upsertTeam(supabase, af.teams.home);
        const awayId = await upsertTeam(supabase, af.teams.away);
        await upsertFixture(supabase, af, league.name, homeId, awayId);
      }
      results[league.name] = fixtures.length;
    } catch (e) {
      results[league.name] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, synced: results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
