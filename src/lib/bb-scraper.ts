/**
 * Server-side BB site scraper — TypeScript port of the HTTP-fetch login from
 * scripts/lib/bb-site-session.mjs, plus HTML scrapers for rosters and player history.
 *
 * Uses BB_PASSWORD env var. No Puppeteer — pure HTTP fetch.
 * Injury data is scraped from the BB site overview page (not BBAPI).
 */

import { getGameWeek, isCountingGame } from "./bb-countries";

const BB_BASE = "https://buzzerbeater.com";
const BB_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface RosterPlayer {
  playerId: number;
  name: string;
}

export interface GameLogEntry {
  date: string;
  position: string;
  minutes: number;
  fgMade: number;
  fgAtt: number;
  tpMade: number;
  tpAtt: number;
  ftMade: number;
  ftAtt: number;
  oreb: number;
  treb: number;
  ast: number;
  to: number;
  stl: number;
  blk: number;
  pf: number;
  pts: number;
  rating: number | null;
  gameType: string;
}

export interface SeasonGameLog {
  season: number;
  games: GameLogEntry[];
}

/**
 * Parse injury days remaining from a BuzzerBeater player overview page.
 * Returns a display string like "3-6" or "1", or "" if the player is healthy.
 */
function parseInjuryDaysFromHtml(html: string): string {
  const head = html.match(/Injury!/i);
  if (!head || head.index == null) return "";
  const slice = html.slice(head.index, head.index + 900);
  const plain = slice
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const range = plain.match(/(\d+)\s*[-–]\s*(\d+)\s*days?/i);
  if (range) return `${range[1]}-${range[2]}`;
  const single = plain.match(/(\d+)\s*days?/i);
  if (single) return single[1];
  return "1"; // "Injury!" found but no day count — show at least 1
}

/** Parse a single hidden input value from HTML */
function parseHiddenField(html: string, name: string): string {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i");
  return (html.match(re) ?? html.match(re2))?.[1] ?? "";
}

function parseMadeAtt(val: string): [number, number] {
  const m = String(val).match(/^(\d+)-(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

/**
 * HTTP-only login to buzzerbeater.com.
 * GET login.aspx → extract ASP.NET tokens → POST credentials → return cookie header.
 */
export async function bbSiteLogin(): Promise<string> {
  const password = process.env.BB_PASSWORD?.trim();
  const login = process.env.BBAPI_LOGIN?.trim() || process.env.BB_LOGIN?.trim() || "PotatoJunior";
  if (!password) {
    throw new Error("BB_PASSWORD environment variable is required for BB site login");
  }

  const loginUrl = `${BB_BASE}/login.aspx`;

  const res1 = await fetch(loginUrl, {
    headers: { "User-Agent": BB_UA, Accept: "text/html,*/*;q=0.9" },
    redirect: "follow",
  });
  if (!res1.ok) throw new Error(`GET login.aspx returned HTTP ${res1.status}`);
  const html1 = await res1.text();

  const getCookies = (res: Response): string => {
    const raw =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie().join("; ")
        : (res.headers.get("set-cookie") ?? "");
    return raw
      .split(/,(?=[^;]+=[^;]+;)/)
      .map((s) => s.trim().split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  };

  const cookies1 = getCookies(res1);
  const viewstate = parseHiddenField(html1, "__VIEWSTATE");
  const viewstateGen = parseHiddenField(html1, "__VIEWSTATEGENERATOR");
  const eventVal = parseHiddenField(html1, "__EVENTVALIDATION");

  if (!viewstate) {
    throw new Error("Could not extract __VIEWSTATE from login page — page structure may have changed");
  }

  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewstate,
    __VIEWSTATEGENERATOR: viewstateGen,
    __EVENTVALIDATION: eventVal,
    "ctl00$cphContent$txtUserName": login,
    "ctl00$cphContent$txtPassword": password,
    "ctl00$cphContent$btnLoginUser": "Login",
  });

  const res2 = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "User-Agent": BB_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,*/*;q=0.9",
      Referer: loginUrl,
      ...(cookies1 ? { Cookie: cookies1 } : {}),
    },
    body: body.toString(),
    redirect: "manual",
  });

  const location = res2.headers.get("location") ?? "";
  const cookies2 = getCookies(res2);

  if (!location.toLowerCase().includes("home.aspx") && res2.status !== 302) {
    throw new Error(
      `BB login failed (HTTP ${res2.status}, redirect: "${location}"). Check BB_PASSWORD.`
    );
  }

  const allCookies = [cookies1, cookies2].filter(Boolean).join("; ");
  if (!allCookies.trim()) throw new Error("No session cookies returned by login POST");
  return allCookies;
}

/**
 * Fetch the U21 national team roster for a given country (1–98).
 * Returns team name and player list.
 */
export async function fetchCountryRoster(
  countryId: number,
  cookieHeader: string
): Promise<{ teamName: string; players: RosterPlayer[] }> {
  const url = `${BB_BASE}/country/${countryId}/jnt/players.aspx`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": BB_UA,
      Accept: "text/html,*/*;q=0.9",
      Cookie: cookieHeader,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch roster page: HTTP ${res.status}`);
  const html = await res.text();

  if (/login\.css|<title>\s*Login\s*<|cphContent_txtUserName/i.test(html)) {
    throw new Error("Roster page returned login wall — session may have expired");
  }

  // Team name from <h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const teamName = h1Match ? h1Match[1].replace(/&nbsp;/g, " ").trim() : `Country ${countryId} U21 National Team`;

  // Player links: href="../../../player/ID/overview.aspx" or href="/player/ID/overview.aspx"
  const seen = new Set<number>();
  const players: RosterPlayer[] = [];
  const linkRe = /href=["'][^"']*\/player\/(\d+)\/overview\.aspx["'][^>]*>([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const playerId = parseInt(m[1], 10);
    const name = m[2].replace(/&nbsp;/g, " ").trim();
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    if (!name || name.toLowerCase().includes("season average")) continue;
    players.push({ playerId, name });
  }

  return { teamName, players };
}

/** Parse a game log table row into a GameLogEntry. Returns null if not a valid game row. */
function parseGameRow(tr: string): GameLogEntry | null {
  const cells = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
  if (!cells || cells.length < 14) return null;

  const getText = (cell: string) =>
    cell.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

  const col = cells.map(getText);

  // col[0] = date (M/D/YYYY), col[1] = position, col[2] = minutes
  if (!col[0]?.match(/^\d+\/\d+\/\d{4}$/)) return null;

  const [fgMade, fgAtt] = parseMadeAtt(col[3] ?? "");
  const [tpMade, tpAtt] = parseMadeAtt(col[4] ?? "");
  const [ftMade, ftAtt] = parseMadeAtt(col[5] ?? "");

  // Columns: date pos min FG 3P FT oreb treb ast to stl blk pf pts [rating] gameType
  const hasRating = cells.length >= 16;
  const ratingRaw = hasRating ? col[14] : null;
  const gameType = hasRating ? (col[15] ?? "") : (col[14] ?? "");

  return {
    date: col[0],
    position: col[1] ?? "",
    minutes: parseInt(col[2] ?? "0", 10) || 0,
    fgMade,
    fgAtt,
    tpMade,
    tpAtt,
    ftMade,
    ftAtt,
    oreb: parseFloat(col[6] ?? "0") || 0,
    treb: parseFloat(col[7] ?? "0") || 0,
    ast: parseFloat(col[8] ?? "0") || 0,
    to: parseFloat(col[9] ?? "0") || 0,
    stl: parseFloat(col[10] ?? "0") || 0,
    blk: parseFloat(col[11] ?? "0") || 0,
    pf: parseFloat(col[12] ?? "0") || 0,
    pts: parseFloat(col[13] ?? "0") || 0,
    rating: ratingRaw !== null ? (parseFloat(ratingRaw) || null) : null,
    gameType,
  };
}

function parseGameLogHtml(html: string): GameLogEntry[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const games: GameLogEntry[] = [];
  for (const tr of rows) {
    const entry = parseGameRow(tr);
    if (entry) games.push(entry);
  }
  return games;
}

export interface GameLogResult {
  games: GameLogEntry[];
  /** Injury label parsed from overview HTML, e.g. "3-6" or "1". Empty string = healthy. */
  injuryDays: string;
}

/**
 * Fetch a player's game log for a specific season using ASP.NET postback.
 * Also returns injury days parsed from the page HTML (no extra request needed).
 * Requires a valid cookie header from bbSiteLogin().
 */
export async function fetchPlayerGameLog(
  playerId: number,
  season: number,
  cookieHeader: string
): Promise<GameLogResult> {
  const overviewUrl = `${BB_BASE}/player/${playerId}/overview.aspx`;

  // Step 1: GET to obtain VIEWSTATE tokens and current injury status
  const res1 = await fetch(overviewUrl, {
    headers: {
      "User-Agent": BB_UA,
      Accept: "text/html,*/*;q=0.9",
      Cookie: cookieHeader,
    },
    redirect: "follow",
  });
  if (!res1.ok) throw new Error(`Failed to fetch player overview: HTTP ${res1.status}`);
  const html1 = await res1.text();

  if (/login\.css|<title>\s*Login\s*</i.test(html1)) {
    throw new Error("Player overview returned login wall — session may have expired");
  }

  // Parse injury from the initial GET — it always reflects current status regardless of season
  const injuryDays = parseInjuryDaysFromHtml(html1);

  const viewstate = parseHiddenField(html1, "__VIEWSTATE");
  const viewstateGen = parseHiddenField(html1, "__VIEWSTATEGENERATOR");
  const eventVal = parseHiddenField(html1, "__EVENTVALIDATION");

  const currentSeasonMatch = html1.match(/<option[^>]*selected[^>]*value=["'](\d+)["']/i);
  const currentSeason = currentSeasonMatch ? parseInt(currentSeasonMatch[1], 10) : null;

  if (currentSeason === season) {
    return { games: parseGameLogHtml(html1), injuryDays };
  }

  // Step 2: POST with season dropdown change (ASP.NET __doPostBack equivalent)
  const body = new URLSearchParams({
    __EVENTTARGET: "ctl00$cphContent$ddlSeasons",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: viewstate,
    __VIEWSTATEGENERATOR: viewstateGen,
    __EVENTVALIDATION: eventVal,
    "ctl00$cphContent$ddlSeasons": String(season),
  });

  const res2 = await fetch(overviewUrl, {
    method: "POST",
    headers: {
      "User-Agent": BB_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,*/*;q=0.9",
      Referer: overviewUrl,
      Cookie: cookieHeader,
    },
    body: body.toString(),
    redirect: "follow",
  });
  if (!res2.ok) throw new Error(`Season postback failed: HTTP ${res2.status}`);
  const html2 = await res2.text();
  return { games: parseGameLogHtml(html2), injuryDays };
}

/**
 * Fetch only the injury label for a player from their BB site overview page.
 * Returns a display string like "3-6" or "1", or "" if healthy.
 */
export async function fetchPlayerInjuryFromSite(
  playerId: number,
  cookieHeader: string
): Promise<string> {
  try {
    const url = `${BB_BASE}/player/${playerId}/overview.aspx`;
    const res = await fetch(url, {
      headers: { "User-Agent": BB_UA, Accept: "text/html,*/*;q=0.9", Cookie: cookieHeader },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = await res.text();
    if (/login\.css|<title>\s*Login\s*</i.test(html)) return "";
    return parseInjuryDaysFromHtml(html);
  } catch {
    return "";
  }
}

/**
 * Fetch a player's name from their overview page.
 */
export async function fetchPlayerName(playerId: number, cookieHeader: string): Promise<string> {
  const url = `${BB_BASE}/player/${playerId}/overview.aspx`;
  const res = await fetch(url, {
    headers: { "User-Agent": BB_UA, Accept: "text/html,*/*;q=0.9", Cookie: cookieHeader },
    redirect: "follow",
  });
  if (!res.ok) return `Player ${playerId}`;
  const html = await res.text();
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return h1 ? h1[1].replace(/&nbsp;/g, " ").trim() : `Player ${playerId}`;
}

export interface WeekPositionMinutes {
  /** week number 1–14 */
  week: number;
  /** position string e.g. "PG" */
  position: string;
  minutes: number;
}

/**
 * Compute aggregations from game log entries across multiple seasons.
 * Only counting games (not BBM / National Team) contribute to minutes.
 */
export function aggregateGameLogs(seasonLogs: SeasonGameLog[]) {
  const minutesByPosition: Record<string, number> = {};
  const minutesBySeason: Record<number, number> = {};
  const gamesBySeason: Record<number, number> = {};
  /** season → week → position → minutes.
   *  Week 0 is a special key used when a game's date belongs to the previous season
   *  but that season is not loaded (first season in our dataset). */
  const minutesBySeasonWeekPosition: Record<number, Record<number, Record<string, number>>> = {};
  /** season → position → minutes */
  const minutesBySeasonPosition: Record<number, Record<string, number>> = {};
  /** season → minutes that could not be attributed to any season window */
  const minutesOutsideWindow: Record<number, number> = {};

  // Which seasons we have logs for — used to decide cross-season attribution vs W0
  const availableSeasons = new Set(seasonLogs.map((sl) => sl.season));

  // Pre-initialise structures for every season so later cross-attribution can safely write
  for (const { season, games } of seasonLogs) {
    gamesBySeason[season] = games.length;
    minutesBySeasonWeekPosition[season] ??= {};
    minutesBySeasonPosition[season] ??= {};
    minutesOutsideWindow[season] ??= 0;
  }

  for (const { season, games } of seasonLogs) {
    let seasonMinutes = 0;

    for (const g of games) {
      if (!isCountingGame(g.gameType)) continue;

      const week = getGameWeek(g.date, season);

      if (week !== null) {
        // ── Normal case: game falls inside this season's 98-day window ──
        seasonMinutes += g.minutes;
        if (g.position) {
          minutesByPosition[g.position] = (minutesByPosition[g.position] ?? 0) + g.minutes;
          minutesBySeasonPosition[season][g.position] =
            (minutesBySeasonPosition[season][g.position] ?? 0) + g.minutes;
          const wm = (minutesBySeasonWeekPosition[season][week] ??= {});
          wm[g.position] = (wm[g.position] ?? 0) + g.minutes;
        }
      } else {
        // ── Game falls outside this season's window ──
        // Check whether it belongs to the previous season (most common: pre-season games
        // logged under Season X but dated in Season X-1's final week).
        const prevWeek = getGameWeek(g.date, season - 1);

        if (prevWeek !== null) {
          if (availableSeasons.has(season - 1)) {
            // Attribute to the previous season at the correct week (usually W14)
            if (g.position) {
              minutesByPosition[g.position] = (minutesByPosition[g.position] ?? 0) + g.minutes;
              minutesBySeasonPosition[season - 1][g.position] =
                (minutesBySeasonPosition[season - 1][g.position] ?? 0) + g.minutes;
              const wm = (minutesBySeasonWeekPosition[season - 1][prevWeek] ??= {});
              wm[g.position] = (wm[g.position] ?? 0) + g.minutes;
            }
            // Do NOT add to seasonMinutes — it belongs to the previous season
          } else {
            // Previous season not loaded → W0 (special "pre-first-season" slot)
            seasonMinutes += g.minutes;
            if (g.position) {
              minutesByPosition[g.position] = (minutesByPosition[g.position] ?? 0) + g.minutes;
              minutesBySeasonPosition[season][g.position] =
                (minutesBySeasonPosition[season][g.position] ?? 0) + g.minutes;
              const wm = (minutesBySeasonWeekPosition[season][0] ??= {});
              wm[g.position] = (wm[g.position] ?? 0) + g.minutes;
            }
          }
        } else {
          // Truly outside every known window — track but do not include in any chart/table
          minutesOutsideWindow[season] += g.minutes;
          seasonMinutes += g.minutes;
        }
      }
    }
    minutesBySeason[season] = seasonMinutes;
  }

  return {
    minutesByPosition,
    minutesBySeason,
    gamesBySeason,
    minutesBySeasonWeekPosition,
    minutesBySeasonPosition,
    minutesOutsideWindow,
  };
}

export interface PlayerInfo {
  playerId: number;
  firstName: string;
  lastName: string;
  age: number | null;
  height: number | null;
  dmi: number | null;
  salary: number | null;
  bestPosition: string | null;
  gameShape: number | null;
  potential: number | null;
  /** Injury label like "3-6" or "1". Empty string or null = healthy. */
  injuryDaysRemaining: string | null;
}

const BBAPI_BASE = "https://bbapi.buzzerbeater.com/";

function extractBBAPICookies(res: Response): string {
  const rawCookies: string[] =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,\s*(?=[A-Za-z0-9_]+=)/);
  return rawCookies
    .map((s) => s.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Login to the BuzzerBeater API and return a session cookie string.
 * Call once and reuse the cookie for multiple player fetches.
 */
export async function bbapiLogin(): Promise<string> {
  const login = process.env.BBAPI_LOGIN?.trim() || process.env.BB_LOGIN?.trim() || "PotatoJunior";
  const code = process.env.BBAPI_CODE?.trim() || "12341234";
  const loginRes = await fetch(
    `${BBAPI_BASE}login.aspx?login=${encodeURIComponent(login)}&code=${encodeURIComponent(code)}`,
    { redirect: "manual" }
  );
  const cookieHeader = extractBBAPICookies(loginRes);
  const loginText = await loginRes.text();
  if (!loginText.includes("<bbapi") || loginText.includes("<error")) {
    throw new Error("BBAPI login failed");
  }
  return cookieHeader;
}

/**
 * Fetch full player info from BBAPI (age, DMI, salary, etc.).
 * Uses redirect:"manual" on the player fetch — do not remove, it was working.
 * Injury comes from injuryDays returned by fetchPlayerGameLog (BB site HTML).
 */
export async function fetchPlayerInfoFromBBAPI(playerId: number): Promise<PlayerInfo | null> {
  try {
    const cookieHeader = await bbapiLogin();

    const playerRes = await fetch(`${BBAPI_BASE}player.aspx?playerid=${playerId}`, {
      headers: { Cookie: cookieHeader },
      redirect: "follow",
    });
    const xml = await playerRes.text();
    if (!xml.includes("<player") || xml.includes("<error")) return null;

    const tag = (name: string) => xml.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`))?.[1] ?? null;
    const num = (name: string) => { const v = tag(name); return v !== null ? parseInt(v, 10) : null; };

    return {
      playerId,
      firstName: tag("firstName") ?? "",
      lastName: tag("lastName") ?? "",
      age: num("age"),
      height: num("height"),
      dmi: num("dmi"),
      salary: num("salary"),
      bestPosition: tag("bestPosition"),
      gameShape: num("gameShape"),
      potential: num("potential"),
      injuryDaysRemaining: null, // filled in by caller from fetchPlayerGameLog's injuryDays
    };
  } catch {
    return null;
  }
}
