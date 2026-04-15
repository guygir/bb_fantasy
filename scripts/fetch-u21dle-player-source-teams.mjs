#!/usr/bin/env node
/**
 * Fetch source team (Y) for each U21dle eligible player from BB player history.
 * Primary: first Transfer entry with Season >= player.season → extract "Purchased from Y for $"
 * Fallback: when no such transfer → "NONE FOUND" (do not use Owner / current club — avoids misleading labels).
 *
 * Run: node scripts/fetch-u21dle-player-source-teams.mjs
 * Env: BBAPI_LOGIN, BB_PASSWORD (for Puppeteer login - history page may require it)
 */

import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const MIN_GP_ELIGIBLE = 8;
const MAIN_BASE = "https://buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const PASSWORD = process.env.BB_PASSWORD;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
];

function loadEligiblePlayers() {
  const path = join(ROOT, "data", "u21dle_players.json");
  if (!existsSync(path)) {
    console.error("data/u21dle_players.json not found. Run: npm run fetch-u21dle-data");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const players = (data.players ?? []).filter((p) => (p.gp ?? 0) >= MIN_GP_ELIGIBLE);
  return players.map((p) => ({ playerId: p.playerId, name: p.name, season: p.season ?? null }));
}

/**
 * Parse date "M/D/YYYY" or "MM/D/YYYY" to timestamp for sorting.
 */
function parseDate(dateStr) {
  const m = (dateStr || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return 0;
  const [, month, day, year] = m;
  return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)).getTime();
}

/**
 * Parse history table HTML for Transfer and U21 Appearance rows.
 * Table is inside #boxHistory. Rows: Event | Date | Season | Details.
 * Returns [{ event, date, dateTs, season, details }] for Transfer and U21 Appearance (newest first in table).
 */
function parseHistoryTable(html) {
  const rows = [];
  const boxMatch = html.match(/id="boxHistory"[\s\S]*?<table[^>]*class="[^"]*history[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!boxMatch) return rows;
  const tbody = boxMatch[1];
  const trMatches = tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const tdMatches = [...(tr[1] || "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 4) continue;
    const getText = (raw) => (raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const event = getText(tdMatches[0][1]);
    const dateStr = getText(tdMatches[1][1]);
    const season = parseInt(getText(tdMatches[2][1]), 10);
    const detailsRaw = tdMatches[3][1];
    if (event === "Transfer" && detailsRaw.includes("Purchased from")) {
      rows.push({ event, date: dateStr, dateTs: parseDate(dateStr), season, details: detailsRaw });
    } else if (event === "U21 Appearance") {
      rows.push({ event, date: dateStr, dateTs: parseDate(dateStr), season, details: detailsRaw });
    }
  }
  return rows;
}

/**
 * Extract team name Y from "Purchased from Y for $"
 * Y can be: "Free Agency", or <a href="...">Team Name</a>
 */
function extractSourceTeam(details) {
  const match = details.match(/Purchased from\s+([\s\S]+?)\s+for\s*\$?\s*(?:&nbsp;)?/i);
  if (!match) return null;
  let y = (match[1] || "").trim();
  // Strip <a href="...">Team Name</a> -> Team Name
  const linkMatch = y.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  if (linkMatch) y = linkMatch[1].replace(/<[^>]+>/g, "").trim();
  // Decode HTML entities
  y = y.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return y || null;
}

/** BB uses "Free Agency" when the player was not purchased from another club — not a real team name. */
function isPlaceholderSourceTeam(name) {
  return !name || /^free agency$/i.test(name.trim());
}

/**
 * Same rule as before: transfers with season >= playerSeason, pick chronologically oldest first
 * (season asc, then date), but skip "Purchased from Free Agency" rows so we show an actual club when possible.
 */
function pickSourceTeamFromTransfers(transferRows, playerSeason) {
  const playerS = playerSeason != null ? playerSeason : 0;
  const candidates = transferRows.filter((r) => r.season >= playerS);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.season - b.season || a.dateTs - b.dateTs);
  for (const r of candidates) {
    const y = extractSourceTeam(r.details);
    if (!isPlaceholderSourceTeam(y)) return y;
  }
  return null;
}

/** History navigation (login uses bb-site-session.mjs — CI-aware timeouts there). */
const NAV_TIMEOUT = process.env.CI ? 90000 : 45000;

async function fetchHistoryWithPuppeteer(page, playerId) {
  await page.goto(`${MAIN_BASE}player/${playerId}/history.aspx`, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT,
  });
  return page.content();
}

async function initPuppeteerSession() {
  const puppeteer = await import("puppeteer");
  const { existsSync } = await import("fs");
  const launchOpts = { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_PATHS.find(existsSync);
  if (executablePath) launchOpts.executablePath = executablePath;

  const browser = await puppeteer.default.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  if (PASSWORD) {
    const { loginToBB } = await import("./lib/bb-site-session.mjs");
    await loginToBB(page);
  }

  return { browser, page };
}

async function fetchHistoryWithFetch(playerId) {
  const res = await fetch(`${MAIN_BASE}player/${playerId}/history.aspx`, {
    headers: { "User-Agent": "BBFantasy/1.0" },
  });
  return res.text();
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  let players = loadEligiblePlayers();
  if (limit) {
    players = players.slice(0, limit);
    console.log(`Testing with first ${limit} players\n`);
  }
  console.log(`Found ${players.length} eligible players (GP>=${MIN_GP_ELIGIBLE})\n`);

  const results = [];
  const usePuppeteer = !!PASSWORD;

  let page = null;
  let browser = null;
  if (usePuppeteer) {
    const session = await initPuppeteerSession();
    browser = session.browser;
    page = session.page;
  }

  const MAX_RETRIES = 2;

  for (let i = 0; i < players.length; i++) {
    const { playerId, name, season } = players[i];
    process.stdout.write(`\r[${i + 1}/${players.length}] ${name} (${playerId})...`);
    let html = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        html = usePuppeteer
          ? await fetchHistoryWithPuppeteer(page, playerId)
          : await fetchHistoryWithFetch(playerId);
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }

    if (!html) {
      results.push({ playerId, name, season: season ?? "?", sourceTeam: "NONE FOUND" });
      console.error(`\n  Error for ${name}: ${lastErr?.message ?? "unknown"}`);
    } else {
      const allRows = parseHistoryTable(html);
      const playerSeason = season != null ? season : 0;

      // Method 1: Oldest transfer with season >= player season (same order as before), but skip
      // "Purchased from Free Agency" — that is not a club name on BB.
      const transferRows = allRows.filter((r) => r.event === "Transfer");
      let sourceTeam = pickSourceTeamFromTransfers(transferRows, playerSeason);
      if (!sourceTeam) sourceTeam = "NONE FOUND";

      results.push({
        playerId,
        name,
        season: season ?? "?",
        sourceTeam,
      });
    }
    await new Promise((r) => setTimeout(r, 500)); // Rate limit
  }

  if (browser) await browser.close();

  // Write { playerId: sourceTeam } for every eligible player (includes "NONE FOUND")
  const sourceTeamsMap = {};
  for (const r of results) {
    sourceTeamsMap[r.playerId] = r.sourceTeam ?? "NONE FOUND";
  }
  const outPath = join(ROOT, "data", "u21dle_source_teams.json");
  writeFileSync(outPath, JSON.stringify(sourceTeamsMap, null, 2), "utf-8");
  console.log(`\n\nWrote ${Object.keys(sourceTeamsMap).length} source teams to data/u21dle_source_teams.json`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
