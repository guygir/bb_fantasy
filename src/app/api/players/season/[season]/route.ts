import { NextResponse } from "next/server";
import { getPlayersWithDetails } from "@/lib/players";
import { hasFantasyData, getPlayersFromSupabase } from "@/lib/fantasy-db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || config.game.currentSeason;

  try {
    if (await hasFantasyData(seasonNum)) {
      const players = await getPlayersFromSupabase(seasonNum);
      if (players) {
        return NextResponse.json({
          meta: { season: seasonNum, source: "supabase" },
          players,
        });
      }
    }
    const players = await getPlayersWithDetails(seasonNum);
    return NextResponse.json({
      meta: { season: seasonNum, source: "stats+bbapi" },
      players,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 404 }
    );
  }
}
