import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLastPlayedMatchFP } from "@/lib/fantasy-db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/debug/weekly-history
 * Full trace of weekly-history computation. No auth.
 * ?userId=... or DEBUG_FANTASY_USER_ID
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season") ?? String(config.game.currentSeason), 10);
  const userId = searchParams.get("userId") ?? process.env.DEBUG_FANTASY_USER_ID ?? null;

  if (!userId) {
    return NextResponse.json({
      error: "Add ?userId=YOUR_USER_ID or set DEBUG_FANTASY_USER_ID",
    }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const GAME_DURATION_MS = 2 * 60 * 60 * 1000;

  const [lastPlayedFP, scheduleRes, statsRes, rosterRes, subsRes] = await Promise.all([
    getLastPlayedMatchFP(season),
    admin.from("fantasy_schedule").select("match_id, match_date, match_start").eq("season", season).not("match_date", "is", null).order("match_date", { ascending: true }),
    admin.from("fantasy_player_game_stats").select("player_id, match_id, name, fantasy_points").eq("season", season),
    admin.from("fantasy_user_rosters").select("player_ids, player_names, picked_at, pending_subs").eq("user_id", userId).eq("season", season).maybeSingle(),
    admin.from("fantasy_roster_substitutions").select("removed_player_ids, added_player_ids, created_at, effective_match_id").eq("user_id", userId).eq("season", season).order("created_at", { ascending: true }),
  ]);

  const roster = rosterRes.data;
  const subs = (subsRes.data ?? []) as { removed_player_ids: number[]; added_player_ids: number[]; created_at: string; effective_match_id: string | null }[];
  const stats = statsRes.data ?? [];
  const fullSchedule = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];

  if (!roster?.player_ids?.length) {
    return NextResponse.json({ error: "No roster" });
  }

  const currentIds = roster.player_ids as number[];
  const playerNames = (roster.player_names ?? {}) as Record<string, string>;
  const pickedAtMs = roster.picked_at ? new Date(roster.picked_at as string).getTime() : 0;
  const lastPlayedMatchId = lastPlayedFP.lastPlayedMatchId;
  const pendingSubs = roster.pending_subs as { effective_match_id?: string; removed_ids?: number[]; added_ids?: number[] } | null;
  const rosterThatPlayedLastMatch =
    pendingSubs?.effective_match_id && String(pendingSubs.effective_match_id) === String(lastPlayedMatchId)
      ? (() => {
          const removed = pendingSubs.removed_ids ?? [];
          const added = pendingSubs.added_ids ?? [];
          return currentIds.filter((id) => !removed.includes(id)).concat(added);
        })()
      : currentIds;

  const nameMap = new Map<number, string>();
  for (const s of stats) {
    if (s.name) nameMap.set(s.player_id, s.name);
  }
  const getName = (id: number) => playerNames[String(id)] ?? nameMap.get(id) ?? `Player ${id}`;

  const scheduleFiltered = fullSchedule
    .map((row, idx) => ({ ...row, weekNum: idx + 1 }))
    .filter((row) => {
      const ms = row.match_start;
      const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
      if (pickedAtMs >= matchStartMs) return false;
      if (row.match_date > today) return false;
      if (row.match_date < today) return true;
      if (row.match_date === today) {
        if (!ms) return false;
        return now >= matchStartMs + GAME_DURATION_MS;
      }
      return false;
    });

  // Trace reverse
  const reverseTrace: { subIdx: number; removed: number[]; added: number[]; anyAddedPresent: boolean; applied: boolean; before: number[]; after: number[] }[] = [];
  let initialIds = [...currentIds];
  for (let i = subs.length - 1; i >= 0; i--) {
    const s = subs[i];
    const removed = s.removed_player_ids ?? [];
    const added = s.added_player_ids ?? [];
    const anyAddedPresent = added.length > 0 && added.some((id) => initialIds.includes(id));
    const before = [...initialIds];
    if (anyAddedPresent) {
      initialIds = initialIds.filter((id) => !added.includes(id)).concat(removed);
    }
    reverseTrace.push({
      subIdx: i + 1,
      removed,
      added,
      anyAddedPresent,
      applied: anyAddedPresent,
      before,
      after: [...initialIds],
    });
  }

  // Trace apply for each week
  const pointsMap = new Map<string, number>();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, Number(s.fantasy_points ?? 0));
  }

  const weekTraces: { week: number; matchId: string; matchDate: string; applyTrace: unknown[]; finalRoster: number[]; rosterWithNames: { id: number; name: string; pts: number }[] }[] = [];

  for (let i = 0; i < scheduleFiltered.length; i++) {
    const row = scheduleFiltered[i];
    const matchDate = row.match_date as string;
    const matchId = row.match_id as string;
    const matchCutoff = new Date(matchDate + "T23:59:59.999Z").getTime();

    const applyTrace: { subIdx: number; removed: number[]; added: number[]; appliesToThisMatch: boolean; allRemovedPresent: boolean; applied: boolean; before: number[]; after: number[] }[] = [];
    let rosterIds = [...initialIds];

    for (let j = 0; j < subs.length; j++) {
      const s = subs[j];
      const effectiveMatchId = s.effective_match_id as string | null;
      const createdAt = new Date(s.created_at).getTime();
      const appliesToThisMatch = effectiveMatchId
        ? String(effectiveMatchId) === String(matchId)
        : createdAt <= matchCutoff;
      const removed = s.removed_player_ids ?? [];
      const added = s.added_player_ids ?? [];
      const allRemovedPresent = removed.length > 0 && removed.every((id) => rosterIds.includes(id));
      const before = [...rosterIds];
      if (appliesToThisMatch && allRemovedPresent) {
        const after = rosterIds.filter((id) => !removed.includes(id)).concat(added);
        if (after.length === 5) rosterIds = after;
      }
      applyTrace.push({
        subIdx: j + 1,
        removed,
        added,
        appliesToThisMatch,
        allRemovedPresent,
        applied: appliesToThisMatch && allRemovedPresent,
        before,
        after: [...rosterIds],
      });
    }

    // For last played match: use roster that played (pending_subs applied if not yet synced)
    const effectiveRosterIds = matchId === lastPlayedMatchId ? [...rosterThatPlayedLastMatch] : rosterIds;

    const rosterWithNames = effectiveRosterIds.map((pid) => ({
      id: pid,
      name: getName(pid),
      pts: pointsMap.get(`${pid}:${matchId}`) ?? 0,
    }));

    weekTraces.push({
      week: row.weekNum,
      matchId,
      matchDate,
      applyTrace,
      finalRoster: rosterIds,
      rosterWithNames,
    });
  }

  return NextResponse.json({
    season,
    currentRoster: currentIds.map((id) => ({ id, name: getName(id) })),
    pendingSubs: pendingSubs ?? null,
    rosterThatPlayedLastMatch: rosterThatPlayedLastMatch.map((id) => ({ id, name: getName(id) })),
    subsCount: subs.length,
    subs: subs.map((s, i) => ({
      idx: i + 1,
      removed: s.removed_player_ids,
      added: s.added_player_ids,
      created_at: s.created_at,
      effective_match_id: s.effective_match_id,
    })),
    reverseTrace,
    initialIds,
    initialIdsWithNames: initialIds.map((id) => ({ id, name: getName(id) })),
    lastPlayedMatchId,
    weekTraces,
    scheduleFiltered: scheduleFiltered.map((r) => ({ week: r.weekNum, matchId: r.match_id, matchDate: r.match_date })),
  });
}
