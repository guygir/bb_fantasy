/**
 * Run weekly price adjustment from player_game_stats
 * Run: npm run update-prices -- 71   (or: node scripts/update-prices.mjs 71)
 *
 * Reads stats from Supabase first (cron-synced, up to date). Falls back to JSON if no Supabase.
 * Prerequisite: fetch-schedule (for bbapi_schedule). Stats: Supabase or process-boxscores.
 *
 * Uses game-by-game simulation (same as simulate-prices) so current prices = W5/End $.
 * Algorithm: 1–3 games → ±1, 4+ games → ±2. Performance vs DNPC mutually exclusive per game.
 */

import { config } from "dotenv";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const DATA_DIR = join(__dirname, "../data");
const SEASON_ARG = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

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
      .select("player_id, match_id, fantasy_points")
      .eq("season", season)
      .range(0, 9999);
    if (error || !data?.length) return [];
    return data.map((r) => ({
      playerId: r.player_id,
      matchId: String(r.match_id),
      fantasyPoints: Number(r.fantasy_points ?? 0),
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

function runSimulation(season, stats) {
  const schedule = loadSchedule(season);
  const prices = {}; // Start empty for deterministic, idempotent result (= W5/End $)

  if (!schedule?.length || !stats.length) return { current: prices, previous: {} };

  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const cumulative = new Map();
  let pricesAtStartOfLastWeek = {};

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

  // Include players with 1 game (below adjustment threshold) - use fantasyPPGToPrice so they get sensible price
  for (const [playerId, { total, gp }] of cumulative) {
    if (gp >= 1 && prices[playerId] == null) {
      const ppg = total / gp;
      prices[playerId] = fantasyPPGToPrice(ppg);
    }
  }

  return { current: prices, previous: pricesAtStartOfLastWeek };
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

  const { current, previous } = runSimulation(SEASON_ARG, stats);
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
        previous, // price at start of last played week (for sync → previous_price)
        history,
      },
      null,
      2
    )
  );

  console.log("Updated prices for", Object.keys(current).length, "players (game-by-game simulation)");
  console.log("Wrote", outPath);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
