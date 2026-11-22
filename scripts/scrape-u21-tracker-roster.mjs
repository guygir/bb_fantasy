#!/usr/bin/env node
/**
 * Daily U21 roster membership scrape via legacy.buzzerbeater.com/api.
 * Diffs vs roster.json → updates players.json stints + appends roster-events.json
 * and writes on-sale.json.
 *
 * Usage:
 *   node scripts/scrape-u21-tracker-roster.mjs
 *   node scripts/scrape-u21-tracker-roster.mjs --max-countries=2
 *
 * Env: BBAPI_LOGIN, BBAPI_CODE (for resolving newly called-up players' numeric IDs), CURRENT_SEASON
 */

import {
  getSeason,
  currentWeekForSeason,
  israelDateString,
  sleep,
  applyRosterDiff,
  writeOnSaleSnapshot,
  loadKnownTrackerCountries,
  mergeCountryLists,
  mergeMetaCountryPools,
} from "./lib/u21-tracker-shared.mjs";
import {
  getTeamPlayers,
  getU21StandingsPools,
  resolveIds,
  resolvePlayerUuidsToNumericIds,
} from "./lib/bb-legacy-api.mjs";

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

  console.log(`Season ${SEASON}, week ${week}, date ${date} (roster-only, legacy API)`);
  console.log("Fetching U21 standings pools from legacy.buzzerbeater.com/api...");
  const standingsCountries = await getU21StandingsPools(SEASON);
  const knownCountries = loadKnownTrackerCountries(SEASON);
  let countries = mergeCountryLists(standingsCountries, knownCountries);
  if (!countries.length) {
    throw new Error("No Pool countries returned from legacy API (and no roster/meta fallback)");
  }

  // Carry over teamUuid from standingsCountries and resolve any missing JNT team UUIDs
  const uuidByCountryId = new Map(
    standingsCountries.filter((c) => c.teamUuid).map((c) => [c.countryId, c.teamUuid])
  );
  const missingTeamNumbers = countries
    .filter((c) => !uuidByCountryId.has(c.countryId))
    .map((c) => 1000 + c.countryId);
  if (missingTeamNumbers.length) {
    const extraTeamMap = await resolveIds("team", missingTeamNumbers);
    for (const [jntNum, uuid] of extraTeamMap.entries()) {
      uuidByCountryId.set(jntNum - 1000, uuid);
    }
  }

  if (standingsCountries.length) {
    mergeMetaCountryPools(SEASON, standingsCountries, scrapedAt);
    console.log(
      `Standings countries: ${standingsCountries.length}; scraping full catalog: ${countries.length}`
    );
  } else if (knownCountries.length) {
    console.warn(
      `Standings returned 0 countries — falling back to ${knownCountries.length} known from roster/meta`
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

  const rawCountryRosters = [];
  const allPlayers = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    const teamUuid = uuidByCountryId.get(country.countryId);
    process.stdout.write(`[${i + 1}/${countries.length}] ${country.name} (${country.pool})... `);
    if (!teamUuid) {
      console.log("missing JNT team UUID");
      rawCountryRosters.push({ ...country, rawPlayers: [], error: "missing team UUID" });
      continue;
    }
    try {
      const rawPlayers = await getTeamPlayers(teamUuid);
      const onSale = rawPlayers.filter((p) => p.isForSale).length;
      console.log(`${rawPlayers.length} players (${onSale} on sale)`);
      rawCountryRosters.push({ ...country, rawPlayers });
      allPlayers.push(...rawPlayers);
    } catch (e) {
      console.log(`roster fetch failed: ${e.message}`);
      rawCountryRosters.push({ ...country, rawPlayers: [], error: e.message });
    }
    await sleep(60);
  }

  console.log(`Resolving numeric player IDs for ${allPlayers.length} roster entries...`);
  const { map: uuidToNumeric, newlyResolved, unresolved } = await resolvePlayerUuidsToNumericIds(allPlayers);
  if (newlyResolved > 0) {
    console.log(`Newly resolved ${newlyResolved} player ID(s) via BBAPI club lookup`);
  }
  if (unresolved.length > 0) {
    console.warn(`Warning: ${unresolved.length} player(s) could not be mapped to numeric ID:`, unresolved.slice(0, 10));
  }

  const countryResults = rawCountryRosters.map((c) => {
    if (c.error) {
      return { countryId: c.countryId, name: c.name, pool: c.pool, players: [], error: c.error };
    }
    const seen = new Set();
    const players = [];
    for (const p of c.rawPlayers) {
      const playerId = uuidToNumeric[p.id];
      if (!playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || `Player ${playerId}`;
      players.push({
        playerId,
        name,
        forSale: Boolean(p.isForSale),
        dmi: p.dmi != null ? Math.round(Number(p.dmi)) : null,
      });
    }
    return {
      countryId: c.countryId,
      name: c.name,
      pool: c.pool,
      players,
    };
  });

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
