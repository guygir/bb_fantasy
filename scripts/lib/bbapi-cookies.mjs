/**
 * BBAPI login and cookie extraction.
 * Works in both local and GitHub Actions (Node 18+).
 *
 * Node fetch headers.get("set-cookie") returns only the first when multiple exist.
 * We use native http(s) for login to get raw headers (all Set-Cookie) - guaranteed
 * to work in CI and locally.
 */
import http from "http";
import https from "https";

function parseCookieValue(setCookieStr) {
  const part = (setCookieStr || "").split(";")[0].trim();
  return part && part.includes("=") ? part : null;
}

/**
 * Login to BBAPI and return { cookies, body }.
 * Uses native http(s) to get raw headers (all Set-Cookie) - works in GitHub Actions.
 */
export async function bbapiLogin(login, code, base = "http://bbapi.buzzerbeater.com/") {
  const url = new URL(`login.aspx?login=${encodeURIComponent(login)}&code=${encodeURIComponent(code)}`, base);
  const protocol = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = protocol.request(
      url.toString(),
      { method: "GET", headers: { "User-Agent": "BBFantasy/1.0" } },
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
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET a BBAPI URL with cookies using native http(s).
 * Use this for all BBAPI requests after bbapiLogin - avoids fetch cookie/session quirks in CI.
 */
export function bbapiGet(url, cookies, base = "http://bbapi.buzzerbeater.com/") {
  const fullUrl = url.startsWith("http") ? url : new URL(url, base).toString();
  const parsed = new URL(fullUrl);
  const protocol = parsed.protocol === "https:" ? https : http;
  const cookieHeader = Array.isArray(cookies) ? cookies.join("; ") : cookies;
  return new Promise((resolve, reject) => {
    const req = protocol.request(
      fullUrl,
      {
        method: "GET",
        headers: { Cookie: cookieHeader, "User-Agent": "BBFantasy/1.0" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
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
