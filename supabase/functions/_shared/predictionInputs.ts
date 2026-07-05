// Shared "gather everything GPT needs" step used by BOTH predict-due (live
// predictions) and backtest (historical validation). Keeping this in one
// place means a backtest run genuinely exercises the same data-gathering
// logic production predictions use — the whole point of backtesting is to
// validate the real pipeline, not a reimplementation that could quietly
// drift from it.
//
// `excludeAtOrAfter` (always the match's own kickoff time) filters out any
// recent-form/H2H/fatigue/discipline data at or after that instant. For a
// live prediction this is a no-op in practice (the match hasn't happened
// yet, so nothing to exclude), but for a backtest against an
// already-finished historical match it's the difference between a genuine
// prediction and one that's silently been shown its own answer.
import {
  getMatchDetails,
  getLineups,
  getHeadToHead,
  getTeamFixtures,
  getLeagueTable,
  type FmMatch,
  type FmH2hMatch,
} from './fotmob.ts';
import { averageGoalsFor, averageGoalsAgainst, type RecentResult } from './poisson.ts';
import { mapRecentResultsFm, attachXgFm, h2hResultLettersFm, lineupSummaryTextFm, formSummaryText } from './matchMapping.ts';
import type { GptPredictionInput } from './openai.ts';
import { getSupabaseAdmin } from './supabaseAdmin.ts';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const RECENT_MATCH_COUNT = 10;

function beforeCutoff(m: FmMatch, cutoffMs: number) {
  return m.status?.finished && m.status?.utcTime && new Date(m.status.utcTime).getTime() < cutoffMs;
}

function restNote(recentMatches: FmMatch[], kickoffAt: string, teamName: string): string {
  const sorted = [...recentMatches].sort((a, b) => new Date(b.status!.utcTime!).getTime() - new Date(a.status!.utcTime!).getTime());
  if (sorted.length === 0) return `${teamName}: 최근 경기 기록 없음`;
  const daysSince = Math.round((new Date(kickoffAt).getTime() - new Date(sorted[0].status!.utcTime!).getTime()) / 86400000);
  const risk = daysSince <= 3 ? ' (연속 경기로 피로 누적 가능성 있음)' : '';
  return `${teamName}: 직전 경기로부터 ${daysSince}일 휴식${risk}`;
}

export type PredictionInputs = {
  gptInput: GptPredictionInput;
  lineups: { home: NonNullable<ReturnType<typeof getLineups>>['home']; away: NonNullable<ReturnType<typeof getLineups>>['away'] } | null;
  homeRecent: RecentResult[];
  awayRecent: RecentResult[];
  homeRecentMatches: FmMatch[];
  awayRecentMatches: FmMatch[];
  h2h: FmH2hMatch[];
  h2hLetters: string[];
  homeXgRef: number;
  awayXgRef: number;
  homeFormationUsed: string | null;
  awayFormationUsed: string | null;
  homeUnavailable: { name: string }[];
  awayUnavailable: { name: string }[];
};

export async function gatherPredictionInputs(
  supabase: Supabase,
  params: {
    homeFotmobId: number;
    awayFotmobId: number;
    homeTeamName: string;
    awayTeamName: string;
    fotmobMatchId: number;
    fotmobLeagueId: number | null;
    kickoffAt: string;
    league: string;
    homeFormationFallback?: string | null;
    awayFormationFallback?: string | null;
    excludeAtOrAfter: string;
  }
): Promise<PredictionInputs> {
  const cutoffMs = new Date(params.excludeAtOrAfter).getTime();

  const [homeAllMatches, awayAllMatches] = await Promise.all([getTeamFixtures(params.homeFotmobId), getTeamFixtures(params.awayFotmobId)]);
  const homeRecentMatches = homeAllMatches
    .filter((m) => beforeCutoff(m, cutoffMs))
    .sort((a, b) => new Date(b.status!.utcTime!).getTime() - new Date(a.status!.utcTime!).getTime())
    .slice(0, RECENT_MATCH_COUNT);
  const awayRecentMatches = awayAllMatches
    .filter((m) => beforeCutoff(m, cutoffMs))
    .sort((a, b) => new Date(b.status!.utcTime!).getTime() - new Date(a.status!.utcTime!).getTime())
    .slice(0, RECENT_MATCH_COUNT);

  // Best-effort xG/cards enrichment: only fixtures we've personally tracked
  // before have cached match_stats, so this is sparse and fills in over
  // time as more matches pass through this same pipeline.
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

  const homeRecent = attachXgFm(mapRecentResultsFm(homeRecentMatches, params.homeFotmobId), homeRecentMatches, params.homeFotmobId, xgByFotmobMatchId);
  const awayRecent = attachXgFm(mapRecentResultsFm(awayRecentMatches, params.awayFotmobId), awayRecentMatches, params.awayFotmobId, xgByFotmobMatchId);

  const discipline = (matches: FmMatch[], teamId: number, teamName: string) => {
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

  const details = await getMatchDetails(params.fotmobMatchId);

  const h2hAll = getHeadToHead(details).filter((m) => {
    const t = m.time?.utcTime ? new Date(m.time.utcTime).getTime() : null;
    return t != null && t < cutoffMs;
  });
  const h2hLetters = h2hResultLettersFm(h2hAll, params.homeTeamName);

  const rawLineups = getLineups(details);
  const lineups = rawLineups && new Date(details.general.matchTimeUTCDate ?? params.kickoffAt).getTime() < cutoffMs ? rawLineups : null;

  const homeXgRef = (averageGoalsFor(homeRecent, 'home') + averageGoalsAgainst(awayRecent, 'away')) / 2;
  const awayXgRef = (averageGoalsFor(awayRecent, 'away') + averageGoalsAgainst(homeRecent, 'home')) / 2;

  const homeFormationUsed = lineups?.home.formation ?? params.homeFormationFallback ?? null;
  const awayFormationUsed = lineups?.away.formation ?? params.awayFormationFallback ?? null;
  const homeUnavailable = lineups?.home.unavailable ?? [];
  const awayUnavailable = lineups?.away.unavailable ?? [];

  let homeStandingNote = `${params.homeTeamName}: 순위 정보 없음`;
  let awayStandingNote = `${params.awayTeamName}: 순위 정보 없음`;
  if (params.fotmobLeagueId) {
    try {
      const table = await getLeagueTable(params.fotmobLeagueId);
      const allRows = table.groups.flatMap((g) => g.rows);
      const homeRow = allRows.find((r) => r.id === params.homeFotmobId);
      const awayRow = allRows.find((r) => r.id === params.awayFotmobId);
      if (homeRow) homeStandingNote = `${params.homeTeamName}: ${homeRow.idx}위 (승점 ${homeRow.pts}, ${homeRow.played}경기)`;
      if (awayRow) awayStandingNote = `${params.awayTeamName}: ${awayRow.idx}위 (승점 ${awayRow.pts}, ${awayRow.played}경기)`;
    } catch {
      // best-effort — leave the "no data" note in place
    }
  }
  // NOTE: standings are always the CURRENT table — FotMob's free API has no
  // "table as of date X" endpoint, so a backtest against an old match sees
  // today's standings, not the standings at the time that match was played.
  // This is a known limitation, not a bug; flagged again in the backtest
  // report so it doesn't get mistaken for a more-informed prediction than
  // it actually is.

  const gptInput: GptPredictionInput = {
    league: params.league,
    homeTeam: params.homeTeamName,
    awayTeam: params.awayTeamName,
    kickoffAt: params.kickoffAt,
    homeFormSummary: formSummaryText(homeRecent, params.homeTeamName),
    awayFormSummary: formSummaryText(awayRecent, params.awayTeamName),
    h2hSummary: h2hLetters.length ? `최근 ${h2hLetters.length}회 맞대결 (홈팀 기준, 최신순): ${h2hLetters.join(', ')}` : '최근 맞대결 기록 없음',
    homeLineupSummary: lineupSummaryTextFm(lineups?.home, params.homeTeamName),
    awayLineupSummary: lineupSummaryTextFm(lineups?.away, params.awayTeamName),
    homeFormationNote: homeFormationUsed ?? '알 수 없음',
    awayFormationNote: awayFormationUsed ?? '알 수 없음',
    homeFatigueNote: restNote(homeRecentMatches, params.kickoffAt, params.homeTeamName),
    awayFatigueNote: restNote(awayRecentMatches, params.kickoffAt, params.awayTeamName),
    homeDisciplineNote: discipline(homeRecentMatches, params.homeFotmobId, params.homeTeamName),
    awayDisciplineNote: discipline(awayRecentMatches, params.awayFotmobId, params.awayTeamName),
    homeStandingNote,
    awayStandingNote,
    referenceXg: `홈 ${homeXgRef.toFixed(2)} / 원정 ${awayXgRef.toFixed(2)}`,
  };

  return {
    gptInput,
    lineups,
    homeRecent,
    awayRecent,
    homeRecentMatches,
    awayRecentMatches,
    h2h: h2hAll,
    h2hLetters,
    homeXgRef,
    awayXgRef,
    homeFormationUsed,
    awayFormationUsed,
    homeUnavailable,
    awayUnavailable,
  };
}
