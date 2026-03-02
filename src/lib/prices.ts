/**
 * Price management - current prices and history (JSON file storage, no Supabase)
 *
 * Weekly price adjustment algorithm (1.3.5):
 * - Min 2 games required to adjust (avoids noise from single-game spikes)
 * - Confidence scaling: 1–3 games → ±1, 4+ games → ±2
 * - Players with no games keep previous price
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  fantasyPPGToPrice,
  MIN_GAMES_FOR_ADJUSTMENT,
  MAX_CHANGE_HIGH_CONFIDENCE,
  MAX_CHANGE_DEFAULT,
  getMaxPriceChange,
} from "./scoring";
import { loadPlayerGameStats } from "./boxscore";
import { config } from "./config";

/**
 * Cost reduction for players who didn't play in a game.
 * $9–10 → -2, $3–8 → -1, $1–2 → no change.
 */
export function dnpcPriceReduction(price: number): number {
  if (price >= 9) return Math.max(1, price - 2);
  if (price >= 3) return Math.max(1, price - 1);
  return price;
}

export interface PriceEntry {
  playerId: number;
  price: number;
  effectiveFrom: string; // ISO date
  fantasyPPG?: number;
  gamesPlayed?: number;
}

export interface PriceHistoryData {
  meta: { season: number; updated: string };
  current: Record<number, number>; // playerId -> price
  history: Record<number, PriceEntry[]>; // playerId -> entries (newest first)
}

function getPricesPath(season: number) {
  return join(process.cwd(), "data", `player_prices_s${season}.json`);
}

/**
 * Load price data from JSON.
 */
export function loadPriceData(season?: number): PriceHistoryData {
  const s = season ?? config.game.currentSeason;
  const path = getPricesPath(s);
  if (!existsSync(path)) {
    return {
      meta: { season: s, updated: new Date().toISOString() },
      current: {},
      history: {},
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {
      meta: { season: s, updated: new Date().toISOString() },
      current: {},
      history: {},
    };
  }
}

/**
 * Compute fantasy PPG per player from player_game_stats.
 */
function computeFantasyPPGByPlayer(stats: { playerId: number; fantasyPoints: number }[]): Map<number, { ppg: number; gp: number }> {
  const byPlayer = new Map<number, { total: number; gp: number }>();
  for (const s of stats) {
    const cur = byPlayer.get(s.playerId) ?? { total: 0, gp: 0 };
    cur.total += s.fantasyPoints;
    cur.gp += 1;
    byPlayer.set(s.playerId, cur);
  }
  const result = new Map<number, { ppg: number; gp: number }>();
  for (const [playerId, { total, gp }] of byPlayer) {
    result.set(playerId, { ppg: gp > 0 ? total / gp : 0, gp });
  }
  return result;
}

/**
 * Compute new prices from player_game_stats and apply weekly adjustment.
 * Uses fantasyPPGToPrice for players with games; others keep previous price or default to 1.
 *
 * Algorithm:
 * - MIN_GAMES_FOR_ADJUSTMENT: Skip adjustment if player has < 2 games (noise)
 * - Confidence scaling: 1–3 games → ±1, 4+ games → ±2
 * - New players (no prior price): use full fantasyPPGToPrice result
 */
export function computePriceAdjustment(
  season?: number,
  maxChangeOverride?: number
): { current: Record<number, number>; history: Record<number, PriceEntry[]> } {
  const s = season ?? config.game.currentSeason;
  const stats = loadPlayerGameStats(s);
  const ppgByPlayer = computeFantasyPPGByPlayer(stats);
  const existing = loadPriceData(s);
  const today = new Date().toISOString().slice(0, 10);

  const current: Record<number, number> = { ...existing.current };
  const history: Record<number, PriceEntry[]> = { ...existing.history };

  // Compute who played in the most recent game (performance vs DNPC are mutually exclusive per game)
  const schedule = loadScheduleFromJson(s);
  let playersWhoPlayedMostRecent = new Set<number>();
  if (schedule && stats.length > 0) {
    const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
    const playedMatches = schedule.filter((m) => matchIdsWithStats.has(String(m.id)));
    const sorted = [...playedMatches].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
    const mostRecentMatchId = sorted[0]?.id;
    if (mostRecentMatchId) {
      playersWhoPlayedMostRecent = new Set(
        stats.filter((x) => String(x.matchId) === String(mostRecentMatchId)).map((x) => x.playerId)
      );
    }
  }

  for (const [playerId, { ppg, gp }] of ppgByPlayer) {
    const oldPrice = existing.current[playerId];
    let finalPrice: number;

    if (playersWhoPlayedMostRecent.has(playerId)) {
      // Played in most recent game → performance-based adjustment only
      const newPrice = fantasyPPGToPrice(ppg);
      if (oldPrice == null) {
        finalPrice = newPrice;
      } else {
        if (gp < MIN_GAMES_FOR_ADJUSTMENT) {
          finalPrice = oldPrice;
        } else {
          const maxChange =
            maxChangeOverride ??
            getMaxPriceChange(gp);
          const delta = newPrice - oldPrice;
          finalPrice = Math.max(
            1,
            Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
          );
        }
      }
      const entry: PriceEntry = {
        playerId,
        price: finalPrice,
        effectiveFrom: today,
        fantasyPPG: ppg,
        gamesPlayed: gp,
      };
      current[playerId] = finalPrice;
      const hist = history[playerId] ?? [];
      if (hist[0]?.price !== finalPrice) {
        history[playerId] = [entry, ...hist].slice(0, 20);
      }
    } else {
      // Didn't play in most recent game → DNPC reduction only (no performance adjustment)
      const priceToReduce = oldPrice ?? current[playerId] ?? 1;
      finalPrice = dnpcPriceReduction(priceToReduce);
      current[playerId] = finalPrice;
      if (finalPrice !== priceToReduce) {
        const entry: PriceEntry = { playerId, price: finalPrice, effectiveFrom: today };
        const hist = history[playerId] ?? [];
        if (hist[0]?.price !== finalPrice) {
          history[playerId] = [entry, ...hist].slice(0, 20);
        }
      }
    }
  }

  // DNPC for players with a price but no stats (never played this season)
  for (const playerId of Object.keys(current).map(Number)) {
    if (ppgByPlayer.has(playerId)) continue; // Already handled above
    if (!playersWhoPlayedMostRecent.has(playerId)) {
      const reduced = dnpcPriceReduction(current[playerId]);
      if (reduced !== current[playerId]) {
        current[playerId] = reduced;
        const entry: PriceEntry = { playerId, price: reduced, effectiveFrom: today };
        const hist = history[playerId] ?? [];
        if (hist[0]?.price !== reduced) {
          history[playerId] = [entry, ...hist].slice(0, 20);
        }
      }
    }
  }

  return { current, history };
}

/**
 * Run price adjustment and save to JSON.
 */
export function runPriceAdjustment(season?: number): PriceHistoryData {
  const s = season ?? config.game.currentSeason;
  const { current, history } = computePriceAdjustment(s);
  const data: PriceHistoryData = {
    meta: { season: s, updated: new Date().toISOString() },
    current,
    history,
  };
  const path = getPricesPath(s);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Get current price for a player (from JSON or fallback).
 */
export function getPlayerPrice(playerId: number, season?: number): number {
  const data = loadPriceData(season ?? config.game.currentSeason);
  return data.current[playerId] ?? 1;
}

function loadScheduleFromJson(season: number): { id: string; start: string }[] | null {
  const path = join(process.cwd(), "data", `bbapi_schedule_s${season}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const matches = data.matches ?? [];
    return Array.isArray(matches) ? matches : null;
  } catch {
    return null;
  }
}

/**
 * Simulate what prices would be if we started from given prices and applied
 * the adjustment algorithm per game for each played game since season start.
 *
 * @param season - Season number
 * @param startingPrices - Prices to treat as "beginning of season" (default: current prices)
 * @returns Simulated prices after game-by-game adjustments
 */
export function simulateAdjustedPrices(
  season?: number,
  startingPrices?: Record<number, number>
): Record<number, number> {
  const s = season ?? config.game.currentSeason;
  const schedule = loadScheduleFromJson(s);
  const stats = loadPlayerGameStats(s);
  const existing = loadPriceData(s);
  const prices: Record<number, number> = { ...(startingPrices ?? existing.current) };

  if (!schedule || schedule.length === 0) return prices;

  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const cumulative = new Map<number, { total: number; gp: number }>();

  for (const match of playedMatches) {
    const matchStats = stats.filter((x) => String(x.matchId) === String(match.id));
    const playersWhoPlayedThisMatch = new Set(matchStats.map((x) => x.playerId));
    for (const st of matchStats) {
      const cur = cumulative.get(st.playerId) ?? { total: 0, gp: 0 };
      cur.total += st.fantasyPoints;
      cur.gp += 1;
      cumulative.set(st.playerId, cur);
    }

    // Performance: only for players who played in THIS game (mutually exclusive with DNPC)
    for (const [playerId, { total, gp }] of cumulative) {
      if (gp < MIN_GAMES_FOR_ADJUSTMENT || !playersWhoPlayedThisMatch.has(playerId)) continue;
      const ppg = total / gp;
      const newPrice = fantasyPPGToPrice(ppg);
      const oldPrice = prices[playerId];
      const maxChange = gp >= 4 ? MAX_CHANGE_HIGH_CONFIDENCE : MAX_CHANGE_DEFAULT;
      let finalPrice: number;
      if (oldPrice == null) {
        finalPrice = newPrice;
      } else {
        const delta = newPrice - oldPrice;
        finalPrice = Math.max(
          1,
          Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
        );
      }
      prices[playerId] = finalPrice;
    }

    // DNPC: for players who didn't play in this game
    for (const playerId of Object.keys(prices).map(Number)) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        prices[playerId] = dnpcPriceReduction(prices[playerId]);
      }
    }
  }

  return prices;
}
