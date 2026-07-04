import TeamLogo from './TeamLogo';
import PlayerAvatar from './PlayerAvatar';

// Groups starters by grid_row (API-Football convention: row 1 = goalkeeper
// end, increasing toward attack) and renders them top-to-bottom on a pitch,
// each row sorted left-to-right by grid_col — same layout as the formation
// view on sites like Sofascore.
export default function FormationPitch({ teamName, teamLogoUrl, formation, players }) {
  const rows = new Map();
  for (const p of players) {
    const key = p.grid_row ?? 0;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(p);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  for (const key of rowKeys) rows.get(key).sort((a, b) => (a.grid_col ?? 0) - (b.grid_col ?? 0));

  return (
    <div className="pitch-card">
      <div className="pitch-header">
        <TeamLogo name={teamName} remoteUrl={teamLogoUrl} size={24} />
        <span className="pitch-team-name">{teamName}</span>
        {formation && <span className="formation-badge">{formation}</span>}
      </div>
      <div className="pitch-field">
        {rowKeys.map((key) => (
          <div className="pitch-row" key={key}>
            {rows.get(key).map((p, i) => (
              <PlayerAvatar key={i} player={p.player} number={p.shirt_number} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
