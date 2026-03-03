import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * GET /api/debug/u21dle-daily?date=2026-03-03
 * Debug daily leaderboard: raw puzzle + guesses data.
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const admin = getSupabaseAdmin();
  const { data: puzzle } = await admin
    .from("u21dle_puzzles")
    .select("id, puzzle_date, player_id")
    .eq("puzzle_date", date)
    .maybeSingle();

  if (!puzzle) {
    return NextResponse.json({ date, puzzle: null, guesses: [], message: "No puzzle for date" });
  }

  const { data: guesses } = await admin
    .from("u21dle_guesses")
    .select("id, user_id, puzzle_id, guesses_used, is_solved, time_taken_seconds, used_cheat")
    .eq("puzzle_id", puzzle.id)
    .limit(100);

  return NextResponse.json({
    date,
    puzzle,
    guessesCount: guesses?.length ?? 0,
    guesses: guesses ?? [],
  });
}
