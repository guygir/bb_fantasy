import Link from "next/link";
import { config } from "@/lib/config";
import { getEligiblePlayers } from "@/lib/u21dle/players";
import { getFaceMtime } from "@/lib/face-mtime";
import { U21dlePlayersTable } from "./U21dlePlayersTable";

export const dynamic = "force-dynamic";

async function getEligibleWithFaces() {
  const players = getEligiblePlayers();
  const withFaces = await Promise.all(
    players.map(async (p) => ({
      ...p,
      faceMtime: await getFaceMtime(p.playerId),
    }))
  );
  return withFaces.sort((a, b) => b.gp - a.gp);
}

export default async function U21dlePlayersPage() {
  let players;
  try {
    players = await getEligibleWithFaces();
  } catch (e) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">U21dle Eligible Players</h2>
        <p className="text-red-600">Failed to load: {e instanceof Error ? e.message : String(e)}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">U21dle Eligible Players</h2>
          <p className="mt-1 text-sm text-gray-600">
            Israel U21 players with GP≥8 from seasons {config.u21dle.minSeason}–{config.u21dle.maxSeason} ({players.length} players). Click column headers to sort.
          </p>
        </div>
        <Link
          href="/u21dle"
          className="text-sm text-exact hover:underline font-medium"
        >
          ← Back to U21dle
        </Link>
      </div>
      <U21dlePlayersTable players={players} />
    </div>
  );
}
