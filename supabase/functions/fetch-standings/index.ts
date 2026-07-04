// On-demand league table, same pattern as quick-match-info: only fetched
// when a viewer opens a match in that league, cached in `league_standings`
// with a TTL so repeated views don't re-hit the API. Keyed by
// api_football_league_id, not fixture_id — every match in the same league
// shares one cached table.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getStandings } from '../_shared/apiFootball.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  let leagueId: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.api_football_league_id === 'number') leagueId = body.api_football_league_id;
  } catch {
    // fall through to the validation error below
  }
  if (leagueId == null) {
    return new Response(JSON.stringify({ ok: false, error: 'api_football_league_id (number) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabaseAdmin();

  const { data: freshest } = await supabase
    .from('league_standings')
    .select('fetched_at')
    .eq('api_football_league_id', leagueId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fetchedAt = freshest?.fetched_at ? new Date(freshest.fetched_at).getTime() : 0;
  if (Date.now() - fetchedAt < CACHE_TTL_MS) {
    return new Response(JSON.stringify({ ok: true, cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { season, rows: standings } = await getStandings(leagueId).catch(() => ({ season: new Date().getFullYear(), rows: [] }));
  if (standings.length === 0) {
    return new Response(JSON.stringify({ ok: true, rows: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Leagues with a split-round system (e.g. K League 1's Championship/
  // Relegation groups) return standings as multiple group arrays that each
  // list every team again post-split - already flattened by getStandings,
  // so dedupe here or the upsert fails ("cannot affect row a second time").
  // Later entries win: split-round groups come after the pre-split table in
  // API-Football's ordering, and the split standing is the current one.
  const byTeam = new Map<number, (typeof standings)[number]>();
  for (const s of standings) byTeam.set(s.team.id, s);

  const rows = [...byTeam.values()].map((s) => ({
    api_football_league_id: leagueId,
    season,
    team_api_id: s.team.id,
    team_name: s.team.name,
    team_logo_url: s.team.logo ?? null,
    rank: s.rank,
    played: s.all.played,
    win: s.all.win,
    draw: s.all.draw,
    lose: s.all.lose,
    goals_for: s.all.goals.for,
    goals_against: s.all.goals.against,
    points: s.points,
    form: s.form ?? null,
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('league_standings').upsert(rows, { onConflict: 'api_football_league_id,season,team_api_id' });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, rows: rows.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
