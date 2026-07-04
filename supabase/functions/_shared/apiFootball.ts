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

// A team's most recent finished matches, across all competitions — the raw
// material for "form". Free plans reject the `last` convenience param
// ("Free plans do not have access to the Last parameter"), so instead pull
// a wide date window and sort/slice client-side, same trick as
// getFixturesByDate uses for fixture discovery. Passing `team` without
// `league` also requires `season` ("The Season field is required."), and
// since league season-year conventions differ (Aug-May vs. calendar-year),
// query the current and previous year as separate season values and merge
// - whichever one actually covers the team's competition will return rows,
// the other comes back empty and is ignored.
export async function getTeamRecentResults(teamId: number, count = 10) {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86400000);
  const seasons = [to.getFullYear(), to.getFullYear() - 1];
  const perSeason = await Promise.all(
    seasons.map((season) =>
      afGet('/fixtures', { team: teamId, season, from: toDateParam(from), to: toDateParam(to) }).catch(() => [] as unknown[])
    )
  );
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

export type AfLineup = {
  team: { id: number; name: string };
  formation?: string;
  startXI: { player: { id: number; name: string; pos?: string } }[];
  substitutes?: { player: { id: number; name: string; pos?: string } }[];
};

// Only populated once a club releases it — usually within ~1h of kickoff.
// Empty response before that; callers should treat [] as "not out yet".
export async function getLineups(fixtureId: number) {
  return (await afGet('/fixtures/lineups', { fixture: fixtureId })) as AfLineup[];
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
