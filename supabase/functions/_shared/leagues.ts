// Tracked competitions — FotMob league IDs, confirmed against the live
// FotMob API (GET /api/data/leagues?id=<id>, checked its `details.name`)
// during the API-Football -> FotMob migration.
//
// "국가대표" (API-Football's generic national-team league id 10, which
// spanned friendlies/qualifiers/tournaments across many confederations)
// has no FotMob equivalent — FotMob has no single "internationals" league
// id the way API-Football did. Scope narrowed to World Cup finals only
// (id 77) rather than trying to enumerate every qualifying competition.
//
// No season field here — sync-leagues discovers fixtures by calendar date
// (see _shared/fotmob.ts: getFixturesByDate) rather than by league+season,
// and just keeps whatever season each returned fixture reports for itself.
export const TRACKED_LEAGUES: { id: number; name: string }[] = [
  { id: 47, name: '프리미어리그' },
  { id: 47, name: 'EPL' },
  { id: 87, name: '라리가' },
  { id: 87, name: 'La Liga' },
  { id: 54, name: '분데스리가' },
  { id: 54, name: 'Bundesliga' },
  { id: 55, name: '세리에A' },
  { id: 55, name: 'Serie A' },
  { id: 9080, name: 'K리그1' },
  { id: 77, name: '월드컵' },
  { id: 77, name: 'World Cup' },
  { id: 61, name: '리그앙' },
  { id: 61, name: 'Ligue 1' },
];
