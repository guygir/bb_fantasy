/**
 * U21dle source teams - loaded from data/u21dle_source_teams.json
 * Run: npm run fetch-u21dle-source-teams
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

let cachedMap: Record<number, string> | null = null;

export function getSourceTeamsMap(): Record<number, string> {
  if (cachedMap) return cachedMap;
  const path = join(process.cwd(), "data", "u21dle_source_teams.json");
  if (!existsSync(path)) {
    cachedMap = {};
    return cachedMap;
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
  cachedMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v) cachedMap[Number(k)] = v;
  }
  return cachedMap;
}

export function getSourceTeam(playerId: number): string | null {
  return getSourceTeamsMap()[playerId] ?? null;
}
