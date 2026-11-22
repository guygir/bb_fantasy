/**
 * BuzzerBeater session login via Ory Kratos (`https://next-auth.buzzerbeater.com`),
 * matching `legacy.buzzerbeater.com` (`kratosAccount` legacy username hashing).
 *
 * No Puppeteer / no login.aspx / no reCAPTCHA needed.
 * Exports `getBuzzerbeaterCookieHeaderFromLogin()` (primary) plus Puppeteer helpers
 * (`loginToBB`, `prepareBbPage`, `launchBbBrowser`, `PUPPETEER_DEFAULT_ARGS`,
 * `BB_LOGIN_NAV_TIMEOUT_MS`) for backwards compatibility.
 *
 * Env: BBAPI_LOGIN or BB_LOGIN, BB_PASSWORD (main site password — not BBAPI_CODE)
 */

import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { launchBbBrowser, PUPPETEER_DEFAULT_ARGS } from "./puppeteer-launch.mjs";

export { launchBbBrowser, PUPPETEER_DEFAULT_ARGS };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local"), override: true });

const KRATOS_ORIGIN = "https://next-auth.buzzerbeater.com";
const LEGACY_DOMAIN = "legacybuzzerbeaterlogin.internal";
const LOGIN = process.env.BBAPI_LOGIN || process.env.BB_LOGIN || "PotatoJunior";
const PASSWORD = process.env.BB_PASSWORD;
const UA =
  process.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function navTimeoutMs() {
  const raw = process.env.BB_LOGIN_NAV_TIMEOUT_MS;
  if (raw && /^\d+$/.test(String(raw).trim())) return parseInt(String(raw).trim(), 10);
  return 45000;
}
export const BB_LOGIN_NAV_TIMEOUT_MS = navTimeoutMs();

const preparedBbPages = new WeakSet();

export async function prepareBbPage(page) {
  if (preparedBbPages.has(page)) return;
  preparedBbPages.add(page);
  await page.setUserAgent(UA);
}

/** Exact Unicode lowercase folding table from legacy.buzzerbeater.com kratosAccount JS */
const LEGACY_LOWER_MAP = new Map([
  [65, 97], [66, 98], [67, 99], [68, 100], [69, 101], [70, 102], [71, 103], [72, 104],
  [73, 105], [74, 106], [75, 107], [76, 108], [77, 109], [78, 110], [79, 111], [80, 112],
  [81, 113], [82, 114], [83, 115], [84, 116], [85, 117], [86, 118], [87, 119], [88, 120],
  [89, 121], [90, 122], [192, 224], [193, 225], [194, 226], [195, 227], [196, 228],
  [197, 229], [198, 230], [199, 231], [200, 232], [201, 233], [202, 234], [203, 235],
  [205, 237], [208, 240], [209, 241], [210, 242], [211, 243], [212, 244], [213, 245],
  [214, 246], [216, 248], [218, 250], [219, 251], [220, 252], [221, 253], [222, 254],
  [260, 261], [262, 263], [268, 269], [270, 271], [272, 273], [278, 279], [280, 281],
  [284, 285], [286, 287], [290, 291], [294, 295], [302, 303], [304, 105], [308, 309],
  [310, 311], [315, 316], [317, 318], [321, 322], [323, 324], [325, 326], [327, 328],
  [330, 331], [332, 333], [336, 337], [344, 345], [346, 347], [350, 351], [352, 353],
  [356, 357], [358, 359], [362, 363], [374, 375], [377, 378], [379, 380], [381, 382],
  [413, 626], [510, 511], [902, 940], [905, 942], [908, 972], [913, 945], [914, 946],
  [915, 947], [916, 948], [917, 949], [918, 950], [919, 951], [920, 952], [921, 953],
  [922, 954], [923, 955], [924, 956], [925, 957], [926, 958], [927, 959], [928, 960],
  [929, 961], [931, 963], [932, 964], [933, 965], [934, 966], [935, 967], [936, 968],
  [937, 969], [1025, 1105], [1026, 1106], [1030, 1110], [1031, 1111], [1032, 1112],
  [1035, 1115], [1040, 1072], [1041, 1073], [1042, 1074], [1043, 1075], [1044, 1076],
  [1045, 1077], [1046, 1078], [1047, 1079], [1048, 1080], [1049, 1081], [1050, 1082],
  [1051, 1083], [1052, 1084], [1053, 1085], [1054, 1086], [1055, 1087], [1056, 1088],
  [1057, 1089], [1058, 1090], [1059, 1091], [1060, 1092], [1061, 1093], [1062, 1094],
  [1063, 1095], [1064, 1096], [1065, 1097], [1066, 1098], [1067, 1099], [1068, 1100],
  [1069, 1101], [1070, 1102], [1071, 1103], [1170, 1171], [1174, 1175], [7844, 7845],
  [7856, 7857], [7862, 7863], [7878, 7879], [7926, 7927], [8548, 8564], [65313, 65345],
  [65314, 65346], [65315, 65347], [65316, 65348], [65317, 65349], [65319, 65351],
  [65321, 65353], [65322, 65354], [65324, 65356], [65325, 65357], [65326, 65358],
  [65327, 65359], [65329, 65361], [65330, 65362], [65331, 65363], [65332, 65364],
  [65335, 65367],
]);

export function hashLegacyIdentifier(raw) {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 32) start++;
  while (end > start && raw.charCodeAt(end - 1) === 32) end--;
  const trimmed = raw.slice(start, end);
  if (!trimmed || trimmed.toLowerCase().endsWith(`@${LEGACY_DOMAIN}`)) return null;
  let folded = "";
  for (const ch of trimmed) {
    const cp = ch.codePointAt(0);
    folded += String.fromCodePoint(LEGACY_LOWER_MAP.get(cp) ?? cp);
  }
  const digest = createHash("sha256").update(folded, "utf8").digest("hex");
  return `${digest.slice(0, 32)}@${LEGACY_DOMAIN}`;
}

function mergeCookies(jar, res) {
  const rawCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") || "").split(/,\s*(?=[^;,\s]+=)/);
  for (const line of rawCookies) {
    const first = String(line || "").split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq > 0) {
      const k = first.slice(0, eq).trim();
      const v = first.slice(eq + 1).trim();
      if (v) jar.set(k, v);
    }
  }
}

function serializeCookies(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function collectKratosMessages(flowJson) {
  const top = flowJson?.ui?.messages || [];
  const nodeMsgs = (flowJson?.ui?.nodes || []).flatMap((n) => n.messages || []);
  return [...top, ...nodeMsgs];
}

function extractHiddenFields(flowJson) {
  const out = {};
  for (const node of flowJson?.ui?.nodes || []) {
    if (node?.attributes?.type === "hidden" && node?.attributes?.name) {
      out[node.attributes.name] = node.attributes.value;
    }
  }
  return out;
}

/**
 * Login to BuzzerBeater via Ory Kratos (`next-auth.buzzerbeater.com`) and return
 * the Cookie header string (contains `ory_kratos_session=...`).
 */
export async function getBuzzerbeaterCookieHeaderFromLogin() {
  const login = (process.env.BBAPI_LOGIN || process.env.BB_LOGIN || LOGIN || "").trim();
  const password = process.env.BB_PASSWORD || PASSWORD;
  if (!login) throw new Error("BBAPI_LOGIN or BB_LOGIN is required");
  if (!password || !String(password).trim()) {
    throw new Error("BB_PASSWORD is required for BuzzerBeater login");
  }

  const jar = new Map();
  const initRes = await fetch(`${KRATOS_ORIGIN}/self-service/login/browser`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
    },
    redirect: "manual",
  });
  mergeCookies(jar, initRes);
  const flow = await initRes.json().catch(() => null);
  if (!initRes.ok || !flow?.ui?.action) {
    throw new Error(`Kratos login init failed (HTTP ${initRes.status})`);
  }

  const legacyHash = hashLegacyIdentifier(login);
  const candidates =
    /^\S+@\S+\.\S+$/.test(login) && legacyHash
      ? [login, legacyHash]
      : [legacyHash || login];

  let actionUrl = new URL(flow.ui.action, KRATOS_ORIGIN).toString();
  let hidden = extractHiddenFields(flow);
  let lastBody = null;
  let lastStatus = 0;

  for (let i = 0; i < candidates.length; i++) {
    const identifier = candidates[i];
    const postRes = await fetch(actionUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        Origin: "https://legacy.buzzerbeater.com",
        Cookie: serializeCookies(jar),
      },
      body: JSON.stringify({
        ...hidden,
        method: "password",
        identifier,
        password: String(password),
      }),
      redirect: "manual",
    });
    mergeCookies(jar, postRes);
    lastStatus = postRes.status;
    lastBody = await postRes.json().catch(() => null);

    if (postRes.ok && (lastBody?.session?.active || jar.has("ory_kratos_session"))) {
      return serializeCookies(jar);
    }

    const msgs = collectKratosMessages(lastBody);
    const invalidCreds = msgs.some((m) => m.id === 4000006);
    if (i + 1 < candidates.length && invalidCreds && lastBody?.ui?.action) {
      actionUrl = new URL(lastBody.ui.action, KRATOS_ORIGIN).toString();
      hidden = extractHiddenFields(lastBody);
      continue;
    }
    break;
  }

  const msgs = collectKratosMessages(lastBody)
    .map((m) => m.text)
    .filter(Boolean)
    .join(" ");
  throw new Error(
    msgs || lastBody?.error?.reason || `Kratos login failed (HTTP ${lastStatus})`
  );
}

/** Set Kratos session cookies onto a Puppeteer page (legacy compatibility helper). */
export async function loginToBB(page) {
  await prepareBbPage(page);
  const cookieHeader = await getBuzzerbeaterCookieHeaderFromLogin();
  const cookies = cookieHeader
    .split(";")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return null;
      return {
        name: part.slice(0, idx).trim(),
        value: part.slice(idx + 1).trim(),
        domain: ".buzzerbeater.com",
        path: "/",
        secure: true,
        httpOnly: true,
      };
    })
    .filter(Boolean);
  if (cookies.length) {
    await page.setCookie(...cookies);
  }
}
