// Thin client for FotMob's unofficial JSON API (no official docs, no API
// key — this is the same endpoint the fotmob.com website itself calls).
// Confirmed live (against real matches) during development: all three
// endpoints below return plain JSON with nothing more than a `User-Agent`
// header — no anti-bot challenge / signed-header requirement observed at
// that time. That could change without notice since this is unofficial;
// callers should treat a non-JSON/failed response as "source unavailable"
// rather than assuming permanent uptime.
//
// Unlike API-Football, FotMob has no free-plan season/date restrictions
// observed, and a single `matchDetails` call returns lineup + head-to-head
// + team form + full stat breakdown together — callers should fetch it
// once per fixture and slice out of that one response instead of making
// several narrower calls.

const BASE_URL = 'https://www.fotmob.com/api/data';

async function fmGet(path: string, params: Record<string, string | number>) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  if (!res.ok) {
    throw new Error(`FotMob ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export type FmTeamRef = { id: number; name: string; score?: number };

// Team name -> FotMob team id lookup, used only for one-time identity
// backfill (matching existing DB rows to FotMob ids by name) — not part of
// the steady-state sync path, which upserts directly by fotmob_id once a
// team is known. Confirmed live: this hits a different host
// (apigw.fotmob.com, not www.fotmob.com/api/data) than every other
// function in this file.
export async function searchTeam(term: string): Promise<{ id: number; name: string }[]> {
  const url = new URL('https://apigw.fotmob.com/searchapi/suggest');
  url.searchParams.set('term', term);
  url.searchParams.set('lang', 'en');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } });
  if (!res.ok) throw new Error(`FotMob team search failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { teamSuggest?: { options?: { text: string }[] }[] };
  const options = json.teamSuggest?.[0]?.options ?? [];
  return options
    .map((o) => {
      const m = o.text.match(/^(.*)\|(\d+)$/);
      return m ? { name: m[1], id: Number(m[2]) } : null;
    })
    .filter((x): x is { id: number; name: string } => x !== null);
}

// Confirmed shape (GET /matches?date=): status.reason.short is a
// short status code much like API-Football's fixture.status.short (e.g.
// "FT" for finished) — check `started`/`finished`/`cancelled` booleans for
// unambiguous state instead of relying on the code alone.
//
// IMPORTANT: `time` is NOT UTC — confirmed against live data it's off from
// `status.utcTime` by the CEST offset (FotMob renders it in Central
// European time, not the viewer's or match's local time). Always use
// `status.utcTime` for kickoff comparisons; `time` is display-only.
// IMPORTANT: `leagueId` on an individual match is a per-season/per-edition
// "tournament instance" id (confirmed live: K League 1 was grouped under
// 919356 in July 2026's daily feed, NOT its stable id 9080 — World Cup
// finals similarly group under a tournament-instance id like 894789, not
// 77). This rotates and should never be used to match against a hardcoded
// tracked-league id. `primaryLeagueId` is the STABLE id (same one
// GET /leagues?id= and this project's TRACKED_LEAGUES use) — it comes from
// the enclosing league group's `primaryId` field in the /matches response,
// not from the match object itself. For leagues FotMob doesn't rotate
// (most smaller/domestic ones), primaryId just equals the group id, so this
// is safe to use uniformly instead of `leagueId`.
export type FmMatch = {
  id: number;
  leagueId: number;
  primaryLeagueId: number;
  time: string; // "DD.MM.YYYY HH:mm" in CEST — display only, do not use for date math
  home: FmTeamRef;
  away: FmTeamRef;
  status?: {
    utcTime?: string; // ISO 8601 UTC — use this for kickoff time
    finished?: boolean;
    started?: boolean;
    cancelled?: boolean;
    scoreStr?: string;
    reason?: { short?: string; long?: string };
  };
};

// All matches worldwide on a single calendar date, grouped by league — the
// fixture-discovery endpoint (replaces API-Football's getFixturesByDate).
// dateStr must be FotMob's own YYYYMMDD format, not ISO YYYY-MM-DD.
export async function getFixturesByDate(dateStr: string): Promise<FmMatch[]> {
  const json = (await fmGet('/matches', { date: dateStr }).catch(() => null)) as {
    leagues?: { id: number; primaryId?: number; matches?: FmMatch[] }[];
  } | null;
  const leagues = json?.leagues ?? [];
  return leagues.flatMap((l) =>
    (l.matches ?? []).map((m) => ({ ...m, leagueId: m.leagueId ?? l.id, primaryLeagueId: l.primaryId ?? l.id }))
  );
}

// Confirmed shape (GET /leagues?id=47): table[N].data.table.{all,home,away}.
// `scoresStr` is a combined "3-1" string, not separate for/against fields —
// parse it at the read layer if numeric goals-for/against are needed.
export type FmStandingRow = {
  id: number;
  name: string;
  shortName?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  scoresStr: string; // e.g. "42-18" (goals for - goals against)
  pts: number;
  idx: number; // rank, 1-based
};

export type FmLeagueTable = { leagueName: string; season: string | null; groups: { leagueName: string; rows: FmStandingRow[] }[] };

// League table for one competition. FotMob can split a competition into
// multiple table entries (confirmed: `table` is an array; each entry's
// leagueName can differ, e.g. regular season vs. championship/relegation
// round) — callers should apply the same de-dup-by-team pattern the old
// getStandings caller used for API-Football's split rounds.
export async function getLeagueTable(fotmobLeagueId: number): Promise<FmLeagueTable> {
  const json = (await fmGet('/leagues', { id: fotmobLeagueId }).catch(() => null)) as {
    details?: { name?: string };
    allAvailableSeasons?: string[];
    table?: { data?: { leagueName?: string; table?: { all?: FmStandingRow[] } } }[];
  } | null;
  const leagueName = json?.details?.name ?? '';
  const season = json?.allAvailableSeasons?.[0] ?? null;
  const tableEntries = json?.table ?? [];
  const groups = tableEntries
    .map((entry) => ({ leagueName: entry?.data?.leagueName ?? leagueName, rows: entry?.data?.table?.all ?? [] }))
    .filter((g) => g.rows.length > 0);
  return { leagueName, season, groups };
}

// usualPlayingPositionId is the stable G/D/M/F indicator (0=GK, 1=DF,
// 2=MF, 3=FW, confirmed against real lineups) — `positionId` by contrast
// encodes the specific formation slot for this match (varies per formation)
// and should NOT be used for position-group bucketing.
// A team's own match history (past and upcoming), independent of any
// specific fixture context — resolves the gap noted elsewhere in this file
// where matchFacts.teamForm only exists inside an already-known match's
// details. Confirmed live: GET /teams?id=<id> returns `fixtures.allFixtures
// .fixtures[]` with the same home/away/status shape as getFixturesByDate,
// so this is the direct replacement for API-Football's
// getTeamRecentResults — sort/filter/slice client-side same as before.
export async function getTeamFixtures(fotmobTeamId: number): Promise<FmMatch[]> {
  const json = (await fmGet('/teams', { id: fotmobTeamId }).catch(() => null)) as {
    fixtures?: { allFixtures?: { fixtures?: (FmMatch & { home: FmTeamRef; away: FmTeamRef })[] } };
  } | null;
  return json?.fixtures?.allFixtures?.fixtures ?? [];
}

// Most recent finished matches from a getTeamFixtures()/getFixturesByDate()
// result, newest first — same "most recent N finished games" contract as
// API-Football's mostRecentFinished helper had.
export function mostRecentFinished(matches: FmMatch[], count: number): FmMatch[] {
  return matches
    .filter((m) => m.status?.finished)
    .sort((a, b) => new Date(b.status?.utcTime ?? 0).getTime() - new Date(a.status?.utcTime ?? 0).getTime())
    .slice(0, count);
}

export type FmLineupPlayer = {
  id: number;
  name: string;
  positionId?: number;
  usualPlayingPositionId?: number;
  shirtNumber?: string | number;
  horizontalLayout?: { x: number; y: number; height?: number; width?: number };
};

export type FmUnavailablePlayer = {
  id: number;
  name: string;
  unavailability?: { injuryId?: number; type?: string; expectedReturn?: string };
};

export type FmTeamLineup = {
  id: number;
  name: string;
  formation?: string;
  starters: FmLineupPlayer[];
  subs?: FmLineupPlayer[];
  // Injured/suspended players for THIS match's context — confirmed present
  // on real lineup payloads (field name is `unavailable`, not documented
  // anywhere). This is scoped to one specific match, not a standalone
  // "team's current injury list" feed the way API-Football's /injuries
  // was, so it's only known for fixtures where lineups have already been
  // fetched — same availability window as the lineup itself.
  unavailable?: FmUnavailablePlayer[];
};

export type FmStatEntry = {
  key: string;
  title: string;
  stats: [string | number, string | number];
  format?: string;
  type?: string;
};

export type FmH2hMatch = {
  time?: { utcTime?: string };
  league?: { id?: string | number; name?: string };
  home: { id: string | number; name: string };
  away: { id: string | number; name: string };
  status?: { scoreStr?: string; finished?: boolean };
};

export type FmMatchDetails = {
  // NOTE: `matchTimeUTC` is a human-readable string ("Sat, Jul 4, 2026,
  // 21:00 UTC"), NOT a parseable ISO timestamp despite the name —
  // confirmed against live data. Use `matchTimeUTCDate` for actual date
  // math (ISO 8601, e.g. "2026-07-04T21:00:00.000Z").
  general: { matchId: string; matchTimeUTC?: string; matchTimeUTCDate?: string; leagueId?: number; leagueName?: string };
  header: { teams: (FmTeamRef & { imageUrl?: string })[] };
  content: {
    stats?: { Periods?: { All?: { stats?: { title: string; key: string; stats: FmStatEntry[] }[] } } };
    // `lineupType` is "unavailable" for matches where lineups haven't been
    // published yet — confirmed live: FotMob still returns homeTeam/awayTeam
    // objects in that case, just with `formation: ""` and `starters: []`,
    // not null/undefined. Checking object presence alone isn't enough to
    // tell "no lineup yet" from "empty lineup" — see getLineups below.
    lineup?: { lineupType?: string; homeTeam?: FmTeamLineup; awayTeam?: FmTeamLineup };
    h2h?: { summary?: [number, number, number]; matches?: FmH2hMatch[] };
    matchFacts?: { teamForm?: unknown[][]; infoBox?: Record<string, unknown> };
  };
};

// The one expensive call — lineup, h2h, team form and full stat breakdown
// all live in this single response. Fetch once per fixture and slice out
// of it (see getMatchStats/getLineups/getHeadToHead/getTeamForm below)
// rather than re-fetching per concern.
export async function getMatchDetails(fotmobMatchId: number): Promise<FmMatchDetails> {
  const json = (await fmGet('/matchDetails', { matchId: fotmobMatchId }).catch(() => null)) as FmMatchDetails | null;
  return {
    general: json?.general ?? {},
    header: json?.header ?? { teams: [] },
    content: json?.content ?? {},
  };
}

export type NormalizedStat = { key: string; title: string; home: string; away: string; type?: string };

// Flattens content.stats.Periods.All.stats (grouped by category, e.g. "Top
// stats" / "Shots" / "Passes") into one flat list. Match by `key`
// (e.g. "expected_goals", "BallPossesion", "total_shots") — `title` is a
// display label that can vary by locale/season and isn't safe to match on.
export function getMatchStats(details: FmMatchDetails): NormalizedStat[] {
  const sections = details.content.stats?.Periods?.All?.stats ?? [];
  return sections.flatMap((section) =>
    (section.stats ?? []).map((s) => ({
      key: s.key,
      title: s.title,
      home: String(s.stats[0]),
      away: String(s.stats[1]),
      type: s.type,
    }))
  );
}

// A team's actual starting lineup from each of its last few matches — the
// raw material for estimating who's likely to start before the club's own
// lineup is out. Unlike API-Football (one lightweight lineup-only
// endpoint), FotMob has no per-fixture lineup-only call, so this costs one
// getTeamFixtures() call plus one getMatchDetails() call per recent match —
// noticeably more expensive than the old client, so callers should keep
// `count` small. Best-effort: matches without published lineup data (older
// fixtures, or competitions FotMob didn't capture lineups for) are simply
// skipped rather than treated as an error.
export async function getTeamLastLineups(fotmobTeamId: number, count = 3): Promise<FmTeamLineup[]> {
  const recentMatches = mostRecentFinished(await getTeamFixtures(fotmobTeamId), count);
  const lineupsPerMatch = await Promise.all(
    recentMatches.map(async (m) => {
      try {
        const details = await getMatchDetails(m.id);
        const lineups = getLineups(details);
        if (!lineups) return null;
        return lineups.home.id === fotmobTeamId ? lineups.home : lineups.away;
      } catch {
        return null;
      }
    })
  );
  return lineupsPerMatch.filter((l): l is FmTeamLineup => l !== null);
}

// Player IDs unavailable (injured/suspended) as of a team's most recent
// lineup snapshot with that data present — takes the newest lineup in the
// list, not a union across several, since older snapshots' "unavailable"
// entries can be stale by the time a new fixture comes around. Returns an
// empty set if no lineup in the list carries an `unavailable` field yet.
export function getUnavailablePlayerIds(recentLineups: FmTeamLineup[]): Set<number> {
  for (const lineup of recentLineups) {
    if (lineup.unavailable && lineup.unavailable.length > 0) {
      return new Set(lineup.unavailable.map((p) => p.id));
    }
  }
  return new Set();
}

// Null before lineups are officially out (usually within ~1h of kickoff) —
// callers should treat null as "not published yet", same contract as
// API-Football's getLineups returning []. Confirmed live: FotMob still
// returns non-null homeTeam/awayTeam placeholder objects before the real
// lineup exists (lineupType: "unavailable", formation: "", starters: []),
// so object presence alone isn't a reliable signal — also require actual
// starters to be present.
export function getLineups(details: FmMatchDetails): { home: FmTeamLineup; away: FmTeamLineup } | null {
  const lineup = details.content.lineup;
  const { homeTeam, awayTeam } = lineup ?? {};
  if (!homeTeam || !awayTeam) return null;
  if (lineup?.lineupType === 'unavailable') return null;
  if (homeTeam.starters.length === 0 || awayTeam.starters.length === 0) return null;
  return { home: homeTeam, away: awayTeam };
}

// Past meetings between the two clubs in this fixture, most recent first —
// unlike API-Football's getHeadToHead(teamAId, teamBId), FotMob's h2h data
// is embedded per-match, so this takes a matchDetails result, not two team
// ids.
export function getHeadToHead(details: FmMatchDetails): FmH2hMatch[] {
  return details.content.h2h?.matches ?? [];
}

// Per-team recent form as FotMob embeds it inside a specific match's
// details. NOTE: this is only known to exist in the context of an already-
// resolved fixture (i.e. you need a FotMob matchId to get here at all) —
// there is no confirmed standalone "team's last N results" endpoint, so a
// brand-new team with no fixture history yet has no way to backfill form
// through this function alone. See _shared/fotmobMatch.ts and the project
// plan doc for how callers are expected to work around that gap.
export function getTeamForm(details: FmMatchDetails): { home: unknown[]; away: unknown[] } {
  const form = details.content.matchFacts?.teamForm ?? [];
  return { home: form[0] ?? [], away: form[1] ?? [] };
}

// Parses FotMob's "2 - 1" / "2-1" h2h scoreStr into numeric goals. Returns
// null for anything that isn't a clean "N - N" (e.g. postponed/void
// meetings use non-numeric placeholders) — callers should skip those
// rather than coercing to 0, which would silently corrupt the H2H record.
export function parseScoreStr(scoreStr: string | undefined): { home: number; away: number } | null {
  if (!scoreStr) return null;
  const m = scoreStr.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

// NOTE: matchDetails itself carries no bookmaker-odds data (confirmed by
// inspecting a full response), but a separate endpoint does:
// GET /api/data/matchOdds?matchId=<id>&ccode3=<3-letter country>&bettingProvider=<name>.
//
// Confirmed live: `bettingProvider` is NOT a free-form name — it's a
// specific per-country persistentKey (e.g. "1xBet_Kenya", "1xBet_Ghana",
// "1xBet_Uganda", "Bet9ja_Nigeria"), not just "1xBet". Passing an
// unrecognized name (e.g. plain "1xBet") returns 200 with an empty shell
// (`odds.resolvedOddsMarket: null`) rather than an error, which is
// misleading — that field is NOT where real odds live. Discovered the
// correct key by passing only `ccode3` (no bettingProvider): the endpoint
// 307-redirects to that country's default provider in the Location header
// (e.g. `ccode3=KEN` -> `bettingProvider=1xBet_Kenya`). With a real
// provider key, actual odds live at `odds.matchfactMarkets[0].selections`
// (each `{ name: "1"|"x"|"2", oddsDecimal: "1.88", ... }`) — confirmed
// against real K League and World Cup matches. ccode3=KEN is hardcoded
// here since it's confirmed to resolve to a real 1xBet key; other 1xBet
// country keys work identically if this one ever stops resolving.
export type FmOdds = { home: number; draw: number; away: number };

export async function getMatchOdds1xBet(fotmobMatchId: number): Promise<FmOdds | null> {
  const url = new URL('https://www.fotmob.com/api/data/matchOdds');
  url.searchParams.set('matchId', String(fotmobMatchId));
  url.searchParams.set('ccode3', 'KEN');
  url.searchParams.set('bettingProvider', '1xBet_Kenya');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`FotMob matchOdds failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    odds?: { matchfactMarkets?: { header?: string; selections?: { name?: string; oddsDecimal?: string }[] }[] } | null;
  } | null;
  const market = json?.odds?.matchfactMarkets?.find((m) => /match|result|1x2/i.test(m.header ?? ''));
  const selections = market?.selections ?? json?.odds?.matchfactMarkets?.[0]?.selections;
  if (!selections || selections.length < 3) return null;

  const find = (name: string) => {
    const entry = selections.find((s) => (s.name ?? '').trim().toLowerCase() === name);
    const num = entry?.oddsDecimal != null ? Number(entry.oddsDecimal) : NaN;
    return Number.isFinite(num) ? num : null;
  };
  const home = find('1');
  const draw = find('x');
  const away = find('2');
  if (home == null || draw == null || away == null) return null;
  return { home, draw, away };
}
