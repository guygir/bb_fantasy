/**
 * Fetch Israel U21 schedule from BBAPI and save to JSON
 * Run: node scripts/fetch-bbapi-schedule.mjs [season]
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const TEAM_ID = Number(process.env.ISRAEL_U21_TEAM_ID ?? 1015);
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : Number(process.env.CURRENT_SEASON ?? 71);

function parseCookies(setCookie) {
  if (!setCookie) return [];
  // Set-Cookie can have multiple values: "name1=val1; path=/, name2=val2; path=/"
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
    console.error("Login failed:", loginText.match(/<error message='([^']+)'/)?.[1]);
    process.exit(1);
  }

  console.log("Fetching schedule teamid=" + TEAM_ID + " season=" + SEASON + "...");
  const scheduleRes = await fetch(
    `${BASE}schedule.aspx?teamid=${TEAM_ID}&season=${SEASON}`,
    {
      headers: {
        Cookie: cookies.join("; "),
        "User-Agent": "BBFantasy/1.0",
      },
    }
  );

  const xml = await scheduleRes.text();
  if (xml.includes("<error")) {
    console.error("Schedule fetch failed:", xml.match(/<error message='([^']+)'/)?.[1]);
    process.exit(1);
  }

  // Parse matches from XML - structure: <match id='83630' start='...' type='...'><awayTeam>...</homeTeam></match>
  const matches = [];
  const matchBlockRegex = /<match id='(\d+)' start='([^']*)' type='([^']*)'>([\s\S]*?)<\/match>/g;
  let m;
  while ((m = matchBlockRegex.exec(xml)) !== null) {
    const block = m[4];
    const awayTeam = block.match(/<awayTeam id='(\d+)'>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?/);
    const homeTeam = block.match(/<homeTeam id='(\d+)'>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?/);
    matches.push({
      id: m[1],
      start: m[2],
      type: m[3],
      awayTeamId: awayTeam?.[1] ?? "",
      awayTeamName: awayTeam?.[2] ?? "",
      awayScore: awayTeam?.[3] ?? null,
      homeTeamId: homeTeam?.[1] ?? "",
      homeTeamName: homeTeam?.[2] ?? "",
      homeScore: homeTeam?.[3] ?? null,
    });
  }

  const outPath = join(__dirname, "../data", `bbapi_schedule_s${SEASON}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: { source: "BBAPI", teamId: TEAM_ID, season: SEASON, fetched: new Date().toISOString() },
        matches,
      },
      null,
      2
    )
  );

  console.log("Saved", matches.length, "matches to", outPath);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
