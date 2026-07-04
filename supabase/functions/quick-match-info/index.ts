// Lightweight, on-demand companion to predict-due: fetches just h2h +
// bookmaker odds for a single fixture so the match detail page has
// something to show (venue/h2h/odds) while the full AI prediction is
// still queued. Called from the client when a viewer opens a match that
// has no prediction yet — NOT on a cron, so it only spends API-Football
// quota on fixtures someone actually looked at.
//
// Cached on the fixtures row (quick_info_fetched_at) so repeated views
// within CACHE_TTL_MS don't re-hit the API.
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getHeadToHead, getAverageMatchWinnerOdds } from '../_shared/apiFootball.ts';
import { h2hResultLetters } from '../_shared/matchMapping.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type FixtureRow = {
  id: number;
  api_football_fixture_id: number;
  home_team: { api_football_id: number };
  away_team: { api_football_id: number };
  quick_h2h: string[];
  quick_odds_home: number | null;
  quick_odds_draw: number | null;
  quick_odds_away: number | null;
  quick_info_fetched_at: string | null;
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
    .select(
      'id, api_football_fixture_id, home_team:home_team_id(api_football_id), away_team:away_team_id(api_football_id), quick_h2h, quick_odds_home, quick_odds_draw, quick_odds_away, quick_info_fetched_at'
    )
    .eq('id', fixtureId)
    .single();
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fixture = data as unknown as FixtureRow;
  const fetchedAt = fixture.quick_info_fetched_at ? new Date(fixture.quick_info_fetched_at).getTime() : 0;
  const isFresh = Date.now() - fetchedAt < CACHE_TTL_MS;

  if (isFresh) {
    return new Response(
      JSON.stringify({
        ok: true,
        h2h: fixture.quick_h2h ?? [],
        odds: { home: fixture.quick_odds_home, draw: fixture.quick_odds_draw, away: fixture.quick_odds_away },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const homeApiId = fixture.home_team.api_football_id;
  const awayApiId = fixture.away_team.api_football_id;

  const [h2hAf, odds] = await Promise.all([
    getHeadToHead(homeApiId, awayApiId, 5).catch(() => []),
    getAverageMatchWinnerOdds(fixture.api_football_fixture_id).catch(() => null),
  ]);
  const h2hLetters = h2hResultLetters(h2hAf, homeApiId);

  const { error: updateError } = await supabase
    .from('fixtures')
    .update({
      quick_h2h: h2hLetters,
      quick_odds_home: odds?.home ?? null,
      quick_odds_draw: odds?.draw ?? null,
      quick_odds_away: odds?.away ?? null,
      quick_info_fetched_at: new Date().toISOString(),
    })
    .eq('id', fixtureId);
  if (updateError) {
    return new Response(JSON.stringify({ ok: false, error: updateError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, h2h: h2hLetters, odds: { home: odds?.home ?? null, draw: odds?.draw ?? null, away: odds?.away ?? null } }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
