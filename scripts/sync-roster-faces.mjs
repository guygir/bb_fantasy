/**
 * Daily cron: check U21 roster for new players, fetch their faces.
 * Skips players that already have a face in public/player-faces/.
 *
 * Run: node scripts/sync-roster-faces.mjs
 *
 * Env: BBAPI_LOGIN, BB_PASSWORD (main site password for BuzzerBeater)
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const proc = spawn("node", ["scripts/fetch-player-face.mjs", "--all"], {
  stdio: "inherit",
  cwd: join(__dirname, ".."),
});

proc.on("exit", (code) => process.exit(code ?? 0));
