#!/usr/bin/env node
/**
 * Compare price calculation methods: current, option 1 (weighted recent), option 2 (rolling 5), option 4 (last game FP).
 * Run: node scripts/compare-price-calcs.mjs 71
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
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

const {
  fantasyPPGToPrice,
  weightedPPGFromGameFPs,
  MIN_GAMES_FOR_ADJUSTMENT,
  getMaxPriceChange,
} = await import(join(__dirname, "../src/lib/scoring-core.mjs"));

function dnpcPriceReduction(price) {
  if (price >= 9) return Math.max(1, price - 2);
  if (price >= 3) return Math.max(1, price - 1);
  return price;
}

async function loadPlayerGameStats(season) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const supabase = createClient(url, key);
      const { data, error } = await supabase
        .from("fantasy_player_game_stats")
        .select("player_id, match_id, fantasy_points, name")
        .eq("season", season)
        .range(0, 9999);
      if (!error && data?.length) {
        return data.map((r) => ({
          playerId: r.player_id,
          matchId: String(r.match_id),
          fantasyPoints: Number(r.fantasy_points ?? 0),
          name: r.name ?? null,
        }));
      }
    } catch {}
  }
  const path = join(DATA_DIR, `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return data.stats ?? [];
}

function loadSchedule(season) {
  const path = join(DATA_DIR, `bbapi_schedule_s${season}.json`);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return data.matches ?? null;
}

/** Run simulation with custom targetPriceFn(oldPrice, cumulative, lastGameFP, playersWhoPlayed) */
function runSimulation(stats, schedule, targetPriceFn) {
  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const matchIdsWithStats = new Set(stats.map((x) => String(x.matchId)));
  const playedMatches = sorted.filter((m) => matchIdsWithStats.has(String(m.id)));

  const prices = {};
  const cumulative = new Map(); // playerId -> { total, gp, lastGames: [fp], allGamesWithDnp: [fp|0] }
  const nameByPlayer = new Map();

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

    for (const [playerId, cum] of cumulative) {
      if (cum.gp < MIN_GAMES_FOR_ADJUSTMENT || !playersWhoPlayedThisMatch.has(playerId)) continue;
      const lastGameFP = cum.lastGames[cum.lastGames.length - 1];
      const targetPrice = targetPriceFn(prices[playerId], cum, lastGameFP, playersWhoPlayedThisMatch);
      const oldPrice = prices[playerId];
      const maxChange = getMaxPriceChange(cum.gp);
      let finalPrice;
      if (oldPrice == null) {
        finalPrice = targetPrice;
      } else {
        const delta = targetPrice - oldPrice;
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

  for (const [playerId, cum] of cumulative) {
    if (cum.gp >= 1 && prices[playerId] == null) {
      const ppg = cum.total / cum.gp;
      prices[playerId] = fantasyPPGToPrice(ppg);
    }
  }

  return { prices, cumulative, nameByPlayer, playedMatches };
}

// 1. Current: season PPG
function targetCurrent(oldPrice, cum) {
  const ppg = cum.total / cum.gp;
  return fantasyPPGToPrice(ppg);
}

// 2. Option 1: weighted recent (last 3 games count 2x)
function targetOption1(oldPrice, cum) {
  const last3 = cum.lastGames.slice(-3);
  const rest = cum.lastGames.slice(0, -3);
  const weightedTotal = rest.reduce((s, fp) => s + fp, 0) + last3.reduce((s, fp) => s + fp * 2, 0);
  const weightedGp = rest.length + last3.length * 2;
  if (weightedGp === 0) return oldPrice ?? 1;
  const ppg = weightedTotal / weightedGp;
  return fantasyPPGToPrice(ppg);
}

// 3. Option 2: rolling window (last 5 games only)
function targetOption2(oldPrice, cum) {
  const last5 = cum.lastGames.slice(-5);
  if (last5.length < 2) return oldPrice ?? fantasyPPGToPrice(cum.total / cum.gp);
  const ppg = last5.reduce((s, fp) => s + fp, 0) / last5.length;
  return fantasyPPGToPrice(ppg);
}

// 4. Option 4: same tiers, use last game FP (treat as 1-game PPG)
function targetOption4(oldPrice, cum, lastGameFP) {
  return fantasyPPGToPrice(lastGameFP);
}

// 5. Option 5: decay weights 30%, 20%, 10%, 5%, 2.5%, ... (last games more), scale to 100%, max change applies
function targetOption5(oldPrice, cum) {
  const lastGames = cum.lastGames ?? [];
  if (lastGames.length === 0) return oldPrice ?? 1;
  const weightedPPG = weightedPPGFromGameFPs(lastGames) || cum.total / cum.gp;
  return fantasyPPGToPrice(weightedPPG);
}

// 6. Option 6: same as Opt5 but DNPs count as 0 FP (allGamesWithDnp)
function targetOption6(oldPrice, cum) {
  const allGames = cum.allGamesWithDnp ?? [];
  if (allGames.length === 0) return oldPrice ?? 1;
  const weightedPPG = weightedPPGFromGameFPs(allGames) || cum.total / cum.gp;
  return fantasyPPGToPrice(weightedPPG);
}

async function run() {
  const stats = await loadPlayerGameStats(SEASON);
  const schedule = loadSchedule(SEASON);
  if (!stats.length || !schedule?.length) {
    console.error("Need stats and schedule. Run fetch-schedule, process-boxscores or use Supabase.");
    process.exit(1);
  }

  const r1 = runSimulation(stats, schedule, targetCurrent);
  const r2 = runSimulation(stats, schedule, targetOption1);
  const r3 = runSimulation(stats, schedule, targetOption2);
  const r4 = runSimulation(stats, schedule, targetOption4);
  const r5 = runSimulation(stats, schedule, targetOption5);
  const r6 = runSimulation(stats, schedule, targetOption6);

  const allPlayerIds = [...new Set([...Object.keys(r1.prices), ...r1.cumulative.keys()].map(Number))].sort((a, b) => a - b);
  const lastMatchId = r1.playedMatches?.length ? String(r1.playedMatches[r1.playedMatches.length - 1]?.id) : null;
  const lastMatchStats = lastMatchId ? stats.filter((x) => String(x.matchId) === lastMatchId) : [];
  const realLastFPByPlayer = new Map(lastMatchStats.map((x) => [x.playerId, x.fantasyPoints]));

  console.log(`\nPrice comparison for season ${SEASON}`);
  console.log("Last FP = last game played. Real Last FP = FP in last match (0 if DNP). Opt6 = weighted with DNPs as 0.");
  console.log("-".repeat(135));
  console.log(
    "Player ID      | Name              | PPG   | GP | Last FP | Real Last | Current $ | Opt1 $ | Opt2 $ | Opt4 $ | Opt5 $ | Opt6 $"
  );
  console.log("-".repeat(135));

  for (const pid of allPlayerIds) {
    const cum = r1.cumulative.get(pid);
    const ppg = cum && cum.gp > 0 ? (cum.total / cum.gp).toFixed(1) : "—";
    const gp = cum?.gp ?? 0;
    const lastFP = cum?.lastGames?.length ? cum.lastGames[cum.lastGames.length - 1].toFixed(1) : "—";
    const realLastFP = realLastFPByPlayer.has(pid) ? realLastFPByPlayer.get(pid).toFixed(1) : "0";
    const name = (r1.nameByPlayer.get(pid) ?? `Player ${pid}`).slice(0, 18).padEnd(18);
    const c1 = r1.prices[pid] != null ? `$${r1.prices[pid]}` : "—";
    const c2 = r2.prices[pid] != null ? `$${r2.prices[pid]}` : "—";
    const c3 = r3.prices[pid] != null ? `$${r3.prices[pid]}` : "—";
    const c4 = r4.prices[pid] != null ? `$${r4.prices[pid]}` : "—";
    const c5 = r5.prices[pid] != null ? `$${r5.prices[pid]}` : "—";
    const c6 = r6.prices[pid] != null ? `$${r6.prices[pid]}` : "—";
    console.log(
      `${String(pid).padEnd(14)} | ${name} | ${String(ppg).padStart(5)} | ${String(gp).padStart(2)} | ${String(lastFP).padStart(7)} | ${String(realLastFP).padStart(9)} | ${c1.padEnd(9)} | ${c2.padEnd(7)} | ${c3.padEnd(7)} | ${c4.padEnd(7)} | ${c5.padEnd(7)} | ${c6}`
    );
  }

  console.log("\nDone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
