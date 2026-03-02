import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/u21dle/leaderboard?type=daily|alltime-wins|alltime-winpercent|alltime-avgguesses
 * Uses service role to bypass RLS and show all players (anon client can filter by RLS).
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") ?? "alltime-wins";
  const date = request.nextUrl.searchParams.get("date"); // for daily

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ success: false, error: "Server config error" }, { status: 500 });
  }

  const [statsRes, profilesRes] = await Promise.all([
    supabase.from("u21dle_user_stats").select("user_id, total_games, failed_games, current_streak, max_streak, average_guesses, total_score"),
    supabase.from("profiles").select("user_id, nickname"),
  ]);

  const stats = statsRes.data ?? [];
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname ?? "?"]));

  let entries: { rank: number; userId: string; nickname: string; value: number; extra?: Record<string, unknown> }[] = [];

  if (type === "daily" && date) {
    const { data: puzzleRow } = await supabase
      .from("u21dle_puzzles")
      .select("id")
      .eq("puzzle_date", date)
      .maybeSingle();
    if (!puzzleRow) {
      return NextResponse.json({ success: true, data: { type: "daily", date, entries: [] } });
    }
    const { data: rawGuesses } = await supabase
      .from("u21dle_guesses")
      .select("user_id, guesses_used, is_solved, time_taken_seconds, used_cheat")
      .eq("puzzle_id", puzzleRow.id)
      .limit(100);
    const finished = (rawGuesses ?? []).filter(
      (g) => g.is_solved || (g.guesses_used ?? 0) >= U21DLE_CONFIG.MAX_GUESSES
    );
    const sorted = [...finished].sort((a, b) => {
      const aClean = a.is_solved && !a.used_cheat;
      const bClean = b.is_solved && !b.used_cheat;
      const aCheat = a.is_solved && a.used_cheat;
      const bCheat = b.is_solved && b.used_cheat;
      if (aClean !== bClean) return aClean ? -1 : 1;
      if (aCheat !== bCheat) return aCheat ? -1 : 1;
      if (a.is_solved && b.is_solved) {
        if ((a.guesses_used ?? 0) !== (b.guesses_used ?? 0)) {
          return (a.guesses_used ?? 0) - (b.guesses_used ?? 0);
        }
        return (a.time_taken_seconds ?? 0) - (b.time_taken_seconds ?? 0);
      }
      return (a.time_taken_seconds ?? 0) - (b.time_taken_seconds ?? 0);
    });
    entries = sorted.map((g, i) => ({
      rank: i + 1,
      userId: g.user_id,
      nickname: profiles.get(g.user_id) ?? "?",
      value: g.guesses_used ?? 0,
      extra: {
        guesses: g.guesses_used,
        time: g.time_taken_seconds,
        isSolved: g.is_solved,
        usedCheat: g.used_cheat ?? false,
      },
    }));
  } else {
    const byUser = stats.map((s) => {
      const total = s.total_games ?? 0;
      const failed = s.failed_games ?? 0;
      const wins = total - failed;
      let value = 0;
      if (type === "alltime-wins") value = wins;
      else if (type === "alltime-winpercent") value = total > 0 ? (wins / total) * 100 : 0;
      else if (type === "alltime-avgguesses") value = -(s.average_guesses ?? 0);
      else if (type === "alltime-streak") value = s.max_streak ?? 0;
      else value = wins;
      return {
        rank: 0,
        userId: s.user_id,
        nickname: profiles.get(s.user_id) ?? "?",
        value,
        extra: { totalGames: total, wins, winPercent: total > 0 ? (wins / total) * 100 : 0, avgGuesses: s.average_guesses },
      };
    });
    const sorted = byUser.sort((a, b) => b.value - a.value);
    entries = sorted.map((e, i) => ({ ...e, rank: i + 1 }));
  }

  return NextResponse.json({
    success: true,
    data: {
      type,
      date: type === "daily" ? date : undefined,
      entries: entries.slice(0, 50),
    },
  });
}
