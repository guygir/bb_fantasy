/**
 * Fetch BBAPI player details (position, DMI, salary) for all Season 71 players
 * and save to JSON. Run before starting the app to ensure Players page has full data.
 *
 * Run: node scripts/fetch-player-details.mjs [season]
 *
 * Injury: scraped from buzzerbeater.com overview. Cookie resolution order:
 *   1) BB_SITE_COOKIES if set
 *   2) Else BB_PASSWORD — Puppeteer login to login.aspx (same as fetch-player-face / cron)
 *   3) Else BBAPI session cookies (usually insufficient for the main site)
 */

import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });

/** Optional override: full browser Cookie header for buzzerbeater.com (see .env.example). */
const SITE_COOKIE_HEADER = (process.env.BB_SITE_COOKIES || process.env.BUZZERBEATER_COOKIES || "").trim();

const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

function parsePlayerXml(xml) {
  const posMatch = xml.match(/<bestPosition>([^<]*)<\/bestPosition>/);
  const dmiMatch = xml.match(/<dmi>(\d+)<\/dmi>/);
  const salaryMatch = xml.match(/<salary>(\d+)<\/salary>/);
  const gameShapeMatch = xml.match(/<gameShape>(\d+)<\/gameShape>/);
  return {
    position: posMatch?.[1] ?? "?",
    dmi: dmiMatch ? parseInt(dmiMatch[1], 10) : null,
    salary: salaryMatch ? parseInt(salaryMatch[1], 10) : null,
    gameShape: gameShapeMatch ? parseInt(gameShapeMatch[1], 10) : null,
  };
}

/**
 * BuzzerBeater overview "Injury!" block. Numbers may be split across HTML tags; copy may use "day" or a single bound.
 */
function parseInjuryFromOverviewHtml(html) {
  const head = html.match(/Injury!/i);
  if (!head || head.index == null) return { injuryDaysMin: null, injuryDaysMax: null };
  const slice = html.slice(head.index, head.index + 1200);
  const plain = slice
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  let m = plain.match(/(\d+)\s*(?:[-–]|to)\s*(\d+)\s*days?/i);
  if (m) {
    return {
      injuryDaysMin: parseInt(m[1], 10),
      injuryDaysMax: parseInt(m[2], 10),
    };
  }
  m = plain.match(/(\d+)\s*days?/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) return { injuryDaysMin: n, injuryDaysMax: n };
  }
  return { injuryDaysMin: null, injuryDaysMax: null };
}

function overviewLooksLikeLoginWall(html) {
  return (
    /login\.css/i.test(html) ||
    /<title>\s*Login\s*</i.test(html) ||
    /Forgot Password/i.test(html)
  );
}

let warnedOverviewLogin = false;

/**
 * @param {string} cookieHeader
 * @param {"site_cookie"|"puppeteer"|"bbapi"} authMode — for login-wall diagnostics
 */
async function fetchInjuryFromOverview(playerId, cookieHeader, authMode) {
  const ch = (cookieHeader || "").trim();
  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    };
    if (ch) headers.Cookie = ch;
    const res = await fetch(`https://buzzerbeater.com/player/${playerId}/overview.aspx`, {
      headers,
      redirect: "follow",
    });
    if (!res.ok) return { injuryDaysMin: null, injuryDaysMax: null };
    const html = await res.text();
    if (overviewLooksLikeLoginWall(html)) {
      if (!warnedOverviewLogin) {
        warnedOverviewLogin = true;
        const msg = !ch
          ? "No cookies for overview."
          : authMode === "site_cookie"
            ? "BB_SITE_COOKIES may be expired; overview still looks like login."
            : authMode === "puppeteer"
              ? "Overview still looks like login after Puppeteer login (unexpected)."
              : "BBAPI cookies did not unlock the main site. Set BB_PASSWORD (main site) for Puppeteer login, or BB_SITE_COOKIES.";
        console.warn(`\n[fetch-player-details] ${msg}\n`);
      }
    }
    return parseInjuryFromOverviewHtml(html);
  } catch {
    return { injuryDaysMin: null, injuryDaysMax: null };
  }
}

/** BBAPI error responses must be rejected; match case-insensitively (`<error` vs `<Error`). */
function bbapiXmlHasError(xml) {
  return /<error\b/i.test(xml);
}

function bbapiErrorMessage(xml) {
  const m =
    xml.match(/<error\s+message=['"]([^'"]+)['"]/) ||
    xml.match(/<error\s+message='([^']+)'/) ||
    xml.match(/<error[^>]*>([^<]+)<\/error>/i);
  return m?.[1]?.trim() || null;
}

async function run() {
  const dataPath = join(__dirname, "../data", `season${SEASON}_stats.json`);
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const players = data.players ?? [];

  console.log("Logging in...");
  const { cookies, body: loginText } = await bbapiLogin(LOGIN, CODE, BASE);

  if (bbapiXmlHasError(loginText)) {
    console.error("Login failed");
    process.exit(1);
  }

  /** @type {"site_cookie"|"puppeteer"|"bbapi"} */
  let overviewAuthMode = "bbapi";
  let overviewCookieHeader = SITE_COOKIE_HEADER;
  if (overviewCookieHeader) {
    overviewAuthMode = "site_cookie";
  } else if (process.env.BB_PASSWORD?.trim()) {
    try {
      const { getBuzzerbeaterCookieHeaderFromLogin } = await import("./lib/bb-site-session.mjs");
      console.log("buzzerbeater.com login (Puppeteer) for injury overview...");
      overviewCookieHeader = await getBuzzerbeaterCookieHeaderFromLogin();
      overviewAuthMode = "puppeteer";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[fetch-player-details] Puppeteer site login failed:", msg);
      overviewCookieHeader = "";
    }
  }
  if (!overviewCookieHeader) {
    overviewCookieHeader = cookies.join("; ");
    overviewAuthMode = "bbapi";
  }

  const details = {};
  /** Skipped players leave existing Supabase rows unchanged on sync — stale DMI/GS until a successful fetch. */
  const failures = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    process.stdout.write(`\rFetching ${i + 1}/${players.length} (${p.name})...`);
    try {
      const xml = await bbapiGet(`${BASE}player.aspx?playerid=${p.playerId}`, cookies, BASE);
      if (bbapiXmlHasError(xml)) {
        const msg = bbapiErrorMessage(xml) || "(no message)";
        failures.push({ playerId: p.playerId, name: p.name, reason: `BBAPI error: ${msg}` });
        console.error(`\n[fetch-player-details] SKIP ${p.name} (${p.playerId}): ${msg}`);
        continue;
      }
      const base = parsePlayerXml(xml);
      const injury = await fetchInjuryFromOverview(p.playerId, overviewCookieHeader, overviewAuthMode);
      details[p.playerId] = { ...base, ...injury };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      failures.push({ playerId: p.playerId, name: p.name, reason: err });
      console.error(`\n[fetch-player-details] SKIP ${p.name} (${p.playerId}): ${err}`);
    }
    await new Promise((r) => setTimeout(r, 200)); // Rate limit
  }

  const outPath = join(__dirname, "../data", `player_details_s${SEASON}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          season: SEASON,
          fetched: new Date().toISOString(),
          source: "BBAPI",
          expectedPlayers: players.length,
          detailCount: Object.keys(details).length,
          failures,
        },
        details,
      },
      null,
      2
    )
  );

  console.log("\nSaved", Object.keys(details).length, "/", players.length, "player details to", outPath);
  if (failures.length > 0) {
    console.error(
      `[fetch-player-details] ${failures.length} player(s) missing — Supabase will keep prior DMI/GS for those IDs until a successful fetch.`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
