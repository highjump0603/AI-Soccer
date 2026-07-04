import { buildScoreMatrix, summarizeMatrix } from './poisson.ts';

export type OutcomeProbs = { home: number; draw: number; away: number };

function topOutcome(p: OutcomeProbs): 'home' | 'draw' | 'away' {
  if (p.home >= p.draw && p.home >= p.away) return 'home';
  if (p.draw >= p.away) return 'draw';
  return 'away';
}

const STAT_WEIGHT = 0.65;
const GPT_WEIGHT = 0.35;

// Blends the two models at the expected-goals level (treating GPT's point
// score estimate as its implied expected goals) and re-runs the Poisson
// summary on the blended xG, so the final score and final probabilities
// come from the same distribution instead of being two numbers stitched
// together after the fact.
export function ensemblePredictions(params: {
  statXgHome: number;
  statXgAway: number;
  statProbs: OutcomeProbs;
  gptXgHome: number;
  gptXgAway: number;
  gptProbs: OutcomeProbs;
}) {
  const finalXgHome = params.statXgHome * STAT_WEIGHT + params.gptXgHome * GPT_WEIGHT;
  const finalXgAway = params.statXgAway * STAT_WEIGHT + params.gptXgAway * GPT_WEIGHT;

  const matrix = buildScoreMatrix(finalXgHome, finalXgAway);
  const summary = summarizeMatrix(matrix);
  const finalProbs: OutcomeProbs = { home: summary.probHome, draw: summary.probDraw, away: summary.probAway };

  const agree = topOutcome(params.statProbs) === topOutcome(params.gptProbs);
  const topProb = Math.max(finalProbs.home, finalProbs.draw, finalProbs.away);
  const confidence: 'high' | 'medium' | 'low' = agree && topProb >= 45 ? 'high' : agree ? 'medium' : 'low';

  return {
    finalProbs,
    finalScore: { home: summary.scoreHome, away: summary.scoreAway },
    confidence,
  };
}
