/**
 * Sub lock: substitutions open from 1h after previous game until 1h before next game.
 * All times UTC (BBAPI schedule uses UTC).
 * Pending subs stored in fantasy_user_rosters.pending_subs, applied when game is played.
 */

const HOUR_MS = 60 * 60 * 1000;

export interface SubWindow {
  open: boolean;
  nextOpenAt?: string;
  nextCloseAt?: string;
  /** When auth provided: true if user already made subs for the upcoming game (one round per game) */
  subsUsedThisWindow?: boolean;
  /** Next match_id (when window open and a next game exists) - for storing effective_match_id */
  nextMatchId?: string;
}

/** Check if sub window is open. Requires fantasy_schedule with match_start populated. Server-side only. */
export async function getSubWindow(season: number, userId?: string): Promise<SubWindow> {
  const { getSupabase } = await import("@/lib/supabase");
  const supabase = getSupabase();
  const { data } = await supabase
    .from("fantasy_schedule")
    .select("match_id, match_start")
    .eq("season", season)
    .not("match_start", "is", null)
    .order("match_start", { ascending: true });

  const matches = (data ?? []) as { match_id: string; match_start: string | null }[];
  const withTime = matches
    .map((m) => ({ matchId: m.match_id, time: new Date(m.match_start!).getTime() }))
    .filter((m) => !isNaN(m.time))
    .sort((a, b) => a.time - b.time);

  if (withTime.length === 0) return { open: true };

  const now = Date.now();
  const first = withTime[0];
  const last = withTime[withTime.length - 1];

  // Before first game: open until 1h before first game
  if (now < first.time - HOUR_MS) {
    const result: SubWindow = {
      open: true,
      nextCloseAt: new Date(first.time - HOUR_MS).toISOString(),
      nextMatchId: first.matchId,
    };
    await addSubsUsedCheck(supabase, season, userId, first.matchId, result);
    return result;
  }

  // After last game: open from 1h after last game (no next match)
  if (now >= last.time + HOUR_MS) {
    const result: SubWindow = { open: true };
    await addSubsUsedCheck(supabase, season, userId, undefined, result);
    return result;
  }

  // Closed window: within 1h before or 1h after any game
  const closedGame = withTime.find((m) => now >= m.time - HOUR_MS && now <= m.time + HOUR_MS);
  if (closedGame != null) {
    return {
      open: false,
      nextOpenAt: new Date(closedGame.time + HOUR_MS).toISOString(),
    };
  }

  // Open: between games
  const nextGame = withTime.find((m) => m.time > now);
  const result: SubWindow = {
    open: true,
    nextCloseAt: nextGame ? new Date(nextGame.time - HOUR_MS).toISOString() : undefined,
    nextMatchId: nextGame?.matchId,
  };
  await addSubsUsedCheck(supabase, season, userId, nextGame?.matchId, result);
  return result;
}

async function addSubsUsedCheck(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase")["getSupabase"]>>,
  season: number,
  userId: string | undefined,
  nextMatchId: string | undefined,
  result: SubWindow
) {
  if (!userId) return;
  // Check pending_subs: user has subs queued for the next match
  if (nextMatchId) {
    const { data: roster } = await supabase
      .from("fantasy_user_rosters")
      .select("pending_subs")
      .eq("user_id", userId)
      .eq("season", season)
      .maybeSingle();
    const ps = roster?.pending_subs as { effective_match_id?: string } | null;
    result.subsUsedThisWindow = ps?.effective_match_id === nextMatchId;
    return;
  }
  result.subsUsedThisWindow = false;
}
