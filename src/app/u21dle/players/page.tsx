import Link from "next/link";
import { getEligiblePlayers } from "@/lib/u21dle/players";
import { getFaceMtime } from "@/lib/face-mtime";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";

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
            Israel U21 players with GP≥8 from seasons 60–70 ({players.length} players)
          </p>
        </div>
        <Link
          href="/u21dle"
          className="text-sm text-exact hover:underline font-medium"
        >
          ← Back to U21dle
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-bb-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left">Player</th>
              <th className="border border-bb-border px-4 py-2 text-left w-20"></th>
              <th className="border border-bb-border px-4 py-2 text-right">GP</th>
              <th className="border border-bb-border px-4 py-2 text-right">PTS</th>
              <th className="border border-bb-border px-4 py-2 text-right">Age</th>
              <th className="border border-bb-border px-4 py-2 text-right">Height</th>
              <th className="border border-bb-border px-4 py-2 text-right">Potential</th>
              <th className="border border-bb-border px-4 py-2 text-right">Trophies</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
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
                <td className="border border-bb-border px-4 py-2 text-right">{p.gp}</td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.pts.toFixed(1)}</td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.age ?? "–"}</td>
                <td className="border border-bb-border px-4 py-2 text-right">
                  {p.height != null ? `${p.height} cm` : "–"}
                </td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.potential ?? "–"}</td>
                <td className="border border-bb-border px-4 py-2 text-right">{p.trophies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
