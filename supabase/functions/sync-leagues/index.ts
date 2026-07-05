// Discovers upcoming fixtures for the tracked leagues and upserts the
// teams/fixtures rows the rest of the pipeline builds on. Run on a cron
// (see migrations/0002_cron.sql) — this function only ever adds/refreshes
// rows, it doesn't compute predictions (that's predict-due).
//
// FotMob's /matches?date= endpoint has no confirmed date-range restriction
// the way API-Football's free plan did, but DAYS_AHEAD is kept modest
// (this endpoint is unofficial — sustained/aggressive polling behavior is
// untested) rather than assuming unlimited headroom.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getFixturesByDate, type FmMatch } from '../_shared/fotmob.ts';
import { TRACKED_LEAGUES } from '../_shared/leagues.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const DAYS_AHEAD = 5;

const TRACKED_BY_ID = new Map(TRACKED_LEAGUES.map((l) => [l.id, l.name]));

// FotMob's team logo CDN URL is deterministic from the team id (confirmed
// live, no extra API call needed) — https://images.fotmob.com/image_resources/logo/teamlogo/<id>.png
function fotmobLogoUrl(teamId: number) {
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${teamId}.png`;
}

async function upsertTeam(supabase: ReturnType<typeof getSupabaseAdmin>, team: { id: number; name: string }) {
  const { data, error } = await supabase
    .from('teams')
    .upsert({ fotmob_id: team.id, name: team.name, logo_url: fotmobLogoUrl(team.id) }, { onConflict: 'fotmob_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

function fixtureStatus(m: FmMatch): string {
  if (m.status?.cancelled) return 'cancelled';
  if (m.status?.finished) return 'finished';
  return 'scheduled';
}

async function upsertFixture(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  m: FmMatch,
  leagueLabel: string,
  homeTeamRowId: number,
  awayTeamRowId: number
) {
  const kickoffAt = m.status?.utcTime;
  if (!kickoffAt) return; // no reliable kickoff time — skip rather than write a bad row
  const { error } = await supabase.from('fixtures').upsert(
    {
      fotmob_id: m.id,
      fotmob_league_id: m.primaryLeagueId,
      league: leagueLabel,
      season: new Date(kickoffAt).getUTCFullYear(),
      kickoff_at: kickoffAt,
      status: fixtureStatus(m),
      home_team_id: homeTeamRowId,
      away_team_id: awayTeamRowId,
      home_score_actual: m.home.score ?? null,
      away_score_actual: m.away.score ?? null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'fotmob_id' }
  );
  if (error) throw error;
}

function dateStringsAhead(days: number) {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    // FotMob's date param is YYYYMMDD, not ISO YYYY-MM-DD.
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
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
      // Match on primaryLeagueId (the stable id), not leagueId (a rotating
      // per-season/edition id — see FmMatch's doc comment in fotmob.ts).
      const tracked = fixturesToday.filter((m) => TRACKED_BY_ID.has(m.primaryLeagueId));
      for (const m of tracked) {
        const leagueName = TRACKED_BY_ID.get(m.primaryLeagueId)!;
        const homeId = await upsertTeam(supabase, m.home);
        const awayId = await upsertTeam(supabase, m.away);
        await upsertFixture(supabase, m, leagueName, homeId, awayId);
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
