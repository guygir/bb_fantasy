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

  const noCache = { "Cache-Control": "no-store, max-age=0" };

  try {
    if (await hasFantasyData(seasonNum)) {
      const players = await getPlayersFromSupabase(seasonNum);
      if (players) {
        return NextResponse.json(
          {
            meta: { season: seasonNum, source: "supabase", count: players.length },
            players,
          },
          { headers: noCache }
        );
      }
    }
    const players = await getPlayersWithDetails(seasonNum);
    return NextResponse.json(
      {
        meta: { season: seasonNum, source: "stats+bbapi", count: players.length },
        players,
      },
      { headers: noCache }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 404 }
    );
  }
}
