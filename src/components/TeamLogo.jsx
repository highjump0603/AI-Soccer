import { getTeamLogoUrl } from '../lib/teamLogos';

function initialsOf(name) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function TeamLogo({ name, size = 52 }) {
  const url = getTeamLogoUrl(name);
  return (
    <div className="logo-slot" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={`${name} 로고`} />
      ) : (
        <span
          className="logo-fallback"
          style={{ fontSize: size * 0.34, color: 'var(--fg-2)' }}
          aria-label={`${name} 로고`}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}
