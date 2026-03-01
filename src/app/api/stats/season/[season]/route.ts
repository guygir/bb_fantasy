import { NextResponse } from "next/server";
import { loadPlayerGameStats } from "@/lib/boxscore";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/season/71
 * Returns per-game stats with fantasy points (from parsed boxscores).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || 71;

  const stats = loadPlayerGameStats(seasonNum);
  return NextResponse.json({
    meta: { season: seasonNum, source: "player_game_stats" },
    stats,
  });
}
