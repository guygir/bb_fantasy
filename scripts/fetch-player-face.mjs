/**
 * Render a player's face from legacy.buzzerbeater.com avatar parts + layer assets
 * and save as a 94x125 PNG matching existing public/player-faces/*.png assets.
 *
 * Run: node scripts/fetch-player-face.mjs <playerId>
 * Or:  node scripts/fetch-player-face.mjs --all   (fetch all from season71_stats)
 * Or:  node scripts/fetch-player-face.mjs --supabase [season]  (fetch from Supabase fantasy_players)
 * Flags: --force  re-fetch even if image exists
 *        --debug  save intermediate HTML to data/debug_player_{id}.html
 *
 * Output: public/player-faces/{playerId}.png
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import {
  PUPPETEER_DEFAULT_ARGS,
  prepareBbPage,
  launchBbBrowser,
} from "./lib/bb-site-session.mjs";
import { getPlayer, resolveIds } from "./lib/bb-legacy-api.mjs";
import { resolveCurrentSeasonFromEnv } from "./lib/season-calendar.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });

const FACE_ASSET_BASE = "https://legacy.buzzerbeater.com/legacy-assets/images/faces";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const DEBUG = ARGS.includes("--debug");
const IS_ALL = ARGS.includes("--all");
const IS_U21DLE = ARGS.includes("--u21dle");
const IS_SUPABASE = ARGS.includes("--supabase");
const EXPLICIT_ID = ARGS.find(
  (a) => !["--force", "--debug", "--all", "--u21dle", "--supabase"].includes(a) && a.trim() !== ""
);

if (!EXPLICIT_ID && !IS_ALL && !IS_U21DLE && !IS_SUPABASE) {
  console.error("Usage: node scripts/fetch-player-face.mjs <playerId> [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --all [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --supabase [season] [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --u21dle [--force] [--debug]  (GP>=8 from u21dle_players.json)");
  process.exit(1);
}

const assetCache = new Map();

async function fetchDataUri(relPath) {
  if (assetCache.has(relPath)) return assetCache.get(relPath);
  const url = `${FACE_ASSET_BASE}/${relPath}`;
  const res = await fetch(url, { headers: { "User-Agent": "BBFantasy/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const uri = `data:image/png;base64,${buf.toString("base64")}`;
  assetCache.set(relPath, uri);
  return uri;
}

function buildFaceHtml(uris) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .playerFace { position: relative; width: 94px; height: 125px; overflow: hidden; }
  .faceBackground { position: absolute; left: 0px; top: 0px; width: 89px; height: 125px; }
  .face { position: absolute; left: 6px; top: 7px; }
  .eyes { position: absolute; left: 21px; top: 56px; }
  .eyebrow { position: absolute; left: 21px; top: 50px; }
  .mouth { position: absolute; left: 24px; top: 86px; }
  .nose { position: absolute; left: 35px; top: 71px; }
  .hair { position: absolute; left: 7px; top: 7px; }
</style>
</head>
<body>
  <div id="faceBox" class="playerFace">
    <img class="faceBackground" src="${uris.bg}" alt="" />
    <img class="face" src="${uris.face}" alt="" />
    <img class="eyes" src="${uris.eyes}" alt="" />
    <img class="eyebrow" src="${uris.eyebrow}" alt="" />
    <img class="mouth" src="${uris.mouth}" alt="" />
    <img class="nose" src="${uris.nose}" alt="" />
    <img class="hair" src="${uris.hair}" alt="" />
  </div>
</body>
</html>`;
}

async function fetchFacesBatch(playerIds) {
  const outDir = join(__dirname, "../public/player-faces");
  mkdirSync(outDir, { recursive: true });

  const todoIds = [];
  for (let i = 0; i < playerIds.length; i++) {
    const id = String(playerIds[i]);
    const outPath = join(outDir, `${id}.png`);
    if (existsSync(outPath) && !FORCE) {
      console.log(`[${i + 1}/${playerIds.length}] ${id} - already exists, skip`);
      continue;
    }
    todoIds.push(id);
  }

  if (todoIds.length === 0) {
    console.log("All player faces already present.");
    return;
  }

  console.log(`Resolving ${todoIds.length} player ID(s) via legacy API...`);
  const uuidByNum = await resolveIds("player", todoIds.map((id) => Number(id)));

  const launchOpts = {
    headless: true,
    args: [...PUPPETEER_DEFAULT_ARGS],
  };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_PATHS.find(existsSync);
  if (executablePath) {
    launchOpts.executablePath = executablePath;
    console.log("Using Chrome:", executablePath);
  }

  const browser = await launchBbBrowser(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 200, height: 200 });
  await prepareBbPage(page);

  try {
    for (let i = 0; i < todoIds.length; i++) {
      const id = todoIds[i];
      const outPath = join(outDir, `${id}.png`);
      console.log(`[${i + 1}/${todoIds.length}] Fetching face for ${id}...`);
      try {
        const uuid = uuidByNum.get(Number(id));
        if (!uuid) throw new Error(`Could not resolve playerId ${id} to UUID`);
        const player = await getPlayer(uuid);
        const av = player?.avatar;
        if (!av) throw new Error(`No avatar parts returned for ${id}`);

        const [bg, face, eyes, eyebrow, mouth, nose, hair] = await Promise.all([
          fetchDataUri("bg/1.png"),
          fetchDataUri(`faces/${av.skinColor}/${av.faceType}.png`),
          fetchDataUri(`eyes/${av.eyeType}.png`),
          fetchDataUri(`eyebrow/${av.hairColor}/${av.eyebrowType}.png`),
          fetchDataUri(`mouth/${av.mouthType}.png`),
          fetchDataUri(`nose/${av.noseType}.png`),
          fetchDataUri(`hair/${av.hairColor}/${av.hairType}.png`),
        ]);

        const html = buildFaceHtml({ bg, face, eyes, eyebrow, mouth, nose, hair });
        if (DEBUG) {
          const debugPath = join(__dirname, "../data", `debug_player_${id}.html`);
          writeFileSync(debugPath, html, "utf-8");
        }
        await page.setContent(html, { waitUntil: "load" });
        const el = await page.$("#faceBox");
        if (!el) throw new Error("Failed to render #faceBox");
        await el.screenshot({ path: outPath });
        console.log("  [face] Saved", outPath);
      } catch (e) {
        console.error(`[${i + 1}/${todoIds.length}] ${id} failed:`, e.message);
      }
    }
  } finally {
    await browser.close();
  }
}

async function run() {
  const playerIds = [];
  if (IS_SUPABASE) {
    const explicitNum = EXPLICIT_ID ? parseInt(EXPLICIT_ID, 10) : NaN;
    const season = Number.isFinite(explicitNum) && explicitNum > 0 ? explicitNum : resolveCurrentSeasonFromEnv();
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --supabase");
      process.exit(1);
    }
    const supabase = createClient(url, key);
    const { data, error } = await supabase.from("fantasy_players").select("player_id").eq("season", season).range(0, 999);
    if (error) {
      console.error("Supabase error:", error.message);
      process.exit(1);
    }
    playerIds.push(...(data ?? []).map((r) => String(r.player_id)));
    console.log("Fetching faces for", playerIds.length, "players (Supabase season", season, ")");
  } else if (IS_ALL) {
    const dataPath = join(__dirname, "../data", "season71_stats.json");
    if (!existsSync(dataPath)) {
      console.error("No season71_stats.json - run with explicit playerId or --supabase");
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));
    playerIds.push(...(data.players ?? []).map((p) => String(p.playerId)));
    console.log("Fetching faces for", playerIds.length, "players (season71_stats.json)");
  } else if (IS_U21DLE) {
    const dataPath = join(__dirname, "../data", "u21dle_players.json");
    if (!existsSync(dataPath)) {
      console.error("No u21dle_players.json - run npm run fetch-u21dle-data first");
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));
    const eligible = (data.players ?? []).filter((p) => p.gp >= 8);
    playerIds.push(...eligible.map((p) => String(p.playerId)));
    console.log("Fetching faces for", playerIds.length, "U21dle players (GP>=8)");
  } else {
    playerIds.push(EXPLICIT_ID);
  }

  if (playerIds.length === 0) {
    console.error("No players to fetch");
    process.exit(1);
  }

  await fetchFacesBatch(playerIds);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
