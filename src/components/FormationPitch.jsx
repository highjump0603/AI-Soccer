import TeamLogo from './TeamLogo';
import PlayerAvatar from './PlayerAvatar';

// FotMob's official lineups carry precise per-player pitch coordinates
// (pos_x: 0 at this team's own goal line -> 1 at the opponent's, pos_y:
// 0-1 across the pitch width) — rendered here as absolute-positioned dots
// so the true formation shape (e.g. a back five vs a back four, split
// double-pivot vs a flat midfield three) comes through instead of being
// flattened into generic G/D/M/F bands.
function CoordinatePitch({ players }) {
  return (
    <div className="pitch-field pitch-field-coords">
      {players.map((p, i) => (
        <div
          className="pitch-coord-dot"
          key={i}
          style={{ top: `${p.pos_x * 100}%`, left: `${p.pos_y * 100}%` }}
        >
          <PlayerAvatar player={p.player} number={p.shirt_number} />
        </div>
      ))}
    </div>
  );
}

// Fallback for lineups with no coordinate data (best-guess "estimated"
// lineups only know a position group + a rough ordering, not real
// coordinates) — groups by grid_row (1=GK, increasing toward attack) and
// renders top-to-bottom, each row sorted left-to-right by grid_col.
function GridPitch({ players }) {
  const rows = new Map();
  for (const p of players) {
    const key = p.grid_row ?? 0;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(p);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  for (const key of rowKeys) rows.get(key).sort((a, b) => (a.grid_col ?? 0) - (b.grid_col ?? 0));

  return (
    <div className="pitch-field">
      {rowKeys.map((key) => (
        <div className="pitch-row" key={key}>
          {rows.get(key).map((p, i) => (
            <PlayerAvatar key={i} player={p.player} number={p.shirt_number} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function FormationPitch({ teamName, teamLogoUrl, formation, players }) {
  const hasCoords = players.some((p) => p.pos_x != null && p.pos_y != null);

  return (
    <div className="pitch-card">
      <div className="pitch-header">
        <TeamLogo name={teamName} remoteUrl={teamLogoUrl} size={24} />
        <span className="pitch-team-name">{teamName}</span>
        {formation && <span className="formation-badge">{formation}</span>}
      </div>
      {hasCoords ? <CoordinatePitch players={players} /> : <GridPitch players={players} />}
    </div>
  );
}
