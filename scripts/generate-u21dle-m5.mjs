#!/usr/bin/env node
/**
 * M5 "trained by" display rule:
 * - current = transfer-based source from u21dle_source_teams.json ("NONE FOUND" when no transfer)
 * - M2 = away team from middle @ row on stats.aspx?season=categorySeason (BBAPI boxscore)
 * - If current is NONE FOUND, empty, Free Agency, or legacy "Okinawa B.C." (old Owner fallback) → M5 = M2 only
 * - Else if current and M2 same name (normalized) → M5 = current once
 * - Else → M5 = "current / M2"
 *
 * Writes:
 *   data/u21dle_m5_trained_by.txt   (TSV, for debugging)
 *   data/u21dle_m5_trained_by.json  { "playerId": "M5 string" }
 *
 * Run: node scripts/generate-u21dle-m5.mjs
 * Env: BBAPI_LOGIN, BBAPI_CODE
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
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

function pickMiddleAwayRow(rows) {
  const a = awayRows(rows);
  if (a.length === 0) return null;
  const idx = Math.floor((a.length - 1) / 2);
  return a[idx];
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

/**
 * Legacy Owner fallback in u21dle_source_teams.json was not a real "Purchased from" club.
 * Same as NONE FOUND / Free Agency for M5: use stats (M2) only.
 */
function shouldUseM2Only(current) {
  const c = (current ?? "").trim();
  if (!c) return true;
  if (/^none found$/i.test(c)) return true;
  if (/^free agency$/i.test(c)) return true;
  if (/^okinawa b\.c\.?$/i.test(c)) return true;
  return false;
}

/**
 * M5 display string from current (transfer) + M2 (stats middle @).
 */
function computeM5(current, m2) {
  const m2v = (m2 ?? "").trim();
  if (shouldUseM2Only(current)) {
    return m2v || "(no M2)";
  }
  const cur = String(current).trim();
  if (norm(cur) === norm(m2v)) return cur;
  return `${cur} / ${m2v}`;
}

async function fetchStatsHtml(playerId, season) {
  const res = await fetch(STATS_URL(playerId, season), {
    headers: { "User-Agent": "BBFantasy/1.0" },
  });
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

    const rawCurrent = currentMap[String(pid)] ?? currentMap[pid];
    const current =
      rawCurrent != null && rawCurrent !== ""
        ? decodeHtmlEntities(String(rawCurrent))
        : "NONE FOUND";

    if (season == null) {
      errors.push({ playerId: pid, name: p.name, reason: "no season" });
      continue;
    }

    let html;
    try {
      html = await fetchStatsHtml(pid, season);
    } catch (e) {
      errors.push({ playerId: pid, name: p.name, reason: String(e.message) });
      continue;
    }
    if (!html) {
      errors.push({ playerId: pid, name: p.name, reason: "stats empty" });
      continue;
    }

    const matchRows = parseMatchRows(html);
    const middlePick = pickMiddleAwayRow(matchRows);
    if (!middlePick) {
      errors.push({ playerId: pid, name: p.name, reason: "no @ rows" });
      continue;
    }

    await sleep(SLEEP_MS);
    let boxXml;
    try {
      boxXml = await bbapiGet(
        `${BBAPI_BASE}boxscore.aspx?matchid=${middlePick.matchId}`,
        cookies,
        BBAPI_BASE
      );
    } catch (e) {
      errors.push({ playerId: pid, name: p.name, reason: String(e.message) });
      continue;
    }

    const m2 = extractAwayTeamName(boxXml);
    if (!m2) {
      errors.push({ playerId: pid, name: p.name, reason: "boxscore parse" });
      continue;
    }

    const m5 = computeM5(current, m2);
    rows.push({
      playerId: pid,
      name: p.name,
      season,
      current,
      m2,
      m5,
      middleMatchId: middlePick.matchId,
    });
    await sleep(SLEEP_MS);
  }

  const dataDir = join(ROOT, "data");
  mkdirSync(dataDir, { recursive: true });
  const ts = new Date().toISOString();

  const txtPath = join(dataDir, "u21dle_m5_trained_by.txt");
  let txt = `# u21dle M5 trained-by snapshot\n# generated: ${ts}\n# columns: playerId, name, season, current_source, m2_middle_at_away, m5\n`;
  for (const r of rows) {
    const esc = (s) => String(s).replace(/\t/g, " ").replace(/\n/g, " ");
    txt += `${r.playerId}\t${esc(r.name)}\t${r.season}\t${esc(r.current)}\t${esc(r.m2)}\t${esc(r.m5)}\n`;
  }
  if (errors.length) {
    txt += `\n# errors (${errors.length}):\n`;
    for (const e of errors) {
      txt += `# ${e.playerId} ${e.name}: ${e.reason}\n`;
    }
  }
  writeFileSync(txtPath, txt, "utf-8");

  const jsonPath = join(dataDir, "u21dle_m5_trained_by.json");
  const jsonMap = {};
  for (const r of rows) {
    jsonMap[String(r.playerId)] = r.m5;
  }
  writeFileSync(
    jsonPath,
    JSON.stringify({ meta: { generated: ts, rule: "M5" }, trainedBy: jsonMap }, null, 2),
    "utf-8"
  );

  console.log(`\n\nWrote ${txtPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`OK: ${rows.length}, errors: ${errors.length}\n`);

  console.log(
    "| Player | Season | Current | M2 | **M5** |\n|--------|--------|---------|----|--------|"
  );
  for (const r of rows) {
    const esc = (s) => String(s).replace(/\|/g, "\\|");
    console.log(`| ${esc(r.name)} | ${r.season} | ${esc(r.current)} | ${esc(r.m2)} | ${esc(r.m5)} |`);
  }
  if (errors.length) {
    console.log("\n--- Errors ---");
    for (const e of errors) console.log(`${e.name} (${e.playerId}): ${e.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
