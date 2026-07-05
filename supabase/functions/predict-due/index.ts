// The core pipeline: for each fixture that needs a (re)prediction, pull
// team form + head-to-head + lineups + match stats from FotMob, run the
// Poisson statistical model, get GPT's independent read, ensemble the two,
// and upsert the result into `predictions`. Bookmaker odds come from a
// separate, best-effort FotMob 1xBet odds call (see _shared/fotmob.ts's
// getMatchOdds1xBet)
// wrapped in its own try/catch so its absence never breaks a prediction.
//
// Two ways to invoke:
//   - POST {} (or via cron)         -> processes whatever's "due" (bounded
//                                       by MAX_PER_RUN so a big backlog
//                                       can't hammer FotMob in one shot)
//   - POST { "fixture_id": 123 }    -> forces an immediate recompute of
//                                       just that one fixture (the admin
//                                       page's "지금 예측 갱신" button)
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import {
  getMatchDetails,
  getMatchStats,
  getLineups,
  getHeadToHead,
  getTeamFixtures,
  mostRecentFinished,
  getMatchOdds1xBet,
} from '../_shared/fotmob.ts';
import { runPoissonModel, computeTacticalStrength, formationAttackMultiplier, availabilityMultiplier } from '../_shared/poisson.ts';
import { getGptPrediction } from '../_shared/openai.ts';
import { ensemblePredictions } from '../_shared/ensemble.ts';
import { cacheTeamRecentResultsFm, upsertPlayerAndLineupFm } from '../_shared/cache.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import {
  mapRecentResultsFm,
  attachXgFm,
  alignH2hForModelFm,
  h2hResultLettersFm,
  h2hDetailRowsFm,
  formSummaryText,
  lineupSummaryTextFm,
} from '../_shared/matchMapping.ts';

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
  league: string;
  kickoff_at: string;
  home_formation: string | null;
  away_formation: string | null;
  home_team: { id: number; fotmob_id: number; name: string };
  away_team: { id: number; fotmob_id: number; name: string };
};

const FIXTURE_SELECT =
  'id, fotmob_id, league, kickoff_at, home_formation, away_formation, home_team:home_team_id(id, fotmob_id, name), away_team:away_team_id(id, fotmob_id, name)';

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

  const [homeAllMatches, awayAllMatches] = await Promise.all([getTeamFixtures(homeId), getTeamFixtures(awayId)]);
  const homeRecentMatches = mostRecentFinished(homeAllMatches, 10);
  const awayRecentMatches = mostRecentFinished(awayAllMatches, 10);

  await Promise.all([
    cacheTeamRecentResultsFm(supabase, fixture.home_team.id, homeId, homeRecentMatches).catch(() => {}),
    cacheTeamRecentResultsFm(supabase, fixture.away_team.id, awayId, awayRecentMatches).catch(() => {}),
  ]);

  // Best-effort xG enrichment: only fixtures we've personally tracked
  // before have cached match_stats, so this is sparse at first and fills in
  // over time as more of a team's matches pass through this same pipeline.
  const candidateFotmobIds = [...homeRecentMatches, ...awayRecentMatches].map((m) => m.id);
  const xgByFotmobMatchId = new Map<number, { home: number; away: number }>();
  if (candidateFotmobIds.length > 0) {
    const { data: cachedFixtures } = await supabase.from('fixtures').select('id, fotmob_id').in('fotmob_id', candidateFotmobIds);
    const fixtureIdToFotmobId = new Map((cachedFixtures ?? []).map((f) => [f.id, f.fotmob_id as number]));
    if (fixtureIdToFotmobId.size > 0) {
      const { data: statRows } = await supabase
        .from('match_stats')
        .select('fixture_id, home_value, away_value')
        .in('fixture_id', [...fixtureIdToFotmobId.keys()])
        .eq('stat_key', 'expected_goals');
      for (const row of statRows ?? []) {
        const fotmobId = fixtureIdToFotmobId.get(row.fixture_id);
        const home = Number(row.home_value);
        const away = Number(row.away_value);
        if (fotmobId && Number.isFinite(home) && Number.isFinite(away)) xgByFotmobMatchId.set(fotmobId, { home, away });
      }
    }
  }

  const homeRecent = attachXgFm(mapRecentResultsFm(homeRecentMatches, homeId), homeRecentMatches, homeId, xgByFotmobMatchId);
  const awayRecent = attachXgFm(mapRecentResultsFm(awayRecentMatches, awayId), awayRecentMatches, awayId, xgByFotmobMatchId);

  const details = await getMatchDetails(fixture.fotmob_id);

  const h2h = getHeadToHead(details);
  const h2hForModel = alignH2hForModelFm(h2h, fixture.home_team.name);
  const h2hLetters = h2hResultLettersFm(h2h, fixture.home_team.name);
  await supabase.from('fixtures').update({ quick_h2h_detail: h2hDetailRowsFm(h2h) }).eq('id', fixture.id);

  const lineups = getLineups(details);
  if (lineups) {
    // Official lineup just landed - clear out our own guess so the UI shows
    // the real thing instead of a stale estimate sitting alongside it.
    await supabase.from('lineups').delete().eq('fixture_id', fixture.id).eq('source', 'estimated');
    await upsertPlayerAndLineupFm(supabase, fixture.id, fixture.home_team.id, lineups.home, 'confirmed').catch(() => {});
    await upsertPlayerAndLineupFm(supabase, fixture.id, fixture.away_team.id, lineups.away, 'confirmed').catch(() => {});
    await supabase
      .from('fixtures')
      .update({ home_formation: lineups.home.formation ?? null, away_formation: lineups.away.formation ?? null })
      .eq('id', fixture.id);
  }

  // Match stats (xG, shots, possession, ...) only exist once the game has
  // started — no-op before kickoff, filled in naturally by a later run
  // thanks to POST_KICKOFF_STATS_WINDOW_MS keeping this fixture "due" for a
  // while after its scheduled kickoff.
  const stats = getMatchStats(details);
  if (stats.length > 0) {
    // Dedupe by stat_key: FotMob's stat sections aren't guaranteed disjoint
    // (e.g. the same key could appear under both a "Top stats" summary
    // section and its detailed category) — a batch upsert with a repeated
    // conflict target in one statement fails outright ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"), so keep only the
    // first occurrence of each key.
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

  // Player-meeting cross-reference (computePlayerMeetingNotesFm) needs the
  // most recent H2H meeting's own lineup, which needs that match's own
  // FotMob matchId — but FmH2hMatch (from content.h2h.matches) doesn't
  // expose one, only team/score/date. There's no confirmed cheap way to
  // resolve it, so this feature is dropped rather than guessed at (flagged
  // as an accepted capability loss in the migration plan doc).
  const lineupOverlapRatio: number | null = null;
  const playerNotes: PlayerNote[] = [];

  const h2hWeight = lineupOverlapRatio != null ? 0.05 + 0.1 * lineupOverlapRatio : 0.1;

  // Tactical nudge: formation shape (attacking vs defensive) + missing
  // (injured/suspended) starters, folded into a small xG multiplier per
  // side. Only computed once a lineup (official, from this call's
  // getMatchDetails) is out — before that we fall back to whatever
  // formation estimate-lineup last stored on the fixture row, with no
  // availability signal (that data only comes bundled with an official
  // lineup) — see computeTacticalStrength in _shared/poisson.ts.
  const homeTacticalStrength = computeTacticalStrength(
    lineups?.home.formation ?? fixture.home_formation,
    lineups?.home.unavailable?.length ?? 0
  );
  const awayTacticalStrength = computeTacticalStrength(
    lineups?.away.formation ?? fixture.away_formation,
    lineups?.away.unavailable?.length ?? 0
  );

  const stat = runPoissonModel({
    homeRecent,
    awayRecent,
    h2h: h2hForModel,
    h2hWeight,
    homeLineupStrength: homeTacticalStrength,
    awayLineupStrength: awayTacticalStrength,
  });

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
      homeLineupSummary: lineupSummaryTextFm(lineups?.home, fixture.home_team.name),
      awayLineupSummary: lineupSummaryTextFm(lineups?.away, fixture.away_team.name),
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

  let bookOdds: { home: number; draw: number; away: number } | null = null;
  try {
    bookOdds = await getMatchOdds1xBet(fixture.fotmob_id);
  } catch {
    // 1xBet odds are best-effort and isolated — a failure here must never
    // fail the rest of the prediction.
  }
  const toDecimalOdds = (probPct: number) => (probPct > 0 ? Math.round((100 / probPct) * 100) / 100 : null);

  // Surface the tactical nudges (formation shape, missing players) as
  // explicit factors alongside GPT's, so it's visible in the UI that
  // they're actually being considered rather than silently folded into a
  // number nobody sees.
  const tacticalFactors: string[] = [];
  const homeFormationUsed = lineups?.home.formation ?? fixture.home_formation;
  const awayFormationUsed = lineups?.away.formation ?? fixture.away_formation;
  const homeFormationMult = formationAttackMultiplier(homeFormationUsed);
  const awayFormationMult = formationAttackMultiplier(awayFormationUsed);
  const homeAvailabilityMult = availabilityMultiplier(lineups?.home.unavailable?.length ?? 0);
  const awayAvailabilityMult = availabilityMultiplier(lineups?.away.unavailable?.length ?? 0);

  if (homeFormationMult > 1.02) tacticalFactors.push(`${fixture.home_team.name}의 공격적인 포메이션(${homeFormationUsed})이 득점 기대치를 높임`);
  else if (homeFormationMult < 0.98) tacticalFactors.push(`${fixture.home_team.name}의 수비적인 포메이션(${homeFormationUsed})이 득점 기대치를 낮춤`);
  if (awayFormationMult > 1.02) tacticalFactors.push(`${fixture.away_team.name}의 공격적인 포메이션(${awayFormationUsed})이 득점 기대치를 높임`);
  else if (awayFormationMult < 0.98) tacticalFactors.push(`${fixture.away_team.name}의 수비적인 포메이션(${awayFormationUsed})이 득점 기대치를 낮춤`);
  if (homeAvailabilityMult < 1 && (lineups?.home.unavailable?.length ?? 0) > 0) {
    tacticalFactors.push(`${fixture.home_team.name} 결장: ${lineups!.home.unavailable!.map((p) => p.name).join(', ')}`);
  }
  if (awayAvailabilityMult < 1 && (lineups?.away.unavailable?.length ?? 0) > 0) {
    tacticalFactors.push(`${fixture.away_team.name} 결장: ${lineups!.away.unavailable!.map((p) => p.name).join(', ')}`);
  }

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
      factors: [...tacticalFactors, ...gpt.factors],
      h2h: h2hLetters,
      player_notes: playerNotes,
      odds_book_home: bookOdds?.home ?? null,
      odds_book_draw: bookOdds?.draw ?? null,
      odds_book_away: bookOdds?.away ?? null,
      odds_ai_home: toDecimalOdds(ensemble.finalProbs.home),
      odds_ai_draw: toDecimalOdds(ensemble.finalProbs.draw),
      odds_ai_away: toDecimalOdds(ensemble.finalProbs.away),
      raw_inputs: { homeRecent, awayRecent, h2hForModel, lineupOverlapRatio, homeTacticalStrength, awayTacticalStrength, gptRaw: gpt },
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
