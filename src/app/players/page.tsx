import { getPlayersWithDetails } from "@/lib/players";
import { hasFantasyData, getPlayersFromSupabase } from "@/lib/fantasy-db";
import { config } from "@/lib/config";
import { getFaceMtime } from "@/lib/face-mtime";
import { PlayersTable } from "./PlayersTable";

export const dynamic = "force-dynamic";

const SEASON = config.game.currentSeason;

async function getPlayers() {
  try {
    let players;
    if (await hasFantasyData(SEASON)) {
      const fromSupabase = await getPlayersFromSupabase(SEASON);
      players = fromSupabase ?? await getPlayersWithDetails(SEASON);
    } else {
      players = await getPlayersWithDetails(SEASON);
    }
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
        Click column headers to sort. Last game FP = FP in most recent match played (0 if DNP). Same as roster &quot;Last week&quot;.
      </p>
      <PlayersTable players={players} />
    </div>
  );
}
