#!/usr/bin/env node
/**
 * Compare source team methods for U21dle eligible players:
 *
 * - Current: data/u21dle_source_teams.json (transfer history script)
 * - Method 2: One away game — middle @ row in stats table → BBAPI away team
 * - Method 3: Two away games — oldest @ in season (last row in table) + middle @;
 *   if away teams match → single name; else "Team1 / Team2"
 * - Method 4: Three away rows — first @ in table (top/newest), middle @, last @ (bottom/oldest);
 *   always "TeamTop / TeamMid / TeamOld" with "/"
 *
 * Stats table order: newest game first (top). So: first @ row = newest away game; last @ row = oldest away game.
 *
 * Run: node scripts/compare-u21dle-source-methods.mjs
 * Env: BBAPI_LOGIN, BBAPI_CODE
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet } from "./lib/bbapi-cookies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BBAPI_BASE = "http://bbapi.buzzerbeater.com/";
const STATS_URL = (id, season) =>
  `https://buzzerbeater.com/player/${id}/stats.aspx?season=${season}`;
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";
const MIN_GP = 8;
const SLEEP_MS = 180;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** All match links with href /match/ID/boxscore (document order: newest first in BB stats table). */
function parseMatchRows(html) {
  const re =
    /<a[^>]*id=['"]matchBoxscoreLink['"][^>]*href="\/match\/(\d+)\/boxscore\.aspx"[^>]*>([\s\S]*?)<\/a>/gi;
  const rows = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    rows.push({ matchId: m[1], text });
  }
  return rows;
}

function awayRows(rows) {
  return rows.filter((r) => r.text.trimStart().startsWith("@"));
}

/** Middle @ row (same as before). */
function pickMiddleAwayRow(rows) {
  const a = awayRows(rows);
  if (a.length === 0) return null;
  const idx = Math.floor((a.length - 1) / 2);
  return a[idx];
}

/** Newest away game: first @ row at top of stats table. */
function pickFirstAwayInTable(rows) {
  const a = awayRows(rows);
  return a.length ? a[0] : null;
}

/**
 * Oldest away game in the season (for method 3 “first chronologically”).
 * Table lists newest first → last @ row in document order.
 */
function pickLastAwayInTable(rows) {
  const a = awayRows(rows);
  return a.length ? a[a.length - 1] : null;
}

function extractAwayTeamName(xml) {
  if (xml.includes("<error")) return null;
  const m = xml.match(/<awayTeam[^>]*>[\s\S]*?<teamName>([^<]*)<\/teamName>/);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

function norm(s) {
  return decodeHtmlEntities(String(s || ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Method 3 display string from two away-team names (oldest + middle). */
function combineMethod3(tOldest, tMiddle) {
  if (!tOldest || !tMiddle) return null;
  if (norm(tOldest) === norm(tMiddle)) return tOldest;
  return `${tOldest} / ${tMiddle}`;
}

/** Method 4: newest / middle / oldest away-game clubs. */
function formatMethod4(tTop, tMid, tBot) {
  const parts = [tTop, tMid, tBot].map((x) => x ?? "?");
  return parts.join(" / ");
}

/** True if Current equals any of the three method-4 away teams (normalized). */
function currentMatchesAnyMethod4(current, tTop, tMid, tBot) {
  if (!current) return false;
  const n0 = norm(current);
  return [tTop, tMid, tBot].some((t) => t && norm(t) === n0);
}

async function fetchAwayTeamForMatch(cookies, matchId) {
  const boxXml = await bbapiGet(
    `${BBAPI_BASE}boxscore.aspx?matchid=${matchId}`,
    cookies,
    BBAPI_BASE
  );
  return extractAwayTeamName(boxXml);
}

async function fetchStatsHtml(playerId, season) {
  const url = STATS_URL(playerId, season);
  const res = await fetch(url, { headers: { "User-Agent": "BBFantasy/1.0" } });
  if (!res.ok) return null;
  return res.text();
}

async function main() {
  const playersPath = join(ROOT, "data", "u21dle_players.json");
  const sourcePath = join(ROOT, "data", "u21dle_source_teams.json");
  if (!existsSync(playersPath)) {
    console.error("Missing data/u21dle_players.json");
    process.exit(1);
  }
  const { players } = JSON.parse(readFileSync(playersPath, "utf-8"));
  const eligible = players.filter((p) => (p.gp ?? 0) >= MIN_GP);
  const currentMap = existsSync(sourcePath)
    ? JSON.parse(readFileSync(sourcePath, "utf-8"))
    : {};

  console.log("Logging in to BBAPI...");
  const { cookies, body: loginText } = await bbapiLogin(LOGIN, CODE, BBAPI_BASE);
  if (loginText.includes("<error")) {
    console.error("BBAPI login failed");
    process.exit(1);
  }

  const rows = [];
  const errors = [];

  for (let i = 0; i < eligible.length; i++) {
    const p = eligible[i];
    const pid = p.playerId;
    const season = p.season;
    process.stdout.write(`\r[${i + 1}/${eligible.length}] ${p.name} (${pid})...`);

    const currentRaw = currentMap[String(pid)] ?? currentMap[pid] ?? null;
    const current = currentRaw ? decodeHtmlEntities(String(currentRaw)) : null;

    if (season == null) {
      errors.push({ playerId: pid, name: p.name, reason: "no season in JSON" });
      continue;
    }

    let html;
    try {
      html = await fetchStatsHtml(pid, season);
    } catch (e) {
      errors.push({ playerId: pid, name: p.name, reason: `stats fetch: ${e.message}` });
      continue;
    }
    if (!html) {
      errors.push({ playerId: pid, name: p.name, reason: "stats page empty" });
      continue;
    }

    const matchRows = parseMatchRows(html);
    const topPick = pickFirstAwayInTable(matchRows);
    const middlePick = pickMiddleAwayRow(matchRows);
    const bottomPick = pickLastAwayInTable(matchRows);
    if (!topPick || !middlePick || !bottomPick) {
      errors.push({ playerId: pid, name: p.name, reason: "no @ away rows in stats table" });
      continue;
    }

    const uniqueIds = [...new Set([topPick.matchId, middlePick.matchId, bottomPick.matchId])];
    const teamByMatch = new Map();
    try {
      for (const id of uniqueIds) {
        const t = await fetchAwayTeamForMatch(cookies, id);
        teamByMatch.set(id, t);
        await sleep(SLEEP_MS);
      }
    } catch (e) {
      errors.push({ playerId: pid, name: p.name, reason: `boxscore: ${e.message}` });
      continue;
    }

    const teamTop = teamByMatch.get(topPick.matchId);
    const teamMiddle = teamByMatch.get(middlePick.matchId);
    const teamBottom = teamByMatch.get(bottomPick.matchId);
    if (!teamTop || !teamMiddle || !teamBottom) {
      errors.push({ playerId: pid, name: p.name, reason: "boxscore parse (away team)" });
      continue;
    }

    const method2 = teamMiddle;
    const method3 = combineMethod3(teamBottom, teamMiddle);
    const method4 = formatMethod4(teamTop, teamMiddle, teamBottom);
    const m4AlignsCurrent = currentMatchesAnyMethod4(current, teamTop, teamMiddle, teamBottom);

    rows.push({
      playerId: pid,
      name: p.name,
      season,
      current,
      method2,
      method3,
      method4,
      m4AlignsCurrent,
      topMatchId: topPick.matchId,
      middleMatchId: middlePick.matchId,
      bottomMatchId: bottomPick.matchId,
    });
  }

  const m4AlignCount = rows.filter((r) => r.m4AlignsCurrent).length;

  const tableRows = rows.filter((r) => {
    const n0 = norm(r.current);
    const n2 = norm(r.method2);
    const n3 = norm(r.method3);
    const threeDiff = n0 !== n2 || n0 !== n3 || n2 !== n3;
    return threeDiff || !r.m4AlignsCurrent;
  });

  const outPath = join(ROOT, "data", "u21dle_source_compare_run.txt");
  let out = "";
  out += `Compared: ${eligible.length} eligible (GP>=${MIN_GP})\n`;
  out += `OK: ${rows.length}, errors: ${errors.length}\n`;
  out += `Current appears as one of Method 4's three away teams: ${m4AlignCount} / ${rows.length}\n`;
  out += `Table rows (Current vs M2/M3 differ OR Current not in M4): ${tableRows.length}\n\n`;

  out +=
    "| Player | Season | Current | M2 (mid @) | M3 (old+mid @) | M4 (top/mid/bot @) | Current ∈ M4? |\n|--------|--------|---------|------------|----------------|---------------------|----------------|\n";
  for (const r of tableRows) {
    const esc = (s) =>
      String(s ?? "")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");
    out += `| ${esc(r.name)} | ${r.season} | ${esc(r.current ?? "(none)")} | ${esc(r.method2)} | ${esc(r.method3)} | ${esc(r.method4)} | ${r.m4AlignsCurrent ? "Yes" : "No"} |\n`;
  }

  if (errors.length) {
    out += "\n--- Errors ---\n";
    for (const e of errors.slice(0, 40)) {
      out += `${e.name} (${e.playerId}): ${e.reason}\n`;
    }
    if (errors.length > 40) out += `... +${errors.length - 40} more\n`;
  }

  writeFileSync(outPath, out, "utf-8");
  console.log("\n\n" + out);
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
