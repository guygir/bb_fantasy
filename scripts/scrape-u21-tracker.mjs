#!/usr/bin/env node
/**
 * Scrape U21 Round Robin pool countries → roster → DMI + gameShape + salary
 * via legacy.buzzerbeater.com/api.
 * Writes data/u21-tracker/s{season}/w{week}.json (+ updates meta.json).
 * Also refreshes roster.json / players.json membership from the week snapshot.
 *
 * Usage:
 *   node scripts/scrape-u21-tracker.mjs
 *   node scripts/scrape-u21-tracker.mjs --seed-week0
 *   node scripts/scrape-u21-tracker.mjs --week=12 --max-countries=2
 *
 * Env: BBAPI_LOGIN, BBAPI_CODE, CURRENT_SEASON
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  getSeason,
  currentWeekForSeason,
  israelDateString,
  sleep,
  trackerDir,
  syncRosterFromWeekPayload,
} from "./lib/u21-tracker-shared.mjs";
import {
  getTeamPlayers,
  getU21StandingsPools,
  resolvePlayerUuidsToNumericIds,
} from "./lib/bb-legacy-api.mjs";

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

  console.log(`Season ${SEASON}, week ${week} (legacy API)`);
  console.log("Fetching U21 standings pools from legacy.buzzerbeater.com/api...");
  let countries = await getU21StandingsPools(SEASON);
  if (!countries.length) throw new Error("No Pool countries returned from legacy API");

  if (args.countries?.length) {
    const allow = new Set(args.countries);
    countries = countries.filter((c) => allow.has(c.countryId));
  }
  if (args.maxCountries && args.maxCountries > 0) {
    countries = countries.slice(0, args.maxCountries);
  }
  const wcCount = countries.filter((c) => /world\s*cup/i.test(c.pool)).length;
  console.log(
    `Countries to scrape: ${countries.length}` +
      (wcCount ? ` (${wcCount} World Cup — DMI/charts only; daily roster still covers full catalog)` : "")
  );

  const rawCountryRosters = [];
  const allPlayers = [];
  for (let i = 0; i < countries.length; i++) {
    const country = countries[i];
    process.stdout.write(`[${i + 1}/${countries.length}] ${country.name} (${country.pool})... `);
    try {
      const rawPlayers = await getTeamPlayers(country.teamUuid);
      console.log(`${rawPlayers.length} players`);
      rawCountryRosters.push({ ...country, rawPlayers });
      allPlayers.push(...rawPlayers);
    } catch (e) {
      console.log(`roster fetch failed: ${e.message}`);
      rawCountryRosters.push({ ...country, rawPlayers: [], error: e.message });
    }
    await sleep(60);
  }

  console.log(`Resolving numeric player IDs for ${allPlayers.length} players...`);
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
        dmi: p.dmi != null ? Math.round(Number(p.dmi)) : null,
        gameShape: p.gameShape != null ? Number(p.gameShape) : null,
        salary: p.salary != null ? Number(p.salary) : null,
      });
    }
    return {
      countryId: c.countryId,
      name: c.name,
      pool: c.pool,
      players,
    };
  });

  const payload = {
    season: SEASON,
    week,
    scrapedAt: new Date().toISOString(),
    source: "https://legacy.buzzerbeater.com/world/standings?teamid=1015",
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
