#!/usr/bin/env node
/**
 * Scrape U21 Round Robin pool countries → roster → DMI + gameShape + salary.
 * Writes data/u21-tracker/s{season}/w{week}.json (+ updates meta.json).
 * Also refreshes roster.json / players.json membership from the week snapshot.
 *
 * Usage:
 *   node scripts/scrape-u21-tracker.mjs
 *   node scripts/scrape-u21-tracker.mjs --seed-week0
 *   node scripts/scrape-u21-tracker.mjs --week=12 --max-countries=2
 *
 * Env: BB_PASSWORD or BB_SITE_COOKIES, BBAPI_LOGIN, BBAPI_CODE, CURRENT_SEASON
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";
import { getBuzzerbeaterCookieHeaderFromLogin } from "./lib/bb-site-session.mjs";
import {
  STANDINGS_URL,
  BB_BASE,
  getSeason,
  currentWeekForSeason,
  israelDateString,
  parsePoolsFromStandings,
  parseRosterPage,
  looksLikeLoginWall,
  fetchText,
  sleep,
  trackerDir,
  syncRosterFromWeekPayload,
} from "./lib/u21-tracker-shared.mjs";

const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";

const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const PASSWORD = process.env.BB_PASSWORD;
const SITE_COOKIE_HEADER = (process.env.BB_SITE_COOKIES || process.env.BUZZERBEATER_COOKIES || "").trim();
const SEASON = getSeason();

function parseArgs(argv) {
  const out = { seedWeek0: false, week: null, maxCountries: null, countries: null };
  for (const arg of argv) {
    if (arg === "--seed-week0") out.seedWeek0 = true;
    else if (arg.startsWith("--week=")) out.week = Number(arg.slice("--week=".length));
    else if (arg.startsWith("--max-countries=")) out.maxCountries = Number(arg.slice("--max-countries=".length));
    else if (arg.startsWith("--countries=")) {
      out.countries = arg
        .slice("--countries=".length)
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0);
    }
  }
  return out;
}

function parsePlayerXml(xml) {
  const dmiMatch = xml.match(/<dmi>(\d+)<\/dmi>/);
  const gameShapeMatch = xml.match(/<gameShape>(\d+)<\/gameShape>/);
  const salaryMatch = xml.match(/<salary>(\d+)<\/salary>/);
  const first = xml.match(/<firstName>([^<]*)<\/firstName>/)?.[1]?.trim() || "";
  const last = xml.match(/<lastName>([^<]*)<\/lastName>/)?.[1]?.trim() || "";
  return {
    dmi: dmiMatch ? Number(dmiMatch[1]) : null,
    gameShape: gameShapeMatch ? Number(gameShapeMatch[1]) : null,
    salary: salaryMatch ? Number(salaryMatch[1]) : null,
    apiName: [first, last].filter(Boolean).join(" "),
  };
}

async function batchMap(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const chunk = await Promise.all(slice.map(fn));
    out.push(...chunk);
    if (i + size < items.length) await sleep(120);
  }
  return out;
}

function writeWeekSnapshot(season, week, payload) {
  const dir = trackerDir(season);
  mkdirSync(dir, { recursive: true });
  const weekPath = join(dir, `w${week}.json`);
  writeFileSync(weekPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const weeks = readdirSync(dir)
    .map((name) => {
      const m = name.match(/^w(\d+)\.json$/);
      return m ? Number(m[1]) : null;
    })
    .filter((n) => n !== null)
    .sort((a, b) => a - b);

  const countries = (payload.countries || []).map((c) => ({
    countryId: c.countryId,
    name: c.name,
    pool: c.pool,
  }));

  const metaPath = join(dir, "meta.json");
  let meta = { season, weeks, countries, updatedAt: payload.scrapedAt };
  if (existsSync(metaPath)) {
    try {
      const prev = JSON.parse(readFileSync(metaPath, "utf8"));
      const byId = new Map((prev.countries || []).map((c) => [c.countryId, c]));
      for (const c of countries) byId.set(c.countryId, c);
      meta = {
        season,
        weeks,
        countries: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
        updatedAt: payload.scrapedAt,
      };
    } catch {
      // rewrite from current payload
    }
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return weekPath;
}

function seedWeek0From(currentPayload) {
  return {
    ...currentPayload,
    week: 0,
    scrapedAt: currentPayload.scrapedAt,
    synthetic: true,
    note: "One-time seed: DMI -25%, gameShape -2 from current week scrape",
    countries: (currentPayload.countries || []).map((country) => ({
      ...country,
      players: (country.players || []).map((p) => ({
        ...p,
        dmi: p.dmi == null ? null : Math.max(0, Math.round(p.dmi * 0.75)),
        gameShape: p.gameShape == null ? null : Math.max(0, p.gameShape - 2),
      })),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const week = args.week ?? currentWeekForSeason(SEASON);
  if (week == null || Number.isNaN(week)) {
    throw new Error(`Could not determine current week for season ${SEASON}`);
  }

  console.log(`Season ${SEASON}, week ${week}`);
  console.log(`Fetching standings ${STANDINGS_URL}...`);
  const standingsHtml = await fetchText(STANDINGS_URL);
  let countries = parsePoolsFromStandings(standingsHtml);
  if (!countries.length) throw new Error("No Pool countries parsed from standings page");

  if (args.countries?.length) {
    const allow = new Set(args.countries);
    countries = countries.filter((c) => allow.has(c.countryId));
  }
  if (args.maxCountries && args.maxCountries > 0) {
    countries = countries.slice(0, args.maxCountries);
  }
  console.log(`Countries to scrape: ${countries.length}`);

  if (!PASSWORD && !SITE_COOKIE_HEADER) {
    throw new Error("BB_PASSWORD or BB_SITE_COOKIES is required for roster pages");
  }
  const cookieHeader = SITE_COOKIE_HEADER || (await getBuzzerbeaterCookieHeaderFromLogin());
  console.log("BB site session ready");

  console.log("Logging into BBAPI...");
  const { cookies, body } = await bbapiLogin(LOGIN, CODE, BBAPI_BASE);
  if (!body.includes("<bbapi") || body.includes("<error") || !cookies.length) {
    throw new Error("BBAPI login failed");
  }
  console.log("BBAPI session ready");

  const countryResults = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    process.stdout.write(`[${i + 1}/${countries.length}] ${country.name} (${country.pool})... `);
    const rosterUrl = `${BB_BASE}/country/${country.countryId}/jnt/players.aspx`;
    let rosterHtml;
    try {
      rosterHtml = await fetchText(rosterUrl, { Cookie: cookieHeader });
    } catch (e) {
      console.log(`roster fetch failed: ${e.message}`);
      countryResults.push({ ...country, players: [], error: e.message });
      continue;
    }
    if (looksLikeLoginWall(rosterHtml)) {
      console.log("login wall");
      countryResults.push({ ...country, players: [], error: "login wall" });
      continue;
    }
    const roster = parseRosterPage(rosterHtml);
    const players = await batchMap(roster, 6, async (p) => {
      try {
        const xml = await bbapiGet(`player.aspx?playerid=${p.playerId}`, cookies, BBAPI_BASE);
        const info = parsePlayerXml(xml);
        return {
          playerId: p.playerId,
          name: info.apiName || p.name,
          dmi: info.dmi,
          gameShape: info.gameShape,
          salary: info.salary,
        };
      } catch {
        return {
          playerId: p.playerId,
          name: p.name,
          dmi: null,
          gameShape: null,
          salary: null,
        };
      }
    });
    console.log(`${players.length} players`);
    countryResults.push({
      countryId: country.countryId,
      name: country.name,
      pool: country.pool,
      players,
    });
    await sleep(80);
  }

  const payload = {
    season: SEASON,
    week,
    scrapedAt: new Date().toISOString(),
    source: STANDINGS_URL,
    countries: countryResults.sort((a, b) => a.name.localeCompare(b.name)),
  };

  const weekPath = writeWeekSnapshot(SEASON, week, payload);
  console.log(`Wrote ${weekPath}`);

  // Keep roster membership aligned with this week's snapshot (no join/left events)
  if (!args.maxCountries && !args.countries?.length) {
    const { rosterPath } = syncRosterFromWeekPayload(SEASON, week, payload, {
      date: israelDateString(),
    });
    console.log(`Synced roster membership → ${rosterPath}`);
  }

  if (args.seedWeek0) {
    const week0 = seedWeek0From(payload);
    const week0Path = writeWeekSnapshot(SEASON, 0, week0);
    console.log(`Wrote seeded ${week0Path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
