/**
 * Fetch BBAPI player details (position, DMI, salary) for all Season 71 players
 * and save to JSON. Run before starting the app to ensure Players page has full data.
 *
 * Run: node scripts/fetch-player-details.mjs [season]
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

function parseCookies(setCookie) {
  if (!setCookie) return [];
  const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
  return parts.map((p) => p.split(";")[0].trim()).filter((kv) => kv && kv.includes("="));
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

async function run() {
  const dataPath = join(__dirname, "../data", `season${SEASON}_stats.json`);
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const players = data.players ?? [];

  console.log("Logging in...");
  const loginRes = await fetch(
    `${BASE}login.aspx?login=${encodeURIComponent(LOGIN)}&code=${encodeURIComponent(CODE)}`,
    { redirect: "manual", headers: { "User-Agent": "BBFantasy/1.0" } }
  );

  const cookies = parseCookies(loginRes.headers.get("set-cookie"));
  const loginText = await loginRes.text();

  if (loginText.includes("<error")) {
    console.error("Login failed");
    process.exit(1);
  }

  const details = {};
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    process.stdout.write(`\rFetching ${i + 1}/${players.length} (${p.name})...`);
    try {
      const res = await fetch(`${BASE}player.aspx?playerid=${p.playerId}`, {
        headers: { Cookie: cookies.join("; "), "User-Agent": "BBFantasy/1.0" },
      });
      const xml = await res.text();
      if (!xml.includes("<error")) {
        details[p.playerId] = parsePlayerXml(xml);
      }
    } catch (e) {
      console.error("\nError fetching", p.playerId, e.message);
    }
    await new Promise((r) => setTimeout(r, 200)); // Rate limit
  }

  const outPath = join(__dirname, "../data", `player_details_s${SEASON}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: { season: SEASON, fetched: new Date().toISOString(), source: "BBAPI" },
        details,
      },
      null,
      2
    )
  );

  console.log("\nSaved", Object.keys(details).length, "player details to", outPath);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
