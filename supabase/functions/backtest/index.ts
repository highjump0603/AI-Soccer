// Runs the real prediction pipeline (_shared/predictionInputs.ts, the same
// module predict-due uses) against an already-finished match, but with
// every recent-form/H2H/fatigue/discipline input restricted to data from
// strictly before that match's own kickoff — so the prediction is genuinely
// blind to the match's own result, not just "predicting" a game it's
// already been shown the answer to. Compares the result against what
// actually happened and asks GPT for a short retrospective on why.
//
// Three ways to invoke:
//   - POST { matchId: <fotmob matchId> } -> backtest one specific match
//   - POST { teamId: <our internal teams.id>, count?: N } -> backtest that
//     team's last N finished matches
//   - POST { league: <league name>, season?: <year>, count?: N } -> backtest
//     that league/season's most recent finished matches
import { getSupabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { getMatchDetails, getTeamFixtures, type FmMatch } from '../_shared/fotmob.ts';
import { getGptPrediction, getBacktestAnalysis } from '../_shared/openai.ts';
import { gatherPredictionInputs } from '../_shared/predictionInputs.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

type BacktestTarget = FmMatch & { leagueName?: string | null };

function normalizeLeagueName(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  const aliases: Record<string, string> = {
    '프리미어리그': '프리미어리그',
    'epl': '프리미어리그',
    'premierleague': '프리미어리그',
    '라리가': '라리가',
    'laliga': '라리가',
    '분데스리가': '분데스리가',
    'bundesliga': '분데스리가',
    '세리에a': '세리에A',
    'seriea': '세리에A',
    '리그앙': '리그앙',
    'ligue1': '리그앙',
    'k리그1': 'K리그1',
    '월드컵': '월드컵',
    'worldcup': '월드컵',
  };
  return aliases[normalized] ?? value?.trim() ?? '';
}

async function backtestOneMatch(supabase: Supabase, m: BacktestTarget) {
  if (m.home.score == null || m.away.score == null) throw new Error('match has no final score yet');

  let details: Awaited<ReturnType<typeof getMatchDetails>>;
  try {
    details = await getMatchDetails(m.id);
  } catch {
    details = { general: {}, header: { teams: [] }, content: {} } as Awaited<ReturnType<typeof getMatchDetails>>;
  }

  const kickoffAt = details.general.matchTimeUTCDate ?? m.status?.utcTime ?? new Date().toISOString();
  const leagueId = details.general.leagueId ?? m.leagueId ?? null;
  const leagueName = m.leagueName || details.general.leagueName || '';

  const inputs = await gatherPredictionInputs(supabase, {
    homeFotmobId: m.home.id,
    awayFotmobId: m.away.id,
    homeTeamName: m.home.name,
    awayTeamName: m.away.name,
    fotmobMatchId: m.id,
    fotmobLeagueId: leagueId,
    kickoffAt,
    league: leagueName,
    // The match itself and anything at/after it is excluded from every
    // recent-form/H2H/fatigue input — this is the whole point of a
    // backtest: predict as if standing at kickoff, not with hindsight.
    excludeAtOrAfter: kickoffAt,
  });

  const gpt = await getGptPrediction(inputs.gptInput);

  const actualHome = m.home.score;
  const actualAway = m.away.score;
  const realOutcome = (h: number, a: number) => (h > a ? 'H' : h < a ? 'A' : 'D');
  const outcomeCorrect = realOutcome(gpt.scoreHome, gpt.scoreAway) === realOutcome(actualHome, actualAway);
  const scoreCorrect = gpt.scoreHome === actualHome && gpt.scoreAway === actualAway;

  let analysis: string;
  try {
    analysis = await getBacktestAnalysis({
      homeTeam: m.home.name,
      awayTeam: m.away.name,
      predictedProbs: { home: gpt.probHome, draw: gpt.probDraw, away: gpt.probAway },
      predictedScore: { home: gpt.scoreHome, away: gpt.scoreAway },
      predictedFactors: gpt.factors,
      actualScore: { home: actualHome, away: actualAway },
    });
  } catch (e) {
    analysis = `분석 실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  const { error } = await supabase.from('backtest_results').upsert(
    {
      fotmob_match_id: m.id,
      league: leagueName || null,
      home_team_name: m.home.name,
      away_team_name: m.away.name,
      kickoff_at: kickoffAt,
      predicted_prob_home: gpt.probHome,
      predicted_prob_draw: gpt.probDraw,
      predicted_prob_away: gpt.probAway,
      predicted_score_home: gpt.scoreHome,
      predicted_score_away: gpt.scoreAway,
      actual_score_home: actualHome,
      actual_score_away: actualAway,
      outcome_correct: outcomeCorrect,
      score_correct: scoreCorrect,
      factors: gpt.factors,
      analysis,
      run_at: new Date().toISOString(),
    },
    { onConflict: 'fotmob_match_id' }
  );
  if (error) throw error;

  return { matchId: m.id, home: m.home.name, away: m.away.name, outcomeCorrect, scoreCorrect };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const supabase = getSupabaseAdmin();
  let body: { matchId?: number; teamId?: number; league?: string; season?: number; count?: number } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to validation error below
  }

  const targets: BacktestTarget[] = [];
  try {
    if (body.matchId) {
      // A single arbitrary FotMob matchId — reconstruct a minimal FmMatch
      // shell from matchDetails since we don't have the /matches listing
      // entry for it.
      const details = await getMatchDetails(body.matchId);
      const [homeRef, awayRef] = details.header.teams;
      targets.push({
        id: body.matchId,
        leagueId: details.general.leagueId ?? 0,
        primaryLeagueId: details.general.leagueId ?? 0,
        time: '',
        home: homeRef,
        away: awayRef,
        status: { finished: true, utcTime: details.general.matchTimeUTCDate },
      });
    } else if (body.teamId) {
      const { data: team, error } = await supabase.from('teams').select('fotmob_id').eq('id', body.teamId).single();
      if (error || !team) throw new Error('team not found');
      const all = await getTeamFixtures(team.fotmob_id);
      const finished = all
        .filter((m) => m.status?.finished && m.status?.utcTime)
        .sort((a, b) => new Date(b.status!.utcTime!).getTime() - new Date(a.status!.utcTime!).getTime())
        .slice(0, body.count ?? 5);
      targets.push(...finished);
    } else if (body.league) {
      const seasonYear = body.season ?? new Date().getUTCFullYear();
      const requestedLeague = normalizeLeagueName(body.league);
      const { data: fixtures, error } = await supabase
        .from('fixtures')
        .select('fotmob_id, league, season, kickoff_at, home_score_actual, away_score_actual, home_team:home_team_id(id, name), away_team:away_team_id(id, name)')
        .order('kickoff_at', { ascending: false })
        .limit(Math.max(200, (body.count ?? 5) * 20));
      if (error) throw error;

      const normalizedFixtures = (fixtures ?? []).filter((fixture) => {
        const hasFinalScore = fixture.home_score_actual != null && fixture.away_score_actual != null;
        return fixture?.fotmob_id && (fixture.status === 'finished' || hasFinalScore);
      });

      const matchingFixtures = normalizedFixtures.filter((fixture) => {
        const fixtureLeague = normalizeLeagueName(fixture.league);
        const sameSeason = fixture.season == null || Number(fixture.season) === Number(seasonYear) || String(fixture.season ?? '') === String(seasonYear);
        const sameLeague = !requestedLeague || fixtureLeague === requestedLeague;
        return sameSeason && sameLeague;
      });

      const resolvedFixtures = requestedLeague ? matchingFixtures : normalizedFixtures;

      for (const fixture of resolvedFixtures.slice(0, body.count ?? 5)) {
        if (!fixture?.fotmob_id || !fixture.home_team?.name || !fixture.away_team?.name) continue;
        targets.push({
          id: fixture.fotmob_id,
          leagueId: 0,
          primaryLeagueId: 0,
          time: '',
          home: { id: fixture.home_team?.id ?? 0, name: fixture.home_team?.name ?? '', score: fixture.home_score_actual ?? null },
          away: { id: fixture.away_team?.id ?? 0, name: fixture.away_team?.name ?? '', score: fixture.away_score_actual ?? null },
          status: { finished: true, utcTime: fixture.kickoff_at },
          leagueName: fixture.league ?? requestedLeague || body.league,
        } as BacktestTarget);
      }
    } else {
      return new Response(JSON.stringify({ ok: false, error: 'matchId, teamId, or league is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: Record<string, string> = {};
  if (targets.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, results, message: 'No matching finished fixtures were found for the selected league/season.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  for (const m of targets) {
    const label = `${m.home.name} vs ${m.away.name} (${m.id})`;
    try {
      const r = await backtestOneMatch(supabase, m);
      results[label] = r.outcomeCorrect ? (r.scoreCorrect ? 'ok (정확한 스코어까지 적중)' : 'ok (승부만 적중)') : 'ok (예측 빗나감)';
    } catch (e) {
      results[label] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: targets.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
