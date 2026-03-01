/**
 * Test BBAPI login
 * Run: node scripts/test-bbapi-login.mjs
 */

const BASE = "http://bbapi.buzzerbeater.com/";
const LOGIN = process.env.BBAPI_LOGIN || "PotatoJunior";
const CODE = process.env.BBAPI_CODE || "12341234";

async function testLogin() {
  console.log("\n=== BBAPI Login Test ===\n");
  console.log("Using:", LOGIN, "/", CODE.replace(/./g, "*"));
  console.log("URL:", BASE + "login.aspx\n");

  const cookies = [];

  // Login
  const loginUrl = `${BASE}login.aspx?login=${encodeURIComponent(LOGIN)}&code=${encodeURIComponent(CODE)}`;
  const loginRes = await fetch(loginUrl, {
    redirect: "manual",
    headers: { "User-Agent": "BBFantasy/1.0" },
  });

  // Capture cookies
  const setCookie = loginRes.headers.get("set-cookie");
  if (setCookie) {
    const parts = setCookie.split(/,\s*(?=\w+=)/);
    for (const p of parts) {
      const kv = p.split(";")[0].trim();
      if (kv) cookies.push(kv);
    }
  }

  const text = await loginRes.text();

  // Check for error
  const errorMatch = text.match(/<error message='([^']+)'\/>/);
  if (errorMatch) {
    console.log("❌ Login FAILED");
    console.log("Error:", errorMatch[1]);
    if (errorMatch[1] === "NotAuthorized") {
      console.log("\nNote: BBAPI uses 'code' = read-only password from BuzzerBeater account settings.");
      console.log("Check: BuzzerBeater → My Team → Settings → API access");
    }
    process.exit(1);
  }

  console.log("✅ Login OK");
  console.log("Cookies:", cookies.length ? "received" : "none");
  if (text.includes("<bbapi")) {
    console.log("Response: valid BBAPI XML");
  }

  // Try schedule.aspx to verify session
  const scheduleUrl = `${BASE}schedule.aspx?teamid=1015`;
  const scheduleRes = await fetch(scheduleUrl, {
    headers: {
      Cookie: cookies.join("; "),
      "User-Agent": "BBFantasy/1.0",
    },
  });

  const scheduleText = await scheduleRes.text();
  const schedError = scheduleText.match(/<error message='([^']+)'\/>/);
  if (schedError) {
    console.log("\n⚠ Schedule fetch failed:", schedError[1]);
    process.exit(1);
  }

  console.log("\n✅ Schedule fetch OK (teamid=1015 Israel U21)");
  if (scheduleText.includes("<match")) {
    const matchCount = (scheduleText.match(/<match/g) || []).length;
    console.log("   Matches in response:", matchCount);
  }

  console.log("\nDone.\n");
}

testLogin().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
