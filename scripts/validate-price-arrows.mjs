/**
 * Price arrows: audit stored data OR predict after next update-prices (same simulation).
 *
 * Run:
 *   node scripts/validate-price-arrows.mjs [season]
 *   node scripts/validate-price-arrows.mjs [season] --supabase
 *   node scripts/validate-price-arrows.mjs [season] --predict
 *   node scripts/validate-price-arrows.mjs [season] --predict --supabase
 *
 * --supabase (audit): read fantasy_player_prices only (production as deployed).
 * --predict: run game-by-game simulation + merge (same as update-prices), using
 *   data/player_prices_s{N}.json for merge fill. Shows arrows that would apply after sync.
 *   With --predict, also lists unchanged ($prev=$cur), roster players with 0 GP in loaded stats
 *   (not in simulation `current`), and can merge names from Supabase fantasy_players when env is set.
 *
 * New-player floor $ is PRICE_FOR_ZERO_GP from src/lib/scoring-core.mjs (default 3).
 * Override for scripts: FANTASY_NEW_PLAYER_PRICE=4 in .env.local (1–10).
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

const argv = process.argv.slice(2);
const USE_SUPABASE = argv.includes("--supabase");
const USE_PREDICT = argv.includes("--predict");
const SEASON = argv.find((a) => /^\d+$/.test(a)) ? parseInt(argv.find((a) => /^\d+$/.test(a)), 10) : 71;

/** Same as sync: previous from JSON row, else history[1] */
function effectivePrevious(previous, history, pid) {
  const p = previous[pid];
  if (p != null) return p;
  const hist = history[pid] ?? [];
  return hist.length >= 2 ? hist[1].price : null;
}

function auditFromJson() {
  const path = join(ROOT, "data", `player_prices_s${SEASON}.json`);
  if (!existsSync(path)) {
    console.error("Missing", path, "— run npm run update-prices", SEASON);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const current = data.current ?? {};
  const previous = data.previous ?? {};
  const history = data.history ?? {};

  const names = {};
  const statsPath = join(ROOT, "data", `player_game_stats_s${SEASON}.json`);
  if (existsSync(statsPath)) {
    try {
      const s = JSON.parse(readFileSync(statsPath, "utf-8")).stats ?? [];
      for (const row of s) {
        if (row.playerId && row.name && !names[row.playerId]) names[row.playerId] = row.name;
      }
    } catch {
      /* ignore */
    }
  }

  const noArrow = [];
  const withArrow = [];
  for (const idStr of Object.keys(current)) {
    const pid = Number(idStr);
    const cur = current[pid];
    const prev = effectivePrevious(previous, history, pid);
    if (prev == null) {
      noArrow.push({ pid, name: names[pid] ?? `Player ${pid}`, current: cur });
    } else if (prev !== cur) {
      withArrow.push({ pid, name: names[pid] ?? `Player ${pid}`, previous: prev, current: cur });
    }
  }
  return { noArrow, withArrow, sourceLabel: path };
}

async function auditFromSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for --supabase");
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const { data: priceRows, error: e1 } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price, previous_price")
    .eq("season", SEASON)
    .range(0, 999);
  if (e1) {
    console.error(e1.message);
    process.exit(1);
  }
  const { data: players, error: e2 } = await supabase
    .from("fantasy_players")
    .select("player_id, name")
    .eq("season", SEASON)
    .range(0, 999);
  if (e2) {
    console.error(e2.message);
    process.exit(1);
  }
  const names = Object.fromEntries((players ?? []).map((r) => [r.player_id, r.name]));

  const noArrow = [];
  const withArrow = [];
  for (const r of priceRows ?? []) {
    const pid = r.player_id;
    const cur = r.price;
    const prev = r.previous_price;
    const name = names[pid] ?? `Player ${pid}`;
    if (prev == null) {
      noArrow.push({ pid, name, current: cur });
    } else if (prev !== cur) {
      withArrow.push({ pid, name, previous: prev, current: cur });
    }
  }
  return { noArrow, withArrow, sourceLabel: "Supabase fantasy_player_prices" };
}

function gpByPlayerFromStats(stats) {
  const m = new Map();
  for (const s of stats) {
    const id = s.playerId;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

function loadSeasonRosterPlayerIds(season) {
  const path = join(ROOT, "data", `season${season}_stats.json`);
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return new Set((data.players ?? []).map((p) => p.playerId));
  } catch {
    return new Set();
  }
}

async function predictFromSimulation() {
  const {
    PRICE_FOR_ZERO_GP,
    loadPlayerGameStats,
    loadSchedule,
    loadPriceData,
    runSimulation,
    mergePreviousForSync,
  } = await import("./lib/season-price-simulation.mjs");

  const stats = await loadPlayerGameStats(SEASON);
  const schedule = loadSchedule(SEASON);
  if (!stats.length) {
    console.error(`No stats for season ${SEASON}. Sync Supabase or add player_game_stats JSON.`);
    process.exit(1);
  }
  if (!schedule?.length) {
    console.error(`No bbapi_schedule_s${SEASON}.json. Run: npm run fetch-schedule`);
    process.exit(1);
  }

  const gpMap = gpByPlayerFromStats(stats);

  const existing = loadPriceData(SEASON);
  const { current, previous: previousSim } = runSimulation(SEASON, stats);
  const previous = mergePreviousForSync(previousSim, current, existing, PRICE_FOR_ZERO_GP);

  let names = {};
  const statsPath = join(ROOT, "data", `player_game_stats_s${SEASON}.json`);
  if (existsSync(statsPath)) {
    try {
      const s = JSON.parse(readFileSync(statsPath, "utf-8")).stats ?? [];
      for (const row of s) {
        if (row.playerId && row.name && !names[row.playerId]) names[row.playerId] = row.name;
      }
    } catch {
      /* ignore */
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let supabaseFantasyPlayers = [];
  if (url && key) {
    const supabase = createClient(url, key);
    const { data: players } = await supabase
      .from("fantasy_players")
      .select("player_id, name")
      .eq("season", SEASON)
      .range(0, 999);
    supabaseFantasyPlayers = players ?? [];
    for (const r of supabaseFantasyPlayers) {
      if (r.name) names[r.player_id] = r.name;
    }
  }

  const noArrow = [];
  const withArrow = [];
  const unchanged = [];
  for (const idStr of Object.keys(current)) {
    const pid = Number(idStr);
    const cur = current[pid];
    const prev = previous[pid];
    const name = names[pid] ?? `Player ${pid}`;
    if (prev == null) {
      noArrow.push({ pid, name, current: cur });
    } else if (prev !== cur) {
      withArrow.push({ pid, name, previous: prev, current: cur });
    } else {
      unchanged.push({ pid, name, price: cur });
    }
  }

  const rosterIds = new Set([...loadSeasonRosterPlayerIds(SEASON)]);
  for (const r of supabaseFantasyPlayers) rosterIds.add(r.player_id);

  const notInSimulation = [];
  for (const pid of rosterIds) {
    if (current[pid] != null) continue;
    const gp = gpMap.get(pid) ?? 0;
    notInSimulation.push({
      pid,
      name: names[pid] ?? `Player ${pid}`,
      gp,
    });
  }

  return {
    noArrow,
    withArrow,
    unchanged,
    notInSimulation,
    sourceLabel: "predicted (runSimulation + merge, same as update-prices)",
    floor: PRICE_FOR_ZERO_GP,
  };
}

let noArrow;
let withArrow;
let unchanged;
let notInSimulation;
let sourceLabel;
let floor;

if (USE_PREDICT) {
  const pred = await predictFromSimulation();
  noArrow = pred.noArrow;
  withArrow = pred.withArrow;
  unchanged = pred.unchanged;
  notInSimulation = pred.notInSimulation;
  sourceLabel = pred.sourceLabel;
  floor = pred.floor;
} else {
  unchanged = [];
  notInSimulation = [];
  const out = USE_SUPABASE ? await auditFromSupabase() : auditFromJson();
  noArrow = out.noArrow;
  withArrow = out.withArrow;
  sourceLabel = out.sourceLabel;
}

console.log(`Season ${SEASON} — price arrow audit (${sourceLabel})\n`);
if (floor != null) {
  console.log(`New-player floor (PRICE_FOR_ZERO_GP): $${floor} — set FANTASY_NEW_PLAYER_PRICE in .env.local to override (1–10).\n`);
}
if (USE_PREDICT) {
  console.log(
    "Predicted: uses local player_prices JSON for merge fill; run update-prices first if JSON is stale.\n"
  );
}
if (!USE_PREDICT && !USE_SUPABASE) {
  console.log(
    "Note: JSON may omit call-ups only on Supabase. For production DB: add --supabase\n"
  );
}
if (!USE_PREDICT) {
  console.log("Add --predict to simulate update-prices and show arrows (incl. new-player $ floor).\n");
}

console.log(
  "--- No arrow (effective previous null — site shows only current $) ---"
);
if (noArrow.length === 0) {
  console.log("  (none)");
} else {
  for (const r of noArrow.sort((a, b) => a.pid - b.pid)) {
    console.log(`  ${r.name} (#${r.pid})  $${r.current}`);
  }
  if (!USE_PREDICT) {
    console.log(
      "\n  Why: simulation had no price at start of last match (often first fantasy game),"
    );
    console.log(
      "  and no history fallback. update-prices merge + sync should set previous_price."
    );
  }
}
console.log("\n--- Arrow (previous !== current) ---");
for (const r of withArrow.sort((a, b) => a.pid - b.pid)) {
  console.log(`  ${r.name} (#${r.pid})  $${r.previous}→$${r.current}`);
}
console.log(`\nCounts: no_arrow=${noArrow.length}, with_arrow=${withArrow.length}`);

if (USE_PREDICT && unchanged.length > 0) {
  console.log("\n--- Unchanged (previous === current, no arrow) ---");
  for (const r of unchanged.sort((a, b) => a.pid - b.pid)) {
    console.log(`  ${r.name} (#${r.pid})  $${r.price}`);
  }
  console.log(`Count: ${unchanged.length}`);
}

if (USE_PREDICT && notInSimulation.length > 0) {
  console.log(
    "\n--- Not in simulation (no price row: 0 fantasy GP in loaded stats; roster only) ---"
  );
  for (const r of notInSimulation.sort((a, b) => a.pid - b.pid)) {
    console.log(`  ${r.name} (#${r.pid})  fantasy GP in load: ${r.gp}`);
  }
  console.log(
    `Count: ${notInSimulation.length} (site shows ${floor != null ? `$${floor}` : "$3"} until they have games)`
  );
}
