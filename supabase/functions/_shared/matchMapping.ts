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

export type H2hDetailRow = {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
};

// Full past-meeting rows (date/competition/score) for display, most recent
// first — h2hResultLetters above throws away everything but W/D/L, which is
// all the model needs but not enough to show an actual match list.
export function h2hDetailRows(h2hAf: AfFixture[], count = 5): H2hDetailRow[] {
  return [...h2hAf]
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, count)
    .map((f) => ({
      date: f.fixture.date,
      league: f.league.name,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      homeGoals: f.goals.home ?? 0,
      awayGoals: f.goals.away ?? 0,
    }));
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

type PosGroup = 'G' | 'D' | 'M' | 'F';

function posGroup(pos?: string): PosGroup {
  const p = (pos ?? '').toUpperCase();
  if (p.startsWith('G')) return 'G';
  if (p.startsWith('D')) return 'D';
  if (p.startsWith('F')) return 'F';
  return 'M';
}

export type EstimatedLineup = {
  formation: string;
  // One array per pitch row, GK first: rows[0] = keeper, rows[1] = defenders, etc.
  rows: { group: PosGroup; id: number; name: string; number?: number }[][];
};

// Best guess at a team's starting XI + formation before the club announces
// one: most-used player per position group across its last few actual
// lineups, skipping anyone currently injured/suspended. No per-player
// rating data involved — pure "who's been playing lately".
export function estimateLineup(recentLineups: AfLineup[], unavailableIds: Set<number>): EstimatedLineup | null {
  if (recentLineups.length === 0) return null;

  const formationCounts = new Map<string, number>();
  for (const l of recentLineups) {
    if (!l.formation) continue;
    formationCounts.set(l.formation, (formationCounts.get(l.formation) ?? 0) + 1);
  }
  const formation =
    [...formationCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? recentLineups[0].formation ?? '4-4-2';

  const segments = formation
    .split('-')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const dfCount = segments[0] ?? 4;
  const fwCount = segments.length > 1 ? segments[segments.length - 1] : 2;
  const mfCount = segments.length > 2 ? segments.slice(1, -1).reduce((a, b) => a + b, 0) : Math.max(0, 10 - dfCount - fwCount);

  type Stat = { name: string; number?: number; group: PosGroup; count: number; lastSeen: number };
  const stats = new Map<number, Stat>();
  recentLineups.forEach((l, idx) => {
    for (const s of l.startXI) {
      if (unavailableIds.has(s.player.id)) continue;
      const recency = recentLineups.length - idx;
      const existing = stats.get(s.player.id);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = Math.max(existing.lastSeen, recency);
      } else {
        stats.set(s.player.id, { name: s.player.name, number: s.player.number, group: posGroup(s.player.pos), count: 1, lastSeen: recency });
      }
    }
  });

  const byGroup: Record<PosGroup, { id: number; name: string; number?: number; count: number; lastSeen: number }[]> = {
    G: [],
    D: [],
    M: [],
    F: [],
  };
  for (const [id, v] of stats.entries()) byGroup[v.group].push({ id, name: v.name, number: v.number, count: v.count, lastSeen: v.lastSeen });
  for (const group of Object.keys(byGroup) as PosGroup[]) {
    byGroup[group].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
  }

  const wanted: { group: PosGroup; count: number }[] = [
    { group: 'G', count: 1 },
    { group: 'D', count: dfCount },
    { group: 'M', count: mfCount },
    { group: 'F', count: fwCount },
  ];

  const pickedIds = new Set<number>();
  const rows: EstimatedLineup['rows'] = [];
  for (const { group, count } of wanted) {
    const picks = byGroup[group].filter((p) => !pickedIds.has(p.id)).slice(0, count);
    for (const p of picks) pickedIds.add(p.id);
    rows.push(picks.map((p) => ({ group, id: p.id, name: p.name, number: p.number })));
  }

  // Backfill short rows (e.g. only one known winger on record) from whoever
  // else is left, regardless of group, so the XI doesn't come up short.
  const leftover = [...stats.entries()]
    .filter(([id]) => !pickedIds.has(id))
    .map(([id, v]) => ({ id, name: v.name, number: v.number, count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
  for (let i = 0; i < rows.length; i++) {
    while (rows[i].length < wanted[i].count && leftover.length > 0) {
      const p = leftover.shift();
      if (!p) break;
      rows[i].push({ group: wanted[i].group, id: p.id, name: p.name, number: p.number });
      pickedIds.add(p.id);
    }
  }

  return { formation, rows };
}
