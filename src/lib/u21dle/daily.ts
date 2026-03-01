/**
 * U21dle daily puzzle - from JSON file.
 * Holdemle-style: use most recent date ≤ today when today's puzzle isn't published yet.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getU21dlePlayerById } from "./players";
import type { U21dlePlayer } from "./feedback";

/** Path to daily puzzle JSON (date -> playerId) */
const DAILY_PATH = join(process.cwd(), "data", "u21dle_daily.json");

function loadDailyData(): Record<string, number> {
  if (!existsSync(DAILY_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(DAILY_PATH, "utf-8"));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

/**
 * Returns the most recent puzzle_date that exists in the DB, where puzzle_date <= today.
 * Before the daily cron runs, this may return yesterday's date.
 */
export function getCurrentPuzzleDate(): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const data = loadDailyData();
  const dates = Object.keys(data).filter((d) => d <= today).sort();
  if (dates.length === 0) return null;
  return dates[dates.length - 1] ?? null;
}

/**
 * Get the daily puzzle player for a date.
 * Date must exist in u21dle_daily.json.
 */
export function getDailyPlayer(dateStr: string): U21dlePlayer | null {
  const data = loadDailyData();
  const playerId = data[dateStr];
  if (playerId == null) return null;
  return getU21dlePlayerById(playerId) ?? null;
}
