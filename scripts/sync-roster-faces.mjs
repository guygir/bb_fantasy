/**
 * Daily cron: check U21 roster for new players, fetch their faces.
 * Skips players that already have a face in public/player-faces/.
 *
 * Run: node scripts/sync-roster-faces.mjs [season]
 *
 * Uses Supabase fantasy_players when NEXT_PUBLIC_SUPABASE_URL is set,
 * otherwise season71_stats.json (--all).
 *
 * Env: BBAPI_LOGIN, BB_PASSWORD (main site password for BuzzerBeater)
 *      Loaded from .env.local via fetch-player-face.
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const season = process.argv[2] ?? process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? "71";
const useSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = useSupabase ? ["scripts/fetch-player-face.mjs", "--supabase", String(season)] : ["scripts/fetch-player-face.mjs", "--all"];

const proc = spawn("node", args, {
  stdio: "inherit",
  cwd: ROOT,
  env: process.env,
});

proc.on("exit", (code) => process.exit(code ?? 0));
