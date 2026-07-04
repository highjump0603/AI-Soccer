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

// Upcoming fixtures for one league — used by sync-leagues to discover what to track.
export async function getUpcomingFixtures(leagueId: number, season: number, next = 20) {
  return (await afGet('/fixtures', { league: leagueId, season, next })) as AfFixture[];
}

// A team's most recent finished matches, across all competitions — the raw
// material for "form". `last` is capped at ~20 by the API.
export async function getTeamRecentResults(teamId: number, last = 10) {
  return (await afGet('/fixtures', { team: teamId, last })) as AfFixture[];
}

// Past meetings between two clubs, most recent first.
export async function getHeadToHead(teamAId: number, teamBId: number, last = 10) {
  return (await afGet('/fixtures/headtohead', { h2h: `${teamAId}-${teamBId}`, last })) as AfFixture[];
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
