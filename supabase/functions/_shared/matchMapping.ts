import type { RecentResult } from './poisson.ts';
import type { FmMatch, FmTeamLineup, FmH2hMatch } from './fotmob.ts';
import { parseScoreStr } from './fotmob.ts';

export function mapRecentResultsFm(fmMatches: FmMatch[], teamId: number): RecentResult[] {
  return fmMatches
    .filter((m) => m.status?.finished)
    .map((m) => {
      const isHome = m.home.id === teamId;
      const goalsFor = (isHome ? m.home.score : m.away.score) ?? 0;
      const goalsAgainst = (isHome ? m.away.score : m.home.score) ?? 0;
      return { venue: isHome ? 'home' : 'away', goals_for: goalsFor, goals_against: goalsAgainst } as RecentResult;
    });
}

// Attaches real xG onto RecentResults wherever we happen to already have it
// cached in match_stats for that past match (only true for fixtures we've
// personally tracked/predicted before — an opponent's match against some
// third club we never tracked has no cached stats, and this is a
// best-effort enhancement, not a requirement — see poisson.ts's comment on
// RecentResult.xg_for/xg_against). `xgByFotmobMatchId` maps a FotMob match
// id to its {home, away} expected-goals figures.
export function attachXgFm(
  results: RecentResult[],
  fmMatches: FmMatch[],
  teamId: number,
  xgByFotmobMatchId: Map<number, { home: number; away: number }>
): RecentResult[] {
  const finished = fmMatches.filter((m) => m.status?.finished);
  return results.map((r, i) => {
    const m = finished[i];
    if (!m) return r;
    const xg = xgByFotmobMatchId.get(m.id);
    if (!xg) return r;
    const isHome = m.home.id === teamId;
    return { ...r, xg_for: isHome ? xg.home : xg.away, xg_against: isHome ? xg.away : xg.home };
  });
}

function h2hFinished(h2h: FmH2hMatch[]) {
  return h2h.filter((m) => m.status?.finished && parseScoreStr(m.status?.scoreStr) !== null);
}

export function alignH2hForModelFm(h2h: FmH2hMatch[], currentHomeName: string) {
  return h2hFinished(h2h).map((m) => {
    const currentHomeWasHome = normalizeTeamName(m.home.name) === normalizeTeamName(currentHomeName);
    const parsed = parseScoreStr(m.status?.scoreStr)!;
    const homeGoals = currentHomeWasHome ? parsed.home : parsed.away;
    const awayGoals = currentHomeWasHome ? parsed.away : parsed.home;
    return { homeGoals, awayGoals };
  });
}

// W/D/L from the current fixture's home team's perspective, most recent first.
export function h2hResultLettersFm(h2h: FmH2hMatch[], currentHomeName: string): string[] {
  const sorted = [...h2hFinished(h2h)].sort(
    (a, b) => new Date(b.time?.utcTime ?? 0).getTime() - new Date(a.time?.utcTime ?? 0).getTime()
  );
  return sorted.map((m) => {
    const currentHomeWasHome = normalizeTeamName(m.home.name) === normalizeTeamName(currentHomeName);
    const parsed = parseScoreStr(m.status?.scoreStr)!;
    const goalsFor = currentHomeWasHome ? parsed.home : parsed.away;
    const goalsAgainst = currentHomeWasHome ? parsed.away : parsed.home;
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
// first — h2hResultLettersFm above throws away everything but W/D/L, which
// is all the model needs but not enough to show an actual match list.
export function h2hDetailRowsFm(h2h: FmH2hMatch[], count = 5): H2hDetailRow[] {
  return [...h2hFinished(h2h)]
    .sort((a, b) => new Date(b.time?.utcTime ?? 0).getTime() - new Date(a.time?.utcTime ?? 0).getTime())
    .slice(0, count)
    .map((m) => {
      const parsed = parseScoreStr(m.status?.scoreStr)!;
      return {
        date: m.time?.utcTime ?? '',
        league: m.league?.name ?? '',
        homeTeam: m.home.name,
        awayTeam: m.away.name,
        homeGoals: parsed.home,
        awayGoals: parsed.away,
      };
    });
}

function normalizeTeamName(name: string) {
  return name.toLowerCase().trim();
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

export function lineupSummaryTextFm(lineup: FmTeamLineup | undefined, teamName: string): string {
  if (!lineup) return `${teamName}: 공식 라인업 미발표`;
  const names = lineup.starters.map((s) => s.name).join(', ');
  const missing = lineup.unavailable ?? [];
  const missingNote = missing.length > 0 ? ` (결장: ${missing.map((p) => p.name).join(', ')})` : '';
  return `${teamName} 예상 포메이션 ${lineup.formation ?? '?'}${missingNote}: ${names}`;
}

// Which current-fixture starters (either side) also started or subbed in the
// most recent meeting between these two clubs — the closest honest proxy we
// have for "선수 개인 맞대결 이력" without a dedicated player-vs-player stats feed.
export function computePlayerMeetingNotesFm(
  currentLineups: FmTeamLineup[],
  lastH2hLineups: FmTeamLineup[],
  lastH2hDate: string,
  lastH2hResultLabel: string
) {
  const pastPlayerIds = new Set<number>();
  for (const team of lastH2hLineups) {
    for (const p of [...team.starters, ...(team.subs ?? [])]) pastPlayerIds.add(p.id);
  }

  const notes: { player: string; team: string; meetings: { date: string; result: string }[] }[] = [];
  for (const team of currentLineups) {
    for (const s of team.starters) {
      if (pastPlayerIds.has(s.id)) {
        notes.push({ player: s.name, team: team.name, meetings: [{ date: lastH2hDate, result: lastH2hResultLabel }] });
      }
    }
  }
  return notes;
}

// 0 (no overlap data / squads fully turned over) to 1 (same core group of
// players as last time these two teams met) — used to scale how much the
// model should lean on H2H history.
export function computeLineupOverlapRatioFm(currentLineups: FmTeamLineup[], lastH2hLineups: FmTeamLineup[]) {
  if (currentLineups.length === 0 || lastH2hLineups.length === 0) return null;
  const pastIds = new Set<number>();
  for (const team of lastH2hLineups) for (const p of team.starters) pastIds.add(p.id);

  let totalStarters = 0;
  let overlap = 0;
  for (const team of currentLineups) {
    for (const s of team.starters) {
      totalStarters += 1;
      if (pastIds.has(s.id)) overlap += 1;
    }
  }
  if (totalStarters === 0) return null;
  return overlap / totalStarters;
}

type PosGroup = 'G' | 'D' | 'M' | 'F';

// 0=GK, 1=DF, 2=MF, 3=FW — confirmed against real FotMob lineup payloads.
// `positionId` (not used here) encodes the specific formation slot instead
// and varies per formation, so it's not safe for position-group bucketing.
function posGroupFm(usualPlayingPositionId?: number): PosGroup {
  if (usualPlayingPositionId === 0) return 'G';
  if (usualPlayingPositionId === 1) return 'D';
  if (usualPlayingPositionId === 3) return 'F';
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
// rating data involved — pure "who's been playing lately". Kept on the
// existing grid_row/grid_col-oriented output shape (position group as row,
// most-common ordering as column) rather than switching FormationPitch.jsx
// over to raw x/y coordinates — de-risks the FotMob cutover; a
// coordinate-based renderer can be a follow-up if desired.
export function estimateLineupFm(recentLineups: FmTeamLineup[], unavailableIds: Set<number>): EstimatedLineup | null {
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
  // Middle segments (e.g. "4-2-3-1"'s 2 and 3) become their own pitch rows
  // instead of one merged midfield line — otherwise a double-pivot +
  // attacking-three shape renders as a single flat row of 5, visually
  // contradicting the formation label shown right above it.
  const midSegments = segments.length > 2 ? segments.slice(1, -1) : [Math.max(0, 10 - dfCount - fwCount)];

  type Stat = { name: string; number?: number; group: PosGroup; count: number; lastSeen: number };
  const stats = new Map<number, Stat>();
  recentLineups.forEach((l, idx) => {
    for (const s of l.starters) {
      if (unavailableIds.has(s.id)) continue;
      const recency = recentLineups.length - idx;
      const existing = stats.get(s.id);
      const shirtNumber = s.shirtNumber != null ? Number(s.shirtNumber) : undefined;
      if (existing) {
        existing.count += 1;
        existing.lastSeen = Math.max(existing.lastSeen, recency);
      } else {
        stats.set(s.id, { name: s.name, number: shirtNumber, group: posGroupFm(s.usualPlayingPositionId), count: 1, lastSeen: recency });
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
    ...midSegments.map((count) => ({ group: 'M' as PosGroup, count })),
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
