/**
 * BBAPI client - login, schedule, boxscore
 * BBAPI uses HTTP (not HTTPS) and returns XML
 */

import { config } from "./config";

const BASE_URL = config.bbapi.baseUrl;

export class BBAPIError extends Error {
  constructor(
    message: string,
    public readonly type?: "NotAuthorized" | "ServerError" | "UnknownMatchID" | "BoxscoreNotAvailable" | "UnknownTeamID"
  ) {
    super(message);
    this.name = "BBAPIError";
  }
}

/**
 * Create a fetch that preserves cookies across requests (for Node.js)
 */
function createSession() {
  const cookies: string[] = [];

  return {
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          Cookie: cookies.join("; "),
        },
        redirect: "manual", // Don't follow redirects so we can capture Set-Cookie
      });

      // Capture Set-Cookie - can have multiple: "name1=val1; path=/, name2=val2"
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
        for (const p of parts) {
          const kv = p.split(";")[0].trim();
          if (kv && kv.includes("=") && !cookies.some((c) => c.startsWith(kv.split("=")[0] + "="))) {
            cookies.push(kv);
          }
        }
      }

      return res;
    },
    getCookies: () => cookies,
  };
}

/**
 * Login to BBAPI - returns a session with auth cookie
 */
export async function bbapiLogin(login: string, code: string): Promise<{ session: ReturnType<typeof createSession>; ok: boolean }> {
  const session = createSession();
  const url = `${BASE_URL}login.aspx?login=${encodeURIComponent(login)}&code=${encodeURIComponent(code)}`;
  const res = await session.fetch(url);

  const text = await res.text();

  // Check for error in XML
  const errorMatch = text.match(/<error message='([^']+)'\/>/);
  if (errorMatch) {
    return { session, ok: false };
  }

  // Success - login returns TeamInfo or similar when successful
  // If we get XML without error, we're good
  if (text.includes("<bbapi") && !text.includes("<error")) {
    return { session, ok: true };
  }

  return { session, ok: false };
}

/**
 * Fetch BBAPI page and parse for errors
 */
async function bbapiGet(
  session: ReturnType<typeof createSession>,
  path: string,
  params?: Record<string, string>
): Promise<string> {
  const search = params ? "?" + new URLSearchParams(params).toString() : "";
  const url = `${BASE_URL}${path}${search}`;
  const res = await session.fetch(url);
  const text = await res.text();

  const errorMatch = text.match(/<error message='([^']+)'\/>/);
  if (errorMatch) {
    throw new BBAPIError(`BBAPI error: ${errorMatch[1]}`, errorMatch[1] as BBAPIError["type"]);
  }

  return text;
}

/**
 * Get schedule for a team/season
 */
export async function bbapiSchedule(
  session: ReturnType<typeof createSession>,
  teamId: number,
  season?: number
): Promise<string> {
  const params: Record<string, string> = { teamid: String(teamId) };
  if (season != null) params.season = String(season);
  return bbapiGet(session, "schedule.aspx", params);
}

/**
 * Get player info (position, DMI, salary)
 */
export async function bbapiPlayer(
  session: ReturnType<typeof createSession>,
  playerId: number
): Promise<string> {
  return bbapiGet(session, "player.aspx", { playerid: String(playerId) });
}

/**
 * Get boxscore for a match
 */
export async function bbapiBoxscore(
  session: ReturnType<typeof createSession>,
  matchId: number
): Promise<string> {
  return bbapiGet(session, "boxscore.aspx", { matchid: String(matchId) });
}

/**
 * Full flow: login and fetch schedule for Israel U21
 */
export async function fetchIsraelU21Schedule(season?: number): Promise<{ ok: boolean; xml?: string; error?: string }> {
  const { session, ok } = await bbapiLogin(config.bbapi.login, config.bbapi.code);
  if (!ok) {
    return { ok: false, error: "BBAPI login failed (wrong credentials or NotAuthorized)" };
  }

  try {
    const xml = await bbapiSchedule(session, config.game.israelU21TeamId, season);
    return { ok: true, xml };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof BBAPIError ? e.message : String(e),
    };
  }
}
