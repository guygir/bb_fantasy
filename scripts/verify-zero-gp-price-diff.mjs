/**
 * Local-only: list players whose display price changes with PRICE_FOR_ZERO_GP (0 GP → $3).
 * Old behavior: currentPrice ?? fantasyPPGToPrice(fantasyPPG) with gp=0 → tier from derived stats (often $1).
 * Run: node scripts/verify-zero-gp-price-diff.mjs [season] [--supabase]
 *   --supabase: use fantasy_* tables (needs .env.local); only counts rows where stored price is null
 *   (same as UI fallback path).
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

const args = process.argv.slice(2).filter((a) => a !== "--supabase");
const USE_SUPABASE = process.argv.includes("--supabase");
const SEASON = args[0] ? parseInt(args[0], 10) : 71;

const { statsToFantasyPoints, fantasyPPGToPrice, PRICE_FOR_ZERO_GP } = await import(
  join(__dirname, "../src/lib/scoring-core.mjs")
);

const DATA_DIR = join(ROOT, "data");

function loadSeasonPlayers() {
  const path = join(DATA_DIR, `season${SEASON}_stats.json`);
  if (!existsSync(path)) {
    console.error(`Missing ${path}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return data.players ?? [];
}

function loadPlayerGameStats() {
  const path = join(DATA_DIR, `player_game_stats_s${SEASON}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.stats ?? [];
  } catch {
    return [];
  }
}

function gpByPlayer(stats) {
  const m = new Map();
  for (const s of stats) {
    const id = s.playerId;
    m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

function derivedPPGFromSeasonRow(p) {
  return statsToFantasyPoints({
    min: p.min,
    fgMade: p.fgMade ?? 0,
    fgAtt: p.fgAtt ?? 0,
    tpMade: p.tpMade ?? 0,
    tpAtt: p.tpAtt ?? 0,
    ftMade: p.ftMade ?? 0,
    ftAtt: p.ftAtt ?? 0,
    or: p.or ?? 0,
    tr: p.tr,
    ast: p.ast,
    to: p.to,
    stl: p.stl,
    blk: p.blk,
    pf: p.pf ?? 0,
    pts: p.pts,
    rtng: p.rtng,
  });
}

/** Supabase fantasy_players row → same derived stats as fantasy-db (zeros for missing box fields). */
function derivedPPGFromFantasyPlayerRow(p) {
  return statsToFantasyPoints({
    min: p.min,
    fgMade: 0,
    fgAtt: 0,
    tpMade: 0,
    tpAtt: 0,
    ftMade: 0,
    ftAtt: 0,
    or: 0,
    tr: p.tr ?? 0,
    ast: p.ast ?? 0,
    to: p.to ?? 0,
    stl: p.stl ?? 0,
    blk: p.blk ?? 0,
    pf: 0,
    pts: p.pts ?? 0,
    rtng: p.rtng ?? 0,
  });
}

async function runSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const [playersRes, statsRes, pricesRes] = await Promise.all([
    supabase.from("fantasy_players").select("*").eq("season", SEASON).range(0, 999),
    supabase.from("fantasy_player_game_stats").select("player_id").eq("season", SEASON).range(0, 9999),
    supabase.from("fantasy_player_prices").select("player_id, price").eq("season", SEASON).range(0, 999),
  ]);
  const gpMap = new Map();
  for (const r of statsRes.data ?? []) {
    const id = r.player_id;
    gpMap.set(id, (gpMap.get(id) ?? 0) + 1);
  }
  const priceById = new Map((pricesRes.data ?? []).map((r) => [r.player_id, r.price]));

  const changes = [];
  for (const p of playersRes.data ?? []) {
    const gp = gpMap.get(p.player_id) ?? 0;
    if (gp !== 0) continue;
    const stored = priceById.get(p.player_id);
    if (stored != null) continue; // UI uses stored price, not PPG fallback
    const derivedPPG = derivedPPGFromFantasyPlayerRow(p);
    const oldPrice = fantasyPPGToPrice(derivedPPG);
    const newPrice = PRICE_FOR_ZERO_GP;
    if (oldPrice !== newPrice) {
      changes.push({
        playerId: p.player_id,
        name: p.name,
        derivedPPG: derivedPPG.toFixed(2),
        oldPrice,
        newPrice,
      });
    }
  }
  return changes;
}

let changes = [];

if (USE_SUPABASE) {
  changes = await runSupabase();
} else {
  const players = loadSeasonPlayers();
  const stats = loadPlayerGameStats();
  const gpMap = gpByPlayer(stats);

  for (const p of players) {
    const gp = gpMap.get(p.playerId) ?? 0;
    if (gp !== 0) continue;

    const derivedPPG = derivedPPGFromSeasonRow(p);
    const oldPrice = fantasyPPGToPrice(derivedPPG);
    const newPrice = PRICE_FOR_ZERO_GP;
    if (oldPrice !== newPrice) {
      changes.push({ playerId: p.playerId, name: p.name, derivedPPG: derivedPPG.toFixed(2), oldPrice, newPrice });
    }
  }
}

const source = USE_SUPABASE ? "Supabase (0 GP, no stored price)" : "JSON season stats + player_game_stats";
console.log(`Season ${SEASON} [${source}]: 0 GP players where PPG-tier fallback changes to $${PRICE_FOR_ZERO_GP}:`);
if (changes.length === 0) {
  console.log("  (none — all such players already tier $3, or no 0-GP rows without stored price)");
} else {
  for (const c of changes.sort((a, b) => a.playerId - b.playerId)) {
    console.log(`  ${c.name} (#${c.playerId})  derivedPPG≈${c.derivedPPG}  $${c.oldPrice} → $${c.newPrice}`);
  }
}
console.log(`\nTotal: ${changes.length} player(s).`);
if (!USE_SUPABASE) {
  console.log("\nTip: for DB roster (e.g. Amrani), run: node scripts/verify-zero-gp-price-diff.mjs " + SEASON + " --supabase");
}
