import type { FmMatch, FmTeamLineup } from './fotmob.ts';
import { getSupabaseAdmin } from './supabaseAdmin.ts';

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const FM_GROUP_ROW: Record<string, number> = { G: 1, D: 2, M: 3, F: 4 };

function fmGroup(usualPlayingPositionId?: number): keyof typeof FM_GROUP_ROW {
  if (usualPlayingPositionId === 0) return 'G';
  if (usualPlayingPositionId === 1) return 'D';
  if (usualPlayingPositionId === 3) return 'F';
  return 'M';
}

// Best-effort cache of a team's match log — used for the player-meeting
// cross-reference and as a record of what the model saw. Failures here
// shouldn't fail the whole prediction, so callers should swallow errors.
export async function cacheTeamRecentResultsFm(supabase: Supabase, teamRowId: number, teamId: number, fmMatches: FmMatch[]) {
  const rows = fmMatches
    .filter((m) => m.status?.finished)
    .map((m) => {
      const isHome = m.home.id === teamId;
      const opponent = isHome ? m.away : m.home;
      const goalsFor = (isHome ? m.home.score : m.away.score) ?? 0;
      const goalsAgainst = (isHome ? m.away.score : m.home.score) ?? 0;
      return {
        team_id: teamRowId,
        fotmob_match_id: m.id,
        played_at: m.status?.utcTime ?? new Date().toISOString(),
        opponent_name: opponent.name,
        venue: isHome ? 'home' : 'away',
        goals_for: goalsFor,
        goals_against: goalsAgainst,
        result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
        competition: null as string | null,
      };
    });
  if (rows.length === 0) return;
  await supabase.from('team_recent_results').upsert(rows, { onConflict: 'team_id,fotmob_match_id' });
}

// Upserts a team + fixture row for an arbitrary FotMob match (used to bring
// a past head-to-head match into our `fixtures` table so its lineup rows
// have somewhere to point their foreign key at). Returns our internal
// fixture row id. Note: FotMob's h2h/matches payloads don't always carry a
// league id in the same field the way API-Football's did — callers pass a
// label explicitly.
export async function ensureFixtureRowFm(supabase: Supabase, m: FmMatch, leagueLabel: string) {
  const upsertTeam = async (team: { id: number; name: string }) => {
    const { data, error } = await supabase
      .from('teams')
      .upsert(
        { fotmob_id: team.id, name: team.name, logo_url: `https://images.fotmob.com/image_resources/logo/teamlogo/${team.id}.png` },
        { onConflict: 'fotmob_id' }
      )
      .select('id')
      .single();
    if (error) throw error;
    return data.id as number;
  };

  const homeId = await upsertTeam(m.home);
  const awayId = await upsertTeam(m.away);

  const { data, error } = await supabase
    .from('fixtures')
    .upsert(
      {
        fotmob_id: m.id,
        fotmob_league_id: m.leagueId,
        league: leagueLabel,
        season: new Date(m.status?.utcTime ?? Date.now()).getUTCFullYear(),
        kickoff_at: m.status?.utcTime ?? new Date().toISOString(),
        status: m.status?.finished ? 'finished' : m.status?.cancelled ? 'cancelled' : 'scheduled',
        home_team_id: homeId,
        away_team_id: awayId,
        home_score_actual: m.home.score ?? null,
        away_score_actual: m.away.score ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'fotmob_id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function upsertPlayerAndLineupFm(
  supabase: Supabase,
  fixtureRowId: number,
  teamRowId: number,
  lineup: FmTeamLineup,
  source: 'predicted' | 'confirmed' | 'estimated'
) {
  for (const entry of lineup.starters) {
    const { data: playerRow, error: playerErr } = await supabase
      .from('players')
      .upsert(
        { fotmob_id: entry.id, name: entry.name, team_id: teamRowId, position: fmGroup(entry.usualPlayingPositionId) },
        { onConflict: 'fotmob_id' }
      )
      .select('id')
      .single();
    if (playerErr) throw playerErr;

    const group = fmGroup(entry.usualPlayingPositionId);
    const shirtNumber = entry.shirtNumber != null ? Number(entry.shirtNumber) : null;

    await supabase.from('lineups').upsert(
      {
        fixture_id: fixtureRowId,
        team_id: teamRowId,
        player_id: playerRow.id,
        is_starting: true,
        source,
        shirt_number: Number.isFinite(shirtNumber) ? shirtNumber : null,
        grid_row: FM_GROUP_ROW[group],
        grid_col: Math.round((entry.horizontalLayout?.x ?? 0) * 100),
        pos_x: entry.horizontalLayout?.x ?? null,
        pos_y: entry.horizontalLayout?.y ?? null,
        captured_at: new Date().toISOString(),
      },
      { onConflict: 'fixture_id,team_id,player_id' }
    );
  }
}
