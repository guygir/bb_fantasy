/**
 * Fetch faces for all U21dle players (GP>=8 from u21dle_players.json).
 * Skips players that already have a face in public/player-faces/.
 *
 * Run: node scripts/sync-u21dle-faces.mjs
 * Or:  npm run sync-u21dle-faces
 *
 * Env: BBAPI_LOGIN, BB_PASSWORD (main site password for BuzzerBeater)
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const proc = spawn("node", ["scripts/fetch-player-face.mjs", "--u21dle"], {
  stdio: "inherit",
  cwd: join(__dirname, ".."),
});

proc.on("exit", (code) => process.exit(code ?? 0));
