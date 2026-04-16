/**
 * U21dle daily puzzle - Supabase primary, JSON fallback.
 * Holdemle-style: use most recent date ≤ today when today's puzzle isn't published yet.
 * Once a puzzle is set for a date, it is never overwritten.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getU21dlePlayerById } from "./players";
import type { U21dlePlayer } from "./feedback";
import { calendarDateInPuzzleTZ } from "./puzzle-date";

/** Path to daily puzzle JSON (fallback when Supabase unavailable) */
const DAILY_PATH = join(process.cwd(), "data", "u21dle_daily.json");

function loadDailyFromJson(): Record<string, number> {
  if (!existsSync(DAILY_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(DAILY_PATH, "utf-8"));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

async function loadDailyFromSupabase(): Promise<Record<string, number>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return {};

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("u21dle_puzzles")
      .select("puzzle_date, player_id");
    if (error) return {};
    const out: Record<string, number> = {};
    for (const row of data ?? []) {
      out[row.puzzle_date] = row.player_id;
    }
    return out;
  } catch {
    return {};
  }
}

/** Supabase first, then JSON; includes source and optional DB error for API debug. */
export async function loadDailyDataWithSource(): Promise<{
  data: Record<string, number>;
  source: "supabase" | "json" | "empty";
  supabaseError: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let supabaseError: string | null = null;

  if (url && key) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key);
      const { data, error } = await supabase
        .from("u21dle_puzzles")
        .select("puzzle_date, player_id");
      if (error) {
        supabaseError = error.message;
      } else {
        const out: Record<string, number> = {};
        for (const row of data ?? []) {
          out[row.puzzle_date] = row.player_id;
        }
        if (Object.keys(out).length > 0) {
          return { data: out, source: "supabase", supabaseError: null };
        }
      }
    } catch (e) {
      supabaseError = e instanceof Error ? e.message : String(e);
    }
  }

  const fromJson = loadDailyFromJson();
  if (Object.keys(fromJson).length > 0) {
    return { data: fromJson, source: "json", supabaseError };
  }
  return { data: {}, source: "empty", supabaseError };
}

/** Load daily data: Supabase first, JSON fallback */
async function loadDailyData(): Promise<Record<string, number>> {
  const { data } = await loadDailyDataWithSource();
  return data;
}

/**
 * Returns the most recent puzzle_date that exists, where puzzle_date <= today (Israel calendar day).
 * Before the daily cron runs, this may return yesterday's date.
 */
export async function getCurrentPuzzleDate(): Promise<string | null> {
  const today = calendarDateInPuzzleTZ(new Date());
  const data = await loadDailyData();
  const dates = Object.keys(data).filter((d) => d <= today).sort();
  if (dates.length === 0) return null;
  return dates[dates.length - 1] ?? null;
}

/**
 * Get the daily puzzle player for a date.
 */
export async function getDailyPlayer(dateStr: string): Promise<U21dlePlayer | null> {
  const data = await loadDailyData();
  const playerId = data[dateStr];
  if (playerId == null) return null;
  return getU21dlePlayerById(playerId) ?? null;
}
