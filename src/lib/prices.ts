/**
 * Price management - current prices and history (JSON file storage, no Supabase)
 *
 * Weekly price adjustment algorithm (1.3.5):
 * - Min 2 games required to adjust (avoids noise from single-game spikes)
 * - Confidence scaling: 5+ games this period → ±2, else ±1
 * - Players with no games keep previous price
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { fantasyPPGToPrice } from "./scoring";
import { loadPlayerGameStats } from "./boxscore";
import { config } from "./config";

/** Minimum games required before we adjust price (avoids single-game noise) */
const MIN_GAMES_FOR_ADJUSTMENT = 2;

/** Max price change when we have high confidence (5+ games) */
const MAX_CHANGE_HIGH_CONFIDENCE = 2;

/** Max price change with normal confidence */
const MAX_CHANGE_DEFAULT = 1;

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
 * - Confidence scaling: 5+ games → ±2, else ±1
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

  for (const [playerId, { ppg, gp }] of ppgByPlayer) {
    const newPrice = fantasyPPGToPrice(ppg);
    const oldPrice = existing.current[playerId];

    let finalPrice: number;
    if (oldPrice == null) {
      finalPrice = newPrice;
    } else {
      // Skip adjustment if too few games (single-game noise)
      if (gp < MIN_GAMES_FOR_ADJUSTMENT) {
        finalPrice = oldPrice;
      } else {
        const maxChange =
          maxChangeOverride ??
          (gp >= 5 ? MAX_CHANGE_HIGH_CONFIDENCE : MAX_CHANGE_DEFAULT);
        const delta = newPrice - oldPrice;
        finalPrice = Math.max(
          1,
          Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange))
        );
      }
    }

    current[playerId] = finalPrice;

    const entry: PriceEntry = {
      playerId,
      price: finalPrice,
      effectiveFrom: today,
      fantasyPPG: ppg,
      gamesPlayed: gp,
    };

    const hist = history[playerId] ?? [];
    if (hist[0]?.price !== finalPrice) {
      history[playerId] = [entry, ...hist].slice(0, 20);
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
