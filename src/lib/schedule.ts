/**
 * Schedule loader - BBAPI with JSON and Supabase fallbacks.
 * Priority: BBAPI (live) → local JSON cache → Supabase fantasy_schedule (always current from cron).
 * Merges match scores from parsed boxscores / fantasy_matches when available.
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase fallback / supplement: use fantasy_schedule (always current from cron) when:
  // (a) BBAPI and local JSON both failed, OR
  // (b) local JSON is stale — Supabase has match IDs not present in the cached JSON
  //     (e.g. SF/Final added to schedule mid-season after the last deployment).
  if (url && anonKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, anonKey);
      const [scheduleRes, matchesRes] = await Promise.all([
        supabase
          .from("fantasy_schedule")
          .select("match_id, match_start, home_team_id, away_team_id, home_team_name, away_team_name, match_type")
          .eq("season", s)
          .not("match_date", "is", null)
          .order("match_date", { ascending: true }),
        supabase
          .from("fantasy_matches")
          .select("match_id, home_score, away_score")
          .eq("season", s),
      ]);
      if (scheduleRes.data?.length) {
        const scoreById = new Map(
          (matchesRes.data ?? []).map((r) => [String(r.match_id), r])
        );
        if (matches.length === 0) {
          // Full fallback: build entirely from Supabase
          matches = scheduleRes.data.map((r) => {
            const scores = scoreById.get(String(r.match_id));
            return {
              id: String(r.match_id),
              start: r.match_start ?? "",
              type: r.match_type ?? "",
              homeTeamId: String(r.home_team_id ?? ""),
              homeTeamName: r.home_team_name ?? `Team ${r.home_team_id ?? "?"}`,
              awayTeamId: String(r.away_team_id ?? ""),
              awayTeamName: r.away_team_name ?? `Team ${r.away_team_id ?? "?"}`,
              homeScore: scores?.home_score != null ? String(scores.home_score) : null,
              awayScore: scores?.away_score != null ? String(scores.away_score) : null,
            };
          });
          source = "cache";
        } else {
          // Supplement: add any match IDs in Supabase that are missing from the cached JSON,
          // and update scores for existing matches from fantasy_matches.
          const knownIds = new Set(matches.map((m) => String(m.id)));
          for (const r of scheduleRes.data) {
            if (knownIds.has(String(r.match_id))) continue;
            const scores = scoreById.get(String(r.match_id));
            matches.push({
              id: String(r.match_id),
              start: r.match_start ?? "",
              type: r.match_type ?? "",
              homeTeamId: String(r.home_team_id ?? ""),
              homeTeamName: r.home_team_name ?? `Team ${r.home_team_id ?? "?"}`,
              awayTeamId: String(r.away_team_id ?? ""),
              awayTeamName: r.away_team_name ?? `Team ${r.away_team_id ?? "?"}`,
              homeScore: scores?.home_score != null ? String(scores.home_score) : null,
              awayScore: scores?.away_score != null ? String(scores.away_score) : null,
            });
          }
          // Also update scores for existing matches (scoreById already fetched above)
          matches = matches.map((m) => {
            const row = scoreById.get(String(m.id));
            if (row?.home_score != null && row?.away_score != null) {
              return { ...m, homeScore: String(row.home_score), awayScore: String(row.away_score) };
            }
            return m;
          });
        }
      }
    } catch {
      /* ignore — will return error below if still empty */
    }
  }

  // Merge scores from local process-boxscores JSON (last resort / offline dev)
  const matchScores = loadMatchScores(s);
  if (Object.keys(matchScores).length > 0) {
    matches = matches.map((m) => {
      const scores = matchScores[m.id];
      if (scores) {
        return { ...m, homeScore: String(scores.homeScore), awayScore: String(scores.awayScore) };
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
