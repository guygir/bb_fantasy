#!/usr/bin/env node
/**
 * Fetch Israel U21 roster + stats.
 * 1. Stats page (public): country/15/jnt/stats.aspx?season=N - players who have played
 * 2. Roster page (login): country/15/jnt/players.aspx - full roster (17 players)
 *    Uses Puppeteer + BB_PASSWORD when set to get roster-only players (no stats yet).
 *
 * Run: node scripts/fetch-season-stats.mjs [season]
 * Env: BBAPI_LOGIN, BBAPI_CODE (for player details)
 *      BB_PASSWORD (optional — full roster via HTTP login + fetch)
 *      BB_SITE_COOKIES (optional — use pre-existing cookie header; skips login entirely)
 *
 * Output: data/season{N}_stats.json (merged with any new players from roster)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";
import { getBuzzerbeaterCookieHeaderFromLogin } from "./lib/bb-site-session.mjs";

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

const ROSTER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function rosterLooksLikeLoginWall(html) {
  return (
    /login\.css/i.test(html) ||
    /<title>\s*Login\s*</i.test(html) ||
    (/cphContent_txtUserName/i.test(html) && /login\.aspx/i.test(html))
  );
}

async function fetchRosterWithCookie(cookieHeader) {
  const res = await fetch(ROSTER_URL, {
    redirect: "follow",
    headers: { "User-Agent": ROSTER_UA, Accept: "text/html,*/*;q=0.9", Cookie: cookieHeader },
  });
  const html = await res.text();
  if (rosterLooksLikeLoginWall(html)) return null;
  return parseRosterPage(html);
}

/** Fetch roster page — HTTP login (fast), no Puppeteer needed. */
async function fetchRosterWithLogin() {
  if (!PASSWORD && !SITE_COOKIE_HEADER) return null;
  try {
    const cookieHeader = SITE_COOKIE_HEADER || (await getBuzzerbeaterCookieHeaderFromLogin());
    const roster = await fetchRosterWithCookie(cookieHeader);
    if (roster?.length) {
      console.log(`  [roster] Loaded ${roster.length} players via HTTP login`);
    } else if (roster !== null) {
      console.warn("  [roster] Login succeeded but no players found on players.aspx");
    } else {
      console.warn("  [roster] players.aspx still looks like login wall after successful login");
    }
    return roster;
  } catch (e) {
    console.warn("  [roster] fetch failed:", e.message);
    return null;
  }
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
  console.log(`Parsed ${scrapedPlayers.length} players from stats page`);

  const scrapedById = new Map(scrapedPlayers.map((p) => [p.playerId, p]));
  
  // Try to fetch from roster page (requires BB_PASSWORD or BB_SITE_COOKIES)
  if (PASSWORD || SITE_COOKIE_HEADER) {
    console.log("Fetching full roster from players.aspx...");
    const rosterPlayers = await fetchRosterWithLogin();
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

  // Exit if no players found from either source
  if (scrapedById.size === 0) {
    console.error("No players found from stats page or roster page.");
    console.error("If season just started (no games played), set BB_PASSWORD to fetch from roster page.");
    process.exit(1);
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
