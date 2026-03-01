/**
 * Fetch boxscores for all past matches in the schedule.
 * Run: node scripts/fetch-all-boxscores.mjs [season]
 *
 * Reads bbapi_schedule_s{N}.json, fetches boxscore for each match that has already started.
 * Then run: npm run process-boxscores 71 && npm run sync-fantasy 71
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

function parseCookies(setCookie) {
  if (!setCookie) return [];
  const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
  return parts.map((p) => p.split(";")[0].trim()).filter((kv) => kv && kv.includes("="));
}

async function fetchBoxscore(matchId, cookies) {
  const res = await fetch(`${BASE}boxscore.aspx?matchid=${matchId}`, {
    headers: { Cookie: cookies.join("; "), "User-Agent": "BBFantasy/1.0" },
  });
  const xml = await res.text();
  if (xml.includes("<error")) return null;
  return xml;
}

async function run() {
  const schedulePath = join(DATA_DIR, `bbapi_schedule_s${SEASON}.json`);
  if (!existsSync(schedulePath)) {
    console.error("No schedule found. Run: npm run fetch-schedule", SEASON);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(schedulePath, "utf-8"));
  const matches = data.matches ?? [];
  const now = Date.now();
  const pastMatches = matches.filter((m) => m.start && new Date(m.start).getTime() < now);

  if (pastMatches.length === 0) {
    console.log("No past matches in schedule.");
    process.exit(0);
  }

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

  const { writeFileSync } = await import("fs");
  let fetched = 0;
  for (const m of pastMatches) {
    const matchId = String(m.id);
    const outPath = join(DATA_DIR, `bbapi_boxscore_${matchId}.xml`);
    if (existsSync(outPath)) {
      console.log(`Skip ${matchId} (already exists)`);
      continue;
    }
    console.log(`Fetching boxscore ${matchId}...`);
    const xml = await fetchBoxscore(matchId, cookies);
    if (xml) {
      writeFileSync(outPath, xml);
      fetched++;
      console.log(`  Saved`);
    } else {
      console.log(`  (not available yet)`);
    }
  }

  console.log(`\nFetched ${fetched} boxscore(s). Run: npm run process-boxscores ${SEASON} && npm run sync-fantasy ${SEASON}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
