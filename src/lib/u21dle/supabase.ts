/**
 * U21dle Supabase helpers - puzzles, guesses, user stats.
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });
}

export interface PuzzleRow {
  id: string;
  puzzle_date: string;
  player_id: number;
}

/** Get puzzle by date (for cheat mode / past puzzles). Uses service role for reliable access on Vercel. */
export async function getPuzzleByDate(dateStr: string): Promise<PuzzleRow | null> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("u21dle_puzzles")
      .select("id, puzzle_date, player_id")
      .eq("puzzle_date", dateStr)
      .maybeSingle();
    if (error || !data) return null;
    return data as PuzzleRow;
  } catch {
    return null;
  }
}

/** Get puzzle ID by date */
export async function getPuzzleIdByDate(dateStr: string): Promise<string | null> {
  const p = await getPuzzleByDate(dateStr);
  return p?.id ?? null;
}

/** Save or update guess for user+puzzle */
export async function upsertGuess(
  accessToken: string,
  puzzleId: string,
  puzzleDate: string,
  data: {
    guessHistory: unknown[];
    guessesUsed: number;
    isSolved: boolean;
    timeTakenSeconds: number;
    totalScore: number;
    usedCheat?: boolean;
  }
): Promise<boolean> {
  const supabase = getSupabase(accessToken);
  if (!supabase) return false;

  const { data: user } = await supabase.auth.getUser(accessToken);
  if (!user?.user) return false;

  const { error } = await supabase.from("u21dle_guesses").upsert(
    {
      user_id: user.user.id,
      puzzle_id: puzzleId,
      guess_history: data.guessHistory,
      guesses_used: data.guessesUsed,
      is_solved: data.isSolved,
      time_taken_seconds: data.timeTakenSeconds,
      total_score: data.totalScore,
      used_cheat: data.usedCheat ?? false,
      submitted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,puzzle_id" }
  );
  return !error;
}

/** Get saved game state for user + puzzle date */
export async function getGameState(
  accessToken: string,
  puzzleDate: string
): Promise<{
  guessHistory: unknown[];
  gameOver: boolean;
  won: boolean;
  elapsed: number;
  usedCheat?: boolean;
} | null> {
  const supabase = getSupabase(accessToken);
  if (!supabase) return null;

  const puzzleId = await getPuzzleIdByDate(puzzleDate);
  if (!puzzleId) return null;

  const { data: user } = await supabase.auth.getUser(accessToken);
  if (!user?.user) return null;

  const { data, error } = await supabase
    .from("u21dle_guesses")
    .select("guess_history, guesses_used, is_solved, time_taken_seconds, used_cheat")
    .eq("user_id", user.user.id)
    .eq("puzzle_id", puzzleId)
    .maybeSingle();

  if (error || !data) return null;

  const guessHistory = (data.guess_history ?? []) as unknown[];
  const isSolved = !!data.is_solved;
  const guessesUsed = data.guesses_used ?? 0;
  const elapsed = data.time_taken_seconds ?? 0;
  const usedCheat = !!data.used_cheat;

  if (guessHistory.length === 0) return null;

  const gameOver = isSolved || guessesUsed >= 6;

  return {
    guessHistory,
    gameOver,
    won: isSolved,
    elapsed,
    usedCheat,
  };
}

/** Update user stats after a completed game */
export async function updateUserStats(
  accessToken: string,
  puzzleDate: string,
  result: { won: boolean; guessesUsed: number; usedCheat?: boolean }
): Promise<void> {
  const supabase = getSupabase(accessToken);
  if (!supabase) return;

  const { data: user } = await supabase.auth.getUser(accessToken);
  if (!user?.user) return;

  const { data: existing } = await supabase
    .from("u21dle_user_stats")
    .select("*")
    .eq("user_id", user.user.id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const lastPlayed = existing?.last_played_date as string | null;
  const currentStreak = existing?.current_streak ?? 0;
  const maxStreak = existing?.max_streak ?? 0;

  let newCurrentStreak = currentStreak;
  let newMaxStreak = maxStreak;

  if (result.won) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    newCurrentStreak = lastPlayed === yesterday ? currentStreak + 1 : 1;
    newMaxStreak = Math.max(maxStreak, newCurrentStreak);
  } else {
    newCurrentStreak = 0;
  }

  const totalGames = (existing?.total_games ?? 0) + 1;
  const failedGames = (existing?.failed_games ?? 0) + (result.won ? 0 : 1);
  const totalScore = (existing?.total_score ?? 0) + (result.won ? (7 - result.guessesUsed) : 0);
  const oldSolved = (existing?.total_games ?? 0) - (existing?.failed_games ?? 0);
  const newSolved = result.won ? oldSolved + 1 : oldSolved;
  const avgGuesses =
    newSolved > 0
      ? ((existing?.average_guesses ?? 0) * oldSolved + (result.won ? result.guessesUsed : 0)) / newSolved
      : 0;

  const dist = (existing?.solved_distribution ?? {}) as Record<string, number>;
  const cheatDist = (existing?.cheat_distribution ?? {}) as Record<string, number>;
  if (result.won) {
    const k = String(result.guessesUsed);
    dist[k] = (dist[k] ?? 0) + 1;
    if (result.usedCheat) {
      cheatDist[k] = (cheatDist[k] ?? 0) + 1;
    }
  }

  await supabase.from("u21dle_user_stats").upsert(
    {
      user_id: user.user.id,
      total_games: totalGames,
      failed_games: failedGames,
      current_streak: newCurrentStreak,
      max_streak: newMaxStreak,
      total_score: totalScore,
      average_guesses: avgGuesses,
      last_played_date: puzzleDate,
      solved_distribution: dist,
      cheat_distribution: cheatDist,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}
