#!/usr/bin/env node
/**
 * Fetch Israel U21 roster + stats.
 * 1. Stats page (public): country/15/jnt/stats.aspx?season=N - players who have played
 * 2. Roster page (login): country/15/jnt/players.aspx - full roster (17 players)
 *    Uses Puppeteer + BB_PASSWORD when set to get roster-only players (no stats yet).
 *
 * Run: node scripts/fetch-season-stats.mjs [season]
 * Env: BBAPI_LOGIN, BBAPI_CODE (for player details)
 *      BB_PASSWORD (optional — full roster via stealth Puppeteer)
 *      BB_SITE_COOKIES (optional — skip browser login when set)
 *
 * Output: data/season{N}_stats.json (merged with any new players from roster)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";
import { loginToBB, PUPPETEER_DEFAULT_ARGS, launchBbBrowser } from "./lib/bb-site-session.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_BASE = "https://buzzerbeater.com/";
const STATS_URL = "https://buzzerbeater.com/country/15/jnt/stats.aspx";
const ROSTER_URL = "https://buzzerbeater.com/country/15/jnt/players.aspx";
const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const PASSWORD = process.env.BB_PASSWORD;
/** Same as fetch-player-details / fetch-player-face — bypasses login.aspx on CI when set. */
const SITE_COOKIE_HEADER = (process.env.BB_SITE_COOKIES || process.env.BUZZERBEATER_COOKIES || "").trim();

function parseMadeAtt(val) {
  const m = String(val).match(/^(\d+)-(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

function parseStatsTable(html) {
  const rows = [];
  const tableRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of tableRows) {
    const linkMatch = tr.match(/\/player\/(\d+)\/overview\.aspx/);
    if (!linkMatch) continue;

    const playerId = parseInt(linkMatch[1], 10);
    const nameMatch = tr.match(/\/player\/\d+\/overview\.aspx"[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : "";

    const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
    if (cells.length < 18) continue;

    const getCellText = (i) => {
      const c = cells[i];
      if (!c) return "";
      return c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    };

    const gp = parseInt(getCellText(1), 10);
    const min = parseFloat(getCellText(2));
    const [fgMadeTot, fgAttTot] = parseMadeAtt(getCellText(3));
    const [tpMadeTot, tpAttTot] = parseMadeAtt(getCellText(5));
    const [ftMadeTot, ftAttTot] = parseMadeAtt(getCellText(7));
    const or = parseFloat(getCellText(9)) || 0;
    const trVal = parseFloat(getCellText(10)) || 0;
    const ast = parseFloat(getCellText(11)) || 0;
    const to = parseFloat(getCellText(12)) || 0;
    const stl = parseFloat(getCellText(13)) || 0;
    const blk = parseFloat(getCellText(14)) || 0;
    const pf = parseFloat(getCellText(15)) || 0;
    const pts = parseFloat(getCellText(16)) || 0;
    const rtng = parseFloat(getCellText(17)) || 0;

    if (name.toLowerCase().includes("season average") || name.toLowerCase().includes("total")) continue;
    if (isNaN(gp) || gp < 1) continue;

    rows.push({
      playerId,
      name,
      gp,
      min,
      fgMade: gp ? fgMadeTot / gp : 0,
      fgAtt: gp ? fgAttTot / gp : 0,
      tpMade: gp ? tpMadeTot / gp : 0,
      tpAtt: gp ? tpAttTot / gp : 0,
      ftMade: gp ? ftMadeTot / gp : 0,
      ftAtt: gp ? ftAttTot / gp : 0,
      or,
      tr: trVal,
      ast,
      to,
      stl,
      blk,
      pf,
      pts,
      rtng,
    });
  }

  return rows;
}

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

/** Parse roster page (players.aspx) - extract player IDs and names from player links */
function parseRosterPage(html) {
  const seen = new Set();
  const rows = [];
  const linkRe = /href="[^"]*\/player\/(\d+)\/overview\.aspx"[^>]*>([^<]+)</gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const playerId = parseInt(m[1], 10);
    const name = (m[2] || "").replace(/&nbsp;/g, " ").trim() || `Player ${playerId}`;
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    if (name.toLowerCase().includes("season average") || name.toLowerCase().includes("total")) continue;
    rows.push({ playerId, name });
  }
  return rows;
}

/** System Chrome paths (fallback when Puppeteer's bundled Chrome is missing) */
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Roster via Cookie header (no Puppeteer) — same pattern as fetch-player-details injury fetch. */
async function fetchRosterWithCookieHeader() {
  if (!SITE_COOKIE_HEADER) return null;
  try {
    const res = await fetch(ROSTER_URL, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        Cookie: SITE_COOKIE_HEADER,
      },
    });
    const html = await res.text();
    if (
      /login\.css/i.test(html) ||
      /<title>\s*Login\s*</i.test(html) ||
      (/cphContent_txtUserName/i.test(html) && /login\.aspx/i.test(html))
    ) {
      console.warn(
        "  [roster] BB_SITE_COOKIES set but players.aspx still looks like login — cookies may be expired; trying Puppeteer if BB_PASSWORD is set"
      );
      return null;
    }
    const roster = parseRosterPage(html);
    if (roster.length > 0) {
      console.log(`  [roster] Loaded ${roster.length} players via BB_SITE_COOKIES (no Puppeteer)`);
    }
    return roster;
  } catch (e) {
    console.warn("  [roster] Cookie fetch failed:", e.message);
    return null;
  }
}

/** Fetch roster page with Puppeteer (requires BB_PASSWORD). Uses shared login (see scripts/lib/bb-site-session.mjs). */
async function fetchRosterWithPuppeteer() {
  if (!PASSWORD) return null;
  const maxAttempts = process.env.CI ? 3 : 1;
  const { existsSync } = await import("fs");
  const launchBase = {
    headless: true,
    args: [...PUPPETEER_DEFAULT_ARGS],
  };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_PATHS.find(existsSync);
  if (executablePath) launchBase.executablePath = executablePath;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const wait = 5000 + attempt * 5000;
      console.warn(`  [roster] Puppeteer login retry ${attempt + 1}/${maxAttempts} (after ${wait}ms)...`);
      await new Promise((r) => setTimeout(r, wait));
    }
    let browser;
    try {
      browser = await launchBbBrowser({ ...launchBase });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await loginToBB(page);
      await page.goto(ROSTER_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
      const html = await page.content();
      const roster = parseRosterPage(html);
      if (roster.length > 0) console.log(`Roster page: ${roster.length} players`);
      await browser.close();
      return roster;
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      if (attempt === maxAttempts - 1) {
        console.warn("Roster fetch (players.aspx) failed:", e.message);
        return null;
      }
    }
  }
  return null;
}

async function run() {
  const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : Number(process.env.CURRENT_SEASON ?? 71);
  const dataDir = join(__dirname, "../data");
  mkdirSync(dataDir, { recursive: true });

  const url = `${STATS_URL}?season=${SEASON}`;
  console.log(`Fetching ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": "BBFantasy/1.0" } });
  const html = await res.text();

  const scrapedPlayers = parseStatsTable(html);
  if (scrapedPlayers.length === 0) {
    console.error("No players parsed from stats page. Page structure may have changed.");
    process.exit(1);
  }
  console.log(`Parsed ${scrapedPlayers.length} players from stats page`);

  const scrapedById = new Map(scrapedPlayers.map((p) => [p.playerId, p]));
  if (PASSWORD || SITE_COOKIE_HEADER) {
    console.log("Fetching full roster from players.aspx (requires login or BB_SITE_COOKIES)...");
    let rosterPlayers = await fetchRosterWithCookieHeader();
    if (!rosterPlayers?.length && PASSWORD) {
      rosterPlayers = await fetchRosterWithPuppeteer();
    }
    if (!rosterPlayers?.length && SITE_COOKIE_HEADER && !PASSWORD) {
      console.warn(
        "BB_SITE_COOKIES did not return a roster (expired or wrong domain) — add BB_PASSWORD or refresh cookies in repo secrets."
      );
    }
    if (rosterPlayers?.length) {
      let added = 0;
      for (const r of rosterPlayers) {
        if (!scrapedById.has(r.playerId)) {
          scrapedById.set(r.playerId, {
            playerId: r.playerId,
            name: r.name,
            gp: 0,
            min: 0,
            fgMade: 0,
            fgAtt: 0,
            tpMade: 0,
            tpAtt: 0,
            ftMade: 0,
            ftAtt: 0,
            or: 0,
            tr: 0,
            ast: 0,
            to: 0,
            stl: 0,
            blk: 0,
            pf: 0,
            pts: 0,
            rtng: 0,
          });
          added++;
        }
      }
      if (added > 0) console.log(`Added ${added} roster-only player(s) from players.aspx`);
    }
  } else {
    console.log("BB_PASSWORD not set - skipping roster page (players.aspx). Stats page only shows players who have played.");
  }

  const statsPath = join(dataDir, `season${SEASON}_stats.json`);
  let existingPlayers = [];
  const existingById = new Map();
  if (existsSync(statsPath)) {
    const data = JSON.parse(readFileSync(statsPath, "utf-8"));
    existingPlayers = data.players ?? [];
    for (const p of existingPlayers) {
      existingById.set(p.playerId, p);
    }
  }

  const newPlayerIds = [];
  for (const p of scrapedById.values()) {
    if (!existingById.has(p.playerId)) {
      newPlayerIds.push(p.playerId);
      existingById.set(p.playerId, p);
      existingPlayers.push(p);
    } else {
      const existing = existingById.get(p.playerId);
      Object.assign(existing, p);
    }
  }

  if (newPlayerIds.length > 0) {
    console.log(`Found ${newPlayerIds.length} new player(s): ${newPlayerIds.join(", ")}`);
    console.log("Fetching BBAPI details for new players...");

    const { cookies, body: loginText } = await bbapiLogin(LOGIN, CODE, BBAPI_BASE);
    if (loginText.includes("<error")) {
      console.warn("BBAPI login failed - new players will have minimal details");
    } else {
      const detailsPath = join(dataDir, `player_details_s${SEASON}.json`);
      let detailsData = { details: {} };
      if (existsSync(detailsPath)) {
        detailsData = JSON.parse(readFileSync(detailsPath, "utf-8"));
      }
      for (let i = 0; i < newPlayerIds.length; i++) {
        const id = newPlayerIds[i];
        process.stdout.write(`\r  ${i + 1}/${newPlayerIds.length} (${id})...`);
        try {
          const xml = await bbapiGet(`${BBAPI_BASE}player.aspx?playerid=${id}`, cookies, BBAPI_BASE);
          if (!xml.includes("<error")) {
            detailsData.details[id] = parsePlayerXml(xml);
          }
        } catch (e) {
          console.error("\nError fetching", id, e.message);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      writeFileSync(
        detailsPath,
        JSON.stringify(
          {
            meta: { season: SEASON, fetched: new Date().toISOString(), source: "BBAPI" },
            details: detailsData.details,
          },
          null,
          2
        )
      );
      console.log("\nUpdated player_details_s" + SEASON + ".json");
    }
  } else {
    console.log("No new players - roster unchanged");
  }

  existingPlayers.sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));

  writeFileSync(
    statsPath,
    JSON.stringify(
      {
        meta: {
          source: url,
          fetched: new Date().toISOString(),
          season: SEASON,
          description: `Israel U21 Season ${SEASON} - per-game averages`,
        },
        players: existingPlayers,
      },
      null,
      2
    )
  );

  console.log(`Saved ${existingPlayers.length} players to ${statsPath}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
