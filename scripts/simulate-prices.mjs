#!/usr/bin/env node
/**
 * Simulate adjusted prices: treat current prices as "beginning of season",
 * then apply the price adjustment algorithm per game for each played game.
 *
 * Run: npm run simulate-prices -- 71   (or: node scripts/simulate-prices.mjs 71)
 * (Option 6: DNPs count as 0 FP for weighted PPG)
 *
 * Reads stats from Supabase first (cron-synced). Falls back to JSON.
 * Prerequisite: fetch-schedule (bbapi_schedule), update-prices (for File $)
 */

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const DATA_DIR = join(__dirname, "../data");
const args = process.argv.slice(2);
const SEASON = parseInt(args.find((a) => !a.startsWith("--")) || "71", 10);

const {
  fantasyPPGToPrice,
  weightedPPGFromGameFPs,
  MIN_GAMES_FOR_ADJUSTMENT,
  getMaxPriceChange,
} = await import(join(__dirname, "../src/lib/scoring-core.mjs"));

/** Cost reduction for players who didn't play: $9–10 → -2, $3–8 → -1 */
function dnpcPriceReduction(price) {
  if (price >= 9) return Math.max(1, price - 2);
  if (price >= 3) return Math.max(1, price - 1);
  return price;
}

function loadPlayerGameStatsFromJson(season) {
  const path = join(DATA_DIR, `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.stats ?? [];
  } catch {
    return [];
  }
}

/** Load stats from Supabase (cron-synced). Returns [] if unavailable. */
async function loadPlayerGameStatsFromSupabase(season) {
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

async function loadPlayerGameStats(season) {
  const fromSupabase = await loadPlayerGameStatsFromSupabase(season);
  if (fromSupabase.length > 0) {
    console.log(`Using ${fromSupabase.length} stats from Supabase (cron-synced)`);
    return fromSupabase;
  }
  const fromJson = loadPlayerGameStatsFromJson(season);
  if (fromJson.length > 0) console.log(`Using ${fromJson.length} stats from JSON (local)`);
  return fromJson;
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

function simulateAdjustedPrices(season, startingPrices, stats) {
  const schedule = loadSchedule(season);
  const existing = loadPriceData(season);
  const prices = { ...(startingPrices ?? existing.current) };

  if (!schedule || schedule.length === 0) return { prices, cumulative: new Map(), nameByPlayer: new Map(), priceByWeek: [] };

  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const cumulative = new Map();
  const nameByPlayer = new Map();
  const priceByWeek = [];

  for (let mi = 0; mi < playedMatches.length; mi++) {
    const match = playedMatches[mi];
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
      if (st.name) nameByPlayer.set(st.playerId, st.name);
    }
    for (const [playerId, cur] of cumulative) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        cur.allGamesWithDnp = (cur.allGamesWithDnp || []).concat(0);
      }
    }

    const weekPrices = {};
    for (const [playerId, cum] of cumulative) {
      const { total, gp } = cum;
      if (gp < MIN_GAMES_FOR_ADJUSTMENT || !playersWhoPlayedThisMatch.has(playerId)) {
        weekPrices[playerId] = prices[playerId] ?? null;
        continue;
      }
      const ppg = weightedPPGFromGameFPs(cum.allGamesWithDnp ?? []) || total / gp;
      const newPrice = fantasyPPGToPrice(ppg);
      const oldPrice = prices[playerId];
      const maxChange = getMaxPriceChange(cum.gp);
      let finalPrice;
      if (oldPrice == null) {
        finalPrice = newPrice;
      } else {
        const delta = newPrice - oldPrice;
        finalPrice = Math.max(1, Math.min(10, oldPrice + Math.sign(delta) * Math.min(Math.abs(delta), maxChange)));
      }
      prices[playerId] = finalPrice;
      weekPrices[playerId] = finalPrice;
    }
    // DNPC: for players who didn't play in this game
    for (const playerId of Object.keys(prices).map(Number)) {
      if (!playersWhoPlayedThisMatch.has(playerId)) {
        prices[playerId] = dnpcPriceReduction(prices[playerId]);
      }
      weekPrices[playerId] = prices[playerId];
    }
    priceByWeek.push({
      matchId: match.id,
      matchDate: match.start?.slice(0, 10) ?? "?",
      weekNum: mi + 1,
      prices: { ...weekPrices },
    });
  }

  return { prices, cumulative, nameByPlayer, priceByWeek, playedMatches };
}

async function run() {
  const stats = await loadPlayerGameStats(SEASON);
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
  const { prices, cumulative, nameByPlayer, priceByWeek, playedMatches } = simulateAdjustedPrices(SEASON, {}, stats);

  console.log(`\nSimulated prices for season ${SEASON} (empty start, game-by-game → End $ = current prices) [Option 6: DNPs as 0]`);
  console.log(`\nNote: Start $ = — means no prior price. Price appears after 2 games (fantasyPPGToPrice).`);
  console.log("End $ should match player_prices_s{N}.json (from update-prices).");
  console.log("");

  const playerIds = [...new Set([...Object.keys(existing.current), ...Object.keys(prices), ...cumulative.keys()].map((x) => Number(x)))].sort((a, b) => a - b);

  const weekHeaders = playedMatches.map((m, i) => `W${i + 1}`).join(" | ");
  console.log("Player ID      | Name              | Start $ | " + weekHeaders + " | End $  | File $ | PPG   | GP");
  console.log("-".repeat(Math.max(90, 60 + weekHeaders.length)));

  for (const pid of playerIds) {
    const startPrice = undefined; // empty start
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
    const match = simPrice === filePrice ? " ✓" : (filePrice != null && simPrice != null ? " ✗" : "");
    console.log(`${String(pid).padEnd(14)} | ${name} | ${startStr.padEnd(7)} | ${weekStrs.join(" | ")} | ${simStr.padEnd(6)} | ${fileStr.padEnd(6)}${match} | ${String(ppg).padStart(5)} | ${gp}`);
  }

  console.log("\nDone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
