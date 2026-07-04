// Tracked competitions — API-Football league IDs. These are the widely-
// documented, stable IDs for the major leagues; the two national-team
// entries are more likely to need adjusting for your API-Football plan's
// actual access, since "국가대표" spans many different competitions
// (friendlies, various confederations' qualifiers, tournaments). Verify
// against GET /leagues once you have live access — this file couldn't be
// tested against the live API from the build environment (no outbound
// network access there).
export const TRACKED_LEAGUES: { id: number; name: string; calendarYearSeason?: boolean }[] = [
  { id: 39, name: '프리미어리그' },
  { id: 140, name: '라리가' },
  { id: 78, name: '분데스리가' },
  { id: 135, name: '세리에A' },
  { id: 292, name: 'K리그1', calendarYearSeason: true },
  { id: 1, name: '월드컵' },
  { id: 10, name: '국가대표' },
];

export function seasonForLeague(league: { calendarYearSeason?: boolean }, now = new Date()) {
  const year = now.getUTCFullYear();
  if (league.calendarYearSeason) return year;
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}
