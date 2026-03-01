import { NextResponse } from "next/server";
import { getEligiblePlayers } from "@/lib/u21dle/players";
import { getFaceMtime } from "@/lib/face-mtime";

export const dynamic = "force-dynamic";

/**
 * Returns all eligible U21dle players (GP>=8 from seasons 60-70).
 * ?light=1 skips faceMtime (for cheat panel).
 */
export async function GET(request: Request) {
  try {
    const light = new URL(request.url).searchParams.get("light") === "1";
    const players = getEligiblePlayers();
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
