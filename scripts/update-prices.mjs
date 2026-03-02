/**
 * Run weekly price adjustment from player_game_stats
 * Run: npm run update-prices -- 71   (or: node scripts/update-prices.mjs 71)
 *
 * Prerequisite: process-boxscores, fetch-schedule
 *
 * Uses game-by-game simulation (same as simulate-prices) so current prices = W5/End $.
 * Algorithm: 1–3 games → ±1, 4+ games → ±2. Performance vs DNPC mutually exclusive per game.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const SEASON_ARG = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

const {
  fantasyPPGToPrice,
  MIN_GAMES_FOR_ADJUSTMENT,
  getMaxPriceChange,
} = await import(join(__dirname, "../src/lib/scoring-core.mjs"));

/** Cost reduction for players who didn't play: $9–10 → -2, $3–8 → -1 */
function dnpcPriceReduction(price) {
  if (price >= 9) return Math.max(1, price - 2);
  if (price >= 3) return Math.max(1, price - 1);
  return price;
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

function loadSchedule(season) {
  const path = join(DATA_DIR, `bbapi_schedule_s${season}.json`);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.matches ?? null;
  } catch {
    return null;
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

function runSimulation(season) {
  const schedule = loadSchedule(season);
  const stats = loadPlayerGameStats(season);
  const prices = {}; // Start empty for deterministic, idempotent result (= W5/End $)

  if (!schedule?.length || !stats.length) return prices;

  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const cumulative = new Map();

  for (const match of playedMatches) {
    const matchStats = stats.filter((x) => String(x.matchId) === String(match.id));
    const playersWhoPlayedThisMatch = new Set(matchStats.map((x) => x.playerId));
    for (const st of matchStats) {
      const cur = cumulative.get(st.playerId) ?? { total: 0, gp: 0 };
      cur.total += st.fantasyPoints;
      cur.gp += 1;
      cumulative.set(st.playerId, cur);
    }

    for (const [playerId, { total, gp }] of cumulative) {
      if (gp < MIN_GAMES_FOR_ADJUSTMENT || !playersWhoPlayedThisMatch.has(playerId)) continue;
      const ppg = total / gp;
      const newPrice = fantasyPPGToPrice(ppg);
      const oldPrice = prices[playerId];
      const maxChange = getMaxPriceChange(gp);
      let finalPrice;
      if (oldPrice == null) {
        finalPrice = newPrice;
      } else {
        const delta = newPrice - oldPrice;
        finalPrice = Math.max(1, Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange)));
      }
      prices[playerId] = finalPrice;
    }

    for (const playerId of Object.keys(prices).map(Number)) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        prices[playerId] = dnpcPriceReduction(prices[playerId]);
      }
    }
  }

  return prices;
}

function run() {
  const stats = loadPlayerGameStats(SEASON_ARG);
  const schedule = loadSchedule(SEASON_ARG);
  if (!stats.length) {
    console.error(`No player_game_stats_s${SEASON_ARG}.json. Run: npm run process-boxscores`);
    process.exit(1);
  }
  if (!schedule?.length) {
    console.error(`No bbapi_schedule_s${SEASON_ARG}.json. Run: npm run fetch-schedule`);
    process.exit(1);
  }

  const current = runSimulation(SEASON_ARG);
  const existing = loadPriceData(SEASON_ARG);
  const today = new Date().toISOString().slice(0, 10);

  const history = { ...existing.history };
  for (const [playerId, price] of Object.entries(current)) {
    const pid = Number(playerId);
    const hist = history[pid] ?? [];
    if (hist[0]?.price !== price) {
      history[pid] = [{ playerId: pid, price, effectiveFrom: today }, ...hist].slice(0, 20);
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

  console.log("Updated prices for", Object.keys(current).length, "players (game-by-game simulation)");
  console.log("Wrote", outPath);
}

run();
