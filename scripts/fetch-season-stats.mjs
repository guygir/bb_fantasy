#!/usr/bin/env node
/**
 * Fetch Israel U21 roster + stats from legacy.buzzerbeater.com/api.
 * 1. /team/GetStats — players who have played in the season
 * 2. /player/GetPlayers — full current Israel U21 roster (includes players with 0 GP)
 *
 * Run: node scripts/fetch-season-stats.mjs [season]
 * Env: BBAPI_LOGIN, BBAPI_CODE (for player details + resolving new player IDs)
 *
 * Output: data/season{N}_stats.json (merged with any new players from roster)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet, DEFAULT_BBAPI_BASE } from "./lib/bbapi-cookies.mjs";
import {
  ISRAEL_U21_TEAM_ID,
  getSeasons,
  getTeamPlayers,
  getTeamStats,
  resolveIds,
  resolvePlayerUuidsToNumericIds,
} from "./lib/bb-legacy-api.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BBAPI_BASE = DEFAULT_BBAPI_BASE;
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

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

function statsRowToPerGame(playerId, s) {
  const gp = Number(s.games || 0);
  const name = [s.firstName, s.lastName].filter(Boolean).join(" ").trim() || `Player ${playerId}`;
  return {
    playerId,
    name,
    gp,
    min: gp ? Number(s.minutes || 0) / gp : 0,
    fgMade: gp ? Number(s.fieldGoals || 0) / gp : 0,
    fgAtt: gp ? Number(s.fieldGoalsAttempts || 0) / gp : 0,
    tpMade: gp ? Number(s.threePointFieldGoals || 0) / gp : 0,
    tpAtt: gp ? Number(s.threePointFieldGoalsAttempts || 0) / gp : 0,
    ftMade: gp ? Number(s.freeThrows || 0) / gp : 0,
    ftAtt: gp ? Number(s.freeThrowsAttempts || 0) / gp : 0,
    or: gp ? Number(s.offensiveRebounds || 0) / gp : 0,
    tr: gp ? Number(s.rebounds || 0) / gp : 0,
    ast: gp ? Number(s.assists || 0) / gp : 0,
    to: gp ? Number(s.turnovers || 0) / gp : 0,
    stl: gp ? Number(s.steals || 0) / gp : 0,
    blk: gp ? Number(s.blocks || 0) / gp : 0,
    pf: gp ? Number(s.fouls || 0) / gp : 0,
    pts: gp ? Number(s.points || 0) / gp : 0,
    rtng: Number(s.starRating || 0),
  };
}

function zeroStatsRow(playerId, p) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || `Player ${playerId}`;
  return {
    playerId,
    name,
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
  };
}

async function run() {
  const argSeason = process.argv[2] ? parseInt(process.argv[2], 10) : NaN;
  const envSeason = process.env.CURRENT_SEASON ? parseInt(process.env.CURRENT_SEASON, 10) : NaN;
  const SEASON = Number.isFinite(argSeason) && argSeason > 0
    ? argSeason
    : (Number.isFinite(envSeason) && envSeason > 0 ? envSeason : 71);

  const dataDir = join(__dirname, "../data");
  mkdirSync(dataDir, { recursive: true });

  const sourceUrl = `https://legacy.buzzerbeater.com/country/${ISRAEL_U21_TEAM_ID - 1000}/jnt/stats?season=${SEASON}`;
  console.log(`Fetching Israel U21 stats & roster for season ${SEASON}...`);

  const teamMap = await resolveIds("team", [ISRAEL_U21_TEAM_ID]);
  const israelUuid = teamMap.get(ISRAEL_U21_TEAM_ID);
  if (!israelUuid) {
    throw new Error("Could not resolve Israel U21 team ID (1015)");
  }

  const seasons = await getSeasons();
  const seasonObj = seasons.find((s) => Number(s.number) === SEASON);
  let statsPlayers = [];
  if (seasonObj?.id) {
    statsPlayers = await getTeamStats(israelUuid, seasonObj.id);
    console.log(`Fetched ${statsPlayers.length} player stat row(s) from /team/GetStats`);
  } else {
    console.warn(`Season ${SEASON} not found in /season/GetSeasons; relying on current roster only`);
  }

  const rosterPlayers = await getTeamPlayers(israelUuid);
  console.log(`Fetched ${rosterPlayers.length} player(s) from /player/GetPlayers`);

  const { map: uuidToNumeric, unresolved } = await resolvePlayerUuidsToNumericIds([
    ...statsPlayers,
    ...rosterPlayers,
  ]);
  if (unresolved.length) {
    console.warn(`Warning: could not resolve ${unresolved.length} player UUID(s):`, unresolved);
  }

  const scrapedById = new Map();
  for (const s of statsPlayers) {
    if ((s.games ?? 0) < 1) continue;
    const playerId = uuidToNumeric[s.id];
    if (!playerId) continue;
    scrapedById.set(playerId, statsRowToPerGame(playerId, s));
  }

  let added = 0;
  for (const r of rosterPlayers) {
    const playerId = uuidToNumeric[r.id];
    if (!playerId) continue;
    if (!scrapedById.has(playerId)) {
      scrapedById.set(playerId, zeroStatsRow(playerId, r));
      added++;
    }
  }
  if (added > 0) console.log(`Added ${added} roster-only player(s) from /player/GetPlayers`);

  if (scrapedById.size === 0) {
    console.error("No players found from /team/GetStats or /player/GetPlayers.");
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
          source: sourceUrl,
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
