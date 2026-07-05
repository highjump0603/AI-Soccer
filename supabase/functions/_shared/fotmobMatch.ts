// FotMob has no relationship to API-Football's numeric IDs, so migrating
// existing teams/fixtures rows means re-deriving FotMob's own IDs by
// matching on team name + date instead. Best-effort: normalized-string
// comparison plus a small alias table for known naming mismatches (K
// League clubs in particular tend to differ between sources). A failed
// match should be logged and skipped, never silently guessed at.
import type { FmMatch, FmTeamRef } from './fotmob.ts';

// Known name mismatches between our existing team names (API-Football's
// naming) and FotMob's naming. The K League entries below were confirmed
// against live FotMob search results during backfill (several K League
// clubs have been re-sponsored/rebranded — e.g. "Jeju United" -> "Jeju SK",
// "Ulsan Hyundai" -> "Ulsan HD" — and FotMob tracks the current name only).
// The EPL/La Liga/Bundesliga entries are common short-name guesses, not
// individually confirmed — verify if they come up unmatched.
const NAME_ALIASES: Record<string, string> = {
  'manchester united': 'man united',
  'manchester city': 'man city',
  'wolverhampton wanderers': 'wolves',
  'brighton & hove albion': 'brighton',
  'paris saint germain': 'psg',
  'paris saint-germain': 'psg',
  'bayern munich': 'bayern münchen',
  'borussia dortmund': 'dortmund',
  'daejeon citizen': 'daejeon hana citizen',
  'jeonbuk motors': 'jeonbuk hyundai motors fc',
  'gimcheon sangmu fc': 'gimcheon sangmu',
  'jeju united fc': 'jeju sk',
  'ulsan hyundai fc': 'ulsan hd fc',
};

function normalize(name: string): string {
  const lower = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_ALIASES[lower] ?? lower;
}

// Finds the best FotMob team match for a given team name among a list of
// candidates (e.g. all teams appearing in a day's fixtures). Returns null
// if nothing looks like a confident match — callers should log this as a
// manual-review case rather than picking the closest guess.
export function matchTeamByName<T extends FmTeamRef>(candidates: T[], targetName: string): T | null {
  const target = normalize(targetName);
  const exact = candidates.find((c) => normalize(c.name) === target);
  if (exact) return exact;

  // Loose fallback: one name contains the other (handles "Newcastle" vs
  // "Newcastle United", "K리그" club short names, etc).
  const loose = candidates.find((c) => {
    const cn = normalize(c.name);
    return cn.includes(target) || target.includes(cn);
  });
  return loose ?? null;
}

// Finds the FotMob match whose two team names (in either order) both match
// homeName/awayName and whose kickoff time falls within toleranceHours of
// kickoffAt. Used to resolve a FotMob matchId for an existing fixture row
// during backfill.
export function matchFixtureByTeamsAndDate(
  fmMatches: FmMatch[],
  homeName: string,
  awayName: string,
  kickoffAt: string,
  toleranceHours = 6
): FmMatch | null {
  const home = normalize(homeName);
  const away = normalize(awayName);
  const kickoffMs = new Date(kickoffAt).getTime();
  const toleranceMs = toleranceHours * 60 * 60 * 1000;

  const candidates = fmMatches.filter((m) => {
    const mh = normalize(m.home.name);
    const ma = normalize(m.away.name);
    const sameOrder = mh === home || mh.includes(home) || home.includes(mh);
    const sameOrderAway = ma === away || ma.includes(away) || away.includes(ma);
    return sameOrder && sameOrderAway;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple name matches (rare, e.g. cup replays same day) — pick the one
  // closest in kickoff time, but only if within tolerance. Use
  // status.utcTime, not the match's `time` field (confirmed NOT to be UTC
  // — see fotmob.ts's FmMatch doc comment).
  let best: FmMatch | null = null;
  let bestDelta = Infinity;
  for (const c of candidates) {
    if (!c.status?.utcTime) continue;
    const t = new Date(c.status.utcTime).getTime();
    const delta = Math.abs(t - kickoffMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  return bestDelta <= toleranceMs ? best : null;
}
