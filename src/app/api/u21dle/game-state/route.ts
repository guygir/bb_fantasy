import { NextRequest, NextResponse } from "next/server";
import { getGameState } from "@/lib/u21dle/supabase";
import { getDailyPlayer } from "@/lib/u21dle/daily";

export const dynamic = "force-dynamic";

/**
 * GET /api/u21dle/game-state?date=YYYY-MM-DD
 * Returns saved game state from Supabase. Requires auth.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ success: false, error: "Missing date" }, { status: 400 });
  }

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const state = await getGameState(token, date);
  if (!state) {
    return NextResponse.json({ success: true, data: null });
  }

  let answer: { playerId: number; name: string } | undefined;
  if (state.gameOver) {
    const dailyPlayer = await getDailyPlayer(date);
    if (dailyPlayer) {
      answer = { playerId: dailyPlayer.playerId, name: dailyPlayer.name };
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...state,
      answer,
    },
  });
}
