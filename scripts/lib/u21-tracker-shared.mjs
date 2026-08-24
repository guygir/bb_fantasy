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

export {
  SEASON_ANCHOR_START_MS as SEASON_72_START,
  SEASON_DURATION_DAYS,
  getSeasonStartMs,
  currentWeekForSeason,
  resolveCurrentSeasonFromEnv,
  competitiveRosterStartDate,
} from "./season-calendar.mjs";

import { competitiveRosterStartDate, resolveCurrentSeasonFromEnv } from "./season-calendar.mjs";

export function getSeason() {
  return resolveCurrentSeasonFromEnv();
}

/** Leave/stint end on or after Sunday of W2 counts for a later "returned". */
export function dateCountsForRosterReturn(season, date) {
  if (!date) return false;
  return String(date) >= competitiveRosterStartDate(season);
}

export function closedStintCountsForRosterReturn(season, stint) {
  if (!stint) return false;
  if (stint.toDate) return dateCountsForRosterReturn(season, stint.toDate);
  return (stint.toWeek ?? 0) >= 3;
}

/**
 * Rejoin is "returned" only if the player already had a closed stint that
 * lasted into the competitive window (Sunday W2 onward). W1 / Saturday W2
 * leaves do not count — those later rejoins are "joined" (new).
 */
export function shouldClassifyAsReturn(season, existing, countryId) {
  if (!existing || existing.countryId !== countryId) return false;
  const stints = existing.stints || [];
  if (stints.some((s) => s.toWeek == null && s.toDate == null)) return false;
  return stints.some(
    (s) => (s.toWeek != null || s.toDate != null) && closedStintCountsForRosterReturn(season, s)
  );
}

export function lastCountingClosedStint(season, existing) {
  return (existing?.stints || [])
    .filter((s) => (s.toWeek != null || s.toDate != null) && closedStintCountsForRosterReturn(season, s))
    .sort((a, b) => {
      const weekCmp = (a.toWeek ?? 0) - (b.toWeek ?? 0);
      if (weekCmp !== 0) return weekCmp;
      return String(a.toDate || "").localeCompare(String(b.toDate || ""));
    })
    .at(-1);
}

/** Rewrite stored "returned" events that only had a pre-competitive leave. */
export function reclassifyRosterReturnEvents(season, events, players = null) {
  return (events || []).map((event, index) => {
    if (event.type !== "returned") return event;
    let lastLeft = null;
    for (let i = index - 1; i >= 0; i--) {
      const prev = events[i];
      if (
        prev.playerId === event.playerId &&
        prev.countryId === event.countryId &&
        prev.type === "left"
      ) {
        lastLeft = prev;
        break;
      }
    }
    const leaveCounts = lastLeft
      ? dateCountsForRosterReturn(season, lastLeft.date) ||
        (!lastLeft.date && (lastLeft.week ?? 0) >= 3)
      : false;
    if (leaveCounts) return event;
    const rec = players?.[String(event.playerId)];
    const priorCounting = (rec?.stints || []).some(
      (s) => s.toDate && s.toDate < event.date && closedStintCountsForRosterReturn(season, s)
    );
    if (priorCounting) return event;
    const { weeksAway: _weeksAway, ...rest } = event;
    return { ...rest, type: "joined" };
  });
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

/** True when standings label is a World Cup pool (e.g. "World Cup - Pool A"). */
export function isWorldCupPool(pool) {
  return /world\s*cup/i.test(String(pool || ""));
}

/**
 * Merge country catalogs by id. `preferred` wins on name/pool conflicts
 * (use standings over roster/meta so World Cup labels stick).
 */
export function mergeCountryLists(preferred, fallback) {
  const byId = new Map();
  for (const c of fallback || []) {
    if (!c?.countryId) continue;
    byId.set(c.countryId, {
      countryId: c.countryId,
      name: c.name,
      pool: c.pool,
    });
  }
  for (const c of preferred || []) {
    if (!c?.countryId) continue;
    const prev = byId.get(c.countryId);
    byId.set(c.countryId, {
      countryId: c.countryId,
      name: c.name || prev?.name,
      pool: c.pool || prev?.pool,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Countries known from roster.json and/or meta.json (full catalog for daily diffs). */
export function loadKnownTrackerCountries(season) {
  const dir = trackerDir(season);
  const fromRoster = readJson(join(dir, "roster.json"))?.countries || [];
  const fromMeta = readJson(join(dir, "meta.json"))?.countries || [];
  return mergeCountryLists(fromRoster, fromMeta);
}

/**
 * Update meta.json name/pool for countries present on standings (keeps full catalog).
 * Used by daily roster scrape so the UI can detect World Cup phase without waiting for Friday.
 */
export function mergeMetaCountryPools(season, standingsCountries, updatedAt = null) {
  if (!standingsCountries?.length) return null;
  const metaPath = join(trackerDir(season), "meta.json");
  const meta = readJson(metaPath);
  if (!meta?.countries?.length) return null;
  const byId = new Map(meta.countries.map((c) => [c.countryId, { ...c }]));
  for (const c of standingsCountries) {
    const prev = byId.get(c.countryId);
    if (prev) {
      byId.set(c.countryId, {
        ...prev,
        name: c.name || prev.name,
        pool: c.pool || prev.pool,
      });
    } else {
      byId.set(c.countryId, {
        countryId: c.countryId,
        name: c.name,
        pool: c.pool,
      });
    }
  }
  const next = {
    ...meta,
    countries: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    updatedAt: updatedAt || meta.updatedAt || new Date().toISOString(),
  };
  writeJson(metaPath, next);
  return metaPath;
}

export function parsePoolsFromStandings(html) {
  const idx = html.search(/Round Robin Pools|World Cup/i);
  const chunk = idx >= 0 ? html.slice(idx) : html;
  const countries = [];
  const seenCountry = new Set();
  // RR: <b>Pool A</b> · WC: <b>World Cup - Pool A</b>
  const poolLabel = "(?:World\\s+Cup\\s*[-–—]\\s*)?Pool\\s+[A-Z0-9]+";
  const poolRe = new RegExp(`<b>\\s*(${poolLabel})\\s*<\\/b>([\\s\\S]*?)(?=<b>\\s*${poolLabel}\\s*<\\/b>|$)`, "gi");
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

function parseDmiFromChunk(chunk) {
  const m = chunk.match(/DMI:\s*([\d\s&nbsp;]+)/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse U21 roster page. Marks forSale when Repeater1_forSaleImage_N is present
 * for the same repeater index as the player name link. Also reads DMI from the card.
 */
export function parseRosterPage(html) {
  const saleIndices = new Set(
    [...html.matchAll(/id=["']cphContent_Repeater1_forSaleImage_(\d+)["']/gi)].map((m) =>
      Number(m[1])
    )
  );
  const seen = new Set();
  const rows = [];

  // Prefer HyperLink1 blocks (one per roster card) so DMI/sale stay in-card
  const linkStarts = [...html.matchAll(/id=["']cphContent_Repeater1_HyperLink1_(\d+)["']/gi)];
  for (let i = 0; i < linkStarts.length; i++) {
    const idx = Number(linkStarts[i][1]);
    const start = linkStarts[i].index;
    const end = i + 1 < linkStarts.length ? linkStarts[i + 1].index : start + 5000;
    const chunk = html.slice(start, end);
    const pm = chunk.match(
      /href=["'][^"']*\/player\/(\d+)\/overview\.aspx["'][^>]*>([^<]+)/i
    );
    if (!pm) continue;
    const playerId = Number(pm[1]);
    const name = (pm[2] || "").replace(/&nbsp;/g, " ").trim() || `Player ${playerId}`;
    if (!playerId || seen.has(playerId)) continue;
    if (/season average|total/i.test(name)) continue;
    seen.add(playerId);
    rows.push({
      playerId,
      name,
      forSale: saleIndices.has(idx),
      dmi: parseDmiFromChunk(chunk),
    });
  }

  if (rows.length) return rows;

  // Fallback if BB markup lacks HyperLink1 ids
  const indexedRe =
    /id=["']cphContent_Repeater1_\w+_(\d+)["'][^>]*href=["'][^"']*\/player\/(\d+)\/overview\.aspx["'][^>]*>([^<]+)/gi;
  let m;
  while ((m = indexedRe.exec(html)) !== null) {
    const idx = Number(m[1]);
    const playerId = Number(m[2]);
    const name = (m[3] || "").replace(/&nbsp;/g, " ").trim() || `Player ${playerId}`;
    if (!playerId || seen.has(playerId)) continue;
    if (/season average|total/i.test(name)) continue;
    seen.add(playerId);
    rows.push({ playerId, name, forSale: saleIndices.has(idx), dmi: null });
  }

  const linkRe = /href=["'][^"']*\/player\/(\d+)\/overview\.aspx["'][^>]*>([^<]+)</gi;
  while ((m = linkRe.exec(html)) !== null) {
    const playerId = Number(m[1]);
    const name = (m[2] || "").replace(/&nbsp;/g, " ").trim() || `Player ${playerId}`;
    if (!playerId || seen.has(playerId)) continue;
    if (/season average|total/i.test(name)) continue;
    seen.add(playerId);
    rows.push({ playerId, name, forSale: false, dmi: null });
  }
  return rows;
}

/** Current-day on-sale snapshot only (overwrites previous file). */
export function writeOnSaleSnapshot(
  season,
  { date, week, scrapedAt, countries, mergePrevious = false }
) {
  const dir = trackerDir(season);
  const path = join(dir, "on-sale.json");
  const players = [];
  for (const c of countries || []) {
    if (c.error) continue;
    for (const p of c.players || []) {
      if (!p.forSale) continue;
      players.push({
        playerId: p.playerId,
        name: p.name,
        countryId: c.countryId,
        countryName: c.name,
        pool: c.pool,
        dmi: p.dmi ?? null,
      });
    }
  }
  if (mergePrevious) {
    const prev = readJson(path);
    const scrapedIds = new Set((countries || []).map((c) => c.countryId));
    for (const p of prev?.players || []) {
      if (!scrapedIds.has(p.countryId)) players.push(p);
    }
  }
  players.sort(
    (a, b) =>
      a.countryName.localeCompare(b.countryName) || a.name.localeCompare(b.name)
  );
  const payload = {
    season,
    date,
    week,
    updatedAt: scrapedAt,
    players,
  };
  writeJson(path, payload);
  return { path, count: players.length };
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

  // Keep countries not in this week's scrape (e.g. non–World Cup teams during WC phase)
  const prevRoster = readJson(join(dir, "roster.json"));
  const scrapedIds = new Set(rosterCountries.map((c) => c.countryId));
  const mergedCountries = [
    ...rosterCountries,
    ...(prevRoster?.countries || []).filter((c) => !scrapedIds.has(c.countryId)),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const roster = {
    season,
    week,
    date: dateStr,
    updatedAt,
    countries: mergedCountries,
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
      const isReturn = shouldClassifyAsReturn(season, existing, c.countryId);

      if (isReturn) {
        const last = lastCountingClosedStint(season, existing);
        const lastWeek = last?.toWeek ?? week - 1;
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
  writeJson(eventsPath, { season, events: reclassifyRosterReturnEvents(season, events, players) });

  return { bootstrapped: false, eventsAdded, rosterPath, playersPath, eventsPath };
}
