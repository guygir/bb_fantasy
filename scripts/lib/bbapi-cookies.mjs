/**
 * BBAPI login and cookie extraction.
 * Works in both local and GitHub Actions (Node 18+).
 *
 * Node fetch headers.get("set-cookie") returns only the first when multiple exist.
 * We use native http(s) for login to get raw headers (all Set-Cookie) - guaranteed
 * to work in CI and locally.
 *
 * Note: bbapi.buzzerbeater.com requires HTTPS (plain http:// returns empty 301/500
 * without session cookies in Node), so http://bbapi.buzzerbeater.com is auto-upgraded.
 */
import http from "http";
import https from "https";

export const DEFAULT_BBAPI_BASE = "https://bbapi.buzzerbeater.com/";
const REQUEST_TIMEOUT_MS = 20000;

function normalizeBbapiBase(base) {
  const b = (base || DEFAULT_BBAPI_BASE).trim();
  return b.replace(/^http:\/\/bbapi\.buzzerbeater\.com\b/i, "https://bbapi.buzzerbeater.com");
}

function normalizeBbapiUrl(url, base = DEFAULT_BBAPI_BASE) {
  const resolved = url.startsWith("http")
    ? url
    : new URL(url, normalizeBbapiBase(base)).toString();
  return resolved.replace(/^http:\/\/bbapi\.buzzerbeater\.com\b/i, "https://bbapi.buzzerbeater.com");
}

function parseCookieValue(setCookieStr) {
  const part = (setCookieStr || "").split(";")[0].trim();
  return part && part.includes("=") ? part : null;
}

/**
 * Login to BBAPI and return { cookies, body }.
 * Uses native http(s) to get raw headers (all Set-Cookie) - works in GitHub Actions.
 */
export async function bbapiLogin(login, code, base = DEFAULT_BBAPI_BASE) {
  const url = new URL(
    `login.aspx?login=${encodeURIComponent(login)}&code=${encodeURIComponent(code)}`,
    normalizeBbapiBase(base)
  );
  const protocol = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = protocol.request(
      url.toString(),
      { method: "GET", headers: { "User-Agent": "BBFantasy/1.0" }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const cookies = [];
          const raw = res.rawHeaders || [];
          for (let i = 0; i < raw.length; i += 2) {
            if (raw[i].toLowerCase() === "set-cookie") {
              const kv = parseCookieValue(raw[i + 1]);
              if (kv) cookies.push(kv);
            }
          }
          resolve({ cookies, body });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`BBAPI login timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET a BBAPI URL with cookies using native http(s).
 * Use this for all BBAPI requests after bbapiLogin - avoids fetch cookie/session quirks in CI.
 */
export function bbapiGet(url, cookies, base = DEFAULT_BBAPI_BASE) {
  const fullUrl = normalizeBbapiUrl(url, base);
  const parsed = new URL(fullUrl);
  const protocol = parsed.protocol === "https:" ? https : http;
  const cookieHeader = Array.isArray(cookies) ? cookies.join("; ") : cookies;
  return new Promise((resolve, reject) => {
    const req = protocol.request(
      fullUrl,
      {
        method: "GET",
        headers: { Cookie: cookieHeader, "User-Agent": "BBFantasy/1.0" },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`BBAPI GET timed out: ${fullUrl}`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Extract cookies from fetch Response (for scripts that already use fetch for login).
 * Prefer bbapiLogin() for new code - it works everywhere.
 */
export function getCookiesFromResponse(res) {
  const cookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    for (const c of res.headers.getSetCookie()) {
      const part = parseCookieValue(c);
      if (part) cookies.push(part);
    }
  } else {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const parts = setCookie.split(/,\s*(?=[\w.]+=)/);
      for (const p of parts) {
        const part = parseCookieValue(p);
        if (part) cookies.push(part);
      }
    }
  }
  return cookies;
}
