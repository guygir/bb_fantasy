/**
 * Run weekly price adjustment from player_game_stats
 * Run: npm run update-prices -- 71   (or: node scripts/update-prices.mjs 71)
 *
 * Reads stats from Supabase first (cron-synced, up to date). Falls back to JSON if no Supabase.
 * Prerequisite: fetch-schedule (for bbapi_schedule). Stats: Supabase or process-boxscores.
 *
 * Uses game-by-game simulation (same as simulate-prices) so current prices = W5/End $.
 * Algorithm: 1–3 games → ±1, 4+ games → ±2. Performance vs DNPC mutually exclusive per game.
 * No prior simulated $: same as new-player floor ($3) for the adjustment step (see PRICE_FOR_ZERO_GP).
 */

import { config } from "dotenv";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const DATA_DIR = join(__dirname, "../data");
const SEASON_ARG = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

import {
  PRICE_FOR_ZERO_GP,
  loadPlayerGameStats,
  loadSchedule,
  loadPriceData,
  runSimulation,
  mergePreviousForSync,
  DATA_DIR as SIM_DATA_DIR,
} from "./lib/season-price-simulation.mjs";

function loadPlayerNames(season) {
  const path = join(SIM_DATA_DIR, `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const stats = data.stats ?? [];
    const names = {};
    for (const s of stats) {
      if (s.playerId && s.name && !names[s.playerId]) names[s.playerId] = s.name;
    }
    return names;
  } catch {
    return {};
  }
}

async function run() {
  const stats = await loadPlayerGameStats(SEASON_ARG);
  const schedule = loadSchedule(SEASON_ARG);
  if (!stats.length) {
    console.error(`No stats. Supabase (cron) or player_game_stats_s${SEASON_ARG}.json (run process-boxscores)`);
    process.exit(1);
  }
  if (!schedule?.length) {
    console.error(`No bbapi_schedule_s${SEASON_ARG}.json. Run: npm run fetch-schedule`);
    process.exit(1);
  }

  const { current, previous: previousSim } = runSimulation(SEASON_ARG, stats);
  const existing = loadPriceData(SEASON_ARG);
  const today = new Date().toISOString().slice(0, 10);

  const previous = mergePreviousForSync(previousSim, current, existing, PRICE_FOR_ZERO_GP);

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
        previous, // for sync → previous_price (includes fill for first-time priced players)
        history,
      },
      null,
      2
    )
  );

  console.log("Updated prices for", Object.keys(current).length, "players (game-by-game simulation)");
  console.log("Wrote", outPath);

  const names = loadPlayerNames(SEASON_ARG);
  const playerIds = Object.keys(current).map(Number).sort((a, b) => a - b);
  console.log("\n--- Prices as shown on site ---");
  for (const pid of playerIds) {
    const cur = current[pid];
    const prev = previous[pid];
    const siteFormat = prev != null && prev !== cur ? `$${prev}→$${cur}` : `$${cur}`;
    const name = names[pid] ?? `Player ${pid}`;
    console.log(`  ${name}: ${siteFormat}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
