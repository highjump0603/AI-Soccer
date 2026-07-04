export const LEAGUES = ['전체', '프리미어리그', '라리가', '분데스리가', '세리에A', 'K리그1', '국가대표'];
export const LEAGUE_OPTIONS = LEAGUES.filter((l) => l !== '전체');

export function confidenceMeta(level) {
  if (level === 'high') return { label: '높음', variant: 'success' };
  if (level === 'low') return { label: '낮음', variant: 'warning' };
  return { label: '보통', variant: 'default' };
}

// Which of home/draw/away has the highest predicted probability — used to
// highlight that segment of the probability bar and its label.
export function maxProbKey(prob) {
  if (prob.home >= prob.draw && prob.home >= prob.away) return 'home';
  if (prob.draw >= prob.away) return 'draw';
  return 'away';
}
