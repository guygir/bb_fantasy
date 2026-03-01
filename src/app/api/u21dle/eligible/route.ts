import { NextResponse } from "next/server";
import { getEligiblePlayers } from "@/lib/u21dle/players";
import { getFaceMtime } from "@/lib/face-mtime";

export const dynamic = "force-dynamic";

/**
 * Returns all eligible U21dle players (GP>=8 from seasons 60-70)
 * with stats and face availability (faceMtime for cache busting, null if no face).
 */
export async function GET() {
  try {
    const players = getEligiblePlayers();
    const withFaces = await Promise.all(
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
