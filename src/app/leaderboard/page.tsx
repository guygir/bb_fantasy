import { loadPlayerGameStats } from "@/lib/boxscore";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface PlayerFantasyTotal {
  playerId: number;
  name: string;
  gamesPlayed: number;
  totalFantasyPoints: number;
  fantasyPPG: number;
}

function aggregateByPlayer(stats: { playerId: number; name: string; fantasyPoints: number }[]): PlayerFantasyTotal[] {
  const byPlayer = new Map<number, { name: string; total: number; gp: number }>();
  for (const s of stats) {
    const cur = byPlayer.get(s.playerId) ?? { name: s.name, total: 0, gp: 0 };
    cur.total += s.fantasyPoints;
    cur.gp += 1;
    byPlayer.set(s.playerId, cur);
  }
  return Array.from(byPlayer.entries())
    .map(([playerId, { name, total, gp }]) => ({
      playerId,
      name,
      gamesPlayed: gp,
      totalFantasyPoints: total,
      fantasyPPG: gp > 0 ? total / gp : 0,
    }))
    .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints);
}

export default async function LeaderboardPage() {
  const stats = loadPlayerGameStats(71);
  const playerTotals = aggregateByPlayer(stats);

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Leaderboard (Season 71)</h2>

      <div className="mb-8">
        <h3 className="mb-2 text-sm font-medium text-gray-600">Top Fantasy Scorers</h3>
        <p className="mb-4 text-sm text-gray-500">
          Based on parsed boxscores. Run <code className="rounded bg-gray-100 px-1">npm run process-boxscores 71</code> to refresh.
        </p>
        {playerTotals.length === 0 ? (
          <p className="text-gray-500">No game stats yet. Fetch boxscores and run process-boxscores.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-bb-border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-card-bg">
                  <th className="border border-bb-border px-4 py-2 text-left">#</th>
                  <th className="border border-bb-border px-4 py-2 text-left">Player</th>
                  <th className="border border-bb-border px-4 py-2 text-right">GP</th>
                  <th className="border border-bb-border px-4 py-2 text-right">Total FP</th>
                  <th className="border border-bb-border px-4 py-2 text-right">FP/G</th>
                </tr>
              </thead>
              <tbody>
                {playerTotals.map((p, i) => (
                  <tr key={p.playerId} className="hover:bg-card-bg">
                    <td className="border border-bb-border px-4 py-2">{i + 1}</td>
                    <td className="border border-bb-border px-4 py-2 font-medium">{p.name}</td>
                    <td className="border border-bb-border px-4 py-2 text-right">{p.gamesPlayed}</td>
                    <td className="border border-bb-border px-4 py-2 text-right">{p.totalFantasyPoints.toFixed(1)}</td>
                    <td className="border border-bb-border px-4 py-2 text-right">{p.fantasyPPG.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t pt-6">
        <h3 className="mb-2 text-sm font-medium text-gray-600">Your Team</h3>
        <p className="mb-4 text-sm text-gray-500">
        <Link href="/pick" className="text-exact hover:underline font-medium">
          Pick your team
        </Link>{" "}
          (5 players, $30 cap) to track your fantasy score. Your roster is saved locally in this browser.
        </p>
        <p className="text-sm text-gray-500">
        <Link href="/roster" className="text-exact hover:underline font-medium">
          View My Roster
        </Link>{" "}
          to see your picks and total fantasy points.
        </p>
      </div>
    </div>
  );
}
