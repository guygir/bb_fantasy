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
/** ms — Puppeteer fallback only (override with BB_LOGIN_NAV_TIMEOUT_MS). */
function navTimeoutMs() {
  const raw = process.env.BB_LOGIN_NAV_TIMEOUT_MS;
  if (raw && /^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  return 45000;
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

/** Parse a single hidden input value from HTML. */
function parseHiddenField(html, name) {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i");
  return (html.match(re) || html.match(re2))?.[1] ?? "";
}

/**
 * Pure HTTP login — no browser, no Puppeteer, no reCAPTCHA widget.
 * Steps: GET login.aspx → extract ASP.NET tokens → POST form → harvest Set-Cookie.
 * Much faster (~1-2s) and not affected by headless detection.
 */
async function getBuzzerbeaterCookieHeaderFromFetch() {
  if (!PASSWORD || !String(PASSWORD).trim()) {
    throw new Error("BB_PASSWORD required");
  }
  const loginUrl = "https://buzzerbeater.com/login.aspx";
  const ua =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  console.log("  [bb-login/fetch] GET", loginUrl);
  const res1 = await fetch(loginUrl, {
    headers: { "User-Agent": ua, Accept: "text/html,*/*;q=0.9" },
    redirect: "follow",
  });
  if (!res1.ok) throw new Error(`GET login.aspx returned ${res1.status}`);
  const html1 = await res1.text();

  const cookieHeader1 = res1.headers.getSetCookie
    ? res1.headers.getSetCookie().join("; ")
    : (res1.headers.get("set-cookie") ?? "");
  // Extract name=value only (strip Expires/Path/etc)
  const cookies1 = cookieHeader1
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((s) => s.trim().split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  const viewstate = parseHiddenField(html1, "__VIEWSTATE");
  const viewstateGen = parseHiddenField(html1, "__VIEWSTATEGENERATOR");
  const eventVal = parseHiddenField(html1, "__EVENTVALIDATION");

  if (!viewstate) throw new Error("Could not find __VIEWSTATE in login page — page structure changed?");

  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewstate,
    __VIEWSTATEGENERATOR: viewstateGen,
    __EVENTVALIDATION: eventVal,
    "ctl00$cphContent$txtUserName": LOGIN,
    "ctl00$cphContent$txtPassword": String(PASSWORD),
    "ctl00$cphContent$btnLoginUser": "Login",
  });

  console.log("  [bb-login/fetch] POST login form...");
  const res2 = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "User-Agent": ua,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,*/*;q=0.9",
      Referer: loginUrl,
      ...(cookies1 ? { Cookie: cookies1 } : {}),
    },
    body: body.toString(),
    redirect: "manual",
  });

  const location = res2.headers.get("location") ?? "";
  const cookieHeader2 = res2.headers.getSetCookie
    ? res2.headers.getSetCookie().join("; ")
    : (res2.headers.get("set-cookie") ?? "");
  const cookies2 = cookieHeader2
    .split(/,(?=[^;]+=[^;]+;)/)
    .map((s) => s.trim().split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  if (!location.includes("home.aspx") && !location.includes("Home.aspx")) {
    const redirectedHtml = res2.status === 200 ? await res2.text() : "";
    if (
      overviewLooksLikeLoginWall(redirectedHtml) ||
      res2.status === 302 && !location
    ) {
      throw new Error(
        `Login via fetch failed (HTTP ${res2.status}, redirect: "${location}"). Server may require reCAPTCHA — Puppeteer will be tried.`
      );
    }
    if (res2.status !== 302) {
      throw new Error(
        `Unexpected login response: status=${res2.status} location="${location}"`
      );
    }
  }

  const allCookies = [cookies1, cookies2].filter(Boolean).join("; ");
  if (!allCookies.trim()) throw new Error("No cookies returned by login POST");
  console.log("  [bb-login/fetch] OK — session cookies obtained");
  return allCookies;
}

function overviewLooksLikeLoginWall(html) {
  return (
    /login\.css/i.test(html) ||
    /<title>\s*Login\s*</i.test(html) ||
    /Forgot Password/i.test(html)
  );
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
 * Login to buzzerbeater.com; returns Cookie header string.
 * Primary: plain HTTP POST (fast, no browser, no reCAPTCHA widget issues).
 * Fallback: Puppeteer (if server requires reCAPTCHA or the fetch path fails).
 */
export async function getBuzzerbeaterCookieHeaderFromLogin() {
  if (!PASSWORD || !String(PASSWORD).trim()) {
    throw new Error("BB_PASSWORD is required for buzzerbeater.com login");
  }

  // 1. Try fast fetch-based login first
  try {
    return await getBuzzerbeaterCookieHeaderFromFetch();
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.warn(`  [bb-login] fetch path failed (${msg.slice(0, 120)}); trying Puppeteer fallback...`);
  }

  // 2. Puppeteer fallback — 2 attempts
  let lastErr;
  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      console.log("  [bb-login] Puppeteer retry 2/2 (after 5s)...");
      await new Promise((r) => setTimeout(r, 5000));
    }
    try {
      return await getBuzzerbeaterCookieHeaderFromLoginOnce();
    } catch (e) {
      lastErr = e;
      if (i === 0) {
        const m = e instanceof Error ? e.message : String(e);
        console.warn(`  [bb-login] Puppeteer attempt 1 failed (${m.slice(0, 120)}), retrying...`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
