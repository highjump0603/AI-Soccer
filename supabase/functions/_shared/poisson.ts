// Statistical scoreline model — a standard independent-Poisson approach
// (the same family as the well-known Dixon-Coles model, without its low-
// score correlation correction, which needs a full league's worth of
// fixtures to fit reliably). Expected goals for each side come from the
// two teams' recent scoring/conceding rates; those combine into a
// Home-goals x Away-goals probability grid, which is then summed into
// win/draw/win probabilities and the single most likely scoreline.

// xg_for/xg_against are optional real xG figures for a past match (from
// FotMob's match-stats feed, see _shared/fotmob.ts's getMatchStats) — when
// present, averageGoalsFor/averageGoalsAgainst prefer them over the raw
// goals_for/against, since actual quality-of-chances is a less noisy
// predictor of future scoring than the noisy actual goal count from a
// single match. Not every past match will have xG available (very recent
// matches not yet stats-enriched, or competitions FotMob doesn't track
// stats for), so this is a best-effort enhancement, not a requirement —
// goals_for/against remain the fallback.
export type RecentResult = { venue: 'home' | 'away'; goals_for: number; goals_against: number; xg_for?: number; xg_against?: number };

// Baseline used when a team has no cached recent results yet (newly
// tracked club) so the model degrades to "average team" instead of NaN.
const FALLBACK_GOALS_FOR = { home: 1.4, away: 1.1 };
const FALLBACK_GOALS_AGAINST = { home: 1.1, away: 1.4 };

function average(nums: number[], fallback: number) {
  if (nums.length === 0) return fallback;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function splitByVenue(results: RecentResult[], venue: 'home' | 'away') {
  return results.filter((r) => r.venue === venue);
}

export function averageGoalsFor(results: RecentResult[], venue: 'home' | 'away') {
  const venueResults = splitByVenue(results, venue);
  const source = venueResults.length >= 3 ? venueResults : results;
  return average(
    source.map((r) => r.xg_for ?? r.goals_for),
    FALLBACK_GOALS_FOR[venue]
  );
}

export function averageGoalsAgainst(results: RecentResult[], venue: 'home' | 'away') {
  const venueResults = splitByVenue(results, venue);
  const source = venueResults.length >= 3 ? venueResults : results;
  return average(
    source.map((r) => r.xg_against ?? r.goals_against),
    FALLBACK_GOALS_AGAINST[venue]
  );
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonPmf(k: number, lambda: number) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export function buildScoreMatrix(xgHome: number, xgAway: number, maxGoals = 6) {
  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      row.push(poissonPmf(h, xgHome) * poissonPmf(a, xgAway));
    }
    matrix.push(row);
  }
  return matrix;
}

export function summarizeMatrix(matrix: number[][]) {
  let probHome = 0;
  let probDraw = 0;
  let probAway = 0;
  let bestHomeP = -1;
  let bestHomeScore = { home: 1, away: 0 };
  let bestDrawP = -1;
  let bestDrawScore = { home: 0, away: 0 };
  let bestAwayP = -1;
  let bestAwayScore = { home: 0, away: 1 };

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      if (h > a) {
        probHome += p;
        if (p > bestHomeP) {
          bestHomeP = p;
          bestHomeScore = { home: h, away: a };
        }
      } else if (h === a) {
        probDraw += p;
        if (p > bestDrawP) {
          bestDrawP = p;
          bestDrawScore = { home: h, away: a };
        }
      } else {
        probAway += p;
        if (p > bestAwayP) {
          bestAwayP = p;
          bestAwayScore = { home: h, away: a };
        }
      }
    }
  }

  const total = probHome + probDraw + probAway;
  const probs = { home: (probHome / total) * 100, draw: (probDraw / total) * 100, away: (probAway / total) * 100 };

  // Pick the most likely single scoreline within whichever outcome (win/draw/
  // loss) has the highest aggregate probability, rather than the single
  // highest-probability cell in the whole matrix. The latter tends to land
  // on a low, symmetric score like 1-1 even when one side's win probability
  // is clearly highest, because winning scorelines (2-1, 3-1, 2-0, ...) split
  // probability mass across more cells than the draw column does - so the
  // headline score and the win/draw/loss split could contradict each other.
  let bestScore: { home: number; away: number };
  if (probs.home >= probs.draw && probs.home >= probs.away) bestScore = bestHomeScore;
  else if (probs.draw >= probs.away) bestScore = bestDrawScore;
  else bestScore = bestAwayScore;

  return {
    probHome: probs.home,
    probDraw: probs.draw,
    probAway: probs.away,
    scoreHome: bestScore.home,
    scoreAway: bestScore.away,
  };
}

// `lineupStrength` is a soft multiplier (clamp roughly [0.85, 1.05]) — see
// computeLineupStrength() — applied to a team's attack expected goals to
// reflect missing/rotated starters without needing a proper player-rating
// dataset.
export function runPoissonModel(params: {
  homeRecent: RecentResult[];
  awayRecent: RecentResult[];
  h2h: { homeGoals: number; awayGoals: number }[];
  // How much weight the H2H average gets vs. the form-derived xG, 0-1.
  // Callers scale this down when the current lineups have little overlap
  // with the squads from that H2H history (see computeLineupOverlapRatio in
  // _shared/matchMapping.ts) — an old meeting between mostly-different
  // squads is weaker evidence than a recent one with the same core players.
  h2hWeight?: number;
  homeLineupStrength?: number;
  awayLineupStrength?: number;
}) {
  const homeAttack = averageGoalsFor(params.homeRecent, 'home');
  const awayDefense = averageGoalsAgainst(params.awayRecent, 'away');
  const awayAttack = averageGoalsFor(params.awayRecent, 'away');
  const homeDefense = averageGoalsAgainst(params.homeRecent, 'home');

  let xgHome = (homeAttack + awayDefense) / 2;
  let xgAway = (awayAttack + homeDefense) / 2;

  if (params.h2h.length > 0) {
    const w = params.h2hWeight ?? 0.15;
    const h2hHomeAvg = average(params.h2h.map((m) => m.homeGoals), xgHome);
    const h2hAwayAvg = average(params.h2h.map((m) => m.awayGoals), xgAway);
    xgHome = xgHome * (1 - w) + h2hHomeAvg * w;
    xgAway = xgAway * (1 - w) + h2hAwayAvg * w;
  }

  xgHome *= params.homeLineupStrength ?? 1;
  xgAway *= params.awayLineupStrength ?? 1;

  // Poisson blows up for absurd inputs (bad data, 10-0 aggregated flukes) —
  // clamp to a sane football range.
  xgHome = Math.min(Math.max(xgHome, 0.3), 4);
  xgAway = Math.min(Math.max(xgAway, 0.3), 4);

  const matrix = buildScoreMatrix(xgHome, xgAway);
  const summary = summarizeMatrix(matrix);

  return { xgHome, xgAway, ...summary };
}

// Rough proxy for "is this the club's first-choice XI or a weakened one":
// what fraction of the given lineup's players also appear in the team's
// own recent-results-linked squad activity. We don't have a player-rating
// dataset, so this only nudges expected goals a little, never dominates
// the form/H2H signal above.
export function computeLineupStrength(startersConsideredKey: number, totalStarters: number) {
  if (totalStarters === 0) return 1;
  const ratio = startersConsideredKey / totalStarters;
  // ratio 1.0 (full strength) -> 1.02, ratio 0.5 (half the regulars missing) -> ~0.88
  return Math.min(1.05, Math.max(0.85, 0.85 + ratio * 0.2));
}
