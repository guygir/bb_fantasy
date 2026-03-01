import { NextResponse } from "next/server";
import { loadPlayerGameStats } from "@/lib/boxscore";
import { hasFantasyData, getPlayerGameStatsFromSupabase } from "@/lib/fantasy-db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/season/[season]
 * Returns per-game stats with fantasy points (Supabase first, JSON fallback).
 * ?source=json forces JSON fallback (for debugging Supabase sync).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || config.game.currentSeason;
  const forceJson = new URL(request.url).searchParams.get("source") === "json";

  if (!forceJson && (await hasFantasyData(seasonNum))) {
    const stats = await getPlayerGameStatsFromSupabase(seasonNum);
    if (stats) {
      return NextResponse.json({
        meta: { season: seasonNum, source: "supabase" },
        stats,
      });
    }
  }
  const stats = loadPlayerGameStats(seasonNum);
  return NextResponse.json({
    meta: { season: seasonNum, source: "player_game_stats" },
    stats,
  });
}
