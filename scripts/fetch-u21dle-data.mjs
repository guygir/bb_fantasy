/**
 * Fetch Israel U21 player data for U21dle (Wordle-like game).
 * Scrapes stats pages seasons 60-70, fetches age/height/potential from BBAPI.
 *
 * Run: node scripts/fetch-u21dle-data.mjs
 * Env: BBAPI_LOGIN, BBAPI_CODE (for player details)
 *
 * Output: data/u21dle_players.json
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_BASE = "https://buzzerbeater.com/country/1015/nt/stats.aspx";
const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

const TROPHY_SEASONS = [62, 68, 70];
/** BBAPI schedule `type`; friendlies are scrimmages (SC on the site). */
const NT_FRIENDLY_TYPE = "nt.friendly";
const ISRAEL_U21_TEAM_ID = 1015;

function parseStatsTable(html) {
  const rows = [];
  const playerRe = /<a[^>]*href="[^"]*\/player\/(\d+)\/overview\.aspx"[^>]*>([^<]+)<\/a>/gi;
  const tableRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of tableRows) {
    const linkMatch = tr.match(/\/player\/(\d+)\/overview\.aspx/);
    if (!linkMatch) continue;

    const playerId = parseInt(linkMatch[1], 10);
    const nameMatch = tr.match(/\/player\/\d+\/overview\.aspx"[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : "";

    const cells = tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
    if (cells.length < 17) continue;

    const getCellText = (i) => {
      const c = cells[i];
      if (!c) return "";
      return c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    };

    const gp = parseInt(getCellText(1), 10);
    const pts = parseFloat(getCellText(16));
    if (isNaN(gp) || isNaN(pts)) continue;

    if (name.toLowerCase().includes("season average") || name.toLowerCase().includes("total")) continue;

    rows.push({ playerId, name, gp, pts });
  }

  return rows;
}

async function fetchStatsPage(season) {
  const url = `${STATS_BASE}?season=${season}`;
  const res = await fetch(url, { headers: { "User-Agent": "BBFantasy/1.0" } });
  const html = await res.text();
  return parseStatsTable(html);
}

function parsePlayerXml(xml) {
  const ageMatch = xml.match(/<age>(\d+)<\/age>/);
  const heightMatch = xml.match(/<height>(\d+)<\/height>/);
  const potentialMatch = xml.match(/<potential>(\d+)<\/potential>/);
  const heightRaw = heightMatch ? parseInt(heightMatch[1], 10) : null;
  const heightCm =
    heightRaw == null ? null : heightRaw === 75 ? 190 : Math.round(heightRaw * 2.54);
  return {
    age: ageMatch ? parseInt(ageMatch[1], 10) : null,
    height: heightCm,
    potential: potentialMatch ? parseInt(potentialMatch[1], 10) : null,
  };
}

function parseNum(val) {
  if (val == null || val === "" || val === "N/A") return 0;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

function sumMinutes(minBlock) {
  if (!minBlock) return 0;
  const pg = parseNum(minBlock.match(/<PG>([^<]*)<\/PG>/)?.[1]);
  const sg = parseNum(minBlock.match(/<SG>([^<]*)<\/SG>/)?.[1]);
  const sf = parseNum(minBlock.match(/<SF>([^<]*)<\/SF>/)?.[1]);
  const pf = parseNum(minBlock.match(/<PF>([^<]*)<\/PF>/)?.[1]);
  const c = parseNum(minBlock.match(/<C>([^<]*)<\/C>/)?.[1]);
  return pg + sg + sf + pf + c;
}

/**
 * Israel roster player IDs who actually played (non-DNP, minutes > 0) in this boxscore.
 */
function extractIsraelPlayedPlayerIds(xml, teamId = ISRAEL_U21_TEAM_ID) {
  if (xml.includes("<error")) return [];
  const tid = String(teamId);
  const homeTeamBlock = xml.match(/<homeTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/homeTeam>/);
  const awayTeamBlock = xml.match(/<awayTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/awayTeam>/);
  if (!homeTeamBlock || !awayTeamBlock) return [];
  const homeTeamId = homeTeamBlock[1];
  const awayTeamId = awayTeamBlock[1];
  const homeContent = homeTeamBlock[2];
  const awayContent = awayTeamBlock[2];
  const israelContent = tid === homeTeamId ? homeContent : awayTeamId === tid ? awayContent : null;
  if (!israelContent) return [];
  const boxscoreMatch = israelContent.match(/<boxscore>([\s\S]*?)<\/boxscore>/);
  if (!boxscoreMatch) return [];
  const boxscore = boxscoreMatch[1];
  const ids = [];
  const playerBlocks = [...boxscore.matchAll(/<player\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/player>/g)];
  for (const p of playerBlocks) {
    const playerId = parseInt(p[1], 10);
    const block = p[2];
    const perfMatch = block.match(/<performance>([\s\S]*?)<\/performance>/);
    if (!perfMatch) continue;
    const perf = perfMatch[1];
    if (perf.includes("<dnp/>")) continue;
    const minBlock = block.match(/<minutes>([\s\S]*?)<\/minutes>/)?.[1] ?? "";
    const min = sumMinutes(minBlock);
    if (min <= 0) continue;
    ids.push(playerId);
  }
  return ids;
}

function parseScheduleMatches(xml) {
  if (xml.includes("<error")) return [];
  const matches = [];
  const re = /<match\s+id=['"](\d+)['"]\s+start=['"]([^'"]*)['"]\s+type=['"]([^'"]*)['"]\s*>([\s\S]*?)<\/match>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[4];
    const awayTeam = block.match(/<awayTeam\s+id=['"](\d+)['"]/);
    const homeTeam = block.match(/<homeTeam\s+id=['"](\d+)['"]/);
    matches.push({
      id: m[1],
      type: m[3],
      awayTeamId: awayTeam?.[1] ?? "",
      homeTeamId: homeTeam?.[1] ?? "",
    });
  }
  return matches;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * For each trophy season, players who appeared in ≥1 non-friendly (non-SC) NT game per BBAPI schedule + boxscores.
 * @returns {{ playerSeasons: Map<number, Set<number>>, seasonsResolved: Set<number> }}
 */
async function fetchCompetitiveTrophyParticipation(cookies) {
  const playerSeasons = new Map();
  const seasonsResolved = new Set();

  for (const season of TROPHY_SEASONS) {
    const url = `${BBAPI_BASE}schedule.aspx?teamid=${ISRAEL_U21_TEAM_ID}&season=${season}`;
    let xml;
    try {
      xml = await bbapiGet(url, cookies, BBAPI_BASE);
    } catch (e) {
      console.warn(`  Trophy season ${season}: schedule request failed:`, e.message);
      continue;
    }
    if (xml.includes("<error")) {
      console.warn(`  Trophy season ${season}: schedule XML error`);
      continue;
    }

    const matches = parseScheduleMatches(xml);
    const competitive = matches.filter((m) => {
      const home = m.homeTeamId === String(ISRAEL_U21_TEAM_ID);
      const away = m.awayTeamId === String(ISRAEL_U21_TEAM_ID);
      if (!home && !away) return false;
      return m.type !== NT_FRIENDLY_TYPE;
    });

    console.log(
      `  Trophy season ${season}: ${competitive.length} competitive (non-${NT_FRIENDLY_TYPE}) match(es), fetching boxscores...`
    );

    if (competitive.length === 0) {
      seasonsResolved.add(season);
      continue;
    }

    let sawIsraelPlayersFromBoxscore = false;
    for (const match of competitive) {
      await sleep(150);
      let boxXml;
      try {
        boxXml = await bbapiGet(`${BBAPI_BASE}boxscore.aspx?matchid=${match.id}`, cookies, BBAPI_BASE);
      } catch (e) {
        console.warn(`    match ${match.id}: boxscore failed:`, e.message);
        continue;
      }
      const playedIds = extractIsraelPlayedPlayerIds(boxXml);
      if (playedIds.length > 0) sawIsraelPlayersFromBoxscore = true;
      for (const pid of playedIds) {
        if (!playerSeasons.has(pid)) playerSeasons.set(pid, new Set());
        playerSeasons.get(pid).add(season);
      }
    }

    if (sawIsraelPlayersFromBoxscore) {
      seasonsResolved.add(season);
    } else {
      console.warn(
        `  Trophy season ${season}: no Israel player minutes from boxscores — using NT stats fallback for trophy count`
      );
    }
  }

  return { playerSeasons, seasonsResolved };
}

async function run() {
  const map = new Map();

  console.log("Fetching stats pages (seasons 60-70)...");
  for (let season = 60; season <= 70; season++) {
    const rows = await fetchStatsPage(season);
    console.log(`  Season ${season}: ${rows.length} players`);

    for (const row of rows) {
      const existing = map.get(row.playerId);
      const seasonsPlayed = existing?.seasonsPlayed ?? new Set();
      if (row.gp >= 1) seasonsPlayed.add(season);

      if (existing) {
        const totalPts = existing.totalPts + row.gp * row.pts;
        const totalGp = existing.gp + row.gp;
        map.set(row.playerId, {
          ...existing,
          gp: totalGp,
          totalPts,
          pts: totalPts / totalGp,
          name: row.name || existing.name,
          seasonsPlayed,
        });
      } else {
        map.set(row.playerId, {
          playerId: row.playerId,
          name: row.name,
          gp: row.gp,
          totalPts: row.gp * row.pts,
          pts: row.pts,
          seasonsPlayed,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const playerIds = [...new Set(map.keys())];
  console.log(`\nFetching BBAPI details (age, height, potential) for ${playerIds.length} players...`);

  const { cookies, body: loginText } = await bbapiLogin(LOGIN, CODE, BBAPI_BASE);
  if (loginText.includes("<error")) {
    console.error("BBAPI login failed");
    process.exit(1);
  }

  console.log("\nCompetitive trophy seasons (non-scrimmage NT games via BBAPI schedule + boxscores)...");
  const { playerSeasons: competitiveTrophyByPlayer, seasonsResolved: trophySeasonsCompetitiveResolved } =
    await fetchCompetitiveTrophyParticipation(cookies);

  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i];
    process.stdout.write(`\r  ${i + 1}/${playerIds.length} (${id})...`);
    try {
      const xml = await bbapiGet(`${BBAPI_BASE}player.aspx?playerid=${id}`, cookies, BBAPI_BASE);
      if (!xml.includes("<error")) {
        const { age, height, potential } = parsePlayerXml(xml);
        const p = map.get(id);
        map.set(id, { ...p, age, height, potential });
      }
    } catch (e) {
      console.error("\nError fetching", id, e.message);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const players = [...map.values()].map((p) => {
    const { totalPts, seasonsPlayed, ...rest } = p;
    /** Per season: use competitive (non-`nt.friendly`) participation when BBAPI data exists; else NT stats table fallback. */
    let trophies = 0;
    for (const s of TROPHY_SEASONS) {
      if (trophySeasonsCompetitiveResolved.has(s)) {
        if (competitiveTrophyByPlayer.get(p.playerId)?.has(s)) trophies += 1;
      } else if (seasonsPlayed?.has(s)) {
        trophies += 1;
      }
    }
    const season = seasonsPlayed?.size ? Math.max(...seasonsPlayed) : null;
    return { ...rest, trophies, season };
  });

  const outDir = join(__dirname, "../data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "u21dle_players.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          source: "buzzerbeater.com/country/1015/nt/stats.aspx?season=60-70",
          fetched: new Date().toISOString(),
          seasons: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70],
          trophySeasons: TROPHY_SEASONS,
          trophyRule:
            "Count seasons in trophySeasons where the player played ≥1 non-scrimmage NT game (BBAPI schedule type !== nt.friendly) with minutes in boxscore; nt.friendly = SC. If schedule/boxscores unavailable for a trophy season, falls back to NT stats (≥1 GP that season).",
          trophySeasonsCompetitiveResolved: [...trophySeasonsCompetitiveResolved].sort((a, b) => a - b),
          heightUnit: "cm",
        },
        players,
      },
      null,
      2
    )
  );

  console.log("\n\nSaved", players.length, "players to", outPath);

  const gp8 = players.filter((p) => p.gp >= 8).sort((a, b) => b.gp - a.gp);
  console.log("\n--- Players with GP >= 8 ---");
  console.log(gp8.length, "players\n");
  for (const p of gp8) {
    console.log(
      `${p.playerId}: ${p.name} | GP=${p.gp} PTS=${p.pts.toFixed(1)} | season=${p.season ?? "?"} height=${p.height ?? "?"}cm pot=${p.potential ?? "?"} trophies=${p.trophies}`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
