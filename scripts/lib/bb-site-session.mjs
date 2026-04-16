/**
 * buzzerbeater.com form login via Puppeteer — single implementation for:
 *   fetch-player-details (injury), fetch-player-face (faces), fetch-season-stats (U21 roster),
 *   fetch-u21dle-player-source-teams (history).
 * Exports `loginToBB(page)` and `getBuzzerbeaterCookieHeaderFromLogin()` (cookie string for fetch).
 *
 * Env: BBAPI_LOGIN or BB_LOGIN, BB_PASSWORD (main site password — not BBAPI_CODE)
 *      PUPPETEER_EXECUTABLE_PATH or system Chrome (CI)
 *      BB_LOGIN_NAV_TIMEOUT_MS — optional override for login goto / post-submit wait (default 45s CI, 30s local)
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { launchBbBrowser, PUPPETEER_DEFAULT_ARGS } from "./puppeteer-launch.mjs";

export { launchBbBrowser, PUPPETEER_DEFAULT_ARGS };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });

const MAIN_BASE = "https://buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const PASSWORD = process.env.BB_PASSWORD;
/** ms — login POST + ASP.NET postback (override with BB_LOGIN_NAV_TIMEOUT_MS). CI default 120s — runners often need it. */
function navTimeoutMs() {
  const raw = process.env.BB_LOGIN_NAV_TIMEOUT_MS;
  if (raw && /^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  return process.env.CI ? 120000 : 30000;
}
/** Exported for fetch-player-face / u21dle (same limits as login). */
export const BB_LOGIN_NAV_TIMEOUT_MS = navTimeoutMs();
const NAV_TIMEOUT = BB_LOGIN_NAV_TIMEOUT_MS;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** One stealth hook per Page — calling prepareBbPage twice used to register duplicate listeners and break login. */
const preparedBbPages = new WeakSet();

function isLoginUrl(url) {
  return (url || "").includes("login.aspx");
}

async function saveDebug(page, label) {
  const debugDir = join(ROOT, "data");
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

/**
 * Once per Page: realistic User-Agent. Stealth plugin (see puppeteer-launch.mjs) handles webdriver/chrome mocks.
 */
export async function prepareBbPage(page) {
  if (preparedBbPages.has(page)) {
    return;
  }
  preparedBbPages.add(page);
  const ua =
    process.platform === "darwin"
      ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  await page.setUserAgent(ua);
}

/** Shared by fetch-player-details, fetch-player-face, fetch-season-stats, u21dle scripts — one login implementation. */
export async function loginToBB(page) {
  if (!PASSWORD || !String(PASSWORD).trim()) {
    throw new Error("BB_PASSWORD required for form login");
  }
  await prepareBbPage(page);
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

  /** Main #cphContent form — NOT the footer modal (name *txtLogin* matches txtLoginUserName first and breaks login). */
  const loginSel = "#cphContent_txtUserName";
  const passSel = "#cphContent_txtPassword";
  const btnSel = "#cphContent_btnLoginUser";
  try {
    await page.waitForSelector(loginSel, { timeout: 8000 });
  } catch (e) {
    console.log("  [debug] Main login form (#cphContent_txtUserName) not found");
    await saveDebug(page, "no_login_form");
    throw e;
  }
  await page.type(loginSel, LOGIN, { delay: 50 });
  await page.type(passSel, PASSWORD, { delay: 50 });
  console.log("  [login] Submitting...");
  try {
    /**
     * ASP.NET postback — do not Promise.race with waitForNavigation: if navigation times out first,
     * the race rejects even when the URL is about to change (regression).
     */
    await page.click(btnSel);
    await page.waitForFunction(
      () => !window.location.href.includes("login.aspx"),
      { timeout: NAV_TIMEOUT, polling: 250 }
    );
  } catch (e) {
    console.log("  [debug] Login URL wait:", e.message);
    await saveDebug(page, "login_nav_timeout");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!isLoginUrl(page.url())) {
        console.log("  [login] URL left login page after post-timeout poll — continuing");
        break;
      }
    }
    if (isLoginUrl(page.url())) {
      const hasRecaptcha = await page.evaluate(
        () => !!document.querySelector(".g-recaptcha, [data-sitekey]")
      );
      if (hasRecaptcha) {
        throw new Error(
          "BuzzerBeater login shows reCAPTCHA in this session — headless login blocked. Retry later or use BB_SITE_COOKIES (optional)."
        );
      }
      throw e;
    }
  }
  console.log("  [login] After login, URL:", page.url());
  if (isLoginUrl(page.url())) {
    await saveDebug(page, "login_failed_still_on_login");
    throw new Error(
      "Login failed — check BB_PASSWORD. If the site served reCAPTCHA, retry later; optional BB_SITE_COOKIES can bypass the form."
    );
  }
}

async function getBuzzerbeaterCookieHeaderFromLoginOnce() {
  const launchOpts = {
    headless: true,
    args: [...PUPPETEER_DEFAULT_ARGS],
  };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_PATHS.find(existsSync);
  if (executablePath) {
    launchOpts.executablePath = executablePath;
    console.log("  [bb-site-session] Using Chrome:", executablePath);
  }

  const browser = await launchBbBrowser(launchOpts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await loginToBB(page);
    const jar = await page.cookies("https://buzzerbeater.com");
    const header = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!header.trim()) {
      const fallback = await page.cookies();
      const h2 = fallback.map((c) => `${c.name}=${c.value}`).join("; ");
      if (!h2.trim()) throw new Error("No cookies after login");
      return h2;
    }
    return header;
  } finally {
    await browser.close();
  }
}

/**
 * One headless login; returns `Cookie` header value for `fetch("https://buzzerbeater.com/...")`.
 * On CI, retries with backoff — GitHub IPs sometimes need a second attempt.
 */
export async function getBuzzerbeaterCookieHeaderFromLogin() {
  if (!PASSWORD || !String(PASSWORD).trim()) {
    throw new Error("BB_PASSWORD is required for buzzerbeater.com login");
  }

  const maxAttempts = Math.min(
    6,
    Math.max(1, parseInt(String(process.env.BB_LOGIN_MAX_ATTEMPTS ?? (process.env.CI ? "4" : "1")), 10) || 1)
  );
  const pauseMs = [0, 8000, 18000, 32000, 45000];

  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    const wait = pauseMs[i] ?? 20000;
    if (wait > 0) {
      console.log(`  [bb-site-session] Login attempt ${i + 1}/${maxAttempts} (after ${wait}ms backoff)...`);
      await new Promise((r) => setTimeout(r, wait));
    } else if (maxAttempts > 1) {
      console.log(`  [bb-site-session] Login attempt ${i + 1}/${maxAttempts}...`);
    }
    try {
      return await getBuzzerbeaterCookieHeaderFromLoginOnce();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (i < maxAttempts - 1) {
        console.warn(`  [bb-site-session] Login failed (${msg.slice(0, 120)}), will retry...`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
