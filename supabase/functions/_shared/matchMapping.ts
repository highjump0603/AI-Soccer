import type { AfFixture, AfLineup } from './apiFootball.ts';
import type { RecentResult } from './poisson.ts';

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

export function mapRecentResults(afFixtures: AfFixture[], teamApiId: number): RecentResult[] {
  return afFixtures
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .map((f) => {
      const isHome = f.teams.home.id === teamApiId;
      const goalsFor = (isHome ? f.goals.home : f.goals.away) ?? 0;
      const goalsAgainst = (isHome ? f.goals.away : f.goals.home) ?? 0;
      return { venue: isHome ? 'home' : 'away', goals_for: goalsFor, goals_against: goalsAgainst } as RecentResult;
    });
}

export function alignH2hForModel(h2hAf: AfFixture[], currentHomeApiId: number) {
  return h2hAf
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .map((f) => {
      const currentHomeWasHome = f.teams.home.id === currentHomeApiId;
      const homeGoals = (currentHomeWasHome ? f.goals.home : f.goals.away) ?? 0;
      const awayGoals = (currentHomeWasHome ? f.goals.away : f.goals.home) ?? 0;
      return { homeGoals, awayGoals };
    });
}

// W/D/L from the current fixture's home team's perspective, most recent first.
export function h2hResultLetters(h2hAf: AfFixture[], currentHomeApiId: number): string[] {
  const sorted = [...h2hAf]
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());

  return sorted.map((f) => {
    const currentHomeWasHome = f.teams.home.id === currentHomeApiId;
    const goalsFor = (currentHomeWasHome ? f.goals.home : f.goals.away) ?? 0;
    const goalsAgainst = (currentHomeWasHome ? f.goals.away : f.goals.home) ?? 0;
    if (goalsFor > goalsAgainst) return 'W';
    if (goalsFor < goalsAgainst) return 'L';
    return 'D';
  });
}

export function formSummaryText(recent: RecentResult[], teamName: string): string {
  if (recent.length === 0) return `${teamName}: 최근 경기 데이터 없음`;
  const wins = recent.filter((r) => r.goals_for > r.goals_against).length;
  const draws = recent.filter((r) => r.goals_for === r.goals_against).length;
  const losses = recent.filter((r) => r.goals_for < r.goals_against).length;
  const avgFor = (recent.reduce((a, r) => a + r.goals_for, 0) / recent.length).toFixed(1);
  const avgAgainst = (recent.reduce((a, r) => a + r.goals_against, 0) / recent.length).toFixed(1);
  return `${teamName}: 최근 ${recent.length}경기 ${wins}승 ${draws}무 ${losses}패, 평균 득점 ${avgFor}골, 평균 실점 ${avgAgainst}골`;
}

export function lineupSummaryText(lineup: AfLineup | undefined, teamName: string): string {
  if (!lineup) return `${teamName}: 공식 라인업 미발표`;
  const names = lineup.startXI.map((s) => s.player.name).join(', ');
  return `${teamName} 예상 포메이션 ${lineup.formation ?? '?'}: ${names}`;
}

// Which current-fixture starters (either side) also started or subbed in the
// most recent meeting between these two clubs — the closest honest proxy we
// have for "선수 개인 맞대결 이력" without a dedicated player-vs-player stats feed.
export function computePlayerMeetingNotes(
  currentLineups: AfLineup[],
  lastH2hLineups: AfLineup[],
  lastH2hDate: string,
  lastH2hResultLabel: string
) {
  const pastPlayerIds = new Set<number>();
  for (const team of lastH2hLineups) {
    for (const p of [...team.startXI, ...(team.substitutes ?? [])]) pastPlayerIds.add(p.player.id);
  }

  const notes: { player: string; team: string; meetings: { date: string; result: string }[] }[] = [];
  for (const team of currentLineups) {
    for (const s of team.startXI) {
      if (pastPlayerIds.has(s.player.id)) {
        notes.push({
          player: s.player.name,
          team: team.team.name,
          meetings: [{ date: lastH2hDate, result: lastH2hResultLabel }],
        });
      }
    }
  }
  return notes;
}

// 0 (no overlap data / squads fully turned over) to 1 (same core group of
// players as last time these two teams met) — used to scale how much the
// model should lean on H2H history.
export function computeLineupOverlapRatio(currentLineups: AfLineup[], lastH2hLineups: AfLineup[]) {
  if (currentLineups.length === 0 || lastH2hLineups.length === 0) return null;
  const pastIds = new Set<number>();
  for (const team of lastH2hLineups) for (const p of team.startXI) pastIds.add(p.player.id);

  let totalStarters = 0;
  let overlap = 0;
  for (const team of currentLineups) {
    for (const s of team.startXI) {
      totalStarters += 1;
      if (pastIds.has(s.player.id)) overlap += 1;
    }
  }
  if (totalStarters === 0) return null;
  return overlap / totalStarters;
}
