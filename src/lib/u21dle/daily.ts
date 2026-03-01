/**
 * U21dle daily puzzle - Supabase primary, JSON fallback.
 * Holdemle-style: use most recent date ≤ today when today's puzzle isn't published yet.
 * Once a puzzle is set for a date, it is never overwritten.
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

async function loadDailyFromSupabase(): Promise<Record<string, number>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return {};

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("u21dle_daily")
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

/** Load daily data: Supabase first, JSON fallback */
async function loadDailyData(): Promise<Record<string, number>> {
  const fromDb = await loadDailyFromSupabase();
  if (Object.keys(fromDb).length > 0) return fromDb;
  return loadDailyFromJson();
}

/**
 * Returns the most recent puzzle_date that exists, where puzzle_date <= today.
 * Before the daily cron runs, this may return yesterday's date.
 */
export async function getCurrentPuzzleDate(): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
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
