/**
 * M5 "trained by" display (transfer + stats middle-@ rule).
 * Loaded from data/u21dle_m5_trained_by.json
 * Run: npm run generate-u21dle-m5
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getSourceTeam } from "./source-teams";

let cachedMap: Record<number, string> | null = null;

export function getM5TrainedByMap(): Record<number, string> {
  if (cachedMap) return cachedMap;
  const path = join(process.cwd(), "data", "u21dle_m5_trained_by.json");
  if (!existsSync(path)) {
    cachedMap = {};
    return cachedMap;
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    trainedBy?: Record<string, string>;
  };
  cachedMap = {};
  for (const [k, v] of Object.entries(raw.trainedBy ?? {})) {
    if (v != null && String(v).trim() !== "") {
      cachedMap[Number(k)] = String(v).trim();
    }
  }
  return cachedMap;
}

/** Prefer M5 string; if missing (file or player), fall back to raw source team from u21dle_source_teams.json. */
export function getU21dleTrainedBy(playerId: number): string | null {
  const m5 = getM5TrainedByMap()[playerId];
  if (m5 != null) return m5;
  return getSourceTeam(playerId);
}
