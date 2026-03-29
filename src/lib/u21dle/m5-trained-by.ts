/**
 * M5 "trained by" display (transfer + stats middle-@ rule).
 * Loaded from data/u21dle_m5_trained_by.json
 * Run: npm run generate-u21dle-m5
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getSourceTeam } from "./source-teams";
import { getEligiblePlayers } from "./players";

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

/** All eligible U21dle players → display label (M5 + fallback). Keys are string playerIds for JSON clients. */
export function getEligibleTrainedByMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of getEligiblePlayers()) {
    const t = getU21dleTrainedBy(p.playerId);
    if (t) out[String(p.playerId)] = t;
  }
  return out;
}
