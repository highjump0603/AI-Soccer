// The core pipeline: for each fixture that needs a (re)prediction, pull
// team form + head-to-head + lineups + match stats + standings from
// FotMob (see _shared/predictionInputs.ts, shared with the backtest
// function so both exercise the same data-gathering logic) and hand all
// of it to GPT, which produces the final score and probabilities directly
// — there's no separate statistical model blended in afterward; GPT's
// read *is* the prediction. Bookmaker odds come from a separate,
// best-effort FotMob 1xBet odds call, wrapped in its own try/catch so its
// absence never breaks a prediction.
//
// Two ways to invoke:
//   - POST {} (or via cron)         -> processes whatever's "due" (bounded
//                                       by MAX_PER_RUN so a big backlog
//                                       can't hammer FotMob in one shot)
//   - POST { "fixture_id": 123 }    -> forces an immediate recompute of
//                                       just that one fixture (the admin
//                                       page's "지금 예측 갱신" button)
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getMatchStats, getMatchDetails, getMatchOdds1xBet } from '../_shared/fotmob.ts';
import { getGptPrediction } from '../_shared/openai.ts';
import { cacheTeamRecentResultsFm, upsertPlayerAndLineupFm } from '../_shared/cache.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { h2hDetailRowsFm } from '../_shared/matchMapping.ts';
import { gatherPredictionInputs } from '../_shared/predictionInputs.ts';

type PlayerNote = { player: string; team: string; meetings: { date: string; result: string }[] };

const MAX_PER_RUN = 8;
const FULL_RECOMPUTE_AFTER_MS = 6 * 60 * 60 * 1000;
const LINEUP_WATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
// After kickoff, keep rechecking for a while so match_stats (which only
// exist once the game has actually started/finished) gets filled in soon
// after the final whistle rather than waiting for the next full recompute.
const POST_KICKOFF_STATS_WINDOW_MS = 4 * 60 * 60 * 1000;

type Supabase = ReturnType<typeof getSupabaseAdmin>;
type FixtureRow = {
  id: number;
  fotmob_id: number;
  fotmob_league_id: number | null;
  league: string;
  kickoff_at: string;
  home_formation: string | null;
  away_formation: string | null;
  home_team: { id: number; fotmob_id: number; name: string };
  away_team: { id: number; fotmob_id: number; name: string };
};

const FIXTURE_SELECT =
  'id, fotmob_id, fotmob_league_id, league, kickoff_at, home_formation, away_formation, home_team:home_team_id(id, fotmob_id, name), away_team:away_team_id(id, fotmob_id, name)';

async function findDueFixtures(supabase: Supabase, forcedFixtureId?: number): Promise<FixtureRow[]> {
  if (forcedFixtureId != null) {
    const { data, error } = await supabase.from('fixtures').select(FIXTURE_SELECT).eq('id', forcedFixtureId).single();
    if (error) throw error;
    return [data as unknown as FixtureRow];
  }

  const now = Date.now();
  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select(FIXTURE_SELECT)
    .neq('status', 'finished')
    .gte('kickoff_at', new Date(now - POST_KICKOFF_STATS_WINDOW_MS).toISOString())
    .lte('kickoff_at', new Date(now + 15 * 86400000).toISOString());
  if (error) throw error;
  if (!fixtures || fixtures.length === 0) return [];

  const ids = fixtures.map((f) => f.id);
  const { data: preds, error: predErr } = await supabase.from('predictions').select('fixture_id, generated_at').in('fixture_id', ids);
  if (predErr) throw predErr;
  const predMap = new Map((preds ?? []).map((p) => [p.fixture_id, p.generated_at as string]));

  const due = (fixtures as unknown as FixtureRow[])
    .map((f) => {
      const lastGenerated = predMap.get(f.id);
      const msToKickoff = new Date(f.kickoff_at).getTime() - now;
      const needsFull = !lastGenerated || now - new Date(lastGenerated).getTime() > FULL_RECOMPUTE_AFTER_MS;
      const nearKickoffRecheck = Math.abs(msToKickoff) < LINEUP_WATCH_WINDOW_MS;
      return { fixture: f, lastGenerated: lastGenerated ?? '1970-01-01', due: needsFull || nearKickoffRecheck };
    })
    .filter((x) => x.due)
    .sort((a, b) => new Date(a.lastGenerated).getTime() - new Date(b.lastGenerated).getTime());

  return due.slice(0, MAX_PER_RUN).map((x) => x.fixture);
}

async function predictOneFixture(supabase: Supabase, fixture: FixtureRow) {
  const homeId = fixture.home_team.fotmob_id;
  const awayId = fixture.away_team.fotmob_id;

  const inputs = await gatherPredictionInputs(supabase, {
    homeFotmobId: homeId,
    awayFotmobId: awayId,
    homeTeamName: fixture.home_team.name,
    awayTeamName: fixture.away_team.name,
    fotmobMatchId: fixture.fotmob_id,
    fotmobLeagueId: fixture.fotmob_league_id,
    kickoffAt: fixture.kickoff_at,
    league: fixture.league,
    homeFormationFallback: fixture.home_formation,
    awayFormationFallback: fixture.away_formation,
    // Live prediction: exclude nothing before "now" — the target match
    // hasn't happened yet, so this is a no-op beyond the usual "finished"
    // filtering, but keeps this call site identical to backtest's.
    excludeAtOrAfter: new Date().toISOString(),
  });

  await Promise.all([
    cacheTeamRecentResultsFm(supabase, fixture.home_team.id, homeId, inputs.homeRecentMatches).catch(() => {}),
    cacheTeamRecentResultsFm(supabase, fixture.away_team.id, awayId, inputs.awayRecentMatches).catch(() => {}),
  ]);

  await supabase.from('fixtures').update({ quick_h2h_detail: h2hDetailRowsFm(inputs.h2h) }).eq('id', fixture.id);

  const details = await getMatchDetails(fixture.fotmob_id);

  if (inputs.lineups) {
    // Official lineup just landed - clear out our own guess so the UI shows
    // the real thing instead of a stale estimate sitting alongside it.
    await supabase.from('lineups').delete().eq('fixture_id', fixture.id).eq('source', 'estimated');
    await upsertPlayerAndLineupFm(supabase, fixture.id, fixture.home_team.id, inputs.lineups.home, 'confirmed').catch(() => {});
    await upsertPlayerAndLineupFm(supabase, fixture.id, fixture.away_team.id, inputs.lineups.away, 'confirmed').catch(() => {});
    await supabase
      .from('fixtures')
      .update({ home_formation: inputs.lineups.home.formation ?? null, away_formation: inputs.lineups.away.formation ?? null })
      .eq('id', fixture.id);
  }

  // Match stats (xG, shots, possession, cards, ...) only exist once the
  // game has started — no-op before kickoff, filled in naturally by a
  // later run thanks to POST_KICKOFF_STATS_WINDOW_MS keeping this fixture
  // "due" for a while after its scheduled kickoff.
  const stats = getMatchStats(details);
  if (stats.length > 0) {
    // Dedupe by stat_key: FotMob's stat sections aren't guaranteed disjoint
    // — a batch upsert with a repeated conflict target in one statement
    // fails outright, so keep only the first occurrence of each key.
    const byKey = new Map(stats.map((s) => [s.key, s]));
    const rows = [...byKey.values()].map((s) => ({
      fixture_id: fixture.id,
      stat_key: s.key,
      stat_title: s.title,
      home_value: s.home,
      away_value: s.away,
      stat_type: s.type ?? null,
      fetched_at: new Date().toISOString(),
    }));
    const { error: statsError } = await supabase.from('match_stats').upsert(rows, { onConflict: 'fixture_id,stat_key' });
    if (statsError) throw new Error(`match_stats upsert failed: ${statsError.message}`);
  }

  // Player-meeting cross-reference needs the most recent H2H meeting's own
  // lineup, which needs that match's own FotMob matchId — FotMob's h2h
  // payload doesn't expose one, so this is dropped rather than guessed at.
  const playerNotes: PlayerNote[] = [];

  let gpt;
  try {
    gpt = await getGptPrediction(inputs.gptInput);
  } catch (e) {
    // If GPT is unavailable there's no fallback model anymore — surface the
    // failure so the caller sees it rather than silently upserting a bogus
    // 0-0/33-33-33 row.
    throw new Error(`GPT prediction failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Confidence is literally GPT's own top probability — there's no second
  // model left to check agreement against, so this *is* "how sure the AI
  // itself is", not a separately-computed heuristic.
  const topProb = Math.max(gpt.probHome, gpt.probDraw, gpt.probAway);

  let bookOdds: { home: number; draw: number; away: number } | null = null;
  try {
    bookOdds = await getMatchOdds1xBet(fixture.fotmob_id);
  } catch {
    // 1xBet odds are best-effort and isolated — a failure here must never
    // fail the rest of the prediction.
  }
  const toDecimalOdds = (probPct: number) => (probPct > 0 ? Math.round((100 / probPct) * 100) / 100 : null);

  // Surface the tactical inputs (formation, missing players) as explicit
  // factors alongside GPT's own, so the reasoning is visible for every
  // prediction rather than buried in the prompt only.
  const tacticalFactors: string[] = [];
  if (inputs.homeFormationUsed) tacticalFactors.push(`${fixture.home_team.name} 포메이션 ${inputs.homeFormationUsed}`);
  if (inputs.awayFormationUsed) tacticalFactors.push(`${fixture.away_team.name} 포메이션 ${inputs.awayFormationUsed}`);
  if (inputs.lineups) {
    tacticalFactors.push(
      inputs.homeUnavailable.length > 0
        ? `${fixture.home_team.name} 결장: ${inputs.homeUnavailable.map((p) => p.name).join(', ')}`
        : `${fixture.home_team.name} 결장 선수 없음`
    );
    tacticalFactors.push(
      inputs.awayUnavailable.length > 0
        ? `${fixture.away_team.name} 결장: ${inputs.awayUnavailable.map((p) => p.name).join(', ')}`
        : `${fixture.away_team.name} 결장 선수 없음`
    );
  }

  const { error } = await supabase.from('predictions').upsert(
    {
      fixture_id: fixture.id,
      generated_at: new Date().toISOString(),
      stat_prob_home: null,
      stat_prob_draw: null,
      stat_prob_away: null,
      stat_score_home: null,
      stat_score_away: null,
      stat_xg_home: inputs.homeXgRef,
      stat_xg_away: inputs.awayXgRef,
      gpt_prob_home: gpt.probHome,
      gpt_prob_draw: gpt.probDraw,
      gpt_prob_away: gpt.probAway,
      gpt_score_home: gpt.scoreHome,
      gpt_score_away: gpt.scoreAway,
      gpt_summary: gpt.summary,
      final_prob_home: gpt.probHome,
      final_prob_draw: gpt.probDraw,
      final_prob_away: gpt.probAway,
      final_score_home: gpt.scoreHome,
      final_score_away: gpt.scoreAway,
      confidence: topProb >= 50 ? 'high' : topProb >= 40 ? 'medium' : 'low',
      confidence_pct: topProb,
      factors: [...tacticalFactors, ...gpt.factors],
      h2h: inputs.h2hLetters,
      player_notes: playerNotes,
      odds_book_home: bookOdds?.home ?? null,
      odds_book_draw: bookOdds?.draw ?? null,
      odds_book_away: bookOdds?.away ?? null,
      odds_ai_home: toDecimalOdds(gpt.probHome),
      odds_ai_draw: toDecimalOdds(gpt.probDraw),
      odds_ai_away: toDecimalOdds(gpt.probAway),
      raw_inputs: {
        homeRecent: inputs.homeRecent,
        awayRecent: inputs.awayRecent,
        homeXgRef: inputs.homeXgRef,
        awayXgRef: inputs.awayXgRef,
        gptRaw: gpt,
      },
    },
    { onConflict: 'fixture_id' }
  );
  if (error) throw error;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  let forcedFixtureId: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.fixture_id === 'number') forcedFixtureId = body.fixture_id;
  } catch {
    // No/empty body is the normal cron-triggered case.
  }

  const due = await findDueFixtures(supabase, forcedFixtureId);
  const results: Record<string, string> = {};

  for (const fixture of due) {
    const label = `${fixture.home_team.name} vs ${fixture.away_team.name}`;
    try {
      await predictOneFixture(supabase, fixture);
      results[label] = 'ok';
    } catch (e) {
      results[label] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: due.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
