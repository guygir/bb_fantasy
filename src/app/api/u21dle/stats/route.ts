import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function getSupabase(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });
}

/**
 * GET /api/u21dle/stats
 * Returns user stats. Requires auth.
 * Uses service role to read stats (bypasses RLS, same fix as leaderboard).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAuth = getSupabase(token);
  if (!supabaseAuth) {
    return NextResponse.json({ success: false, error: "Server config error" }, { status: 500 });
  }

  const { data: user } = await supabaseAuth.auth.getUser(token);
  if (!user?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("u21dle_user_stats")
    .select("*, cheat_distribution")
    .eq("user_id", user.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const totalGames = data?.total_games ?? 0;
  const failedGames = data?.failed_games ?? 0;
  const wins = totalGames - failedGames;

  return NextResponse.json({
    success: true,
    data: {
      totalGames,
      wins,
      failedGames,
      winPercent: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      currentStreak: data?.current_streak ?? 0,
      maxStreak: data?.max_streak ?? 0,
      averageGuesses: data?.average_guesses ?? 0,
      solvedDistribution: data?.solved_distribution ?? {},
      cheatDistribution: data?.cheat_distribution ?? {},
      lastPlayedDate: data?.last_played_date ?? null,
    },
  });
}
