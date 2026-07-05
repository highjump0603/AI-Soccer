// Reference expected-goals helpers — GPT is the sole predictor now (see
// _shared/openai.ts / predict-due), but it's given a "참고용 기대득점" hint
// derived from recent scoring/conceding rates the same way the old
// standalone Poisson model computed its own xG, since a raw text prompt of
// "team scored 2, 1, 3 in its last matches" is a weaker signal than a
// pre-averaged number for GPT to anchor on.

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
// tracked club) so the reference figure degrades to "average team" instead
// of NaN.
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
