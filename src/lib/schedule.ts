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
    console.log("[getSchedule] Loaded from BBAPI:", matches.length, "matches");
  }
  if (matches.length === 0) {
    const cached = loadScheduleFromJson(s);
    if (cached && cached.length > 0) {
      matches = cached;
      source = "cache";
      console.log("[getSchedule] Loaded from local JSON:", matches.length, "matches");
      // Debug: show SF match from local JSON
      const sf = matches.find((m) => m.type?.includes("semifinal") || m.id === "84052");
      if (sf) console.log("[getSchedule] SF match from local JSON:", { id: sf.id, type: sf.type, homeScore: sf.homeScore, awayScore: sf.awayScore });
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
      // Check for query errors
      if (scheduleRes.error) {
        console.error("[getSchedule] Supabase fantasy_schedule error:", scheduleRes.error);
      }
      if (matchesRes.error) {
        console.error("[getSchedule] Supabase fantasy_matches error:", matchesRes.error);
      }
      console.log("[getSchedule] Supabase fantasy_schedule rows:", scheduleRes.data?.length ?? 0);
      console.log("[getSchedule] Supabase fantasy_matches rows:", matchesRes.data?.length ?? 0);

      if (scheduleRes.data?.length) {
        const scoreById = new Map(
          (matchesRes.data ?? []).map((r) => [String(r.match_id), r])
        );
        // Debug: check if SF score is in Supabase
        const sfScore = scoreById.get("84052");
        console.log("[getSchedule] SF score from Supabase:", sfScore ? { home: sfScore.home_score, away: sfScore.away_score } : "NOT FOUND");
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
          console.log("[getSchedule] Known IDs from local JSON:", Array.from(knownIds).join(", "));
          for (const r of scheduleRes.data) {
            if (knownIds.has(String(r.match_id))) continue;
            const scores = scoreById.get(String(r.match_id));
            console.log(`[getSchedule] Adding missing match ${r.match_id} from Supabase:`, { type: r.match_type, scores: scores ? { home: scores.home_score, away: scores.away_score } : null });
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
            if (row) {
              if (m.id === "84052") {
                console.log("[getSchedule] Updating SF score from Supabase:", { before: { home: m.homeScore, away: m.awayScore }, after: { home: row.home_score, away: row.away_score } });
              }
              return {
                ...m,
                homeScore: row.home_score != null ? String(row.home_score) : m.homeScore,
                awayScore: row.away_score != null ? String(row.away_score) : m.awayScore,
              };
            }
            return m;
          });
        }
      }
    } catch (e) {
      console.error("[getSchedule] Supabase error:", e);
    }
  }

  // Merge scores from local process-boxscores JSON (last resort / offline dev)
  const matchScores = loadMatchScores(s);
  console.log("[getSchedule] Local match_scores JSON has", Object.keys(matchScores).length, "matches");
  if (Object.keys(matchScores).length > 0) {
    const sfLocalScore = matchScores["84052"];
    console.log("[getSchedule] SF score from local JSON:", sfLocalScore ?? "NOT FOUND");
    matches = matches.map((m) => {
      const scores = matchScores[m.id];
      if (scores) {
        return { ...m, homeScore: String(scores.homeScore), awayScore: String(scores.awayScore) };
      }
      return m;
    });
  }

  // Final debug: check SF after all merges
  const finalSf = matches.find((m) => m.id === "84052");
  console.log("[getSchedule] Final SF match:", finalSf ? { id: finalSf.id, homeScore: finalSf.homeScore, awayScore: finalSf.awayScore } : "NOT FOUND");

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
