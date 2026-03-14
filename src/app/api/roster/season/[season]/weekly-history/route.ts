import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLastPlayedMatchFP } from "@/lib/fantasy-db";

export const dynamic = "force-dynamic";

const ROSTER_SIZE = 5;

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
 * Requires auth. Prefers fantasy_roster_by_match (snapshot at lock), fallback to reconstruction.
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

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const GAME_DURATION_MS = 2 * 60 * 60 * 1000;

  const admin = getSupabaseAdmin();
  const [lastPlayedFP, scheduleRes, statsRes, rosterRes, rosterByMatchRes, subsRes] = await Promise.all([
    getLastPlayedMatchFP(seasonNum),
    admin
      .from("fantasy_schedule")
      .select("match_id, match_date, match_start")
      .eq("season", seasonNum)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true }),
    admin
      .from("fantasy_player_game_stats")
      .select("player_id, match_id, name, fantasy_points")
      .eq("season", seasonNum)
      .range(0, 9999),
    admin
      .from("fantasy_user_rosters")
      .select("player_ids, player_names, picked_at, pending_subs")
      .eq("user_id", user.id)
      .eq("season", seasonNum)
      .maybeSingle(),
    admin
      .from("fantasy_roster_by_match")
      .select("match_id, player_ids")
      .eq("user_id", user.id)
      .eq("season", seasonNum),
    admin
      .from("fantasy_roster_substitutions")
      .select("removed_player_ids, added_player_ids, created_at, effective_match_id")
      .eq("user_id", user.id)
      .eq("season", seasonNum)
      .order("created_at", { ascending: true }),
  ]);

  const stats = statsRes.data ?? [];
  const roster = rosterRes.data;
  const subs = subsRes.data ?? [];
  const rosterByMatchRows = (rosterByMatchRes.data ?? []) as { match_id: string; player_ids: number[] }[];
  const rosterByMatch = new Map(rosterByMatchRows.map((r) => [r.match_id, r.player_ids]));

  if (!roster?.player_ids?.length) {
    return NextResponse.json({ weeks: [] });
  }

  const pickedAtMs = roster.picked_at ? new Date(roster.picked_at as string).getTime() : 0;
  const currentIds = roster.player_ids as number[];
  const playerNames = (roster.player_names ?? {}) as Record<string, string>;

  const fullSchedule = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];
  const lastPlayedMatchId = lastPlayedFP.lastPlayedMatchId;
  const lastPlayedRow = fullSchedule.find((r) => r.match_id === lastPlayedMatchId);
  const wasEligibleForLastPlayed = lastPlayedRow
    ? pickedAtMs > 0 &&
      pickedAtMs < (lastPlayedRow.match_start ? new Date(lastPlayedRow.match_start).getTime() : new Date(lastPlayedRow.match_date + "T12:00:00Z").getTime())
    : false;

  // Filter schedule: only games where user had roster BEFORE game start (picked_at < match_start)
  const scheduleFiltered = fullSchedule
    .map((row, idx) => ({ ...row, weekNum: idx + 1 }))
    .filter((row) => {
      const ms = row.match_start;
      const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
      if (pickedAtMs >= matchStartMs) return false; // User picked after game started
      if (row.match_date > today) return false;
      if (row.match_date < today) return true; // Past game, include
      if (row.match_date === today) {
        if (!ms) return false;
        return now >= matchStartMs + GAME_DURATION_MS; // Include only if game has finished
      }
      return false;
    });

  // Build initial roster by reversing substitutions (newest first).
  // Avoid duplicates: only add removed players that aren't already in roster.
  let initialIds = [...currentIds];
  for (let i = subs.length - 1; i >= 0; i--) {
    const s = subs[i];
    const removed = (s.removed_player_ids ?? []) as number[];
    const added = (s.added_player_ids ?? []) as number[];
    const anyAddedPresent = added.length > 0 && added.some((id) => initialIds.includes(id));
    if (anyAddedPresent) {
      const afterRemove = initialIds.filter((id) => !added.includes(id));
      const toAdd = removed.filter((id) => !afterRemove.includes(id));
      initialIds = [...afterRemove, ...toAdd];
    }
  }
  // Roster that played in last match:
  // - If pending_subs.effective_match_id === last match: user made subs for that game, sync hasn't run yet.
  //   Roster that played = current + pending_subs applied (the "future roster" at lock time).
  // - Else (pending_subs null or for a different match): sync already ran, current roster = roster that played.
  const pendingSubs = roster.pending_subs as { effective_match_id?: string; removed_ids?: number[]; added_ids?: number[] } | null;
  const lastPlayedMatchIdForOverride = lastPlayedFP.lastPlayedMatchId;
  const rosterThatPlayedLastMatch =
    pendingSubs?.effective_match_id && String(pendingSubs.effective_match_id) === String(lastPlayedMatchIdForOverride)
      ? (() => {
          const removed = pendingSubs.removed_ids ?? [];
          const added = pendingSubs.added_ids ?? [];
          return currentIds.filter((id) => !removed.includes(id)).concat(added);
        })()
      : currentIds;

  // Points by (player_id, match_id)
  const pointsMap = new Map<string, number>();
  const nameMap = new Map<number, string>();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, Number(s.fantasy_points ?? 0));
    if (s.name) nameMap.set(s.player_id, s.name);
  }

  // Roster per match: prefer snapshot (fantasy_roster_by_match), fallback to reconstruction
  const weeks: {
    week: number;
    matchDate: string;
    matchId: string;
    roster: { playerId: number; name: string; points: number }[];
    total: number;
  }[] = [];

  for (let i = 0; i < scheduleFiltered.length; i++) {
    const row = scheduleFiltered[i];
    const matchDate = row.match_date as string;
    const matchId = row.match_id as string;

    let rosterIds: number[];
    const snapshot = rosterByMatch.get(matchId);
    if (snapshot && snapshot.length > 0) {
      // Use immutable snapshot written by sync when game finished
      rosterIds = snapshot;
    } else if (matchId === lastPlayedMatchIdForOverride) {
      // Last played: pending_subs may not be synced yet
      rosterIds = [...rosterThatPlayedLastMatch];
    } else {
      // Fallback: reconstruct from subs (before sync has populated snapshots)
      const matchCutoff = new Date(matchDate + "T23:59:59.999Z").getTime();
      rosterIds = [...initialIds];
      for (const s of subs) {
        const effectiveMatchId = s.effective_match_id as string | null;
        const createdAt = new Date((s.created_at as string)).getTime();
        const appliesToThisMatch = effectiveMatchId
          ? String(effectiveMatchId) === String(matchId)
          : createdAt <= matchCutoff;
        if (appliesToThisMatch) {
          const removed = (s.removed_player_ids ?? []) as number[];
          const added = (s.added_player_ids ?? []) as number[];
          const allRemovedPresent = removed.length > 0 && removed.every((id) => rosterIds.includes(id));
          if (allRemovedPresent) {
            const after = rosterIds.filter((id) => !removed.includes(id)).concat(added);
            if (after.length === ROSTER_SIZE) {
              rosterIds = after;
            }
          }
        }
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
      week: scheduleFiltered[i].weekNum,
      matchDate,
      matchId,
      roster: rosterEntries,
      total,
    });
  }

  // FP for "Last week" column: show FP for current roster players (0 if they were subbed out)
  const lastWeekFPByCurrentRoster: Record<number, number> = {};
  if (lastPlayedMatchId && currentIds.length > 0) {
    for (const pid of currentIds) {
      lastWeekFPByCurrentRoster[pid] = pointsMap.get(`${pid}:${lastPlayedMatchId}`) ?? 0;
    }
  }

  return NextResponse.json({
    weeks,
    lastPlayedMatchId,
    wasEligibleForLastPlayed,
    lastWeekFPByCurrentRoster,
  });
}
