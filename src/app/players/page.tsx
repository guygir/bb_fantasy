import { getPlayersWithDetails } from "@/lib/players";
import { config } from "@/lib/config";
import { getFaceMtime } from "@/lib/face-mtime";
import { PlayersTable } from "./PlayersTable";

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
        Click column headers to sort. Photo, name, position, DMI, salary (BB), game shape, fantasy price ($), avg rating
      </p>
      <PlayersTable players={players} />
    </div>
  );
}
