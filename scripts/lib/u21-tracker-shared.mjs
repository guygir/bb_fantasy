/**
 * Shared helpers for U21 tracker weekly DMI scrape + daily roster diff.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "../..");

export const STANDINGS_URL = "https://buzzerbeater.com/world/standings.aspx?teamid=1015";
export const BB_BASE = "https://buzzerbeater.com";
export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SEASON_72_START = Date.UTC(2026, 4, 2); // 2026-05-02
export const SEASON_DURATION_DAYS = 98;

export function getSeason() {
  return Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 72);
}

export function getSeasonStartMs(season) {
  return SEASON_72_START - (72 - season) * SEASON_DURATION_DAYS * 86400000;
}

export function currentWeekForSeason(season, now = new Date()) {
  const diffDays = Math.floor((now.getTime() - getSeasonStartMs(season)) / 86400000);
  if (diffDays < 0 || diffDays >= SEASON_DURATION_DAYS) return null;
  return Math.floor(diffDays / 7) + 1;
}

/** Calendar date in Asia/Jerusalem as YYYY-MM-DD */
export function israelDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function trackerDir(season) {
  return join(ROOT, "data", "u21-tracker", `s${season}`);
}

export function parsePoolsFromStandings(html) {
  const idx = html.search(/Round Robin Pools/i);
  const chunk = idx >= 0 ? html.slice(idx) : html;
  const countries = [];
  const seenCountry = new Set();
  const poolRe = /<b>\s*(Pool\s+[A-Z0-9]+)\s*<\/b>([\s\S]*?)(?=<b>\s*Pool\s+[A-Z0-9]+\s*<\/b>|$)/gi;
  let poolMatch;
  while ((poolMatch = poolRe.exec(chunk)) !== null) {
    const pool = poolMatch[1].replace(/\s+/g, " ").trim();
    const body = poolMatch[2].split(/Recent Matches/i)[0];
    const rowRe = /<tr[^>]*rptrStandings[^>]*trEntry[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = body.match(rowRe) || [];
    const searchIn = rows.length ? rows.join("\n") : body;
    const linkRe = /href=["']\/country\/(\d+)\/jnt\/overview\.aspx["'][^>]*>\s*([^<]+?)\s*<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRe.exec(searchIn)) !== null) {
      const countryId = Number(linkMatch[1]);
      if (!countryId || seenCountry.has(countryId)) continue;
      seenCountry.add(countryId);
      const name = linkMatch[2]
        .replace(/&nbsp;/g, " ")
        .replace(/\s+U21\s*$/i, "")
        .trim();
      countries.push({ countryId, name, pool });
    }
  }
  return countries;
}

export function parseRosterPage(html) {
  const seen = new Set();
  const rows = [];
  const linkRe = /href=["'][^"']*\/player\/(\d+)\/overview\.aspx["'][^>]*>([^<]+)</gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const playerId = Number(m[1]);
    const name = (m[2] || "").replace(/&nbsp;/g, " ").trim() || `Player ${playerId}`;
    if (!playerId || seen.has(playerId)) continue;
    if (/season average|total/i.test(name)) continue;
    seen.add(playerId);
    rows.push({ playerId, name });
  }
  return rows;
}

export function looksLikeLoginWall(html) {
  return (
    /login\.css/i.test(html) ||
    /<title>\s*Login\s*</i.test(html) ||
    (/cphContent_txtUserName/i.test(html) && /login\.aspx/i.test(html))
  );
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.9", ...headers },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function listWeekNumbers(season) {
  const dir = trackerDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => {
      const m = name.match(/^w(\d+)\.json$/);
      return m ? Number(m[1]) : null;
    })
    .filter((n) => n !== null)
    .sort((a, b) => a - b);
}

export function loadLatestWeekFile(season) {
  const weeks = listWeekNumbers(season).filter((w) => w > 0);
  if (!weeks.length) {
    const all = listWeekNumbers(season);
    if (!all.length) return null;
    const week = all[all.length - 1];
    return { week, file: readJson(join(trackerDir(season), `w${week}.json`)) };
  }
  const week = weeks[weeks.length - 1];
  return { week, file: readJson(join(trackerDir(season), `w${week}.json`)) };
}

/**
 * Sync roster.json + players.json membership from a weekly DMI payload
 * without emitting join/left events (used after Friday scrape / bootstrap).
 */
export function syncRosterFromWeekPayload(season, week, payload, { date = null } = {}) {
  const dir = trackerDir(season);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const dateStr = date || israelDateString(now);
  const updatedAt = payload.scrapedAt || now.toISOString();

  const rosterCountries = (payload.countries || []).map((c) => ({
    countryId: c.countryId,
    name: c.name,
    pool: c.pool,
    players: (c.players || []).map((p) => ({
      playerId: p.playerId,
      name: p.name,
    })),
  }));

  const roster = {
    season,
    week,
    date: dateStr,
    updatedAt,
    countries: rosterCountries.sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeJson(join(dir, "roster.json"), roster);

  const playersPath = join(dir, "players.json");
  const prevPlayers = readJson(playersPath) || { season, updatedAt, players: {} };
  const players = { ...(prevPlayers.players || {}) };

  for (const c of rosterCountries) {
    const onRoster = new Set(c.players.map((p) => p.playerId));
    for (const p of c.players) {
      const key = String(p.playerId);
      const existing = players[key];
      if (!existing) {
        players[key] = {
          name: p.name,
          countryId: c.countryId,
          active: true,
          stints: [{ fromWeek: week, toWeek: null, fromDate: dateStr, toDate: null }],
        };
      } else {
        existing.name = p.name || existing.name;
        existing.countryId = c.countryId;
        existing.active = true;
        const stints = existing.stints || [];
        const open = stints.find((s) => s.toWeek == null && s.toDate == null);
        if (!open) {
          stints.push({ fromWeek: week, toWeek: null, fromDate: dateStr, toDate: null });
        }
        existing.stints = stints;
      }
    }
    // Close open stints for players previously tracked on this country but absent now
    for (const [key, rec] of Object.entries(players)) {
      if (rec.countryId !== c.countryId) continue;
      if (onRoster.has(Number(key))) continue;
      if (!rec.active) continue;
      // Don't close during silent sync from weekly if we only know weekly membership —
      // actually plan says refresh roster membership from week's player lists.
      // Weekly snapshot is authoritative for "who was on roster at scrape time".
      rec.active = false;
      const open = (rec.stints || []).find((s) => s.toWeek == null && s.toDate == null);
      if (open) {
        open.toWeek = week;
        open.toDate = dateStr;
      }
    }
  }

  writeJson(playersPath, { season, updatedAt, players });

  const eventsPath = join(dir, "roster-events.json");
  if (!existsSync(eventsPath)) {
    writeJson(eventsPath, { season, events: [] });
  }

  return { rosterPath: join(dir, "roster.json"), playersPath };
}

/**
 * Diff scraped rosters against roster.json; append events; update players + roster.
 * If roster.json missing, bootstrap from scrape (or latest week) with no events.
 */
export function applyRosterDiff({
  season,
  week,
  date,
  scrapedAt,
  countries,
}) {
  const dir = trackerDir(season);
  mkdirSync(dir, { recursive: true });
  const rosterPath = join(dir, "roster.json");
  const playersPath = join(dir, "players.json");
  const eventsPath = join(dir, "roster-events.json");

  const prevRoster = readJson(rosterPath);
  const prevPlayersDoc = readJson(playersPath) || { season, updatedAt: scrapedAt, players: {} };
  const players = { ...(prevPlayersDoc.players || {}) };
  const eventsDoc = readJson(eventsPath) || { season, events: [] };
  const events = [...(eventsDoc.events || [])];

  const newRosterCountries = countries
    .map((c) => ({
      countryId: c.countryId,
      name: c.name,
      pool: c.pool,
      players: (c.players || []).map((p) => ({ playerId: p.playerId, name: p.name })),
      error: c.error,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Bootstrap: no previous roster → seed without events
  if (!prevRoster?.countries?.length) {
    const latest = loadLatestWeekFile(season);
    if (latest?.file?.countries?.length) {
      syncRosterFromWeekPayload(season, latest.week, latest.file, { date });
      // Re-load and continue with diff against just-seeded roster so today's scrape still diffs
      return applyRosterDiff({ season, week, date, scrapedAt, countries });
    }
    // No week file either — seed from this scrape silently
    for (const c of newRosterCountries) {
      for (const p of c.players) {
        players[String(p.playerId)] = {
          name: p.name,
          countryId: c.countryId,
          active: true,
          stints: [{ fromWeek: week, toWeek: null, fromDate: date, toDate: null }],
        };
      }
    }
    writeJson(rosterPath, { season, week, date, updatedAt: scrapedAt, countries: newRosterCountries });
    writeJson(playersPath, { season, updatedAt: scrapedAt, players });
    writeJson(eventsPath, { season, events: [] });
    return { bootstrapped: true, eventsAdded: 0, rosterPath, playersPath, eventsPath };
  }

  const prevByCountry = new Map(prevRoster.countries.map((c) => [c.countryId, c]));
  let eventsAdded = 0;

  for (const c of newRosterCountries) {
    if (c.error) continue;
    const prev = prevByCountry.get(c.countryId);
    const prevIds = new Set((prev?.players || []).map((p) => p.playerId));
    const nextIds = new Set(c.players.map((p) => p.playerId));

    for (const p of c.players) {
      if (prevIds.has(p.playerId)) {
        const rec = players[String(p.playerId)];
        if (rec) {
          rec.name = p.name || rec.name;
          rec.countryId = c.countryId;
          rec.active = true;
        }
        continue;
      }

      const key = String(p.playerId);
      const existing = players[key];
      const closedStints = (existing?.stints || [])
        .filter((s) => s.toWeek != null || s.toDate != null)
        .sort((a, b) => (a.toWeek ?? 0) - (b.toWeek ?? 0));
      const isReturn = Boolean(
        existing &&
          closedStints.length &&
          existing.countryId === c.countryId &&
          !(existing.stints || []).some((s) => s.toWeek == null && s.toDate == null)
      );

      if (isReturn) {
        const last = closedStints[closedStints.length - 1];
        const lastWeek = last.toWeek ?? week - 1;
        const weeksAway = Math.max(1, week - lastWeek);
        events.push({
          ts: scrapedAt,
          date,
          week,
          countryId: c.countryId,
          playerId: p.playerId,
          name: p.name,
          type: "returned",
          weeksAway,
        });
        eventsAdded++;
        existing.name = p.name || existing.name;
        existing.countryId = c.countryId;
        existing.active = true;
        existing.stints = [
          ...(existing.stints || []),
          { fromWeek: week, toWeek: null, fromDate: date, toDate: null },
        ];
      } else if (existing && existing.countryId !== c.countryId) {
        // Moved countries within season — treat as join on new country
        events.push({
          ts: scrapedAt,
          date,
          week,
          countryId: c.countryId,
          playerId: p.playerId,
          name: p.name,
          type: "joined",
        });
        eventsAdded++;
        existing.name = p.name || existing.name;
        existing.countryId = c.countryId;
        existing.active = true;
        existing.stints = [
          ...(existing.stints || []),
          { fromWeek: week, toWeek: null, fromDate: date, toDate: null },
        ];
      } else if (!existing) {
        events.push({
          ts: scrapedAt,
          date,
          week,
          countryId: c.countryId,
          playerId: p.playerId,
          name: p.name,
          type: "joined",
        });
        eventsAdded++;
        players[key] = {
          name: p.name,
          countryId: c.countryId,
          active: true,
          stints: [{ fromWeek: week, toWeek: null, fromDate: date, toDate: null }],
        };
      } else {
        // Known but not active / edge case — open stint + joined
        events.push({
          ts: scrapedAt,
          date,
          week,
          countryId: c.countryId,
          playerId: p.playerId,
          name: p.name,
          type: "joined",
        });
        eventsAdded++;
        existing.active = true;
        existing.countryId = c.countryId;
        existing.name = p.name || existing.name;
        const open = (existing.stints || []).find((s) => s.toWeek == null && s.toDate == null);
        if (!open) {
          existing.stints = [
            ...(existing.stints || []),
            { fromWeek: week, toWeek: null, fromDate: date, toDate: null },
          ];
        }
      }
    }

    for (const p of prev?.players || []) {
      if (nextIds.has(p.playerId)) continue;
      const key = String(p.playerId);
      const rec = players[key] || {
        name: p.name,
        countryId: c.countryId,
        active: true,
        stints: [{ fromWeek: week, toWeek: null, fromDate: date, toDate: null }],
      };
      events.push({
        ts: scrapedAt,
        date,
        week,
        countryId: c.countryId,
        playerId: p.playerId,
        name: p.name || rec.name,
        type: "left",
      });
      eventsAdded++;
      rec.active = false;
      rec.countryId = c.countryId;
      const open = (rec.stints || []).find((s) => s.toWeek == null && s.toDate == null);
      if (open) {
        open.toWeek = week;
        open.toDate = date;
      } else {
        rec.stints = [
          ...(rec.stints || []),
          { fromWeek: week, toWeek: week, fromDate: date, toDate: date },
        ];
      }
      players[key] = rec;
    }
  }

  // Merge: keep previous countries not included in this scrape (supports --max-countries)
  const scrapedIds = new Set(newRosterCountries.map((c) => c.countryId));
  const mergedCountries = [
    ...newRosterCountries,
    ...(prevRoster.countries || []).filter((c) => !scrapedIds.has(c.countryId)),
  ].sort((a, b) => a.name.localeCompare(b.name));

  writeJson(rosterPath, {
    season,
    week,
    date,
    updatedAt: scrapedAt,
    countries: mergedCountries,
  });
  writeJson(playersPath, { season, updatedAt: scrapedAt, players });
  writeJson(eventsPath, { season, events });

  return { bootstrapped: false, eventsAdded, rosterPath, playersPath, eventsPath };
}
