/**
 * Fetch boxscore from BBAPI
 * Run: node scripts/fetch-bbapi-boxscore.mjs <matchId>
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const MATCH_ID = process.argv[2] || "83641";

function parseCookies(setCookie) {
  if (!setCookie) return [];
  const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
  return parts.map((p) => p.split(";")[0].trim()).filter((kv) => kv && kv.includes("="));
}

async function run() {
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

  console.log("Fetching boxscore matchId=" + MATCH_ID + "...");
  const res = await fetch(`${BASE}boxscore.aspx?matchid=${MATCH_ID}`, {
    headers: { Cookie: cookies.join("; "), "User-Agent": "BBFantasy/1.0" },
  });

  const xml = await res.text();
  if (xml.includes("<error")) {
    console.error("Boxscore fetch failed:", xml.match(/<error message='([^']+)'/)?.[1]);
    process.exit(1);
  }

  const outPath = join(__dirname, "../data", `bbapi_boxscore_${MATCH_ID}.xml`);
  writeFileSync(outPath, xml);
  console.log("Saved to", outPath);

  // Quick parse for Israel (team 1015) players
  const israelMatch = xml.match(/<team id='1015'[^>]*>([\s\S]*?)<\/team>/);
  if (israelMatch) {
    const playerMatches = israelMatch[1].matchAll(/<player id='(\d+)'[^>]*>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<pts>(\d+)<\/pts>/g);
    console.log("\nIsrael U21 players (PTS):");
    for (const p of playerMatches) {
      console.log("  ", p[2], "-", p[3], "pts");
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
