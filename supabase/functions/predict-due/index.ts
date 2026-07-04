// The core pipeline: for each fixture that needs a (re)prediction, pull
// team form + head-to-head + lineups from API-Football, run the Poisson
// statistical model, get GPT's independent read, ensemble the two, and
// upsert the result into `predictions`.
//
// Two ways to invoke:
//   - POST {} (or via cron)         -> processes whatever's "due" (bounded
//                                       by MAX_PER_RUN so a big backlog
//                                       can't blow through the API-Football
//                                       rate limit in one shot)
//   - POST { "fixture_id": 123 }    -> forces an immediate recompute of
//                                       just that one fixture (the admin
//                                       page's "지금 예측 갱신" button)
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getTeamRecentResults, getHeadToHead, getLineups, getAverageMatchWinnerOdds, type AfLineup } from '../_shared/apiFootball.ts';
import { runPoissonModel } from '../_shared/poisson.ts';
import { getGptPrediction } from '../_shared/openai.ts';
import { ensemblePredictions } from '../_shared/ensemble.ts';
import { cacheTeamRecentResults, ensureFixtureRow, upsertPlayerAndLineup } from '../_shared/cache.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import {
  mapRecentResults,
  alignH2hForModel,
  h2hResultLetters,
  formSummaryText,
  lineupSummaryText,
  computePlayerMeetingNotes,
  computeLineupOverlapRatio,
} from '../_shared/matchMapping.ts';

const MAX_PER_RUN = 8;
const FULL_RECOMPUTE_AFTER_MS = 6 * 60 * 60 * 1000;
const LINEUP_WATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

type Supabase = ReturnType<typeof getSupabaseAdmin>;
type FixtureRow = {
  id: number;
  api_football_fixture_id: number;
  league: string;
  kickoff_at: string;
  home_team: { id: number; api_football_id: number; name: string };
  away_team: { id: number; api_football_id: number; name: string };
};

async function findDueFixtures(supabase: Supabase, forcedFixtureId?: number): Promise<FixtureRow[]> {
  if (forcedFixtureId != null) {
    const { data, error } = await supabase
      .from('fixtures')
      .select('id, api_football_fixture_id, league, kickoff_at, home_team:home_team_id(id, api_football_id, name), away_team:away_team_id(id, api_football_id, name)')
      .eq('id', forcedFixtureId)
      .single();
    if (error) throw error;
    return [data as unknown as FixtureRow];
  }

  const now = Date.now();
  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select('id, api_football_fixture_id, league, kickoff_at, home_team:home_team_id(id, api_football_id, name), away_team:away_team_id(id, api_football_id, name)')
    .neq('status', 'finished')
    .gte('kickoff_at', new Date(now).toISOString())
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
      const nearKickoffRecheck = msToKickoff > 0 && msToKickoff < LINEUP_WATCH_WINDOW_MS;
      return { fixture: f, lastGenerated: lastGenerated ?? '1970-01-01', due: needsFull || nearKickoffRecheck };
    })
    .filter((x) => x.due)
    .sort((a, b) => new Date(a.lastGenerated).getTime() - new Date(b.lastGenerated).getTime());

  return due.slice(0, MAX_PER_RUN).map((x) => x.fixture);
}

async function predictOneFixture(supabase: Supabase, fixture: FixtureRow) {
  const homeApiId = fixture.home_team.api_football_id;
  const awayApiId = fixture.away_team.api_football_id;

  const [homeRecentAf, awayRecentAf] = await Promise.all([getTeamRecentResults(homeApiId, 10), getTeamRecentResults(awayApiId, 10)]);

  await Promise.all([
    cacheTeamRecentResults(supabase, fixture.home_team.id, homeApiId, homeRecentAf).catch(() => {}),
    cacheTeamRecentResults(supabase, fixture.away_team.id, awayApiId, awayRecentAf).catch(() => {}),
  ]);

  const homeRecent = mapRecentResults(homeRecentAf, homeApiId);
  const awayRecent = mapRecentResults(awayRecentAf, awayApiId);

  const h2hAf = await getHeadToHead(homeApiId, awayApiId, 5).catch(() => []);
  const h2hForModel = alignH2hForModel(h2hAf, homeApiId);
  const h2hLetters = h2hResultLetters(h2hAf, homeApiId);

  const lineupsAf = await getLineups(fixture.api_football_fixture_id).catch(() => [] as AfLineup[]);
  if (lineupsAf.length > 0) {
    for (const l of lineupsAf) {
      const teamRowId = l.team.id === homeApiId ? fixture.home_team.id : fixture.away_team.id;
      await upsertPlayerAndLineup(supabase, fixture.id, teamRowId, l, 'confirmed').catch(() => {});
    }
    const homeFormation = lineupsAf.find((l) => l.team.id === homeApiId)?.formation ?? null;
    const awayFormation = lineupsAf.find((l) => l.team.id === awayApiId)?.formation ?? null;
    await supabase
      .from('fixtures')
      .update({ home_formation: homeFormation, away_formation: awayFormation })
      .eq('id', fixture.id);
  }

  let lineupOverlapRatio: number | null = null;
  let playerNotes: ReturnType<typeof computePlayerMeetingNotes> = [];
  if (lineupsAf.length > 0 && h2hAf.length > 0) {
    const sortedH2h = [...h2hAf].sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());
    const lastH2h = sortedH2h[0];
    try {
      const lastH2hLineups = await getLineups(lastH2h.fixture.id);
      if (lastH2hLineups.length > 0) {
        const pastFixtureRowId = await ensureFixtureRow(supabase, lastH2h, fixture.league);
        for (const l of lastH2hLineups) {
          const teamRowId = l.team.id === homeApiId ? fixture.home_team.id : fixture.away_team.id;
          await upsertPlayerAndLineup(supabase, pastFixtureRowId, teamRowId, l, 'confirmed').catch(() => {});
        }
        lineupOverlapRatio = computeLineupOverlapRatio(lineupsAf, lastH2hLineups);
        playerNotes = computePlayerMeetingNotes(lineupsAf, lastH2hLineups, lastH2h.fixture.date, h2hLetters[0] ?? 'D');
      }
    } catch {
      // Lineup data for older fixtures isn't always available — that's fine,
      // player-meeting notes just stay empty for this run.
    }
  }

  const h2hWeight = lineupOverlapRatio != null ? 0.05 + 0.1 * lineupOverlapRatio : 0.1;
  const stat = runPoissonModel({ homeRecent, awayRecent, h2h: h2hForModel, h2hWeight });

  const homeLineup = lineupsAf.find((l) => l.team.id === homeApiId);
  const awayLineup = lineupsAf.find((l) => l.team.id === awayApiId);

  let gpt;
  try {
    gpt = await getGptPrediction({
      league: fixture.league,
      homeTeam: fixture.home_team.name,
      awayTeam: fixture.away_team.name,
      kickoffAt: fixture.kickoff_at,
      homeFormSummary: formSummaryText(homeRecent, fixture.home_team.name),
      awayFormSummary: formSummaryText(awayRecent, fixture.away_team.name),
      h2hSummary: h2hLetters.length ? `최근 ${h2hLetters.length}회 맞대결 (홈팀 기준, 최신순): ${h2hLetters.join(', ')}` : '최근 맞대결 기록 없음',
      homeLineupSummary: lineupSummaryText(homeLineup, fixture.home_team.name),
      awayLineupSummary: lineupSummaryText(awayLineup, fixture.away_team.name),
    });
  } catch (e) {
    // If GPT is unavailable for any reason, fall back to the stat model
    // alone rather than failing the whole prediction — confidence caps at
    // 'medium' in ensemblePredictions when both sides trivially "agree".
    gpt = {
      probHome: stat.probHome,
      probDraw: stat.probDraw,
      probAway: stat.probAway,
      scoreHome: stat.scoreHome,
      scoreAway: stat.scoreAway,
      factors: [`GPT 예측 실패로 통계 모델 결과만 사용됨 (${e instanceof Error ? e.message : String(e)})`],
      summary: '',
    };
  }

  const ensemble = ensemblePredictions({
    statXgHome: stat.xgHome,
    statXgAway: stat.xgAway,
    statProbs: { home: stat.probHome, draw: stat.probDraw, away: stat.probAway },
    gptXgHome: gpt.scoreHome,
    gptXgAway: gpt.scoreAway,
    gptProbs: { home: gpt.probHome, draw: gpt.probDraw, away: gpt.probAway },
  });

  const bookOdds = await getAverageMatchWinnerOdds(fixture.api_football_fixture_id).catch(() => null);
  const toDecimalOdds = (probPct: number) => (probPct > 0 ? Math.round((100 / probPct) * 100) / 100 : null);

  const { error } = await supabase.from('predictions').upsert(
    {
      fixture_id: fixture.id,
      generated_at: new Date().toISOString(),
      stat_prob_home: stat.probHome,
      stat_prob_draw: stat.probDraw,
      stat_prob_away: stat.probAway,
      stat_score_home: stat.scoreHome,
      stat_score_away: stat.scoreAway,
      stat_xg_home: stat.xgHome,
      stat_xg_away: stat.xgAway,
      gpt_prob_home: gpt.probHome,
      gpt_prob_draw: gpt.probDraw,
      gpt_prob_away: gpt.probAway,
      gpt_score_home: gpt.scoreHome,
      gpt_score_away: gpt.scoreAway,
      gpt_summary: gpt.summary,
      final_prob_home: ensemble.finalProbs.home,
      final_prob_draw: ensemble.finalProbs.draw,
      final_prob_away: ensemble.finalProbs.away,
      final_score_home: ensemble.finalScore.home,
      final_score_away: ensemble.finalScore.away,
      confidence: ensemble.confidence,
      factors: gpt.factors,
      h2h: h2hLetters,
      player_notes: playerNotes,
      odds_book_home: bookOdds?.home ?? null,
      odds_book_draw: bookOdds?.draw ?? null,
      odds_book_away: bookOdds?.away ?? null,
      odds_ai_home: toDecimalOdds(ensemble.finalProbs.home),
      odds_ai_draw: toDecimalOdds(ensemble.finalProbs.draw),
      odds_ai_away: toDecimalOdds(ensemble.finalProbs.away),
      raw_inputs: { homeRecent, awayRecent, h2hForModel, lineupOverlapRatio, gptRaw: gpt },
    },
    { onConflict: 'fixture_id' }
  );
  if (error) throw error;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

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
