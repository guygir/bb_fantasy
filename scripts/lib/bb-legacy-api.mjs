/**
 * BuzzerBeater Legacy JSON RPC + ID Resolution Helper (`https://legacy.buzzerbeater.com/api/*`).
 *
 * Replaces dead ASP.NET HTML scraping (`login.aspx`, `players.aspx`, `stats.aspx`,
 * `standings.aspx`, `overview.aspx`) which now 301-redirect to Cloudflare-protected SPA.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bbapiLogin, bbapiGet, DEFAULT_BBAPI_BASE } from "./bbapi-cookies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "../..");
export const DATA_DIR = join(ROOT, "data");
export const PLAYER_ID_MAP_PATH = join(DATA_DIR, "bb_player_id_map.json");
export const LEGACY_API_BASE = "https://legacy.buzzerbeater.com/api";
export const ISRAEL_U21_TEAM_ID = 1015;

/** Complete 104-entry BuzzerBeater country table: [numericCountryId, isoCode, name] */
export const COUNTRY_ENTRIES = [
  [1, "US", "USA"], [2, "AR", "Argentina"], [3, "BR", "Brasil"], [4, "CA", "Canada"],
  [5, "CN", "China"], [6, "TR", "Türkiye"], [7, "ES", "España"], [8, "DE", "Deutschland"],
  [9, "SE", "Sverige"], [10, "IT", "Italia"], [11, "FR", "France"], [12, "GR", "Hellas"],
  [13, "BE", "Belgium"], [14, "GB-ENG", "England"], [15, "IL", "Israel"], [16, "NL", "Nederland"],
  [17, "AU", "Australia"], [18, "PT", "Portugal"], [19, "RU", "Rossiya"], [20, "LT", "Lietuva"],
  [21, "CL", "Chile"], [22, "CO", "Colombia"], [23, "KR", "Hanguk"], [24, "HR", "Hrvatska"],
  [25, "NG", "Nigeria"], [26, "NO", "Norge"], [27, "AT", "Österreich"], [28, "CH", "Schweiz"],
  [29, "RS", "Srbija"], [30, "MX", "México"], [31, "DZ", "Al Jazair"], [32, "MA", "Al Maghrib"],
  [33, "UA", "Ukraina"], [34, "BO", "Bolivia"], [35, "BA", "Bosna i Hercegovina"], [36, "BG", "Bulgaria"],
  [37, "CZ", "Česká Rep."], [38, "CR", "Costa Rica"], [39, "DK", "Danmark"], [40, "EC", "Ecuador"],
  [41, "EE", "Eesti"], [42, "IN", "India"], [43, "ID", "Indonesia"], [44, "IE", "Ireland"],
  [45, "HK", "Hong Kong"], [46, "LV", "Latvija"], [47, "LB", "Lubnan"], [48, "HU", "Magyarország"],
  [49, "MK", "Makedonija"], [50, "MY", "Malaysia"], [51, "EG", "Misr"], [52, "NZ", "New Zealand"],
  [53, "JP", "Nippon"], [54, "PA", "Panama"], [55, "PY", "Paraguay"], [56, "PE", "Perú"],
  [57, "PH", "Pilipinas"], [58, "PL", "Polska"], [59, "IR", "Iran"], [60, "DO", "Rep. Dominicana"],
  [61, "RO", "România"], [62, "GE", "Sakartvelo"], [63, "SA", "Saudi Arabia"], [64, "GB-SCT", "Scotland"],
  [65, "SG", "Singapore"], [66, "SI", "Slovenija"], [67, "SK", "Slovensko"], [68, "ZA", "South Africa"],
  [69, "FI", "Suomi"], [70, "TW", "Taiwan"], [71, "TN", "Tounes"], [72, "TH", "Prathet Thai"],
  [73, "UY", "Uruguay"], [74, "VE", "Venezuela"], [75, "AD", "Andorra"], [76, "ME", "Crna Gora"],
  [77, "CY", "Cyprus"], [78, "IS", "Ísland"], [79, "AL", "Shqipëria"], [80, "PR", "Puerto Rico"],
  [81, "GB-WLS", "Cymru"], [82, "GT", "Guatemala"], [83, "KZ", "Kazakhstan"], [84, "AE", "U.A.E."],
  [85, "BY", "Belarus"], [86, "MD", "Moldova"], [87, "AM", "Hayastan"], [88, "AZ", "Azərbaycan"],
  [89, "PK", "Pakistan"], [90, "MT", "Malta"], [91, "LU", "Luxembourg"], [92, "VN", "Việt Nam"],
  [93, "GH", "Ghana"], [94, "SN", "Senegal"], [95, "BB", "Barbados"], [96, "JM", "Jamaica"],
  [97, "MO", "Macau"], [98, "BS", "Bahamas"], [99, "X1", "Utopia"], [100, "N2", "Nations of Africa"],
  [101, "N1", "Nations of Europe"], [102, "N4", "Nations of Asia"], [103, "N3", "Nations of America"],
  [104, "X2", "Pickup"],
];

const BY_ISO = new Map(COUNTRY_ENTRIES.map(([countryId, iso, name]) => [iso, { countryId, iso, name }]));
const BY_ID = new Map(COUNTRY_ENTRIES.map(([countryId, iso, name]) => [countryId, { countryId, iso, name }]));

export function countryByIso(iso) {
  return BY_ISO.get(String(iso || "").trim()) || null;
}

export function countryById(countryId) {
  return BY_ID.get(Number(countryId)) || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call a legacy.buzzerbeater.com JSON RPC endpoint with Retry/429/5xx backoff.
 */
export async function bbApiCall(endpoint, body = {}, opts = {}) {
  const url = `${LEGACY_API_BASE}/${endpoint.replace(/^\/+/, "")}`;
  const maxAttempts = opts.maxAttempts ?? 6;
  const headers = {
    "Content-Type": "application/json",
    "X-BB-Client-Type": "legacy",
    "X-BB-Language": "en",
    "User-Agent": "BBFantasy/1.0",
  };
  if (opts.cookieHeader) {
    headers.Cookie = opts.cookieHeader;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) {
        const waitMs = Math.min(8000, 600 * attempt);
        lastErr = new Error(`HTTP ${res.status} from ${endpoint}`);
        if (attempt < maxAttempts) {
          await sleep(waitMs);
          continue;
        }
        throw lastErr;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        throw new Error(`HTTP ${res.status} from ${endpoint}`);
      }
      if (json.error) {
        if (json.error.code === "Retry" && attempt < maxAttempts) {
          const waitMs = Math.max(Number(json.error.retryInMilliseconds) || 0, 400 * attempt) + 120;
          await sleep(waitMs);
          continue;
        }
        throw new Error(`API error on ${endpoint}: ${json.error.code || json.error.message || JSON.stringify(json.error)}`);
      }
      return json.response ?? json;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && !String(err?.message || "").startsWith("API error on ")) {
        await sleep(500 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`Failed ${endpoint}`);
}

/**
 * Resolve numeric IDs -> UUIDs via /public/ResolveIds in batches of 100.
 * @param {"team"|"player"} kind
 * @param {number[]} numbers
 * @returns {Promise<Map<number, string>>}
 */
export async function resolveIds(kind, numbers, opts = {}) {
  const unique = [...new Set((numbers || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const resp = await bbApiCall("public/ResolveIds", { kind, numbers: chunk }, opts);
    for (const item of resp.items || []) {
      if (item?.number != null && item?.id) {
        out.set(Number(item.number), item.id);
      }
    }
    if (i + 100 < unique.length) await sleep(80);
  }
  return out;
}

export async function getSeasons(opts = {}) {
  const resp = await bbApiCall("season/GetSeasons", {}, opts);
  return resp.seasons || [];
}

export async function getTeamCard(teamUuid, opts = {}) {
  return bbApiCall("team/GetTeamCard", { teamId: teamUuid }, opts);
}

export async function getPlayer(playerUuid, opts = {}) {
  const resp = await bbApiCall("player/GetPlayer", { playerId: playerUuid }, opts);
  return resp.player ?? resp;
}

/**
 * Fetch ALL players on a team (paginated; max page size is 30).
 */
export async function getTeamPlayers(teamUuid, opts = {}) {
  const all = [];
  let offset = 0;
  const size = 30;
  for (;;) {
    const resp = await bbApiCall("player/GetPlayers", { teamId: teamUuid, offset, size }, opts);
    const batch = resp.players || [];
    all.push(...batch);
    if (batch.length < size) break;
    offset += size;
    await sleep(60);
  }
  return all;
}

export async function getTeamStats(teamUuid, seasonId, opts = {}) {
  const resp = await bbApiCall("team/GetStats", { teamId: teamUuid, seasonId }, opts);
  return resp.players || [];
}

/**
 * Fetch U21 Round Robin / World Cup pool teams for the given season number.
 * Uses Israel U21 (team 1015) competitions -> GetCompetitionEdition -> GetStandings.
 * Returns [{ countryId, name, pool, teamUuid }] sorted by name.
 */
export async function getU21StandingsPools(seasonNumber, opts = {}) {
  const seasons = await getSeasons(opts);
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  const idMap = await resolveIds("team", [ISRAEL_U21_TEAM_ID], opts);
  const israelUuid = idMap.get(ISRAEL_U21_TEAM_ID);
  if (!israelUuid) throw new Error("Failed to resolve Israel U21 team ID (1015)");

  const compsResp = await bbApiCall("competition/GetNationalTeamCompetitions", { teamId: israelUuid }, opts);
  const comps = compsResp.competitions || [];
  if (!comps.length) throw new Error("No competitions returned for Israel U21");

  const matching = comps.filter((c) => seasonById.get(c.seasonId)?.number === Number(seasonNumber));
  const candidates = matching.length ? matching : comps;

  // Prefer WorldCup if it exists and has started, else latest competition by startsAt
  const now = Date.now();
  const started = candidates.filter((c) => !c.startsAt || new Date(c.startsAt).getTime() <= now);
  const poolSource = (started.length ? started : candidates).sort((a, b) => {
    const aWc = a.type === "WorldCup" ? 1 : 0;
    const bWc = b.type === "WorldCup" ? 1 : 0;
    if (aWc !== bWc) return bWc - aWc;
    return String(b.startsAt || "").localeCompare(String(a.startsAt || ""));
  });

  const countries = [];
  const seen = new Set();

  for (const comp of poolSource) {
    const ed = await bbApiCall("competition/GetCompetitionEdition", { competitionEditionId: comp.editionId }, opts);
    const stages = (ed.stages || [])
      .filter((s) => Array.isArray(s.groups) && s.groups.length > 0)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!stages.length) continue;

    // Group stage (RoundRobin / Qualification)
    const stage = stages.find((s) => s.type === "RoundRobin") || stages[0];
    const standings = await bbApiCall(
      "competition/GetStandings",
      { competitionStageId: stage.id, tier: null },
      opts
    );

    const isWc = comp.type === "WorldCup";
    for (const group of standings.groups || []) {
      const rawName = String(group.name || "").replace(/\s+/g, " ").trim() || "Pool A";
      const pool = isWc && !/world\s*cup/i.test(rawName) ? `World Cup - ${rawName}` : rawName;
      for (const entry of group.teams || []) {
        const team = entry.team;
        if (!team?.countryId) continue;
        const country = countryByIso(team.countryId);
        if (!country || seen.has(country.countryId)) continue;
        seen.add(country.countryId);
        countries.push({
          countryId: country.countryId,
          name: country.name,
          pool,
          teamUuid: team.id,
        });
      }
    }

    if (countries.length > 0) break;
  }

  return countries.sort((a, b) => a.name.localeCompare(b.name));
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normName(str) {
  return decodeXmlEntities(str)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function romanToInt(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50 };
  let total = 0;
  let prev = 0;
  const s = String(roman || "").toUpperCase();
  for (let i = s.length - 1; i >= 0; i--) {
    const v = map[s[i]] || 0;
    total += v < prev ? -v : v;
    prev = v;
  }
  return total;
}

function parseDivisionLevel(leagueName) {
  const m =
    String(leagueName || "").trim().match(/\b([IVXL]+)\.\d+\b/i) ||
    String(leagueName || "").trim().match(/^([IVXL]+)(?:\.\d+|\b)/i);
  if (m) {
    const lvl = romanToInt(m[1]);
    if (lvl >= 1 && lvl <= 10) return lvl;
  }
  return 1;
}

function loadJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function loadPlayerIdMap(mapPath = PLAYER_ID_MAP_PATH) {
  return loadJsonSafe(mapPath) || {};
}

export function savePlayerIdMap(map, mapPath = PLAYER_ID_MAP_PATH) {
  mkdirSync(dirname(mapPath), { recursive: true });
  const sorted = {};
  for (const k of Object.keys(map).sort()) {
    sorted[k] = Number(map[k]);
  }
  writeFileSync(mapPath, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

function collectKnownNumericPlayerIdsFromDisk() {
  const ids = new Set();
  if (!existsSync(DATA_DIR)) return ids;

  for (const name of readdirSync(DATA_DIR)) {
    const full = join(DATA_DIR, name);
    if (/^season\d+_stats\.json$/.test(name) || name === "u21dle_players.json") {
      const doc = loadJsonSafe(full);
      for (const p of doc?.players || []) {
        if (Number(p?.playerId) > 0) ids.add(Number(p.playerId));
      }
    } else if (/^player_details_s\d+\.json$/.test(name)) {
      const doc = loadJsonSafe(full);
      for (const k of Object.keys(doc?.details || {})) {
        if (Number(k) > 0) ids.add(Number(k));
      }
    } else if (/^bbapi_boxscore_\d+\.xml$/.test(name)) {
      try {
        const xml = readFileSync(full, "utf8");
        for (const m of xml.matchAll(/<player\s+id=['"](\d+)['"]/g)) {
          ids.add(Number(m[1]));
        }
      } catch {
        // ignore
      }
    }
  }

  const trackerRoot = join(DATA_DIR, "u21-tracker");
  if (existsSync(trackerRoot)) {
    for (const sDir of readdirSync(trackerRoot)) {
      const p = join(trackerRoot, sDir);
      const playersDoc = loadJsonSafe(join(p, "players.json"));
      for (const k of Object.keys(playersDoc?.players || {})) {
        if (Number(k) > 0) ids.add(Number(k));
      }
      const rosterDoc = loadJsonSafe(join(p, "roster.json"));
      for (const c of rosterDoc?.countries || []) {
        for (const pl of c?.players || []) {
          if (Number(pl?.playerId) > 0) ids.add(Number(pl.playerId));
        }
      }
    }
  }

  return ids;
}

/**
 * Resolve an array of legacy API player objects (`{ id, firstName, lastName, owner }`)
 * into numeric `playerId`s using:
 *   1) Cached `data/bb_player_id_map.json`
 *   2) Batch `/public/ResolveIds` over known numeric IDs in `data/`
 *   3) Club roster lookup via `/team/GetTeamCard` + BBAPI (`leagues` -> `standings` -> `roster`)
 *      verified with `/public/ResolveIds`.
 *
 * Persists new mappings to `data/bb_player_id_map.json`.
 */
export async function resolvePlayerUuidsToNumericIds(players, opts = {}) {
  const mapPath = opts.mapPath || PLAYER_ID_MAP_PATH;
  const map = loadPlayerIdMap(mapPath);
  let dirty = false;

  const targetUuids = [...new Set((players || []).map((p) => p?.id).filter(Boolean))];
  const missingBeforeSeed = targetUuids.filter((u) => !map[u]);

  // Step 2: Seed from known numeric IDs on disk (only if something is missing)
  if (missingBeforeSeed.length > 0) {
    const knownNumeric = new Set(Object.values(map).map(Number));
    const diskIds = [...collectKnownNumericPlayerIdsFromDisk()].filter((n) => !knownNumeric.has(n));
    if (diskIds.length > 0) {
      const resolved = await resolveIds("player", diskIds, opts);
      for (const [numId, uuid] of resolved.entries()) {
        if (!map[uuid]) {
          map[uuid] = numId;
          dirty = true;
        }
      }
    }
  }

  // Step 3: Club lookup via GetTeamCard + BBAPI for any still-unmapped players
  const stillMissing = (players || []).filter((p) => p?.id && !map[p.id]);
  const unresolved = [];
  let newlyResolved = 0;

  if (stillMissing.length > 0) {
    const bbLogin = opts.bbapiLogin || process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
    const bbCode = opts.bbapiCode || process.env.BBAPI_CODE || "12341234";
    const { cookies, body } = await bbapiLogin(bbLogin, bbCode, DEFAULT_BBAPI_BASE);
    if (!cookies.length || /<error\b/i.test(body)) {
      throw new Error("BBAPI login failed while resolving new player IDs");
    }

    const teamCardCache = new Map();
    const leaguesCache = new Map();
    const standingsCache = new Map();
    const rosterCache = new Map();

    function getCachedTeamCard(teamUuid) {
      if (!teamCardCache.has(teamUuid)) {
        teamCardCache.set(teamUuid, getTeamCard(teamUuid, opts));
      }
      return teamCardCache.get(teamUuid);
    }

    function getLeaguesXml(countryId, level) {
      const key = `${countryId}:${level}`;
      if (!leaguesCache.has(key)) {
        leaguesCache.set(key, bbapiGet(`leagues.aspx?countryid=${countryId}&level=${level}`, cookies));
      }
      return leaguesCache.get(key);
    }

    function getStandingsXml(leagueId) {
      if (!standingsCache.has(leagueId)) {
        standingsCache.set(leagueId, bbapiGet(`standings.aspx?leagueid=${leagueId}`, cookies));
      }
      return standingsCache.get(leagueId);
    }

    function getClubRoster(bbTeamId) {
      if (!rosterCache.has(bbTeamId)) {
        rosterCache.set(
          bbTeamId,
          bbapiGet(`roster.aspx?teamid=${bbTeamId}`, cookies).then((xml) => {
            const rows = [];
            for (const m of xml.matchAll(/<player\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/player>/g)) {
              const pid = Number(m[1]);
              const blk = m[2];
              const first = decodeXmlEntities(blk.match(/<firstName>([^<]*)<\/firstName>/)?.[1] || "");
              const last = decodeXmlEntities(blk.match(/<lastName>([^<]*)<\/lastName>/)?.[1] || "");
              rows.push({ playerId: pid, fullName: `${first} ${last}`.trim() });
            }
            return rows;
          })
        );
      }
      return rosterCache.get(bbTeamId);
    }

    let nextIdx = 0;
    const concurrency = Math.min(4, stillMissing.length);
    async function worker() {
      while (nextIdx < stillMissing.length) {
        const idx = nextIdx++;
        const p = stillMissing[idx];
      if (map[p.id]) continue;
      try {
        let ownerTeamId = p.owner?.teamId;
        if (ownerTeamId === undefined) {
          const fullP = await getPlayer(p.id, opts);
          ownerTeamId = fullP?.owner?.teamId ?? null;
        }
        if (!ownerTeamId) {
          unresolved.push({ uuid: p.id, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), reason: "no owner team" });
          continue;
        }

        const card = await getCachedTeamCard(ownerTeamId);
        const country = countryByIso(card?.countryId);
        if (!country) {
          unresolved.push({ uuid: p.id, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), reason: `unknown country ${card?.countryId}` });
          continue;
        }

        const leagueName = card?.league?.name || "";
        const levelsToTry = [...new Set([parseDivisionLevel(leagueName), 1])];
        let leagueId = null;
        for (const lvl of levelsToTry) {
          const lxml = await getLeaguesXml(country.countryId, lvl);
          const targetLeagueNorm = normName(leagueName);
          const strippedLeagueNorm = normName(
            leagueName.replace(new RegExp(`^${country.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "")
          );
          for (const lm of lxml.matchAll(/<league\s+id=['"](\d+)['"][^>]*>([^<]*)<\/league>/g)) {
            const candNorm = normName(lm[2]);
            if (candNorm === targetLeagueNorm || candNorm === strippedLeagueNorm) {
              leagueId = lm[1];
              break;
            }
          }
          if (leagueId) break;
        }
        if (!leagueId) {
          unresolved.push({ uuid: p.id, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), reason: `league not found: ${leagueName}` });
          continue;
        }

        const sxml = await getStandingsXml(leagueId);
        let bbClubId = null;
        const targetTeamNorm = normName(card.name);
        for (const tm of sxml.matchAll(/<team\s+id=['"](\d+)['"][^>]*>[\s\S]*?<teamName>([^<]*)<\/teamName>/g)) {
          if (normName(tm[2]) === targetTeamNorm) {
            bbClubId = tm[1];
            break;
          }
        }
        if (!bbClubId) {
          unresolved.push({ uuid: p.id, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), reason: `club not found: ${card.name}` });
          continue;
        }

        const clubRoster = await getClubRoster(bbClubId);
        const targetPlayerNorm = normName(`${p.firstName || ""} ${p.lastName || ""}`);
        const candidates = clubRoster
          .filter((r) => normName(r.fullName) === targetPlayerNorm)
          .map((r) => r.playerId);

        const idsToVerify = candidates.length ? candidates : clubRoster.map((r) => r.playerId);
        const resolved = await resolveIds("player", idsToVerify, opts);
        let matchedNumeric = null;
        for (const [numId, uuid] of resolved.entries()) {
          if (!map[uuid]) {
            map[uuid] = numId;
            dirty = true;
          }
          if (uuid === p.id) {
            matchedNumeric = numId;
          }
        }

        if (matchedNumeric) {
          newlyResolved++;
        } else {
          unresolved.push({ uuid: p.id, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), reason: "not matched in club roster" });
        }
      } catch (e) {
        unresolved.push({
          uuid: p.id,
          name: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
          reason: e instanceof Error ? e.message : String(e),
        });
      }
      if ((idx + 1) % 25 === 0) {
        console.log(`  [id-resolver] ${idx + 1}/${stillMissing.length} checked (newlyResolved=${newlyResolved})...`);
        if (dirty) {
          savePlayerIdMap(map, mapPath);
          dirty = false;
        }
      }
    }
  }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  if (dirty) {
    savePlayerIdMap(map, mapPath);
  }

  return { map, newlyResolved, unresolved };
}
