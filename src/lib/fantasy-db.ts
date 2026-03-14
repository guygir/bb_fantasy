/**
 * Fantasy game data from Supabase.
 * Used when sync-fantasy has populated the tables. Returns same shapes as JSON-based libs.
 */

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase";
import { loadPlayerGameStats } from "./boxscore";
import { statsToFantasyPoints, fantasyPPGToPrice } from "./scoring";
import type { PlayerWithDetails } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSupabase() {
  if (!url || !key) return null;
  return createClient(url, key);
}

const GAME_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Last played match = most recent game that has finished (same logic as roster weekly-history).
 * Returns FP per player for that match (0 if DNP). Single source of truth for "Last week" / "Last game FP".
 * Uses service role to ensure stats/schedule are always readable (same as U21dle, leaderboard).
 */
export async function getLastPlayedMatchFP(season: number): Promise<{
  lastPlayedMatchId: string | null;
  playerFP: Record<number, number>;
}> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { lastPlayedMatchId: null, playerFP: {} };
  }

  const [scheduleRes, statsRes] = await Promise.all([
    supabase
      .from("fantasy_schedule")
      .select("match_id, match_date, match_start")
      .eq("season", season)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true })
      .range(0, 999),
    supabase
      .from("fantasy_player_game_stats")
      .select("player_id, match_id, fantasy_points")
      .eq("season", season)
      .range(0, 999),
  ]);

  const schedule = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];
  const stats = statsRes.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  let lastPlayedMatchId: string | null = null;
  for (let i = schedule.length - 1; i >= 0; i--) {
    const row = schedule[i];
    const ms = row.match_start;
    const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
    const isPlayed = row.match_date < today || (row.match_date === today && now >= matchStartMs + GAME_DURATION_MS);
    if (isPlayed) {
      lastPlayedMatchId = row.match_id;
      break;
    }
  }

  const playerFP: Record<number, number> = {};
  for (const s of stats) {
    if (String(s.match_id) === String(lastPlayedMatchId)) {
      playerFP[s.player_id] = Number(s.fantasy_points ?? 0);
    }
  }
  return { lastPlayedMatchId, playerFP };
}

/** Get player IDs that appear in /players for a season (for U21dle season override) */
export async function getSeasonPlayerIds(season: number): Promise<Set<number>> {
  try {
    if (await hasFantasyData(season)) {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from("fantasy_players")
        .select("player_id")
        .eq("season", season)
        .range(0, 999);
      return new Set((data ?? []).map((r) => r.player_id));
    }
  } catch {
    /* fall through to JSON */
  }
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const path = join(process.cwd(), "data", `season${season}_stats.json`);
  if (!existsSync(path)) return new Set();
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const players = data.players ?? [];
  return new Set(players.map((p: { playerId: number }) => p.playerId));
}

/** Check if fantasy tables have data for season */
export async function hasFantasyData(season: number): Promise<boolean> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return false;
  }
  const { data, error } = await supabase
    .from("fantasy_players")
    .select("player_id")
    .eq("season", season)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/** Get current price and previous price per player */
async function getCurrentPrices(season: number): Promise<Record<number, { price: number; previousPrice: number | null }>> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return {};
  }
  const { data, error } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price, previous_price")
    .eq("season", season)
    .range(0, 999);
  if (error || !data) return {};
  const out: Record<number, { price: number; previousPrice: number | null }> = {};
  for (const row of data) {
    out[row.player_id] = {
      price: row.price,
      previousPrice: row.previous_price != null ? row.previous_price : null,
    };
  }
  return out;
}

/** Get players with details from Supabase (same shape as getPlayersWithDetails) */
export async function getPlayersFromSupabase(season: number): Promise<PlayerWithDetails[] | null> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return null;
  }

  const [playersRes, detailsRes, pricesRes, gameStatsRes, lastPlayedFP] = await Promise.all([
    supabase.from("fantasy_players").select("*").eq("season", season).range(0, 999),
    supabase.from("fantasy_player_details").select("*").eq("season", season).range(0, 999),
    getCurrentPrices(season),
    supabase.from("fantasy_player_game_stats").select("player_id, match_id, fantasy_points").eq("season", season).range(0, 999),
    getLastPlayedMatchFP(season),
  ]);

  const players = playersRes.data ?? [];
  const detailsMap = new Map(
    (detailsRes.data ?? []).map((d) => [d.player_id, d])
  );
  const gameStats = gameStatsRes.data ?? [];
  const lastGameFPByPlayer = lastPlayedFP.playerFP;

  // Per player: total FP, gp (for fantasyPPG)
  const byPlayer = new Map<number, { total: number; gp: number }>();
  for (const s of gameStats) {
    const cur = byPlayer.get(s.player_id) ?? { total: 0, gp: 0 };
    cur.total += s.fantasy_points ?? 0;
    cur.gp += 1;
    byPlayer.set(s.player_id, cur);
  }

  const results: PlayerWithDetails[] = players.map((p) => {
    const d = detailsMap.get(p.player_id);
    const stats = {
      min: p.min,
      fgMade: 0,
      fgAtt: 0,
      tpMade: 0,
      tpAtt: 0,
      ftMade: 0,
      ftAtt: 0,
      or: 0,
      tr: p.tr ?? 0,
      ast: p.ast ?? 0,
      to: p.to ?? 0,
      stl: p.stl ?? 0,
      blk: p.blk ?? 0,
      pf: 0,
      pts: p.pts ?? 0,
      rtng: p.rtng ?? 0,
    };
    const derivedPPG = statsToFantasyPoints(stats);
    const gameData = byPlayer.get(p.player_id);
    const fantasyPPG = gameData && gameData.gp > 0 ? gameData.total / gameData.gp : derivedPPG;
    const totalFP = gameData?.total ?? 0;
    const lastGameFP = lastGameFPByPlayer[p.player_id] ?? 0;
    const priceRow = pricesRes[p.player_id];
    const currentPrice = priceRow?.price;
    const inGamePrice = currentPrice ?? fantasyPPGToPrice(fantasyPPG);
    const previousPrice = priceRow?.previousPrice ?? null;

    return {
      playerId: p.player_id,
      name: p.name,
      image: `https://buzzerbeater.com/player/${p.player_id}/overview.aspx`,
      position: d?.position ?? "?",
      dmi: d?.dmi ?? null,
      salary: d?.salary ?? null,
      inGamePrice,
      previousPrice,
      avgRating: p.rtng ?? 0,
      pts: p.pts ?? 0,
      fantasyPPG,
      gameShape: d?.game_shape ?? null,
      lastGameFP,
      totalFP,
    };
  });

  return results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);
}

/** Get price data from Supabase (same shape as loadPriceData). No history in DB. */
export async function getPriceDataFromSupabase(season: number): Promise<{
  meta: { season: number; updated: string };
  current: Record<number, number>;
  history: Record<number, { playerId: number; price: number; effectiveFrom: string }[]>;
} | null> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price, previous_price")
    .eq("season", season)
    .range(0, 999);

  if (error || !data) return null;

  const current: Record<number, number> = {};
  for (const row of data) {
    current[row.player_id] = row.price;
  }

  return {
    meta: { season, updated: new Date().toISOString() },
    current,
    history: {},
  };
}

/** Get player game stats from Supabase. Uses service role for reliable reads. */
export async function getPlayerGameStatsFromSupabase(season: number): Promise<
  { playerId: number; matchId: string; name: string; fantasyPoints: number }[] | null
> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from("fantasy_player_game_stats")
    .select("player_id, match_id, name, fantasy_points")
    .eq("season", season);

  if (error || !data) return null;

  return data.map((r) => ({
    playerId: r.player_id,
    matchId: r.match_id,
    name: r.name ?? "",
    fantasyPoints: r.fantasy_points ?? 0,
  }));
}

/** Get player game stats - Supabase first, JSON fallback. Use in server components. */
export async function getPlayerGameStats(
  season: number
): Promise<{ playerId: number; matchId: string; name: string; fantasyPoints: number }[]> {
  if (await hasFantasyData(season)) {
    const stats = await getPlayerGameStatsFromSupabase(season);
    if (stats) return stats;
  }
  return loadPlayerGameStats(season);
}

/** User standings: users ranked by roster total fantasy points.
 * Reads total_fantasy_points from fantasy_user_rosters (populated by sync script).
 * Uses service role to bypass RLS and show all users (same fix as U21dle leaderboard).
 * If total_fantasy_points is null (before first sync), shows 0 until sync runs.
 * Includes lastWeekFP and lastWeekNumber - same logic as roster weekly-history.
 */
export async function getUserStandings(season: number): Promise<
  { rank: number; userId: string; nickname: string; totalFantasyPoints: number; lastWeekFP: number; lastWeekNumber: number }[]
> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  const [rostersRes, profilesRes, lastPlayedFP, scheduleRes, statsRes, subsRes] = await Promise.all([
    supabase.from("fantasy_user_rosters").select("user_id, total_fantasy_points, nickname, player_ids, picked_at, pending_subs").eq("season", season),
    supabase.from("profiles").select("user_id, nickname, username"),
    getLastPlayedMatchFP(season),
    supabase.from("fantasy_schedule").select("match_id, match_date, match_start").eq("season", season).not("match_date", "is", null).order("match_date", { ascending: true }).range(0, 999),
    supabase.from("fantasy_player_game_stats").select("player_id, match_id, fantasy_points").eq("season", season).range(0, 9999),
    supabase.from("fantasy_roster_substitutions").select("user_id, removed_player_ids, added_player_ids, created_at, effective_match_id").eq("season", season).order("created_at", { ascending: true }).range(0, 999),
  ]);

  const rosters = rostersRes.data ?? [];
  const profiles = new Map(
    (profilesRes.data ?? []).map((p) => {
      const row = p as { user_id: string; nickname?: string; username?: string };
      return [row.user_id, row.nickname ?? row.username ?? "?"];
    })
  );

  const lastPlayedMatchId = lastPlayedFP.lastPlayedMatchId;
  const schedule = (scheduleRes.data ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];
  const stats = statsRes.data ?? [];
  const subs = (subsRes.data ?? []) as { user_id: string; removed_player_ids: number[]; added_player_ids: number[]; created_at: string; effective_match_id: string | null }[];

  const pointsMap = new Map<string, number>();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, Number(s.fantasy_points ?? 0));
  }

  const subsByUser = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push(s);
    subsByUser.set(s.user_id, list);
  }

  const lastPlayedRow = schedule.find((r) => r.match_id === lastPlayedMatchId);
  const lastWeekNumber = lastPlayedRow ? schedule.indexOf(lastPlayedRow) + 1 : 0;
  const lastMatchStartMs = lastPlayedRow
    ? (lastPlayedRow.match_start ? new Date(lastPlayedRow.match_start).getTime() : new Date(lastPlayedRow.match_date + "T12:00:00Z").getTime())
    : 0;

  const standings: { userId: string; nickname: string; totalFantasyPoints: number; lastWeekFP: number; lastWeekNumber: number }[] = [];

  for (const r of rosters) {
    const stored = r.total_fantasy_points;
    const total = stored != null ? Number(stored) : 0;
    const nickname =
      (profiles.get(r.user_id) ?? (r.nickname as string | null)?.trim()) || "?";

    let lastWeekFP = 0;
    if (lastPlayedMatchId && r.player_ids?.length) {
      const pickedAtMs = r.picked_at ? new Date(r.picked_at as string).getTime() : 0;
      if (pickedAtMs > 0 && pickedAtMs < lastMatchStartMs) {
        const currentIds = (r.player_ids ?? []) as number[];
        const pendingSubs = r.pending_subs as { effective_match_id?: string; removed_ids?: number[]; added_ids?: number[] } | null;
        // Same logic as roster weekly-history: when sync ran, currentIds = roster that played.
        // When pending_subs targets last match, apply it to get roster that played.
        const rosterThatPlayed =
          pendingSubs?.effective_match_id && String(pendingSubs.effective_match_id) === String(lastPlayedMatchId)
            ? currentIds.filter((id) => !(pendingSubs.removed_ids ?? []).includes(id)).concat(pendingSubs.added_ids ?? [])
            : currentIds;
        for (const pid of rosterThatPlayed) {
          lastWeekFP += pointsMap.get(`${pid}:${lastPlayedMatchId}`) ?? 0;
        }
      }
    }

    standings.push({
      userId: r.user_id,
      nickname,
      totalFantasyPoints: total,
      lastWeekFP,
      lastWeekNumber,
    });
  }

  return standings
    .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
