#!/usr/bin/env node
/**
 * Audit: game-by-game price simulation vs player_prices_s{N}.json (from update-prices).
 * Uses the same implementation as update-prices: runSimulation() in lib/season-price-simulation.mjs.
 *
 * Run: npm run simulate-prices -- 71   (or: node scripts/simulate-prices.mjs 71)
 *
 * Stats: Supabase first, then JSON (see loadPlayerGameStatsPreferSupabase).
 * Prerequisite: fetch-schedule (bbapi_schedule), update-prices (for File $)
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  runSimulation,
  loadPlayerGameStatsPreferSupabase,
  loadPriceData,
  loadSchedule,
} from "./lib/season-price-simulation.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const SEASON = parseInt(args.find((a) => !a.startsWith("--")) || "71", 10);

function buildNameByPlayer(stats) {
  const m = new Map();
  for (const s of stats) {
    const pid = s.playerId;
    const n = s.name;
    if (pid != null && n && !m.has(pid)) m.set(pid, n);
  }
  return m;
}

async function run() {
  const stats = await loadPlayerGameStatsPreferSupabase(SEASON);
  const schedule = loadSchedule(SEASON);
  if (!stats.length) {
    console.error(`No stats. Supabase (cron) or player_game_stats_s${SEASON}.json (run process-boxscores)`);
    process.exit(1);
  }
  if (!schedule?.length) {
    console.error(`No bbapi_schedule_s${SEASON}.json or empty matches. Run: npm run fetch-schedule`);
    process.exit(1);
  }

  const existing = loadPriceData(SEASON);
  const nameByPlayer = buildNameByPlayer(stats);

  const { current: prices, priceByWeek, playedMatches, cumulative } = runSimulation(SEASON, stats, {
    includeWeekSnapshots: true,
  });

  console.log(`\nSimulated prices for season ${SEASON} (empty start, game-by-game → End $ = current prices) [Option 6: DNPs as 0]`);
  console.log(`\nNote: Start $ = — means no prior price. Price appears after 2 games (fantasyPPGToPrice).`);
  console.log("End $ should match player_prices_s{N}.json (from update-prices).");
  console.log("");

  const playerIds = [...new Set([...Object.keys(existing.current), ...Object.keys(prices), ...cumulative.keys()].map((x) => Number(x)))].sort((a, b) => a - b);

  const weekHeaders = playedMatches.map((m, i) => `W${i + 1}`).join(" | ");
  console.log("Player ID      | Name              | Start $ | " + weekHeaders + " | End $  | File $ | PPG   | GP");
  console.log("-".repeat(Math.max(90, 60 + weekHeaders.length)));

  for (const pid of playerIds) {
    const startPrice = undefined;
    const simPrice = prices[pid];
    const cum = cumulative.get(pid);
    const ppg = cum && cum.gp > 0 ? (cum.total / cum.gp).toFixed(1) : "—";
    const gp = cum?.gp ?? 0;
    const name = (nameByPlayer.get(pid) ?? `Player ${pid}`).slice(0, 18).padEnd(18);
    const startStr = startPrice != null ? `$${startPrice}` : "—";
    const simStr = simPrice != null ? `$${simPrice}` : "—";
    const filePrice = existing.current[pid];
    const fileStr = filePrice != null ? `$${filePrice}` : "—";
    const weekStrs = priceByWeek.map((w) => {
      const p = w.prices[pid];
      return p != null ? `$${p}` : "—";
    });
    const match = simPrice === filePrice ? " ✓" : filePrice != null && simPrice != null ? " ✗" : "";
    console.log(
      `${String(pid).padEnd(14)} | ${name} | ${startStr.padEnd(7)} | ${weekStrs.join(" | ")} | ${simStr.padEnd(6)} | ${fileStr.padEnd(6)}${match} | ${String(ppg).padStart(5)} | ${gp}`
    );
  }

  console.log("\nDone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
