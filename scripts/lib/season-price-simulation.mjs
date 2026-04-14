/**
 * Shared game-by-game price simulation (same algorithm as update-prices.mjs).
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "../../data");

import {
  fantasyPPGToPrice,
  weightedPPGFromGameFPs,
  MIN_GAMES_FOR_ADJUSTMENT,
  getMaxPriceChange,
  PRICE_FOR_ZERO_GP,
} from "../../src/lib/scoring-core.mjs";

export { PRICE_FOR_ZERO_GP };

/** Cost reduction for players who didn't play: $9–10 → -2, $3–8 → -1 */
export function dnpcPriceReduction(price) {
  if (price >= 9) return Math.max(1, price - 2);
  if (price >= 3) return Math.max(1, price - 1);
  return price;
}

export function loadPlayerGameStatsFromJson(season) {
  const path = join(DATA_DIR, `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.stats ?? [];
  } catch {
    return [];
  }
}

export async function loadPlayerGameStatsFromSupabase(season) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("fantasy_player_game_stats")
      .select("player_id, match_id, fantasy_points, name")
      .eq("season", season)
      .range(0, 9999);
    if (error || !data?.length) return [];
    return data.map((r) => ({
      playerId: r.player_id,
      matchId: String(r.match_id),
      fantasyPoints: Number(r.fantasy_points ?? 0),
      name: r.name ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * For audit scripts (simulate-prices): Supabase first, then JSON.
 * `loadPlayerGameStats` (update-prices / CI) prefers JSON when USE_JSON_STATS=1 or empty Supabase.
 */
export async function loadPlayerGameStatsPreferSupabase(season) {
  const fromSupabase = await loadPlayerGameStatsFromSupabase(season);
  if (fromSupabase.length > 0) {
    console.log(`Using ${fromSupabase.length} stats from Supabase (cron-synced)`);
    return fromSupabase;
  }
  const fromJson = loadPlayerGameStatsFromJson(season);
  if (fromJson.length > 0) console.log(`Using ${fromJson.length} stats from JSON (local)`);
  return fromJson;
}

export async function loadPlayerGameStats(season) {
  const fromJson = loadPlayerGameStatsFromJson(season);
  const fromSupabase = await loadPlayerGameStatsFromSupabase(season);
  const preferJson = process.env.USE_JSON_STATS === "1" || fromSupabase.length === 0;
  if (preferJson && fromJson.length > 0) {
    console.log(`Using ${fromJson.length} stats from JSON (sync pipeline)`);
    return fromJson;
  }
  if (fromSupabase.length > 0) {
    console.log(`Using ${fromSupabase.length} stats from Supabase (cron-synced)`);
    return fromSupabase;
  }
  if (fromJson.length > 0) console.log(`Using ${fromJson.length} stats from JSON (local)`);
  return fromJson;
}

export function loadSchedule(season) {
  const path = join(DATA_DIR, `bbapi_schedule_s${season}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.matches ?? null;
  } catch {
    return null;
  }
}

export function loadPriceData(season) {
  const path = join(DATA_DIR, `player_prices_s${season}.json`);
  if (!existsSync(path)) return { current: {}, history: {}, previous: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      current: data.current ?? {},
      history: data.history ?? {},
      /** Last run's "start of last week" snapshot (for arrow merge when simulation omits a player). */
      previous: data.previous ?? {},
    };
  } catch {
    return { current: {}, history: {}, previous: {} };
  }
}

/**
 * @param {number} season
 * @param {Array<{ playerId: number; matchId: string; fantasyPoints: number; name?: string | null }>} stats
 * @param {{ newPlayerFloor?: number; includeWeekSnapshots?: boolean }} [options]
 *   - includeWeekSnapshots: also return priceByWeek, playedMatches, cumulative (for simulate-prices audit)
 */
export function runSimulation(season, stats, options = {}) {
  const floor = options.newPlayerFloor ?? PRICE_FOR_ZERO_GP;
  const includeWeekSnapshots = options.includeWeekSnapshots === true;
  const schedule = loadSchedule(season);
  const prices = {};

  if (!schedule?.length || !stats.length) {
    return includeWeekSnapshots
      ? { current: prices, previous: {}, priceByWeek: [], playedMatches: [], cumulative: new Map() }
      : { current: prices, previous: {} };
  }

  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const cumulative = new Map();
  let pricesAtStartOfLastWeek = {};
  /** @type {Array<{ matchId: string; matchDate: string; weekNum: number; prices: Record<number, number | null> }>} */
  const priceByWeek = [];

  for (let mi = 0; mi < playedMatches.length; mi++) {
    const match = playedMatches[mi];
    if (mi === playedMatches.length - 1) {
      pricesAtStartOfLastWeek = { ...prices };
    }
    const matchStats = stats.filter((x) => String(x.matchId) === String(match.id));
    const playersWhoPlayedThisMatch = new Set(matchStats.map((x) => x.playerId));

    for (const st of matchStats) {
      const cur = cumulative.get(st.playerId) ?? { total: 0, gp: 0, lastGames: [], allGamesWithDnp: [] };
      while ((cur.allGamesWithDnp || []).length < mi) cur.allGamesWithDnp.push(0);
      cur.total += st.fantasyPoints;
      cur.gp += 1;
      cur.lastGames = (cur.lastGames || []).concat(st.fantasyPoints).slice(-20);
      cur.allGamesWithDnp = (cur.allGamesWithDnp || []).concat(st.fantasyPoints);
      cumulative.set(st.playerId, cur);
    }
    for (const [playerId, cur] of cumulative) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        cur.allGamesWithDnp = (cur.allGamesWithDnp || []).concat(0);
      }
    }

    for (const [playerId, cum] of cumulative) {
      const { total, gp } = cum;
      if (gp < MIN_GAMES_FOR_ADJUSTMENT || !playersWhoPlayedThisMatch.has(playerId)) continue;
      const ppg = weightedPPGFromGameFPs(cum.allGamesWithDnp ?? []) || total / gp;
      const newPrice = fantasyPPGToPrice(ppg);
      const oldPrice = prices[playerId];
      const maxChange = getMaxPriceChange(cum.gp);
      const effectiveOld = oldPrice ?? floor;
      const delta = newPrice - effectiveOld;
      const finalPrice = Math.max(
        1,
        Math.min(10, effectiveOld + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
      );
      prices[playerId] = finalPrice;
    }

    /**
     * First price for gp 1–2 players (main loop above needs gp >= MIN_GAMES_FOR_ADJUSTMENT).
     * Must run INSIDE the match loop so `prices[playerId]` exists before DNP — otherwise
     * low-GP players never get dnpcPriceReduction on later matches (e.g. one game @83738, DNP @83742).
     */
    for (const [playerId, cum] of cumulative) {
      const { total, gp } = cum;
      if (gp < 1 || prices[playerId] != null || !playersWhoPlayedThisMatch.has(playerId)) continue;
      const newPrice = fantasyPPGToPrice(total / gp);
      const effectiveOld = floor;
      const maxChange = getMaxPriceChange(gp);
      const delta = newPrice - effectiveOld;
      prices[playerId] = Math.max(
        1,
        Math.min(10, effectiveOld + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
      );
    }

    for (const playerId of Object.keys(prices).map(Number)) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        prices[playerId] = dnpcPriceReduction(prices[playerId]);
      }
    }

    if (includeWeekSnapshots) {
      const weekPrices = {};
      const ids = new Set([...cumulative.keys(), ...Object.keys(prices).map(Number)]);
      for (const pid of ids) {
        weekPrices[pid] = prices[pid] ?? null;
      }
      priceByWeek.push({
        matchId: String(match.id),
        matchDate: match.start?.slice(0, 10) ?? "?",
        weekNum: mi + 1,
        prices: weekPrices,
      });
    }
  }

  for (const [playerId, { total, gp }] of cumulative) {
    if (gp >= 1 && prices[playerId] == null) {
      const newPrice = fantasyPPGToPrice(total / gp);
      const effectiveOld = floor;
      const maxChange = getMaxPriceChange(gp);
      const delta = newPrice - effectiveOld;
      prices[playerId] = Math.max(
        1,
        Math.min(10, effectiveOld + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
      );
    }
  }

  const result = { current: prices, previous: pricesAtStartOfLastWeek };
  if (includeWeekSnapshots) {
    result.priceByWeek = priceByWeek;
    result.playedMatches = playedMatches;
    result.cumulative = cumulative;
  }
  return result;
}

/**
 * Fill gaps in previousSim (snapshot at start of last match). When missing:
 * 1) history[1] — price before last update (newest-first history)
 * 2) file `previous` only if it differs from simulated `current` (week had a move)
 * 3) new-player floor — when history has a single row and file previous === current, the file
 *    cannot represent week-start (e.g. $3→$2); use PRICE_FOR_ZERO_GP, not stale current.
 * Never use file `current` here: it is already the post-update price and collapses arrows.
 */
export function mergePreviousForSync(previousSim, current, existingFile, floorPrice) {
  const floor = floorPrice ?? PRICE_FOR_ZERO_GP;
  const fromFilePrev = existingFile?.previous ?? {};
  const history = existingFile?.history ?? {};
  const previous = { ...previousSim };
  for (const pid of Object.keys(current).map(Number)) {
    if (previous[pid] != null) continue;
    const h = history[pid] ?? [];
    const fromHistory = h.length >= 2 ? h[1].price : null;
    if (fromHistory != null) {
      previous[pid] = fromHistory;
    } else if (fromFilePrev[pid] != null && fromFilePrev[pid] !== current[pid]) {
      previous[pid] = fromFilePrev[pid];
    } else {
      previous[pid] = floor;
    }
  }
  return previous;
}
