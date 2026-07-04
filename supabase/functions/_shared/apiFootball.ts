// Thin client for API-Football v3 (https://www.api-football.com/documentation-v3).
// Every call goes through afGet so the key and base URL live in one place.

const BASE_URL = 'https://v3.football.api-sports.io';

async function afGet(path: string, params: Record<string, string | number>) {
  const key = Deno.env.get('API_FOOTBALL_KEY');
  if (!key) throw new Error('API_FOOTBALL_KEY secret is not set for this function.');

  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, { headers: { 'x-apisports-key': key } });
  if (!res.ok) {
    throw new Error(`API-Football ${path} failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors && Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors || {}).length) {
    throw new Error(`API-Football ${path} returned errors: ${JSON.stringify(json.errors)}`);
  }
  return json.response as unknown[];
}

export type AfFixture = {
  fixture: { id: number; date: string; venue?: { name?: string }; status: { short: string } };
  league: { id: number; name: string; season: number };
  teams: {
    home: { id: number; name: string; logo?: string; winner: boolean | null };
    away: { id: number; name: string; logo?: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
};

// All fixtures worldwide on a single calendar date — used by sync-leagues to
// discover what to track. Deliberately NOT `league+season+next`: on the free
// API-Football plan that combination is rejected outright ("Free plans do
// not have access to this season"), but a plain `date=` lookup for a
// near-term date works even on the free plan (confirmed against the live
// API — it appears to only reject season-archive-style browsing, not
// single-date lookups). Callers filter the result down to tracked leagues
// themselves. If you're on a paid plan with full season access, this still
// works fine, just less efficient than one `league+season+next` call.
export async function getFixturesByDate(dateStr: string) {
  return (await afGet('/fixtures', { date: dateStr })) as AfFixture[];
}

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function toDateParam(d: Date) {
  return d.toISOString().slice(0, 10);
}

function mostRecentFinished(fixtures: AfFixture[], count: number) {
  return fixtures
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
    .slice(0, count);
}

// This project's specific free-plan key currently rejects season=2025/2026
// outright ("Free plans do not have access to this season, try from 2022 to
// 2024" - confirmed against the live API), even though it happily accepts a
// plain date=/from+to lookup with no season at all (see getFixturesByDate).
// So alongside the current/previous year (in case the plan's allowed range
// moves forward later), always also try the newest season we know the plan
// accepts. Whichever attempt(s) actually return rows win; mostRecentFinished
// sorts by date after merging, so fresher data always takes priority over
// this stale fallback once/if the plan opens up.
const FREE_PLAN_FALLBACK_SEASON = 2024;

// A team's most recent finished matches, across all competitions — the raw
// material for "form". Free plans reject the `last` convenience param
// ("Free plans do not have access to the Last parameter"), so instead pull
// the whole season and sort/slice client-side. Passing `team` without
// `league` also requires `season` ("The Season field is required."). No
// from/to window here deliberately — a season is already a small, cheap
// result set on its own, and combining it with a "last 365 days" range would
// exclude the FREE_PLAN_FALLBACK_SEASON entirely (that season's matches
// happened well outside any recent window by definition).
export async function getTeamRecentResults(teamId: number, count = 10) {
  const seasons = [...new Set([new Date().getFullYear(), new Date().getFullYear() - 1, FREE_PLAN_FALLBACK_SEASON])];
  const perSeason = await Promise.all(seasons.map((season) => afGet('/fixtures', { team: teamId, season }).catch(() => [] as unknown[])));
  return mostRecentFinished(perSeason.flat() as AfFixture[], count);
}

// Past meetings between two clubs, most recent first. Same free-plan `last`
// restriction as getTeamRecentResults, worked around the same way.
export async function getHeadToHead(teamAId: number, teamBId: number, count = 10) {
  const to = new Date();
  const from = new Date(to.getTime() - 5 * 365 * 86400000);
  const fixtures = (await afGet('/fixtures/headtohead', {
    h2h: `${teamAId}-${teamBId}`,
    from: toDateParam(from),
    to: toDateParam(to),
  })) as AfFixture[];
  return mostRecentFinished(fixtures, count);
}

export type AfStanding = {
  rank: number;
  team: { id: number; name: string; logo?: string };
  points: number;
  form?: string;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
};

// League table for one competition. Same season restriction as
// getTeamRecentResults (this plan only allows 2022-2024 right now), worked
// around the same way — try the current/previous year, and fall back to the
// newest season the plan does allow.
export async function getStandings(leagueId: number): Promise<{ season: number; rows: AfStanding[] }> {
  const seasons = [...new Set([new Date().getFullYear(), new Date().getFullYear() - 1, FREE_PLAN_FALLBACK_SEASON])];
  for (const season of seasons) {
    try {
      const response = (await afGet('/standings', { league: leagueId, season })) as { league: { standings: AfStanding[][] } }[];
      const rows = response[0]?.league?.standings?.flat() ?? [];
      if (rows.length > 0) return { season, rows };
    } catch {
      // try the next season
    }
  }
  return { season: seasons[0], rows: [] };
}

export type AfLineup = {
  team: { id: number; name: string };
  formation?: string;
  // `grid` is API-Football's "row:col" pitch position (e.g. "2:3"), row 1 =
  // goalkeeper end increasing toward attack — null for substitutes.
  startXI: { player: { id: number; name: string; number?: number; pos?: string; grid?: string | null } }[];
  substitutes?: { player: { id: number; name: string; pos?: string } }[];
};

// Only populated once a club releases it — usually within ~1h of kickoff.
// Empty response before that; callers should treat [] as "not out yet".
export async function getLineups(fixtureId: number) {
  return (await afGet('/fixtures/lineups', { fixture: fixtureId })) as AfLineup[];
}

// A team's actual starting lineup from each of its last few matches — the
// raw material for estimating who's likely to start before the club's own
// lineup is out. Best-effort: older fixtures don't always have lineup data
// on the free plan, callers should treat a short/empty result as "not
// enough signal" rather than an error.
export async function getTeamLastLineups(teamApiId: number, count = 3) {
  const recentFixtures = await getTeamRecentResults(teamApiId, count);
  const lineupsPerFixture = await Promise.all(
    recentFixtures.map((f) => getLineups(f.fixture.id).catch(() => [] as AfLineup[]))
  );
  return lineupsPerFixture
    .map((ls) => ls.find((l) => l.team.id === teamApiId))
    .filter((l): l is AfLineup => !!l);
}

type AfInjuryEntry = { player: { id: number }; fixture?: { date?: string } };

// Players currently injured or suspended (API-Football's /injuries feed
// covers both under one endpoint). Only counts entries tied to a fixture
// within the last 3 weeks as still-relevant — the feed doesn't say when
// someone recovers, so older entries are more likely stale than useful.
// Note: unlike getTeamRecentResults, there's no stale-season fallback worth
// adding here — this endpoint needs the *current* season specifically (an
// old season's injuries are outside the 21-day relevance window anyway), so
// on this plan's current 2022-2024 restriction it will simply come back
// empty until that range moves forward. Safe default: nobody gets excluded.
export async function getUnavailablePlayerIds(teamApiId: number) {
  const seasons = [new Date().getFullYear(), new Date().getFullYear() - 1];
  const perSeason = await Promise.all(
    seasons.map((season) => afGet('/injuries', { team: teamApiId, season }).catch(() => [] as unknown[]))
  );
  const cutoff = Date.now() - 21 * 86400000;
  const ids = new Set<number>();
  for (const entry of perSeason.flat() as AfInjuryEntry[]) {
    const fixtureDate = entry.fixture?.date ? new Date(entry.fixture.date).getTime() : 0;
    if (fixtureDate >= cutoff && entry.player?.id) ids.add(entry.player.id);
  }
  return ids;
}

type AfOdds = {
  bookmakers: { id: number; name: string; bets: { name: string; values: { value: string; odd: string }[] }[] }[];
};

// Averages the "Match Winner" market across whichever bookmakers the API
// returns for this fixture. Not available for every fixture/plan tier —
// callers should treat a null return as "no odds available" rather than an error.
export async function getAverageMatchWinnerOdds(fixtureId: number) {
  const response = (await afGet('/odds', { fixture: fixtureId })) as AfOdds[];
  const bookmakers = response[0]?.bookmakers ?? [];
  const home: number[] = [];
  const draw: number[] = [];
  const away: number[] = [];
  for (const bm of bookmakers) {
    const market = bm.bets.find((b) => b.name === 'Match Winner');
    if (!market) continue;
    for (const v of market.values) {
      const odd = Number(v.odd);
      if (!Number.isFinite(odd)) continue;
      if (v.value === 'Home') home.push(odd);
      else if (v.value === 'Draw') draw.push(odd);
      else if (v.value === 'Away') away.push(odd);
    }
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const result = { home: avg(home), draw: avg(draw), away: avg(away) };
  if (result.home == null || result.draw == null || result.away == null) return null;
  return result as { home: number; draw: number; away: number };
}
