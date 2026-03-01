/**
 * Run weekly price adjustment from player_game_stats
 * Run: node scripts/update-prices.mjs [season]
 *
 * Prerequisite: Run process-boxscores first to populate player_game_stats
 *
 * Algorithm (matches lib/prices.ts):
 * - Min 2 games required to adjust (avoids single-game noise)
 * - 5+ games → ±2 max change, else ±1
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const SEASON_ARG = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

function fantasyPPGToPrice(ppg) {
  if (ppg >= 25) return 10;
  if (ppg >= 22) return 9;
  if (ppg >= 19) return 8;
  if (ppg >= 16) return 7;
  if (ppg >= 13) return 6;
  if (ppg >= 10) return 5;
  if (ppg >= 7) return 4;
  if (ppg >= 4) return 3;
  if (ppg >= 2) return 2;
  return 1;
}

function loadPlayerGameStats(season) {
  const path = join(DATA_DIR, `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.stats ?? [];
  } catch {
    return [];
  }
}

function loadPriceData(season) {
  const path = join(DATA_DIR, `player_prices_s${season}.json`);
  if (!existsSync(path)) return { current: {}, history: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return { current: data.current ?? {}, history: data.history ?? {} };
  } catch {
    return { current: {}, history: {} };
  }
}

function run() {
  const stats = loadPlayerGameStats(SEASON_ARG);
  const ppgByPlayer = new Map();
  for (const s of stats) {
    const cur = ppgByPlayer.get(s.playerId) ?? { total: 0, gp: 0 };
    cur.total += s.fantasyPoints;
    cur.gp += 1;
    ppgByPlayer.set(s.playerId, cur);
  }

  const existing = loadPriceData(SEASON_ARG);
  const today = new Date().toISOString().slice(0, 10);
  const current = { ...existing.current };
  const history = { ...existing.history };
  const MIN_GAMES = 2;

  for (const [playerId, { total, gp }] of ppgByPlayer) {
    const ppg = gp > 0 ? total / gp : 0;
    const newPrice = fantasyPPGToPrice(ppg);
    const oldPrice = existing.current[playerId];

    let finalPrice;
    if (oldPrice == null) {
      finalPrice = newPrice;
    } else {
      if (gp < MIN_GAMES) {
        finalPrice = oldPrice;
      } else {
        const maxChange = gp >= 5 ? 2 : 1;
        const delta = newPrice - oldPrice;
        finalPrice = Math.max(1, Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange)));
      }
    }

    current[playerId] = finalPrice;

    const entry = { playerId, price: finalPrice, effectiveFrom: today, fantasyPPG: ppg, gamesPlayed: gp };
    const hist = history[playerId] ?? [];
    if (hist[0]?.price !== finalPrice) {
      history[playerId] = [entry, ...hist].slice(0, 20);
    }
  }

  const outPath = join(DATA_DIR, `player_prices_s${SEASON_ARG}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: { season: SEASON_ARG, updated: new Date().toISOString() },
        current,
        history,
      },
      null,
      2
    )
  );

  console.log("Updated prices for", Object.keys(current).length, "players");
  console.log("Wrote", outPath);
}

run();
