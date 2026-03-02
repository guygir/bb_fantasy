/**
 * U21dle daily puzzle - Supabase primary, JSON fallback.
 * Same approach as Holdemle/Riftle: UTC today, DB query with .lte().order().limit(1).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getU21dlePlayerById } from "./players";
import type { U21dlePlayer } from "./feedback";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Same as Holdemle/Riftle: UTC today, query DB with .lte().order().limit(1). Use service role to bypass RLS. */
export async function getCurrentPuzzleDate(supabase: SupabaseClient): Promise<string | null> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("u21dle_puzzles")
    .select("puzzle_date")
    .lte("puzzle_date", today)
    .order("puzzle_date", { ascending: false })
    .limit(1);
  const row = Array.isArray(data) ? data[0] : data;
  const result = row?.puzzle_date ?? null;
  console.log("[u21dle getCurrentPuzzleDate]", { today, rawData: data, error: error?.message, result });
  return result;
}

/** Load daily data: Supabase first, JSON fallback (for getDailyPlayer when no supabase passed) */
export type DailyDataSource = "supabase" | "json";

async function loadDailyFromSupabase(): Promise<{
  data: Record<string, number>;
  error?: string;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { data: {}, error: "Missing Supabase URL or anon key" };

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, key);
    const { data, error } = await client
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

/**
 * Get the daily puzzle player for a date.
 */
export async function getDailyPlayer(dateStr: string): Promise<U21dlePlayer | null> {
  const data = await loadDailyData();
  const playerId = data[dateStr];
  if (playerId == null) return null;
  return getU21dlePlayerById(playerId) ?? null;
}
