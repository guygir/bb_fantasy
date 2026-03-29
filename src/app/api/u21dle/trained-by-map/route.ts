import { NextResponse } from "next/server";
import { getEligibleTrainedByMap } from "@/lib/u21dle/m5-trained-by";

export const dynamic = "force-dynamic";

/**
 * GET /api/u21dle/trained-by-map
 * Full playerId → M5 label map for eligible players (same as /u21dle/players “Trained By”).
 */
export async function GET() {
  try {
    const data = getEligibleTrainedByMap();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
