import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getEligiblePlayers } from "@/lib/u21dle/players";
import { getFaceMtime } from "@/lib/face-mtime";
import { getSeasonPlayerIds } from "@/lib/fantasy-db";

export const dynamic = "force-dynamic";

/**
 * Returns all eligible U21dle players (GP>=8 from seasons 60-70).
 * ?light=1 skips faceMtime (for cheat panel).
 * Players in /players (season 71) get season=71.
 */
export async function GET(request: Request) {
  try {
    const light = new URL(request.url).searchParams.get("light") === "1";
    const currentSeason = config.game.currentSeason;
    const season71Ids = await getSeasonPlayerIds(currentSeason);
    const players = getEligiblePlayers().map((p) =>
      season71Ids.has(p.playerId) ? { ...p, season: currentSeason } : p
    );
    const withFaces = light
      ? players.map((p) => ({ ...p, faceMtime: null as number | null }))
      : await Promise.all(
          players.map(async (p) => ({
            ...p,
            faceMtime: await getFaceMtime(p.playerId),
          }))
        );
    return NextResponse.json({
      success: true,
      data: {
        players: withFaces.sort((a, b) => b.gp - a.gp),
        count: withFaces.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
