/**
 * Fetch a player's face from BuzzerBeater and save as PNG.
 * Uses Puppeteer to login and screenshot the face container.
 *
 * Run: node scripts/fetch-player-face.mjs <playerId>
 * Or:  node scripts/fetch-player-face.mjs --all   (fetch all from season71_stats)
 * Flags: --force  re-fetch even if image exists
 *       --debug   save player page HTML to data/debug_player_{id}.html
 *
 * Env: BBAPI_LOGIN, BB_PASSWORD (main site password - may differ from BBAPI_CODE)
 *
 * Output: public/player-faces/{playerId}.png
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_BASE = "https://buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const PASSWORD = process.env.BB_PASSWORD; // Main site password - NOT BBAPI_CODE (that's read-only for API)

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes("--force");
const DEBUG = ARGS.includes("--debug");
const IS_ALL = ARGS.includes("--all");
const IS_U21DLE = ARGS.includes("--u21dle");
const EXPLICIT_ID = ARGS.find((a) => !["--force", "--debug", "--all", "--u21dle"].includes(a));

if (!EXPLICIT_ID && !IS_ALL && !IS_U21DLE) {
  console.error("Usage: node scripts/fetch-player-face.mjs <playerId> [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --all [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --u21dle [--force] [--debug]  (GP>=8 from u21dle_players.json)");
  process.exit(1);
}
if (!PASSWORD) {
  console.error("Set BB_PASSWORD (main site password) - do not use BBAPI_CODE");
  process.exit(1);
}

async function saveDebug(page, label) {
  const debugDir = join(__dirname, "../data");
  mkdirSync(debugDir, { recursive: true });
  const slug = label.replace(/\s+/g, "_");
  try {
    await page.screenshot({ path: join(debugDir, `debug_${slug}.png`) });
    const html = await page.content();
    writeFileSync(join(debugDir, `debug_${slug}.html`), html, "utf-8");
    console.log("  [debug] Saved", `data/debug_${slug}.png`, "and .html");
  } catch (e) {
    console.log("  [debug] Could not save:", e.message);
  }
}

async function fetchFace(playerId) {
  let browser;
  try {
    console.log("  [1/7] Launching browser...");
    const puppeteer = await import("puppeteer");
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    console.log("  [2/7] Browser launched");

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    const loginUrl = `${MAIN_BASE}login.aspx`;
    console.log("  [3/7] Navigating to login page:", loginUrl);
    let nav;
    try {
      nav = await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (e) {
      console.log("  [debug] goto timed out or failed:", e.message);
      await saveDebug(page, "login_timeout");
      throw e;
    }
    console.log("  [3/7] Response:", nav?.status(), "URL:", page.url());

    const loginSel = 'input[name*="txtLogin"], input[name*="Login"], input[type="text"]';
    const passSel = 'input[type="password"]';
    const btnSel = 'input[type="submit"], button[type="submit"], input[name*="btnLogin"]';
    console.log("  [4/7] Looking for login form...");
    try {
      await page.waitForSelector(loginSel, { timeout: 5000 });
    } catch (e) {
      console.log("  [debug] Login form not found");
      await saveDebug(page, "no_login_form");
      throw e;
    }
    await page.type(loginSel, LOGIN, { delay: 50 });
    await page.type(passSel, PASSWORD, { delay: 50 });
    console.log("  [4/7] Submitting login...");
    await page.click(btnSel);
    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      console.log("  [debug] Login navigation timed out - likely reCAPTCHA blocking automated login");
      await saveDebug(page, "login_nav_timeout");
      const hasRecaptcha = await page.evaluate(() => !!document.querySelector(".g-recaptcha, [data-sitekey]"));
      if (hasRecaptcha) {
        throw new Error(
          "BuzzerBeater login has reCAPTCHA - automated login is blocked. " +
          "Use cookie export (see data/README.md) or manual face screenshots."
        );
      }
      throw e;
    }
    console.log("  [4/7] After login, URL:", page.url());
    if (page.url().includes("login")) {
      await saveDebug(page, "login_failed_still_on_login");
      throw new Error("Login failed - check BB_PASSWORD (main site password, not BBAPI code)");
    }

    const playerUrl = `${MAIN_BASE}player/${playerId}/overview.aspx`;
    console.log("  [5/7] Navigating to player page:", playerUrl);
    try {
      await page.goto(playerUrl, { waitUntil: "load", timeout: 20000 });
    } catch (e) {
      console.log("  [debug] Player page goto timed out");
      await saveDebug(page, "player_page_timeout");
      throw e;
    }
    console.log("  [5/7] Player page URL:", page.url());

    // Face only: #cphContent_faceContainer > div.playerFace (no ball, no text)
    // Ball/number: #cphContent_playerNumber_divNumber (hide before screenshot)
    const faceSel = "#cphContent_faceContainer > div.playerFace";
    const ballSel = "#cphContent_playerNumber_divNumber";
    console.log("  [6/7] Looking for face (#cphContent_faceContainer > div.playerFace)...");
    await page.waitForSelector(faceSel, { timeout: 8000 }).catch(() => null);
    const faceEl = await page.$(faceSel);
    if (!faceEl) {
      await saveDebug(page, "no_face_container");
      throw new Error("Face element not found (expected #cphContent_faceContainer > div.playerFace)");
    }

    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.style.setProperty("display", "none", "important");
    }, ballSel);

    console.log("  [6/7] Waiting for face parts (hair, etc.) to load...");
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const imgs = el.querySelectorAll("img");
        if (imgs.length === 0) return true;
        return Array.from(imgs).every((img) => img.complete && img.naturalWidth > 0);
      },
      { timeout: 10000 },
      faceSel
    ).catch(() => null);
    await new Promise((r) => setTimeout(r, 3000));

    if (DEBUG) {
      const html = await page.content();
      const debugPath = join(__dirname, "../data", `debug_player_${playerId}.html`);
      writeFileSync(debugPath, html, "utf-8");
      console.log("  [debug] Saved", debugPath);
    }

    const outDir = join(__dirname, "../public/player-faces");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${playerId}.png`);
    console.log("  [7/7] Screenshotting face...");
    await faceEl.screenshot({ path: outPath });
    console.log("  [7/7] Saved", outPath);
    return outPath;
  } finally {
    if (browser) await browser.close();
  }
}

async function run() {
  const playerIds = [];
  if (IS_ALL) {
    const dataPath = join(__dirname, "../data", "season71_stats.json");
    if (!existsSync(dataPath)) {
      console.error("No season71_stats.json - run with explicit playerId");
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));
    playerIds.push(...(data.players ?? []).map((p) => String(p.playerId)));
    console.log("Fetching faces for", playerIds.length, "players (season71 roster)");
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

  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i];
    const outPath = join(__dirname, "../public/player-faces", `${id}.png`);
    if (existsSync(outPath) && !FORCE) {
      console.log(`[${i + 1}/${playerIds.length}] ${id} - already exists, skip`);
      continue;
    }
    try {
      console.log(`[${i + 1}/${playerIds.length}] Fetching ${id}...`);
      await fetchFace(id);
    } catch (e) {
      console.error(`[${i + 1}/${playerIds.length}] ${id} failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 2000)); // Rate limit
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
