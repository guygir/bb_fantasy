"use client";

import { useState } from "react";
import Link from "next/link";

interface PlayerAvatarProps {
  playerId: number;
  name: string;
  /** File mtime for cache busting when face is re-fetched */
  faceMtime?: number | null;
}

/**
 * Player avatar - uses our stored face (from npm run fetch-player-face) when available,
 * otherwise shows initial. Links to BuzzerBeater profile.
 */
export function PlayerAvatar({ playerId, name, faceMtime }: PlayerAvatarProps) {
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
          className="block max-h-24 w-auto rounded-lg"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-lg">{name.charAt(0)}</span>
      )}
    </Link>
  );
}
