/**
 * Sub lock: substitutions open from 1h after previous game until 1h before next game.
 * All times UTC (BBAPI schedule uses UTC).
 */

const HOUR_MS = 60 * 60 * 1000;

export interface SubWindow {
  open: boolean;
  nextOpenAt?: string;
  nextCloseAt?: string;
}

/** Check if sub window is open. Requires fantasy_schedule with match_start populated. Server-side only. */
export async function getSubWindow(season: number): Promise<SubWindow> {
  const { getSupabase } = await import("@/lib/supabase");
  const supabase = getSupabase();
  const { data } = await supabase
    .from("fantasy_schedule")
    .select("match_id, match_start")
    .eq("season", season)
    .not("match_start", "is", null)
    .order("match_start", { ascending: true });

  const matches = (data ?? []) as { match_id: string; match_start: string | null }[];
  const sorted = matches
    .map((m) => new Date(m.match_start!).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  if (sorted.length === 0) return { open: true };

  const now = Date.now();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Before first game: open until 1h before first game
  if (now < first - HOUR_MS) {
    return { open: true, nextCloseAt: new Date(first - HOUR_MS).toISOString() };
  }

  // After last game: open from 1h after last game
  if (now >= last + HOUR_MS) {
    return { open: true };
  }

  // Closed window: within 1h before or 1h after any game
  const closedGame = sorted.find((t) => now >= t - HOUR_MS && now <= t + HOUR_MS);
  if (closedGame != null) {
    return {
      open: false,
      nextOpenAt: new Date(closedGame + HOUR_MS).toISOString(),
    };
  }

  // Open: between games
  const nextGame = sorted.find((t) => t > now);
  return {
    open: true,
    nextCloseAt: nextGame ? new Date(nextGame - HOUR_MS).toISOString() : undefined,
  };
}
