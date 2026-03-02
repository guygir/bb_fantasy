import { getPlayerGameStats, getUserStandings, getLastPlayedMatchFP } from "@/lib/fantasy-db";
import { config } from "@/lib/config";
import Link from "next/link";
import { LeaderboardTable } from "./LeaderboardTable";
import { PlayerScorersTable } from "./PlayerScorersTable";

export const dynamic = "force-dynamic";

const SEASON = config.game.currentSeason;

interface PlayerFantasyTotal {
  playerId: number;
  name: string;
  gamesPlayed: number;
  totalFantasyPoints: number;
  lastGameFP: number;
}

function aggregateByPlayer(
  stats: { playerId: number; name: string; fantasyPoints: number }[],
  lastGameFPByPlayer: Record<number, number>
): PlayerFantasyTotal[] {
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
      lastGameFP: lastGameFPByPlayer[playerId] ?? 0,
    }))
    .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints);
}

export default async function LeaderboardPage() {
  const [stats, userStandings, lastPlayedFP] = await Promise.all([
    getPlayerGameStats(SEASON),
    getUserStandings(SEASON),
    getLastPlayedMatchFP(SEASON),
  ]);
  const playerTotals = aggregateByPlayer(stats, lastPlayedFP.playerFP);

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Leaderboard (Season {SEASON})</h2>

      {userStandings.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-2 text-sm font-medium text-gray-600">User Standings</h3>
          <p className="mb-4 text-sm text-gray-500">
            Ranked by roster total fantasy points. Sign in and pick your team to join.
          </p>
          <LeaderboardTable data={userStandings} />
        </div>
      )}

      <div className="mb-8">
        <h3 className="mb-2 text-sm font-medium text-gray-600">Top Fantasy Scorers</h3>
        <p className="mb-4 text-sm text-gray-500">
          Based on parsed boxscores. Last game FP = FP in most recent match played (0 if DNP). Run{" "}
          <code className="rounded bg-gray-100 px-1">npm run process-boxscores {SEASON}</code> to refresh.
        </p>
        {playerTotals.length === 0 ? (
          <p className="text-gray-500">No game stats yet. Fetch boxscores and run process-boxscores.</p>
        ) : (
          <PlayerScorersTable data={playerTotals} />
        )}
      </div>

      <div className="border-t pt-6">
        <h3 className="mb-2 text-sm font-medium text-gray-600">Your Team</h3>
        <p className="mb-4 text-sm text-gray-500">
        <Link href="/roster" className="text-exact hover:underline font-medium">
          My Roster
        </Link>{" "}
          to pick your team (5 players, $30 cap) or view your picks and fantasy points.
        </p>
      </div>
    </div>
  );
}
