import { NextRequest, NextResponse } from "next/server";
import { getDailyPlayer } from "@/lib/u21dle/daily";

export const dynamic = "force-dynamic";

/**
 * Verify that a cached answer is still correct for a date.
 * Used when loading from localStorage - if puzzle was overwritten in DB, we invalidate cache.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const playerId = request.nextUrl.searchParams.get("playerId");
  if (!date || !playerId) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
  const pid = parseInt(playerId, 10);
  if (isNaN(pid)) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }
  const dailyPlayer = await getDailyPlayer(date);
  if (!dailyPlayer) {
    return NextResponse.json({ valid: false });
  }
  return NextResponse.json({ valid: dailyPlayer.playerId === pid });
}
