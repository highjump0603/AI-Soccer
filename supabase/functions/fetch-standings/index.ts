// On-demand league table, same pattern as quick-match-info: only fetched
// when a viewer opens a match in that league, cached in `league_standings`
// with a TTL so repeated views don't re-hit the API. Keyed by
// fotmob_league_id, not fixture_id — every match in the same league shares
// one cached table.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getLeagueTable } from '../_shared/fotmob.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  let leagueId: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.fotmob_league_id === 'number') leagueId = body.fotmob_league_id;
  } catch {
    // fall through to the validation error below
  }
  if (leagueId == null) {
    return new Response(JSON.stringify({ ok: false, error: 'fotmob_league_id (number) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: freshest } = await supabase
    .from('league_standings')
    .select('fetched_at')
    .eq('fotmob_league_id', leagueId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fetchedAt = freshest?.fetched_at ? new Date(freshest.fetched_at).getTime() : 0;
  if (Date.now() - fetchedAt < CACHE_TTL_MS) {
    return new Response(JSON.stringify({ ok: true, cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const table = await getLeagueTable(leagueId).catch(() => ({ leagueName: '', season: null, groups: [] }));
  const seasonYear = table.season ? Number(table.season.split('/')[0]) || new Date().getFullYear() : new Date().getFullYear();

  if (table.groups.length === 0) {
    return new Response(JSON.stringify({ ok: true, rows: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Split-round competitions (e.g. K League 1's Championship/Relegation
  // groups) return multiple table groups that each list every team again
  // post-split — dedupe by team, later groups win (post-split standing is
  // the current one, same reasoning as the old API-Football-based logic).
  const byTeam = new Map<number, (typeof table.groups)[number]['rows'][number]>();
  for (const group of table.groups) for (const row of group.rows) byTeam.set(row.id, row);

  const rows = [...byTeam.values()].map((row) => {
    const [goalsFor, goalsAgainst] = row.scoresStr.split('-').map((n) => Number(n) || 0);
    return {
      fotmob_league_id: leagueId,
      season: seasonYear,
      fotmob_team_id: row.id,
      team_name: row.name,
      team_logo_url: null,
      rank: row.idx,
      played: row.played,
      win: row.wins,
      draw: row.draws,
      lose: row.losses,
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      points: row.pts,
      form: null,
      fetched_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from('league_standings').upsert(rows, { onConflict: 'fotmob_league_id,season,fotmob_team_id' });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, rows: rows.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
