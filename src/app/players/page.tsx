import Link from "next/link";
import type { PlayerWithDetails } from "@/lib/types";
import { getPlayersWithDetails } from "@/lib/players";
import { config } from "@/lib/config";
import { getFaceMtime } from "@/lib/face-mtime";
import { PlayerAvatar } from "./PlayerAvatar";

export const dynamic = "force-dynamic";

const SEASON = config.game.currentSeason;

async function getPlayers() {
  try {
    const players = await getPlayersWithDetails(SEASON);
    const playersWithFaceMtime = await Promise.all(
      players.map(async (p) => ({
        ...p,
        faceMtime: await getFaceMtime(p.playerId),
      }))
    );
    return { players: playersWithFaceMtime, error: null };
  } catch (e) {
    return { players: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function PlayersPage() {
  const { players, error } = await getPlayers();

  if (error) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Season {SEASON} Players</h2>
        <p className="text-red-600">Failed to load: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Season {SEASON} Players</h2>
      <p className="mb-6 text-sm text-gray-600">
        Name, position, DMI, salary (BB), game shape, fantasy price ($), avg rating
      </p>
      <div className="overflow-x-auto rounded-lg border border-bb-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left">Player</th>
              <th className="border border-bb-border px-4 py-2 text-left w-auto"></th>
              <th className="border border-bb-border px-4 py-2 text-left">Pos</th>
              <th className="border border-bb-border px-4 py-2 text-right">DMI</th>
              <th className="border border-bb-border px-4 py-2 text-right">Salary</th>
              <th className="border border-bb-border px-4 py-2 text-right" title="Game Shape (1–10)">GS</th>
              <th className="border border-bb-border px-4 py-2 text-right">$</th>
              <th className="border border-bb-border px-4 py-2 text-right">PTS</th>
              <th className="border border-bb-border px-4 py-2 text-right">RTNG</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p: PlayerWithDetails) => (
              <tr key={p.playerId} className="hover:bg-card-bg">
                <td className="border border-bb-border px-4 py-2">
                  <Link
                    href={`https://buzzerbeater.com/player/${p.playerId}/overview.aspx`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-exact hover:underline"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="border border-bb-border px-4 py-2">
                  <PlayerAvatar playerId={p.playerId} name={p.name} faceMtime={p.faceMtime} />
                </td>
                <td className="border border-bb-border px-4 py-2">{p.position}</td>
                <td className="border border-bb-border px-4 py-2 text-right">
                  {p.dmi != null ? p.dmi.toLocaleString() : "–"}
                </td>
                <td className="border border-bb-border px-4 py-2 text-right">
                  {p.salary != null ? p.salary.toLocaleString() : "–"}
                </td>
                <td className="border border-bb-border px-4 py-2 text-right">
                  {p.gameShape != null ? p.gameShape : "–"}
                </td>
                <td className="border border-bb-border px-4 py-2 text-right font-medium">
                  ${p.inGamePrice}
                </td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.pts.toFixed(1)}</td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.avgRating.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
