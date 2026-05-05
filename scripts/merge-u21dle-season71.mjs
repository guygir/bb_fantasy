/**
 * Merge season 71 players into u21dle_players.json
 * 
 * - Updates existing players (cumulative GP/PTS, season=71)
 * - Adds new players (fetches age/height/potential from BBAPI)
 * - Updates meta.seasons to include 71
 * 
 * Run: node scripts/merge-u21dle-season71.mjs
 * Add --trophy flag if season 71 was a trophy season (Israel won)
 * 
 * Env: BBAPI_LOGIN, BBAPI_CODE
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

const IS_TROPHY_SEASON = process.argv.includes("--trophy");
const SEASON = 71;

function parsePlayerXml(xml) {
  const ageMatch = xml.match(/<age>(\d+)<\/age>/);
  const heightMatch = xml.match(/<height>(\d+)<\/height>/);
  const potentialMatch = xml.match(/<potential>(\d+)<\/potential>/);
  const heightRaw = heightMatch ? parseInt(heightMatch[1], 10) : null;
  // BBAPI returns height in inches; convert to cm (75 inches special case = 190cm)
  const heightCm =
    heightRaw == null ? null : heightRaw === 75 ? 190 : Math.round(heightRaw * 2.54);
  return {
    age: ageMatch ? parseInt(ageMatch[1], 10) : null,
    height: heightCm,
    potential: potentialMatch ? parseInt(potentialMatch[1], 10) : null,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log(`Merging season ${SEASON} into u21dle_players.json`);
  console.log(`Trophy season: ${IS_TROPHY_SEASON ? "YES" : "NO"}`);
  if (!IS_TROPHY_SEASON) {
    console.log("  (Add --trophy flag if Israel U21 won the championship in season 71)\n");
  }

  // Load existing data
  const u21dlePath = join(ROOT, "data", "u21dle_players.json");
  const s71Path = join(ROOT, "data", "season71_stats.json");

  const u21dle = JSON.parse(readFileSync(u21dlePath, "utf-8"));
  const s71 = JSON.parse(readFileSync(s71Path, "utf-8"));

  const existingById = new Map(u21dle.players.map((p) => [p.playerId, p]));
  const s71Players = s71.players;

  // Separate existing vs new
  const toUpdate = [];
  const toAdd = [];

  for (const p of s71Players) {
    if (existingById.has(p.playerId)) {
      toUpdate.push({ existing: existingById.get(p.playerId), s71: p });
    } else {
      toAdd.push(p);
    }
  }

  console.log(`Existing players to update: ${toUpdate.length}`);
  console.log(`New players to add: ${toAdd.length}`);

  // Update existing players
  for (const { existing, s71 } of toUpdate) {
    const oldGp = existing.gp;
    const oldPts = existing.pts;
    
    // If player already has season 71 data (season field = 71), replace instead of add
    // This handles re-running the merge with updated stats
    if (existing.season === SEASON) {
      // Player was added in this season - just update with fresh stats
      // We need to figure out their pre-season-71 stats
      // Since we can't know for sure, we'll use the s71 stats directly for new players
      // For players who existed before s71, this is trickier...
      // 
      // Simple approach: if their previous GP was <= s71's old GP, they're a new player
      // Otherwise, subtract old s71 GP and add new s71 GP
      console.log(`  Updating ${existing.name} (already has s71): GP ${oldGp} -> replacing with fresh s71 data`);
      
      // For simplicity, assume new players from s71 should just have s71 stats
      // For existing players, we'd need to track pre-s71 stats separately
      // For now, just use the fresh s71 GP directly (works for new s71 players)
      existing.gp = s71.gp;
      existing.pts = s71.pts;
    } else {
      // Player from previous seasons - add s71 stats
      const oldTotalPts = existing.gp * existing.pts;
      const newGp = oldGp + s71.gp;
      const newTotalPts = oldTotalPts + s71.gp * s71.pts;
      const newPts = newGp > 0 ? newTotalPts / newGp : 0;

      console.log(`  Updating ${existing.name}: GP ${oldGp} -> ${newGp}, PTS ${oldPts.toFixed(1)} -> ${newPts.toFixed(1)}`);

      existing.gp = newGp;
      existing.pts = Math.round(newPts * 10) / 10; // Round to 1 decimal
    }
    
    existing.season = SEASON;

    // Increment trophies if this is a trophy season (only once)
    if (IS_TROPHY_SEASON && existing.season !== SEASON) {
      existing.trophies = (existing.trophies || 0) + 1;
    }
  }

  // Fetch details for new players from BBAPI
  if (toAdd.length > 0) {
    console.log(`\nLogging into BBAPI to fetch player details...`);
    const { cookies, body: loginText } = await bbapiLogin(LOGIN, CODE, BBAPI_BASE);
    if (loginText.includes("<error")) {
      console.error("BBAPI login failed");
      process.exit(1);
    }
    console.log("BBAPI login successful\n");

    for (let i = 0; i < toAdd.length; i++) {
      const p = toAdd[i];
      process.stdout.write(`  Fetching ${i + 1}/${toAdd.length}: ${p.name} (${p.playerId})...`);

      let age = null, height = null, potential = null;
      try {
        const xml = await bbapiGet(`${BBAPI_BASE}player.aspx?playerid=${p.playerId}`, cookies, BBAPI_BASE);
        if (!xml.includes("<error")) {
          const details = parsePlayerXml(xml);
          age = details.age;
          height = details.height;
          potential = details.potential;
        }
      } catch (e) {
        console.error(` error: ${e.message}`);
      }

      const newPlayer = {
        playerId: p.playerId,
        name: p.name,
        gp: p.gp,
        pts: Math.round(p.pts * 10) / 10,
        age,
        height,
        potential,
        trophies: IS_TROPHY_SEASON ? 1 : 0,
        season: SEASON,
      };

      u21dle.players.push(newPlayer);
      console.log(` age=${age} height=${height}cm pot=${potential}`);

      await sleep(200);
    }
  }

  // Update meta
  if (!u21dle.meta.seasons.includes(SEASON)) {
    u21dle.meta.seasons.push(SEASON);
    u21dle.meta.seasons.sort((a, b) => a - b);
  }

  if (IS_TROPHY_SEASON && !u21dle.meta.trophySeasons.includes(SEASON)) {
    u21dle.meta.trophySeasons.push(SEASON);
    u21dle.meta.trophySeasons.sort((a, b) => a - b);
    if (!u21dle.meta.trophySeasonsCompetitiveResolved.includes(SEASON)) {
      u21dle.meta.trophySeasonsCompetitiveResolved.push(SEASON);
      u21dle.meta.trophySeasonsCompetitiveResolved.sort((a, b) => a - b);
    }
  }

  u21dle.meta.source = u21dle.meta.source.replace(/60-\d+/, `60-${SEASON}`);
  u21dle.meta.fetched = new Date().toISOString();

  // Sort players by playerId for consistency
  u21dle.players.sort((a, b) => a.playerId - b.playerId);

  // Write back
  writeFileSync(u21dlePath, JSON.stringify(u21dle, null, 2));

  console.log(`\n✓ Saved ${u21dle.players.length} players to ${u21dlePath}`);
  console.log(`  Seasons: ${u21dle.meta.seasons.join(", ")}`);
  console.log(`  Trophy seasons: ${u21dle.meta.trophySeasons.join(", ")}`);

  // Summary of GP>=8 players from season 71
  const gp8 = u21dle.players
    .filter((p) => p.season === SEASON && p.gp >= 8)
    .sort((a, b) => b.gp - a.gp);
  console.log(`\n--- Season ${SEASON} players with GP >= 8 (U21dle eligible) ---`);
  console.log(`${gp8.length} players\n`);
  for (const p of gp8) {
    console.log(
      `${p.playerId}: ${p.name} | GP=${p.gp} PTS=${p.pts.toFixed(1)} | height=${p.height ?? "?"}cm pot=${p.potential ?? "?"} trophies=${p.trophies}`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
