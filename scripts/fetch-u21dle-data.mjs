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

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_BASE = "https://buzzerbeater.com/country/1015/nt/stats.aspx";
const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

const TROPHY_SEASONS = [62, 68, 70];

function parseCookies(setCookie) {
  if (!setCookie) return [];
  const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
  return parts.map((p) => p.split(";")[0].trim()).filter((kv) => kv && kv.includes("="));
}

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

  const loginRes = await fetch(
    `${BBAPI_BASE}login.aspx?login=${encodeURIComponent(LOGIN)}&code=${encodeURIComponent(CODE)}`,
    { redirect: "manual", headers: { "User-Agent": "BBFantasy/1.0" } }
  );
  const cookies = parseCookies(loginRes.headers.get("set-cookie"));
  const loginText = await loginRes.text();
  if (loginText.includes("<error")) {
    console.error("BBAPI login failed");
    process.exit(1);
  }

  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i];
    process.stdout.write(`\r  ${i + 1}/${playerIds.length} (${id})...`);
    try {
      const res = await fetch(`${BBAPI_BASE}player.aspx?playerid=${id}`, {
        headers: { Cookie: cookies.join("; "), "User-Agent": "BBFantasy/1.0" },
      });
      const xml = await res.text();
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
    const trophies = TROPHY_SEASONS.filter((s) => seasonsPlayed?.has(s)).length;
    return { ...rest, trophies };
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
      `${p.playerId}: ${p.name} | GP=${p.gp} PTS=${p.pts.toFixed(1)} | age=${p.age ?? "?"} height=${p.height ?? "?"}cm pot=${p.potential ?? "?"} trophies=${p.trophies}`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
