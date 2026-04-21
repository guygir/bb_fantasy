import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchFantasyGameStatsForScheduleMatchIds, getLastPlayedMatchFP } from "@/lib/fantasy-db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const ROSTER_SIZE = 5;

type SubRow = {
  removed_player_ids?: number[] | null;
  added_player_ids?: number[] | null;
  created_at?: string | null;
  effective_match_id?: string | null;
};

/** Roster at lock for a match by replaying subs forward from reversed initial roster. */
function reconstructRosterForMatch(
  matchId: string,
  matchDate: string,
  initialIds: number[],
  subs: SubRow[]
): number[] {
  const matchCutoff = new Date(matchDate + "T23:59:59.999Z").getTime();
  let rosterIds = [...initialIds];
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
  return rosterIds;
}

function sameSortedPlayerSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

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
 *
 * Query: `?debug=1` — includes `debug` object (env, last-week roster source vs candidates) to compare
 * localhost vs production. Roster page in development requests this automatically and logs `debug` to the console.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? 71);
  const debugRequested = new URL(request.url).searchParams.get("debug") === "1";

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
  const [lastPlayedFP, scheduleRes, rosterRes, rosterByMatchRes, subsRes] = await Promise.all([
    getLastPlayedMatchFP(seasonNum),
    admin
      .from("fantasy_schedule")
      .select("match_id, match_date, match_start")
      .eq("season", seasonNum)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true }),
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

  const fullScheduleForStats = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];
  console.log("[weekly-history] fullSchedule from DB:", fullScheduleForStats.length, "rows, match_ids:", fullScheduleForStats.map(r => r.match_id).join(","));
  const scheduleMatchIds = fullScheduleForStats.map((r) => String(r.match_id));
  let stats: { player_id: number; match_id: string; name: string | null; fantasy_points: number | null }[] = [];
  try {
    stats = await fetchFantasyGameStatsForScheduleMatchIds(admin, seasonNum, scheduleMatchIds);
  } catch (e) {
    console.error("weekly-history game stats:", e);
    return NextResponse.json({ error: "Failed to load game stats" }, { status: 500 });
  }
  const roster = rosterRes.data;
  const subs = (subsRes.data ?? []) as SubRow[];
  const rosterByMatchRows = (rosterByMatchRes.data ?? []) as { match_id: string | number; player_ids: number[] }[];
  // Keys must be normalized: PostgREST can return match_id as number; schedule uses string — Map.get would miss.
  const rosterByMatch = new Map(rosterByMatchRows.map((r) => [String(r.match_id), r.player_ids]));

  if (!roster?.player_ids?.length) {
    return NextResponse.json({ weeks: [] });
  }

  const pickedAtMs = roster.picked_at ? new Date(roster.picked_at as string).getTime() : 0;
  const currentIds = roster.player_ids as number[];
  const playerNames = (roster.player_names ?? {}) as Record<string, string>;

  const fullSchedule = fullScheduleForStats;
  const lastPlayedMatchId = lastPlayedFP.lastPlayedMatchId;
  const lastPlayedRow = fullSchedule.find((r) => String(r.match_id) === String(lastPlayedMatchId));
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
      const pickedAfterStart = pickedAtMs >= matchStartMs;
      const isFuture = row.match_date > today;
      const isPast = row.match_date < today;
      const isToday = row.match_date === today;
      const isTodayFinished = isToday && ms && now >= matchStartMs + GAME_DURATION_MS;
      
      // Debug SF match filtering
      if (String(row.match_id) === "84052") {
        console.log("[weekly-history] SF match filter:", {
          match_id: row.match_id,
          match_date: row.match_date,
          today,
          pickedAtMs,
          matchStartMs,
          pickedAfterStart,
          isFuture,
          isPast,
          isToday,
          isTodayFinished,
          include: !pickedAfterStart && (isPast || isTodayFinished),
        });
      }
      
      if (pickedAfterStart) return false; // User picked after game started
      if (isFuture) return false;
      if (isPast) return true; // Past game, include
      if (isToday) {
        if (!ms) return false;
        return now >= matchStartMs + GAME_DURATION_MS; // Include only if game has finished
      }
      return false;
    });
  
  console.log("[weekly-history] scheduleFiltered count:", scheduleFiltered.length, "last weekNum:", scheduleFiltered.at(-1)?.weekNum);

  /** User's last counted week (may differ from league lastPlayedMatchId — e.g. picked after lock, UTC date edge). */
  const userLastMatchId =
    scheduleFiltered.length > 0 ? String(scheduleFiltered[scheduleFiltered.length - 1].match_id) : null;

  // Direct fetch for the last match snapshot: bulk select sometimes omits a row (limits/PostgREST); PK lookup is reliable.
  let lastMatchSnapshotIds: number[] | null = null;
  if (userLastMatchId) {
    const snapQuery = (matchKey: string | number) =>
      admin
        .from("fantasy_roster_by_match")
        .select("player_ids")
        .eq("user_id", user.id)
        .eq("season", seasonNum)
        .eq("match_id", matchKey)
        .maybeSingle();
    let { data: lastSnap } = await snapQuery(userLastMatchId);
    if (!lastSnap?.player_ids?.length) {
      const n = Number(userLastMatchId);
      if (!Number.isNaN(n)) {
        ({ data: lastSnap } = await snapQuery(n));
      }
    }
    const ids = lastSnap?.player_ids as number[] | undefined;
    if (ids?.length) {
      lastMatchSnapshotIds = [...ids];
      rosterByMatch.set(String(userLastMatchId), ids);
    }
  }

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
  /** Fallback roster for a specific match when pending_subs apply to that match_id (not only global last game). */
  const rosterFallbackForMatch = (matchId: string): number[] => {
    if (pendingSubs?.effective_match_id && String(pendingSubs.effective_match_id) === String(matchId)) {
      const removed = pendingSubs.removed_ids ?? [];
      const added = pendingSubs.added_ids ?? [];
      return currentIds.filter((id) => !removed.includes(id)).concat(added);
    }
    return [...currentIds];
  };

  // Points by (player_id, match_id)
  const pointsMap = new Map<string, number>();
  const nameMap = new Map<number, string>();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${String(s.match_id)}`, Number(s.fantasy_points ?? 0));
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

  let lastWeekResolutionDebug: {
    matchId: string;
    matchDate: string;
    source: "reconstructed" | "fallback" | "snapshot";
    chosenPlayerIds: number[];
    candidates: {
      reconstructed: { ids: number[]; length: number };
      fallback: { ids: number[]; length: number };
      snapshot: { ids: number[] | null };
    };
    candidateTotalsFp: {
      snapshot: number | null;
      reconstructed: number;
      fallback: number;
    };
    sameSortedSet: {
      snapshotVsReconstructed: boolean;
      snapshotVsFallback: boolean;
      reconstructedVsFallback: boolean;
    };
  } | null = null;

  for (let i = 0; i < scheduleFiltered.length; i++) {
    const row = scheduleFiltered[i];
    const matchDate = row.match_date as string;
    const matchId = row.match_id as string;

    let rosterIds: number[];
    const snapshot = rosterByMatch.get(String(matchId));
    const reconstructed = reconstructRosterForMatch(matchId, matchDate, initialIds, subs);

    // User's last week: prefer fantasy_roster_by_match when sync wrote 5 IDs (authoritative for finished games).
    // Subs reconstruction can still yield 5 wrong IDs (replay order / effective_match edge cases) — do not prefer it over snapshot.
    // Order: snapshot (5) → reconstructed (5) → fallback (5) → partial snapshot → fallback.
    if (userLastMatchId && String(matchId) === userLastMatchId) {
      const fallbackIds = rosterFallbackForMatch(matchId);
      const snap = snapshot && snapshot.length > 0 ? [...snapshot] : null;
      let source: "reconstructed" | "fallback" | "snapshot";
      if (snap && snap.length === ROSTER_SIZE) {
        rosterIds = snap;
        source = "snapshot";
      } else if (reconstructed.length === ROSTER_SIZE) {
        rosterIds = reconstructed;
        source = "reconstructed";
      } else if (fallbackIds.length === ROSTER_SIZE) {
        rosterIds = fallbackIds;
        source = "fallback";
      } else if (snap) {
        rosterIds = snap;
        source = "snapshot";
      } else {
        rosterIds = fallbackIds;
        source = "fallback";
      }
      if (debugRequested) {
        const rec = [...reconstructed];
        const fb = [...fallbackIds];
        const sumFp = (ids: number[]) =>
          ids.reduce((s, pid) => s + (pointsMap.get(`${pid}:${String(matchId)}`) ?? 0), 0);
        lastWeekResolutionDebug = {
          matchId: String(matchId),
          matchDate,
          source,
          chosenPlayerIds: [...rosterIds],
          candidates: {
            reconstructed: { ids: rec, length: rec.length },
            fallback: { ids: fb, length: fb.length },
            snapshot: { ids: snap },
          },
          candidateTotalsFp: {
            snapshot: snap ? sumFp(snap) : null,
            reconstructed: sumFp(rec),
            fallback: sumFp(fb),
          },
          sameSortedSet: {
            snapshotVsReconstructed: snap ? sameSortedPlayerSet(snap, rec) : false,
            snapshotVsFallback: snap ? sameSortedPlayerSet(snap, fb) : false,
            reconstructedVsFallback: sameSortedPlayerSet(rec, fb),
          },
        };
      }
    } else if (snapshot && snapshot.length > 0) {
      rosterIds = snapshot;
    } else {
      rosterIds = reconstructed;
    }

    const rosterEntries: { playerId: number; name: string; points: number }[] = [];
    let total = 0;
    for (const pid of rosterIds) {
      const pts = pointsMap.get(`${pid}:${String(matchId)}`) ?? 0;
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

  const body: Record<string, unknown> = {
    weeks,
    lastPlayedMatchId,
    /** Match id for the user's last counted week (aligns with weeks[last]); use for FP fallbacks on the client */
    lastWeekMatchId: userLastMatchId,
    wasEligibleForLastPlayed,
  };

  if (debugRequested) {
    body.debug = {
      env: {
        nodeEnv: process.env.NODE_ENV ?? null,
        vercel: process.env.VERCEL === "1",
      },
      season: seasonNum,
      gameStatsRowCount: stats.length,
      scheduleFilteredWeekCount: scheduleFiltered.length,
      leagueLastPlayedMatchId: lastPlayedMatchId,
      userLastMatchId,
      lastPlayedEqualsUserLast: String(lastPlayedMatchId) === String(userLastMatchId),
      lastWeekRosterResolution: lastWeekResolutionDebug,
      currentIdsFromDb: currentIds,
      initialIdsAfterReverseSubs: initialIds,
      pendingSubsFromDb: pendingSubs ?? null,
      pickedAt: roster.picked_at ?? null,
      lastMatchSnapshotDirectFetch: userLastMatchId
        ? {
            found: lastMatchSnapshotIds != null,
            length: lastMatchSnapshotIds?.length ?? 0,
            matchId: userLastMatchId,
          }
        : null,
      rosterByMatchBulkRowCount: rosterByMatchRows.length,
    };
    console.log("[weekly-history]", {
      userId: user.id,
      season: seasonNum,
      userLastMatchId,
      lastWeekSource: lastWeekResolutionDebug?.source,
      candidateTotalsFp: lastWeekResolutionDebug?.candidateTotalsFp,
      chosenTotal: weeks.length
        ? (() => {
            const w = weeks[weeks.length - 1];
            return { matchId: w.matchId, total: w.total, roster: w.roster.map((x) => ({ id: x.playerId, n: x.name, fp: x.points })) };
          })()
        : null,
    });
  }

  return NextResponse.json(
    body,
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    }
  );
}
