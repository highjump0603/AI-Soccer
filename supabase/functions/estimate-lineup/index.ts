// Builds a best-guess starting XI + formation for a fixture before
// FotMob's own official lineup is out — from each team's last few actual
// lineups plus current injury/suspension info (taken from whichever of
// those recent lineups carries an `unavailable` list). Called from the
// client when a viewer opens a match detail page that has no official
// lineup yet, same on-demand-with-caching pattern as quick-match-info.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getTeamLastLineups, getUnavailablePlayerIds } from '../_shared/fotmob.ts';
import { estimateLineupFm } from '../_shared/matchMapping.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type FixtureRow = {
  id: number;
  status: string;
  estimated_lineup_fetched_at: string | null;
  home_team: { id: number; fotmob_id: number };
  away_team: { id: number; fotmob_id: number };
};

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  let fixtureId: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.fixture_id === 'number') fixtureId = body.fixture_id;
  } catch {
    // fall through to the validation error below
  }
  if (fixtureId == null) {
    return new Response(JSON.stringify({ ok: false, error: 'fixture_id (number) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('fixtures')
    .select('id, status, estimated_lineup_fetched_at, home_team:home_team_id(id, fotmob_id), away_team:away_team_id(id, fotmob_id)')
    .eq('id', fixtureId)
    .single();
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const fixture = data as unknown as FixtureRow;

  if (fixture.status === 'finished') {
    return new Response(JSON.stringify({ ok: true, skipped: 'finished' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fetchedAt = fixture.estimated_lineup_fetched_at ? new Date(fixture.estimated_lineup_fetched_at).getTime() : 0;
  if (Date.now() - fetchedAt < CACHE_TTL_MS) {
    return new Response(JSON.stringify({ ok: true, cached: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Official data (once the club announces it) always wins - don't lay an
  // estimate over/under it.
  const { count: officialCount } = await supabase
    .from('lineups')
    .select('id', { count: 'exact', head: true })
    .eq('fixture_id', fixtureId)
    .in('source', ['confirmed', 'predicted']);
  if ((officialCount ?? 0) > 0) {
    return new Response(JSON.stringify({ ok: true, skipped: 'official lineup already present' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sides = [
    { side: 'home' as const, teamRowId: fixture.home_team.id, teamFotmobId: fixture.home_team.fotmob_id },
    { side: 'away' as const, teamRowId: fixture.away_team.id, teamFotmobId: fixture.away_team.fotmob_id },
  ];

  const formations: { home: string | null; away: string | null } = { home: null, away: null };

  for (const { side, teamRowId, teamFotmobId } of sides) {
    const recentLineups = await getTeamLastLineups(teamFotmobId, 3).catch(() => []);
    const unavailable = getUnavailablePlayerIds(recentLineups);
    const estimate = estimateLineupFm(recentLineups, unavailable);
    if (!estimate) continue;
    formations[side] = estimate.formation;

    // Clear any stale estimate from a previous run before writing the new one.
    await supabase.from('lineups').delete().eq('fixture_id', fixtureId).eq('team_id', teamRowId).eq('source', 'estimated');

    let gridRow = 0;
    for (const row of estimate.rows) {
      gridRow += 1;
      let gridCol = 0;
      for (const p of row) {
        gridCol += 1;
        const { data: playerRow, error: playerErr } = await supabase
          .from('players')
          .upsert({ fotmob_id: p.id, name: p.name, team_id: teamRowId, position: p.group }, { onConflict: 'fotmob_id' })
          .select('id')
          .single();
        if (playerErr) continue;

        await supabase.from('lineups').upsert(
          {
            fixture_id: fixtureId,
            team_id: teamRowId,
            player_id: playerRow.id,
            is_starting: true,
            source: 'estimated',
            shirt_number: p.number ?? null,
            grid_row: gridRow,
            grid_col: gridCol,
            captured_at: new Date().toISOString(),
          },
          { onConflict: 'fixture_id,team_id,player_id' }
        );
      }
    }
  }

  await supabase
    .from('fixtures')
    .update({
      home_formation: formations.home,
      away_formation: formations.away,
      estimated_lineup_fetched_at: new Date().toISOString(),
    })
    .eq('id', fixtureId);

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
