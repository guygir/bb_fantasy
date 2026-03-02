/**
 * Schedule loader - BBAPI with JSON fallback
 * Merges match scores from parsed boxscores when available.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fetchIsraelU21Schedule } from "./bbapi";
import { loadMatchScores } from "./boxscore";
import { config } from "./config";

export interface ScheduleMatch {
  id: string;
  start: string;
  type: string;
  awayTeamId: string;
  awayTeamName: string;
  awayScore: string | null;
  homeTeamId: string;
  homeTeamName: string;
  homeScore: string | null;
}

function parseScheduleXml(xml: string): ScheduleMatch[] {
  const matches: ScheduleMatch[] = [];
  // Match each <match>...</match> block - support both single and double quotes
  const matchBlocks = xml.matchAll(/<match\s+id=['"](\d+)['"]\s+start=['"]([^'"]*)['"]\s+type=['"]([^'"]*)['"]\s*>([\s\S]*?)<\/match>/g);
  for (const m of matchBlocks) {
    const block = m[4];
    const awayTeam = block.match(/<awayTeam\s+id=['"](\d+)['"]\s*>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?/);
    const homeTeam = block.match(/<homeTeam\s+id=['"](\d+)['"]\s*>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?/);
    matches.push({
      id: m[1],
      start: m[2],
      type: m[3],
      awayTeamId: awayTeam?.[1] ?? "",
      awayTeamName: awayTeam?.[2] ?? "",
      awayScore: awayTeam?.[3] ?? null,
      homeTeamId: homeTeam?.[1] ?? "",
      homeTeamName: homeTeam?.[2] ?? "",
      homeScore: homeTeam?.[3] ?? null,
    });
  }
  return matches;
}

export function loadScheduleFromJson(season: number): ScheduleMatch[] | null {
  const path = join(process.cwd(), "data", `bbapi_schedule_s${season}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const matches = data.matches ?? null;
    if (Array.isArray(matches) && matches.length > 0) return matches;
    return null;
  } catch {
    return null;
  }
}

export async function getSchedule(season?: number): Promise<{
  matches: ScheduleMatch[];
  meta: { season: number; source: "bbapi" | "cache" };
  error?: string;
}> {
  const s = season ?? config.game.currentSeason;
  const result = await fetchIsraelU21Schedule(s);
  let matches: ScheduleMatch[] = [];
  let source: "bbapi" | "cache" = "bbapi";

  if (result.ok && result.xml) {
    matches = parseScheduleXml(result.xml);
  }
  if (matches.length === 0) {
    const cached = loadScheduleFromJson(s);
    if (cached && cached.length > 0) {
      matches = cached;
      source = "cache";
    }
  }

  // Merge scores from parsed boxscores (run: npm run process-boxscores)
  const matchScores = loadMatchScores(s);
  if (Object.keys(matchScores).length > 0) {
    matches = matches.map((m) => {
      const scores = matchScores[m.id];
      if (scores) {
        return {
          ...m,
          homeScore: String(scores.homeScore),
          awayScore: String(scores.awayScore),
        };
      }
      return m;
    });
  }

  if (matches.length === 0) {
    return {
      matches: [],
      meta: { season: s, source: "bbapi" },
      error: result.error ?? "No schedule data available",
    };
  }

  matches.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return { matches, meta: { season: s, source } };
}
