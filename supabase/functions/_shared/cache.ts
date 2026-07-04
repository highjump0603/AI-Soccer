import type { AfFixture, AfLineup } from './apiFootball.ts';
import { getSupabaseAdmin } from './supabaseAdmin.ts';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

// Best-effort cache of a team's match log — used for the player-meeting
// cross-reference and as a record of what the model saw. Failures here
// shouldn't fail the whole prediction, so callers should swallow errors.
export async function cacheTeamRecentResults(supabase: Supabase, teamRowId: number, teamApiId: number, afFixtures: AfFixture[]) {
  const rows = afFixtures
    .filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
    .map((f) => {
      const isHome = f.teams.home.id === teamApiId;
      const opponent = isHome ? f.teams.away : f.teams.home;
      const goalsFor = (isHome ? f.goals.home : f.goals.away) ?? 0;
      const goalsAgainst = (isHome ? f.goals.away : f.goals.home) ?? 0;
      return {
        team_id: teamRowId,
        api_football_fixture_id: f.fixture.id,
        played_at: f.fixture.date,
        opponent_name: opponent.name,
        venue: isHome ? 'home' : 'away',
        goals_for: goalsFor,
        goals_against: goalsAgainst,
        result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
        competition: f.league.name,
      };
    });
  if (rows.length === 0) return;
  await supabase.from('team_recent_results').upsert(rows, { onConflict: 'team_id,api_football_fixture_id' });
}

const STATUS_MAP: Record<string, string> = {
  NS: 'scheduled',
  TBD: 'scheduled',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'cancelled',
};

// Upserts a team + fixture row for an arbitrary API-Football fixture (used
// to bring a past head-to-head match into our `fixtures` table so its
// lineup rows have somewhere to point their foreign key at). Returns our
// internal fixture row id.
export async function ensureFixtureRow(supabase: Supabase, af: AfFixture, leagueLabel: string) {
  const upsertTeam = async (team: { id: number; name: string; logo?: string }) => {
    const { data, error } = await supabase
      .from('teams')
      .upsert({ api_football_id: team.id, name: team.name, logo_url: team.logo }, { onConflict: 'api_football_id' })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const homeId = await upsertTeam(af.teams.home);
  const awayId = await upsertTeam(af.teams.away);

  const { data, error } = await supabase
    .from('fixtures')
    .upsert(
      {
        api_football_fixture_id: af.fixture.id,
        api_football_league_id: af.league.id,
        league: leagueLabel,
        season: af.league.season,
        kickoff_at: af.fixture.date,
        venue: af.fixture.venue?.name ?? null,
        status: STATUS_MAP[af.fixture.status.short] ?? 'finished',
        home_team_id: homeId,
        away_team_id: awayId,
        home_score_actual: af.goals.home,
        away_score_actual: af.goals.away,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'api_football_fixture_id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function upsertPlayerAndLineup(
  supabase: Supabase,
  fixtureRowId: number,
  teamRowId: number,
  lineup: AfLineup,
  source: 'predicted' | 'confirmed'
) {
  for (const entry of lineup.startXI) {
    const { data: playerRow, error: playerErr } = await supabase
      .from('players')
      .upsert(
        { api_football_id: entry.player.id, name: entry.player.name, team_id: teamRowId, position: entry.player.pos ?? null },
        { onConflict: 'api_football_id' }
      )
      .select('id')
      .single();
    if (playerErr) throw playerErr;

    await supabase.from('lineups').upsert(
      {
        fixture_id: fixtureRowId,
        team_id: teamRowId,
        player_id: playerRow.id,
        is_starting: true,
        source,
        captured_at: new Date().toISOString(),
      },
      { onConflict: 'fixture_id,team_id,player_id' }
    );
  }
}
