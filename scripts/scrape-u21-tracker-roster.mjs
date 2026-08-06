#!/usr/bin/env node
/**
 * Daily U21 roster membership scrape (no BBAPI / no DMI).
 * Diffs vs roster.json → updates players.json stints + appends roster-events.json.
 *
 * Usage:
 *   node scripts/scrape-u21-tracker-roster.mjs
 *   node scripts/scrape-u21-tracker-roster.mjs --max-countries=2
 *
 * Env: BB_PASSWORD or BB_SITE_COOKIES, CURRENT_SEASON
 */

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
  applyRosterDiff,
  writeOnSaleSnapshot,
  loadKnownTrackerCountries,
  mergeCountryLists,
  mergeMetaCountryPools,
} from "./lib/u21-tracker-shared.mjs";

const PASSWORD = process.env.BB_PASSWORD;
const SITE_COOKIE_HEADER = (process.env.BB_SITE_COOKIES || process.env.BUZZERBEATER_COOKIES || "").trim();
const SEASON = getSeason();

function parseArgs(argv) {
  const out = { maxCountries: null, countries: null };
  for (const arg of argv) {
    if (arg.startsWith("--max-countries=")) out.maxCountries = Number(arg.slice("--max-countries=".length));
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const week = currentWeekForSeason(SEASON);
  if (week == null || Number.isNaN(week)) {
    throw new Error(`Could not determine current week for season ${SEASON}`);
  }
  const date = israelDateString();
  const scrapedAt = new Date().toISOString();

  console.log(`Season ${SEASON}, week ${week}, date ${date} (roster-only)`);
  console.log(`Fetching standings ${STANDINGS_URL}...`);
  const standingsHtml = await fetchText(STANDINGS_URL);
  const standingsCountries = parsePoolsFromStandings(standingsHtml);
  const knownCountries = loadKnownTrackerCountries(SEASON);
  // World Cup standings only list 16 teams — still scrape full catalog for roster changes
  let countries = mergeCountryLists(standingsCountries, knownCountries);
  if (!countries.length) throw new Error("No Pool countries parsed from standings page (and no roster/meta fallback)");

  if (standingsCountries.length) {
    mergeMetaCountryPools(SEASON, standingsCountries, scrapedAt);
    console.log(
      `Standings countries: ${standingsCountries.length}; scraping full catalog: ${countries.length}`
    );
  } else if (knownCountries.length) {
    console.warn(
      `Standings parse returned 0 countries — falling back to ${knownCountries.length} known from roster/meta`
    );
  }

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
    const players = parseRosterPage(rosterHtml);
    const onSale = players.filter((p) => p.forSale).length;
    console.log(`${players.length} players (${onSale} on sale)`);
    countryResults.push({
      countryId: country.countryId,
      name: country.name,
      pool: country.pool,
      players,
    });
    await sleep(60);
  }

  const result = applyRosterDiff({
    season: SEASON,
    week,
    date,
    scrapedAt,
    countries: countryResults,
  });

  const isPartial = Boolean(args.countries?.length || args.maxCountries);
  const sale = writeOnSaleSnapshot(SEASON, {
    date,
    week,
    scrapedAt,
    countries: countryResults,
    mergePrevious: isPartial,
  });

  console.log(
    result.bootstrapped
      ? `Bootstrapped roster files (no events). Wrote ${result.rosterPath}`
      : `Roster diff done: ${result.eventsAdded} event(s). Updated ${result.rosterPath}`
  );
  console.log(`On sale snapshot: ${sale.count} players → ${sale.path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
