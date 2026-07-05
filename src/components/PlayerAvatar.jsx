import { useState } from 'react';

function initialsOf(name) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function PlayerAvatar({ player, number }) {
  const [imgError, setImgError] = useState(false);
  const url = player.fotmob_id ? `https://images.fotmob.com/image_resources/playerimages/${player.fotmob_id}.png` : null;

  return (
    <div className="player-avatar">
      <div className="player-photo">
        {url && !imgError ? (
          <img src={url} alt={player.name} onError={() => setImgError(true)} />
        ) : (
          <span className="player-photo-fallback">{initialsOf(player.name)}</span>
        )}
        {number != null && <span className="shirt-number">{number}</span>}
      </div>
      <span className="player-name">{player.name}</span>
    </div>
  );
}
