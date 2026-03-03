import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLastPlayedMatchFP } from "@/lib/fantasy-db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/fantasy-fp
 * Debug endpoint for 0 FP issue. No auth required.
 * Use ?userId=... or set DEBUG_FANTASY_USER_ID in .env.local.
 * Example: /api/debug/fantasy-fp?season=71&userId=48c707ed-c070-4864-b64c-dfbf61bd0152
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season") ?? String(config.game.currentSeason), 10);
  const userId =
    searchParams.get("userId") ?? process.env.DEBUG_FANTASY_USER_ID ?? null;

  if (!userId) {
    return NextResponse.json({
      error: "Add ?userId=YOUR_USER_ID or set DEBUG_FANTASY_USER_ID in .env.local",
      hint: "Get user_id from fantasy_user_rosters or fantasy_roster_substitutions in Supabase",
    }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "No Supabase admin" }, { status: 500 });
  }

  const [lastPlayedFP, statsRes, rosterRes] = await Promise.all([
    getLastPlayedMatchFP(season),
    admin.from("fantasy_player_game_stats").select("player_id, match_id, fantasy_points, name").eq("season", season),
    admin.from("fantasy_user_rosters").select("player_ids, picked_at").eq("user_id", userId).eq("season", season).maybeSingle(),
  ]);

  const stats = statsRes?.data ?? [];
  const roster = rosterRes?.data;
  const matchId = lastPlayedFP.lastPlayedMatchId;
  const statsForMatch = stats.filter((s: { match_id: string }) => String(s.match_id) === String(matchId));
  const rosterIds = (roster?.player_ids ?? []) as number[];
  const lookupResults = rosterIds.map((pid) => {
    const s = statsForMatch.find((x: { player_id: number }) => x.player_id === pid);
    return { playerId: pid, matchId, fp: s ? Number(s.fantasy_points) : 0, found: !!s };
  });

  // Replicate wasEligibleForLastPlayed from weekly-history (if false, roster page shows 0 for all)
  const scheduleRes = await admin.from("fantasy_schedule").select("match_id, match_date, match_start").eq("season", season).not("match_date", "is", null).order("match_date", { ascending: true });
  const schedule = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];
  const lastRow = schedule.find((r) => r.match_id === matchId);
  const pickedAtMs = roster?.picked_at ? new Date(roster.picked_at as string).getTime() : 0;
  const matchStartMs = lastRow?.match_start ? new Date(lastRow.match_start).getTime() : lastRow ? new Date(lastRow.match_date + "T12:00:00Z").getTime() : 0;
  const wasEligibleForLastPlayed = lastRow ? pickedAtMs > 0 && pickedAtMs < matchStartMs : false;

  return NextResponse.json({
    season,
    lastPlayedMatchId: matchId,
    statsCount: stats.length,
    statsForMatchCount: statsForMatch.length,
    rosterPlayerIds: rosterIds,
    lookupResults,
    wasEligibleForLastPlayed,
    pickedAt: roster?.picked_at ?? null,
    matchStart: lastRow?.match_start ?? null,
    sampleStatsForMatch: statsForMatch.slice(0, 3),
  });
}
