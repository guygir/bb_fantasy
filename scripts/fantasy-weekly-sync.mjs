#!/usr/bin/env node
/**
 * Full fantasy data sync: schedule → boxscores → process → prices → Supabase.
 * Run: node scripts/fantasy-weekly-sync.mjs [season]
 *
 * 1. Fetch schedule (BBAPI)
 * 2. Fetch boxscores for past matches
 * 3. Process boxscores → player_game_stats, match_scores
 * 4. Update prices (weekly adjustment from stats)
 * 5. Sync to Supabase
 *
 * Runs daily at 02:00 UTC. Picks up new boxscores after U21 games (typically weekly).
 */

import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : Number(process.env.CURRENT_SEASON ?? 71);

function run(name, cmd, args = []) {
  console.log(`\n--- ${name} ---`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  if (r.status !== 0) {
    console.error(`${name} failed (exit ${r.status})`);
    process.exit(r.status);
  }
}

console.log(`Fantasy weekly sync for season ${SEASON}`);

run("Fetch schedule", "node", ["scripts/fetch-bbapi-schedule.mjs", String(SEASON)]);
run("Fetch boxscores", "node", ["scripts/fetch-all-boxscores.mjs", String(SEASON)]);
run("Process boxscores", "node", ["scripts/process-boxscores.mjs", String(SEASON)]);
run("Update prices", "node", ["scripts/update-prices.mjs", String(SEASON)]);
run("Sync to Supabase", "node", ["scripts/sync-fantasy-to-supabase.mjs", String(SEASON)]);

// Sync roster faces (optional - needs BB_PASSWORD; may fail on CI if reCAPTCHA blocks login)
if (process.env.BB_PASSWORD) {
  console.log("\n--- Sync roster faces ---");
  const faceResult = spawnSync("node", ["scripts/sync-roster-faces.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  if (faceResult.status !== 0) {
    console.warn("sync-roster-faces failed (non-fatal) - faces may be outdated");
  }
} else {
  console.log("\n--- Skipping sync-roster-faces (BB_PASSWORD not set) ---");
}

console.log(`\nDone. Season ${SEASON} fantasy data synced.`);
