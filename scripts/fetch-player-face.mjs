/**
 * Fetch a player's face from BuzzerBeater and save as PNG.
 * Prefers public player overview (no login) when BB serves the face — avoids reCAPTCHA on CI.
 * Falls back to one Puppeteer login per batch, then reuses that session for all remaining players.
 *
 * Run: node scripts/fetch-player-face.mjs <playerId>
 * Or:  node scripts/fetch-player-face.mjs --all   (fetch all from season71_stats)
 * Or:  node scripts/fetch-player-face.mjs --supabase [season]  (fetch from Supabase fantasy_players)
 * Flags: --force  re-fetch even if image exists
 *       --debug   save player page HTML to data/debug_player_{id}.html
 *
 * Env: BBAPI_LOGIN, BB_PASSWORD (main site password - may differ from BBAPI_CODE)
 *      BB_SITE_COOKIES — optional; raw "Cookie" header value from a logged-in browser session
 *        (DevTools → Application → Cookies for buzzerbeater.com, or copy Cookie request header).
 *        Bypasses login.aspx and reCAPTCHA — same idea as lessons.md / data/README.md.
 *      PUPPETEER_EXECUTABLE_PATH or system Chrome (see CHROME_PATHS) for GitHub Actions
 *
 * Output: public/player-faces/{playerId}.png
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });
const MAIN_BASE = "https://buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const PASSWORD = process.env.BB_PASSWORD;
/** Same as data/README.md — export from logged-in browser when reCAPTCHA blocks Puppeteer login. */
const SITE_COOKIE_HEADER = (process.env.BB_SITE_COOKIES || process.env.BUZZERBEATER_COOKIES || "").trim();

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
const EXPLICIT_ID = ARGS.find((a) => !["--force", "--debug", "--all", "--u21dle", "--supabase"].includes(a));

if (!EXPLICIT_ID && !IS_ALL && !IS_U21DLE && !IS_SUPABASE) {
  console.error("Usage: node scripts/fetch-player-face.mjs <playerId> [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --all [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --supabase [season] [--force] [--debug]");
  console.error("   or: node scripts/fetch-player-face.mjs --u21dle [--force] [--debug]  (GP>=8 from u21dle_players.json)");
  process.exit(1);
}
if (!PASSWORD && !SITE_COOKIE_HEADER) {
  console.warn(
    "No BB_PASSWORD or BB_SITE_COOKIES — only players with a public overview face will succeed; login fallback disabled."
  );
}

/** Same as fetch-u21dle-player-source-teams.mjs — BB can be slow; short timeouts cause false failures. */
const NAV_TIMEOUT = 45000;

const faceSel = "#cphContent_faceContainer > div.playerFace";
const ballSel = "#cphContent_playerNumber_divNumber";

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

async function tryScreenshotFace(page, playerId) {
  await page.waitForSelector(faceSel, { timeout: 8000 }).catch(() => null);
  if (!(await page.$(faceSel))) return false;

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.setProperty("display", "none", "important");
  }, ballSel);

  await page
    .waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const imgs = el.querySelectorAll("img");
        if (imgs.length === 0) return true;
        return Array.from(imgs).every((img) => img.complete && img.naturalWidth > 0);
      },
      { timeout: 10000 },
      faceSel
    )
    .catch(() => null);
  await new Promise((r) => setTimeout(r, 1500));

  if (DEBUG) {
    const html = await page.content();
    const debugPath = join(__dirname, "../data", `debug_player_${playerId}.html`);
    writeFileSync(debugPath, html, "utf-8");
    console.log("  [debug] Saved", debugPath);
  }

  const faceElFinal = await page.$(faceSel);
  if (!faceElFinal) return false;

  const outDir = join(__dirname, "../public/player-faces");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${playerId}.png`);
  await faceElFinal.screenshot({ path: outPath });
  console.log("  [face] Saved", outPath);
  return true;
}

function isLoginUrl(url) {
  return (url || "").includes("login.aspx");
}

/**
 * Log in once; leaves page on post-login URL (caller navigates to player).
 */
async function loginToBB(page) {
  if (!PASSWORD || !String(PASSWORD).trim()) {
    throw new Error("BB_PASSWORD required for form login (set it or use BB_SITE_COOKIES)");
  }
  await page.setExtraHTTPHeaders({});
  const loginUrl = `${MAIN_BASE}login.aspx`;
  console.log("  [login] Navigating to", loginUrl);
  let nav;
  try {
    nav = await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  } catch (e) {
    console.log("  [debug] goto timed out or failed:", e.message);
    await saveDebug(page, "login_timeout");
    throw e;
  }
  console.log("  [login] Response:", nav?.status(), "URL:", page.url());

  /** Main #cphContent form — not the footer modal (name *txtLogin* matches txtLoginUserName first). */
  const loginSel = "#cphContent_txtUserName";
  const passSel = "#cphContent_txtPassword";
  const btnSel = "#cphContent_btnLoginUser";
  try {
    await page.waitForSelector(loginSel, { timeout: 10000 });
  } catch (e) {
    console.log("  [debug] Login form not found");
    await saveDebug(page, "no_login_form");
    throw e;
  }
  await page.type(loginSel, LOGIN, { delay: 50 });
  await page.type(passSel, PASSWORD, { delay: 50 });
  console.log("  [login] Submitting...");
  await page.click(btnSel);
  try {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
  } catch (e) {
    console.log("  [debug] Login waitForNavigation:", e.message);
    await saveDebug(page, "login_nav_timeout");
    // Navigation event sometimes never fires even after URL changes (same pattern as slow BB)
    if (!isLoginUrl(page.url())) {
      console.log("  [login] URL left login page despite navigation timeout — continuing");
    } else {
      const hasRecaptcha = await page.evaluate(
        () => !!document.querySelector(".g-recaptcha, [data-sitekey]")
      );
      if (hasRecaptcha) {
        throw new Error(
          "BuzzerBeater login has reCAPTCHA - automated login is blocked. " +
            "Public overview did not expose the face; try cookies or manual screenshot (see docs)."
        );
      }
      throw e;
    }
  }
  console.log("  [login] After login, URL:", page.url());
  if (isLoginUrl(page.url())) {
    await saveDebug(page, "login_failed_still_on_login");
    throw new Error("Login failed - check BB_PASSWORD (main site password, not BBAPI code)");
  }
}

async function fetchFacesBatch(playerIds) {
  const puppeteer = await import("puppeteer");
  const launchOpts = { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_PATHS.find(existsSync);
  if (executablePath) {
    launchOpts.executablePath = executablePath;
    console.log("Using Chrome:", executablePath);
  }

  console.log("  [1/3] Launching browser...");
  const browser = await puppeteer.default.launch(launchOpts);
  console.log("  [2/3] Browser launched");
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  if (SITE_COOKIE_HEADER) {
    await page.setExtraHTTPHeaders({ Cookie: SITE_COOKIE_HEADER });
    console.log(
      "  [session] BB_SITE_COOKIES set — using browser Cookie header (no login.aspx / reCAPTCHA)"
    );
  }

  let loggedIn = false;

  try {
    for (let i = 0; i < playerIds.length; i++) {
      const id = playerIds[i];
      const outPath = join(__dirname, "../public/player-faces", `${id}.png`);
      if (existsSync(outPath) && !FORCE) {
        console.log(`[${i + 1}/${playerIds.length}] ${id} - already exists, skip`);
        continue;
      }

      console.log(`[${i + 1}/${playerIds.length}] Fetching ${id}...`);
      const overviewUrl = `${MAIN_BASE}player/${id}/overview.aspx`;

      try {
        await page.goto(overviewUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        const urlAfter = page.url();

        if (!isLoginUrl(urlAfter) && (await tryScreenshotFace(page, id))) {
          console.log(
            SITE_COOKIE_HEADER
              ? "  [face] OK (session cookie or public overview)"
              : "  [face] OK without login (public overview)"
          );
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (!loggedIn) {
          if (SITE_COOKIE_HEADER && isLoginUrl(urlAfter)) {
            console.log(
              "  [session] BB_SITE_COOKIES invalid or expired (still on login) — clearing header; trying password login"
            );
            await page.setExtraHTTPHeaders({});
          }
          if (!PASSWORD || !String(PASSWORD).trim()) {
            throw new Error(
              "Need buzzerbeater.com session: set BB_SITE_COOKIES (see data/README.md) or BB_PASSWORD"
            );
          }
          console.log("  [face] Session required (login redirect or no face); logging in once for batch...");
          await loginToBB(page);
          loggedIn = true;
        }

        await page.goto(overviewUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        if (isLoginUrl(page.url())) {
          await saveDebug(page, "overview_after_login_still_login");
          throw new Error("Still on login after session — cookie/session lost?");
        }
        if (!(await tryScreenshotFace(page, id))) {
          await saveDebug(page, "no_face_container");
          throw new Error(
            "Face element not found (expected #cphContent_faceContainer > div.playerFace)"
          );
        }
      } catch (e) {
        console.error(`[${i + 1}/${playerIds.length}] ${id} failed:`, e.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    console.log("  [3/3] Closing browser");
    await browser.close();
  }
}

async function run() {
  const playerIds = [];
  if (IS_SUPABASE) {
    const season = EXPLICIT_ID
      ? parseInt(EXPLICIT_ID, 10)
      : Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 71);
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
