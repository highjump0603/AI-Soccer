// The core pipeline: for each fixture that needs a (re)prediction, pull
// team form + head-to-head + lineups + match stats + standings from
// FotMob and hand all of it to GPT, which produces the final score and
// probabilities directly — there's no separate statistical model blended
// in afterward; GPT's read *is* the prediction. Bookmaker odds come from a
// separate, best-effort FotMob 1xBet odds call (see _shared/fotmob.ts's
// getMatchOdds1xBet), wrapped in its own try/catch so its absence never
// breaks a prediction.
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
  getLeagueTable,
} from '../_shared/fotmob.ts';
import { averageGoalsFor, averageGoalsAgainst } from '../_shared/poisson.ts';
import { getGptPrediction } from '../_shared/openai.ts';
import { cacheTeamRecentResultsFm, upsertPlayerAndLineupFm } from '../_shared/cache.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { mapRecentResultsFm, attachXgFm, h2hResultLettersFm, h2hDetailRowsFm, lineupSummaryTextFm, formSummaryText } from '../_shared/matchMapping.ts';

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

// Days since a team's most recent finished match before this fixture's
// kickoff — a simple, team-level fatigue proxy (no per-player minutes-
// played data available). A short turnaround (<=3 days, common in cup
// congestion) is flagged as a fatigue risk.
function restNote(recentMatches: { status?: { utcTime?: string; finished?: boolean } }[], kickoffAt: string, teamName: string): string {
  const finished = recentMatches
    .filter((m) => m.status?.finished && m.status?.utcTime)
    .sort((a, b) => new Date(b.status!.utcTime!).getTime() - new Date(a.status!.utcTime!).getTime());
  if (finished.length === 0) return `${teamName}: 최근 경기 기록 없음`;
  const daysSince = Math.round((new Date(kickoffAt).getTime() - new Date(finished[0].status!.utcTime!).getTime()) / 86400000);
  const risk = daysSince <= 3 ? ' (연속 경기로 피로 누적 가능성 있음)' : '';
  return `${teamName}: 직전 경기로부터 ${daysSince}일 휴식${risk}`;
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

  // Best-effort xG/cards enrichment: only fixtures we've personally tracked
  // before have cached match_stats, so this is sparse at first and fills in
  // over time as more of a team's matches pass through this same pipeline.
  const candidateFotmobIds = [...homeRecentMatches, ...awayRecentMatches].map((m) => m.id);
  const xgByFotmobMatchId = new Map<number, { home: number; away: number }>();
  const cardsByFotmobMatchId = new Map<number, { home: number; away: number }>();
  if (candidateFotmobIds.length > 0) {
    const { data: cachedFixtures } = await supabase.from('fixtures').select('id, fotmob_id').in('fotmob_id', candidateFotmobIds);
    const fixtureIdToFotmobId = new Map((cachedFixtures ?? []).map((f) => [f.id, f.fotmob_id as number]));
    if (fixtureIdToFotmobId.size > 0) {
      const { data: statRows } = await supabase
        .from('match_stats')
        .select('fixture_id, stat_key, home_value, away_value')
        .in('fixture_id', [...fixtureIdToFotmobId.keys()])
        .in('stat_key', ['expected_goals', 'yellow_cards', 'red_cards']);
      for (const row of statRows ?? []) {
        const fotmobId = fixtureIdToFotmobId.get(row.fixture_id);
        if (!fotmobId) continue;
        const home = Number(row.home_value);
        const away = Number(row.away_value);
        if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
        if (row.stat_key === 'expected_goals') {
          xgByFotmobMatchId.set(fotmobId, { home, away });
        } else {
          const existing = cardsByFotmobMatchId.get(fotmobId) ?? { home: 0, away: 0 };
          cardsByFotmobMatchId.set(fotmobId, { home: existing.home + home, away: existing.away + away });
        }
      }
    }
  }

  const homeRecent = attachXgFm(mapRecentResultsFm(homeRecentMatches, homeId), homeRecentMatches, homeId, xgByFotmobMatchId);
  const awayRecent = attachXgFm(mapRecentResultsFm(awayRecentMatches, awayId), awayRecentMatches, awayId, xgByFotmobMatchId);

  const discipline = (matches: typeof homeRecentMatches, teamId: number, teamName: string) => {
    const cardCounts = matches
      .map((m) => {
        const c = cardsByFotmobMatchId.get(m.id);
        if (!c) return null;
        return m.home.id === teamId ? c.home : c.away;
      })
      .filter((n): n is number => n != null);
    if (cardCounts.length === 0) return `${teamName}: 카드 기록 없음`;
    const avg = cardCounts.reduce((a, b) => a + b, 0) / cardCounts.length;
    return `${teamName}: 최근 ${cardCounts.length}경기 평균 ${avg.toFixed(1)}장`;
  };

  const details = await getMatchDetails(fixture.fotmob_id);

  const h2h = getHeadToHead(details);
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

  // Match stats (xG, shots, possession, cards, ...) only exist once the
  // game has started — no-op before kickoff, filled in naturally by a
  // later run thanks to POST_KICKOFF_STATS_WINDOW_MS keeping this fixture
  // "due" for a while after its scheduled kickoff.
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
  const playerNotes: PlayerNote[] = [];

  // Reference expected goals — purely a text hint fed into GPT's prompt,
  // not a separate model whose output competes with GPT's own. Derived
  // the same way the old Poisson model did (recent scoring/conceding rates,
  // preferring real xG over raw goals when we have it cached).
  const homeXgRef = (averageGoalsFor(homeRecent, 'home') + averageGoalsAgainst(awayRecent, 'away')) / 2;
  const awayXgRef = (averageGoalsFor(awayRecent, 'away') + averageGoalsAgainst(homeRecent, 'home')) / 2;

  const homeFormationUsed = lineups?.home.formation ?? fixture.home_formation;
  const awayFormationUsed = lineups?.away.formation ?? fixture.away_formation;
  const homeUnavailable = lineups?.home.unavailable ?? [];
  const awayUnavailable = lineups?.away.unavailable ?? [];

  // League standings — best-effort, only meaningful once the league's
  // table has some played matches (pre-season it's all zeros).
  let homeStandingNote = `${fixture.home_team.name}: 순위 정보 없음`;
  let awayStandingNote = `${fixture.away_team.name}: 순위 정보 없음`;
  if (fixture.fotmob_league_id) {
    try {
      const table = await getLeagueTable(fixture.fotmob_league_id);
      const allRows = table.groups.flatMap((g) => g.rows);
      const homeRow = allRows.find((r) => r.id === homeId);
      const awayRow = allRows.find((r) => r.id === awayId);
      if (homeRow) homeStandingNote = `${fixture.home_team.name}: ${homeRow.idx}위 (승점 ${homeRow.pts}, ${homeRow.played}경기)`;
      if (awayRow) awayStandingNote = `${fixture.away_team.name}: ${awayRow.idx}위 (승점 ${awayRow.pts}, ${awayRow.played}경기)`;
    } catch {
      // best-effort — leave the "no data" note in place
    }
  }

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
      homeFormationNote: homeFormationUsed ?? '알 수 없음',
      awayFormationNote: awayFormationUsed ?? '알 수 없음',
      homeFatigueNote: restNote(homeRecentMatches, fixture.kickoff_at, fixture.home_team.name),
      awayFatigueNote: restNote(awayRecentMatches, fixture.kickoff_at, fixture.away_team.name),
      homeDisciplineNote: discipline(homeRecentMatches, homeId, fixture.home_team.name),
      awayDisciplineNote: discipline(awayRecentMatches, awayId, fixture.away_team.name),
      homeStandingNote,
      awayStandingNote,
      referenceXg: `홈 ${homeXgRef.toFixed(2)} / 원정 ${awayXgRef.toFixed(2)}`,
    });
  } catch (e) {
    // If GPT is unavailable there's no fallback model anymore — surface the
    // failure so the caller sees it rather than silently upserting a bogus
    // 0-0/33-33-33 row.
    throw new Error(`GPT prediction failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Confidence purely from how decisive GPT's own top probability is (no
  // second model left to check agreement against).
  const topProb = Math.max(gpt.probHome, gpt.probDraw, gpt.probAway);
  const confidence: 'high' | 'medium' | 'low' = topProb >= 50 ? 'high' : topProb >= 40 ? 'medium' : 'low';

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
  if (homeFormationUsed) tacticalFactors.push(`${fixture.home_team.name} 포메이션 ${homeFormationUsed}`);
  if (awayFormationUsed) tacticalFactors.push(`${fixture.away_team.name} 포메이션 ${awayFormationUsed}`);
  if (lineups) {
    tacticalFactors.push(
      homeUnavailable.length > 0 ? `${fixture.home_team.name} 결장: ${homeUnavailable.map((p) => p.name).join(', ')}` : `${fixture.home_team.name} 결장 선수 없음`
    );
    tacticalFactors.push(
      awayUnavailable.length > 0 ? `${fixture.away_team.name} 결장: ${awayUnavailable.map((p) => p.name).join(', ')}` : `${fixture.away_team.name} 결장 선수 없음`
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
      stat_xg_home: homeXgRef,
      stat_xg_away: awayXgRef,
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
      confidence,
      factors: [...tacticalFactors, ...gpt.factors],
      h2h: h2hLetters,
      player_notes: playerNotes,
      odds_book_home: bookOdds?.home ?? null,
      odds_book_draw: bookOdds?.draw ?? null,
      odds_book_away: bookOdds?.away ?? null,
      odds_ai_home: toDecimalOdds(gpt.probHome),
      odds_ai_draw: toDecimalOdds(gpt.probDraw),
      odds_ai_away: toDecimalOdds(gpt.probAway),
      raw_inputs: { homeRecent, awayRecent, homeXgRef, awayXgRef, homeStandingNote, awayStandingNote, gptRaw: gpt },
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
