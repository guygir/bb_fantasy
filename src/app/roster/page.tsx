"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "fantasy_roster_s71";

interface Roster {
  playerIds: number[];
  playerPrices: Record<number, number>;
  playerNames: Record<number, string>;
  pickedAt: string;
}

interface GameStat {
  playerId: number;
  matchId: string;
  name: string;
  fantasyPoints: number;
}

export default function MyRosterPage() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      try {
        setRoster(JSON.parse(stored));
      } catch {
        setRoster(null);
      }
    } else {
      setRoster(null);
    }
    fetch("/api/stats/season/71")
      .then((r) => r.json())
      .then((data) => {
        setStats(data.stats ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (!roster || roster.playerIds.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
        <p className="text-gray-600">
          You haven&apos;t picked a team yet.{" "}
          <Link href="/pick" className="text-exact hover:underline font-medium">
            Pick your team
          </Link>{" "}
          (5 players, $30 cap).
        </p>
      </div>
    );
  }

  const totalCost = roster.playerIds.reduce((sum, id) => sum + (roster.playerPrices[id] ?? 0), 0);
  const pointsByPlayer = new Map<number, number>();
  for (const s of stats) {
    if (roster.playerIds.includes(s.playerId)) {
      pointsByPlayer.set(s.playerId, (pointsByPlayer.get(s.playerId) ?? 0) + s.fantasyPoints);
    }
  }
  const totalFantasyPoints = Array.from(pointsByPlayer.values()).reduce((a, b) => a + b, 0);
  const gamesPlayed = new Set(stats.filter((s) => roster!.playerIds.includes(s.playerId)).map((s) => s.matchId)).size;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
      <p className="mb-6 text-sm text-gray-600">
        Picked {new Date(roster.pickedAt).toLocaleDateString()}. Total: ${totalCost} · Fantasy points from {gamesPlayed} game(s).
      </p>

      <div className="mb-6 rounded-lg border border-bb-border bg-card-bg p-4">
        <div className="flex gap-8">
          <div>
            <span className="text-sm text-gray-500">Total cost</span>
            <p className="text-xl font-bold">${totalCost}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Fantasy points</span>
            <p className="text-xl font-bold">{totalFantasyPoints.toFixed(1)}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-bb-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left">Player</th>
              <th className="border border-bb-border px-4 py-2 text-right">$</th>
              <th className="border border-bb-border px-4 py-2 text-right">FP</th>
            </tr>
          </thead>
          <tbody>
            {roster.playerIds.map((id) => (
              <tr key={id} className="hover:bg-card-bg">
                <td className="border border-bb-border px-4 py-2 font-medium">{roster.playerNames[id] ?? `Player ${id}`}</td>
                <td className="border border-bb-border px-4 py-2 text-right">${roster.playerPrices[id] ?? 0}</td>
                <td className="border border-bb-border px-4 py-2 text-right">{(pointsByPlayer.get(id) ?? 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        <Link href="/pick" className="text-exact hover:underline font-medium">Change roster</Link>
        {" · "}
        <Link href="/leaderboard" className="text-exact hover:underline font-medium">Leaderboard</Link>
      </p>
    </div>
  );
}
