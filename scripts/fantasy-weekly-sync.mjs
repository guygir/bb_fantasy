#!/usr/bin/env node
/**
 * Full fantasy data sync: schedule → boxscores → process → Supabase.
 * Run: node scripts/fantasy-weekly-sync.mjs [season]
 *
 * 1. Fetch schedule (BBAPI)
 * 2. Fetch boxscores for past matches
 * 3. Process boxscores → player_game_stats, match_scores
 * 4. Sync to Supabase
 *
 * Used by GitHub Actions weekly cron. Also run manually after game days.
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
run("Sync to Supabase", "node", ["scripts/sync-fantasy-to-supabase.mjs", String(SEASON)]);

console.log(`\nDone. Season ${SEASON} fantasy data synced.`);
