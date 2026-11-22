/**
 * Daily cron: check U21 roster for new players, fetch their faces.
 * Skips players that already have a face in public/player-faces/.
 *
 * Run: node scripts/sync-roster-faces.mjs [season]
 *
 * Uses Supabase fantasy_players when NEXT_PUBLIC_SUPABASE_URL is set,
 * otherwise season71_stats.json (--all).
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { resolveCurrentSeasonFromEnv } from "./lib/season-calendar.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });

const argSeason = process.argv[2] && String(process.argv[2]).trim() !== "" ? parseInt(process.argv[2], 10) : NaN;
const season = Number.isFinite(argSeason) && argSeason > 0 ? argSeason : resolveCurrentSeasonFromEnv();
const useSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = useSupabase
  ? ["scripts/fetch-player-face.mjs", "--supabase", String(season)]
  : ["scripts/fetch-player-face.mjs", "--all"];

const proc = spawn("node", args, {
  stdio: "inherit",
  cwd: ROOT,
  env: process.env,
});

proc.on("exit", (code) => process.exit(code ?? 0));
