"use client";

import { useState } from "react";
import Link from "next/link";

interface PlayerAvatarProps {
  playerId: number;
  name: string;
  /** File mtime for cache busting when face is re-fetched */
  faceMtime?: number | null;
  /** Compact size for dense layouts */
  compact?: boolean;
}

/**
 * Player avatar - uses our stored face (from npm run fetch-player-face) when available,
 * otherwise shows initial. Links to BuzzerBeater profile.
 */
export function PlayerAvatar({ playerId, name, faceMtime, compact }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const profileUrl = `https://buzzerbeater.com/player/${playerId}/overview.aspx`;
  const faceUrl = `/player-faces/${playerId}.png${faceMtime ? `?v=${faceMtime}` : ""}`;

  return (
    <Link
      href={profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-200 text-sm font-medium text-gray-600"
      title="View on BuzzerBeater"
    >
      {!imgError ? (
        <img
          src={faceUrl}
          alt={name}
          className={`block w-auto rounded-lg ${compact ? "max-h-12" : "max-h-24"}`}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className={`flex items-center justify-center rounded-lg ${compact ? "h-10 w-10" : "h-16 w-16"}`}>{name.charAt(0)}</span>
      )}
    </Link>
  );
}
