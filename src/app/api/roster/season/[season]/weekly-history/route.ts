import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseWithAuth(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/**
 * GET /api/roster/season/[season]/weekly-history
 * Returns weekly breakdown: roster (names), points per player, total per week.
 * Requires auth. Uses effective roster per week (replays substitutions).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? 71);

  const authHeader = request.headers.get("Authorization");
  const supabase = getSupabaseWithAuth(authHeader);
  if (!supabase) {
    return NextResponse.json({ error: "Server config error" }, { status: 500 });
  }

  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token ?? "");
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [scheduleRes, statsRes, rosterRes, subsRes] = await Promise.all([
    supabase
      .from("fantasy_schedule")
      .select("match_id, match_date")
      .eq("season", seasonNum)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true }),
    supabase
      .from("fantasy_player_game_stats")
      .select("player_id, match_id, name, fantasy_points")
      .eq("season", seasonNum),
    supabase
      .from("fantasy_user_rosters")
      .select("player_ids, player_names")
      .eq("user_id", user.id)
      .eq("season", seasonNum)
      .maybeSingle(),
    supabase
      .from("fantasy_roster_substitutions")
      .select("removed_player_ids, added_player_ids, created_at")
      .eq("user_id", user.id)
      .eq("season", seasonNum)
      .order("created_at", { ascending: true }),
  ]);

  const schedule = scheduleRes.data ?? [];
  const stats = statsRes.data ?? [];
  const roster = rosterRes.data;
  const subs = subsRes.data ?? [];

  if (!roster?.player_ids?.length) {
    return NextResponse.json({ weeks: [] });
  }

  const currentIds = roster.player_ids as number[];
  const playerNames = (roster.player_names ?? {}) as Record<string, string>;

  // Build initial roster by reversing substitutions (newest first)
  let initialIds = [...currentIds];
  for (let i = subs.length - 1; i >= 0; i--) {
    const s = subs[i];
    const removed = (s.removed_player_ids ?? []) as number[];
    const added = (s.added_player_ids ?? []) as number[];
    initialIds = initialIds.filter((id) => !added.includes(id)).concat(removed);
  }

  // Points by (player_id, match_id)
  const pointsMap = new Map<string, number>();
  const nameMap = new Map<number, string>();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, Number(s.fantasy_points ?? 0));
    if (s.name) nameMap.set(s.player_id, s.name);
  }

  // For each match, compute effective roster (apply subs where created_at < match_date end)
  const weeks: {
    week: number;
    matchDate: string;
    matchId: string;
    roster: { playerId: number; name: string; points: number }[];
    total: number;
  }[] = [];

  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    const matchDate = row.match_date as string;
    const matchId = row.match_id as string;

    // Roster at this match: apply subs where created_at <= match_date 23:59:59
    const matchCutoff = new Date(matchDate + "T23:59:59.999Z").getTime();
    let rosterIds = [...initialIds];
    for (const s of subs) {
      const createdAt = new Date((s.created_at as string)).getTime();
      if (createdAt <= matchCutoff) {
        const removed = (s.removed_player_ids ?? []) as number[];
        const added = (s.added_player_ids ?? []) as number[];
        rosterIds = rosterIds.filter((id) => !removed.includes(id)).concat(added);
      }
    }

    const rosterEntries: { playerId: number; name: string; points: number }[] = [];
    let total = 0;
    for (const pid of rosterIds) {
      const pts = pointsMap.get(`${pid}:${matchId}`) ?? 0;
      rosterEntries.push({
        playerId: pid,
        name: playerNames[String(pid)] ?? nameMap.get(pid) ?? `Player ${pid}`,
        points: pts,
      });
      total += pts;
    }

    weeks.push({
      week: i + 1,
      matchDate,
      matchId,
      roster: rosterEntries,
      total,
    });
  }

  return NextResponse.json({ weeks });
}
