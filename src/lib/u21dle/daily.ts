/**
 * U21dle daily puzzle - Supabase primary, JSON fallback.
 * Holdemle-style: use most recent date ≤ today when today's puzzle isn't published yet.
 * Once a puzzle is set for a date, it is never overwritten.
 * Uses Israel timezone (Asia/Jerusalem) for "today" so localhost and Vercel match.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getU21dlePlayerById } from "./players";
import type { U21dlePlayer } from "./feedback";

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

async function loadDailyFromSupabase(): Promise<{
  data: Record<string, number>;
  error?: string;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { data: {}, error: "Missing Supabase URL or anon key" };

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("u21dle_puzzles")
      .select("puzzle_date, player_id");
    if (error) return { data: {}, error: error.message };
    const out: Record<string, number> = {};
    for (const row of data ?? []) {
      out[row.puzzle_date] = row.player_id;
    }
    return { data: out };
  } catch (e) {
    return { data: {}, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/** Load daily data: Supabase first, JSON fallback */
export type DailyDataSource = "supabase" | "json";

export async function loadDailyData(): Promise<Record<string, number>> {
  const { data } = await loadDailyFromSupabase();
  if (Object.keys(data).length > 0) return data;
  return loadDailyFromJson();
}

export async function loadDailyDataWithSource(): Promise<{
  data: Record<string, number>;
  source: DailyDataSource;
  supabaseError?: string;
}> {
  const fromDb = await loadDailyFromSupabase();
  if (Object.keys(fromDb.data).length > 0) {
    return { data: fromDb.data, source: "supabase" };
  }
  const fromJson = loadDailyFromJson();
  return {
    data: fromJson,
    source: "json",
    supabaseError: fromDb.error,
  };
}

/** Today's date in Israel timezone (YYYY-MM-DD). Uses formatToParts for consistent format on Vercel. */
export function getTodayIsrael(): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Returns the most recent puzzle_date that exists, where puzzle_date <= today.
 * Uses Israel timezone so puzzle switches at midnight Israel time.
 */
export async function getCurrentPuzzleDate(): Promise<string | null> {
  const today = getTodayIsrael();
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
