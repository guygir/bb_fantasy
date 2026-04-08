/**
 * Scrape Israel League II or III: top 3 per conference per league, exclude bots, rank, keep top 32, store in Supabase.
 * Run: node scripts/fetch-promotions-leagues.mjs [league3|league2]
 * Default: league3 (1004–1019). league2 → 1000–1003.
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const TIERS = {
  league3: { leagueMin: 1004, leagueMax: 1019, label: "League III" },
  league2: { leagueMin: 1000, leagueMax: 1003, label: "League II" },
};

/** Rows after header: 1st, 2nd, 3rd in conference standings */
const TOP_PER_CONF = 3;
/** After ranking all scraped teams, keep only this many for the site and DB */
const DISPLAY_TOP_N = 32;
const FETCH_TIMEOUT_MS = 25000;
const USER_AGENT = "Mozilla/5.0 (compatible; BBIsraelFantasy/1.0; +https://github.com)";
const BB_ORIGIN = "https://buzzerbeater.com";
/** Matches logobox text on team page (case-insensitive, whitespace normalized) */
const BOT_PHRASE = "managed by a computerized player";
/** Parallel team page fetches per batch (avoid hammering BB) */
const TEAM_BOT_CHECK_CONCURRENCY = 6;

/** Resolve relative /team/... links from standings HTML */
function resolveTeamPageUrl(href) {
  if (!href || typeof href !== "string") return null;
  const t = href.trim();
  if (!t) return null;
  try {
    return new URL(t, BB_ORIGIN).href;
  } catch {
    return null;
  }
}

function parseTdInt(text) {
  const n = parseInt(String(text).replace(/[^-\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseStandingsRow($, tr) {
  const tds = $(tr).find("td");
  if (tds.length < 8) return null;
  const rank = parseTdInt($(tds[0]).text());
  const teamCell = $(tds[1]);
  const link = teamCell.find("a").first();
  const teamName = link.text().trim() || teamCell.text().trim();
  const teamUrl = resolveTeamPageUrl(link.attr("href"));
  const wins = parseTdInt($(tds[2]).text());
  const losses = parseTdInt($(tds[3]).text());
  const pd = parseTdInt($(tds[7]).text());
  if (!teamName || rank < 1) return null;
  return { conf_rank: rank, team_name: teamName, team_url: teamUrl, wins, losses, pd };
}

function parseLeaguePage(html) {
  const $ = load(html);
  const leagueName = $("#titlebar h1").first().text().replace(/\s+/g, " ").trim() || "League";

  const lis = $("#standings ul.leagueStandings > li");
  if (lis.length < 2) {
    return { leagueName, rows: [] };
  }

  const rows = [];
  for (let conf = 1; conf <= 2; conf++) {
    const trs = $(lis[conf - 1]).find("table.standings tr");
    for (let i = 1; i <= TOP_PER_CONF; i++) {
      const tr = trs.eq(i);
      if (!tr.length) continue;
      const parsed = parseStandingsRow($, tr);
      if (parsed) rows.push({ ...parsed, conf });
    }
  }
  return { leagueName, rows };
}

async function fetchLeague(leagueId) {
  const url = `https://buzzerbeater.com/league/${leagueId}/overview.aspx`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const { leagueName, rows } = parseLeaguePage(html);
    return { leagueId, leagueName, rows, error: null };
  } catch (e) {
    return {
      leagueId,
      leagueName: "",
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchTeamPageIsBot(teamUrl) {
  if (!teamUrl) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(teamUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return false;
    const html = await res.text();
    const $ = load(html);
    const text = $("#logobox").text().replace(/\s+/g, " ").trim().toLowerCase();
    return text.includes(BOT_PHRASE);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function rankAndTakeTop(teams, topN) {
  const sorted = [...teams].sort((a, b) => {
    if (a.conf_rank !== b.conf_rank) return a.conf_rank - b.conf_rank;
    if (a.wins !== b.wins) return b.wins - a.wins;
    return b.pd - a.pd;
  });
  return sorted.slice(0, topN).map((t, i) => ({ ...t, display_rank: i + 1 }));
}

async function pruneOldSnapshots(supabase, tierId) {
  const { data: snapList, error: listErr } = await supabase
    .from("promotions_snapshots")
    .select("id")
    .eq("tier", tierId)
    .order("created_at", { ascending: false });
  if (listErr) {
    console.warn(`Cleanup list snapshots (${tierId}):`, listErr.message);
    return;
  }
  if (snapList && snapList.length > 2) {
    const toDelete = snapList.slice(2).map((s) => s.id);
    const { error: delErr } = await supabase.from("promotions_snapshots").delete().in("id", toDelete);
    if (delErr) {
      console.warn(`Cleanup old snapshots (${tierId}):`, delErr.message);
    }
  }
}

async function runTier(supabase, tierId) {
  const cfg = TIERS[tierId];
  if (!cfg) {
    console.error(`Unknown tier "${tierId}". Use: league3 | league2`);
    process.exit(1);
  }
  const { leagueMin: LEAGUE_MIN, leagueMax: LEAGUE_MAX, label } = cfg;

  console.log(`\n=== ${label} (${tierId}) — leagues ${LEAGUE_MIN}–${LEAGUE_MAX} ===\n`);

  const all = [];

  for (let leagueId = LEAGUE_MIN; leagueId <= LEAGUE_MAX; leagueId++) {
    const r = await fetchLeague(leagueId);
    if (r.error) {
      console.warn(`League ${leagueId}: ${r.error}`);
    }
    for (const row of r.rows) {
      all.push({
        league_id: leagueId,
        league_name: r.leagueName,
        conf: row.conf,
        conf_rank: row.conf_rank,
        team_name: row.team_name,
        team_url: row.team_url,
        wins: row.wins,
        losses: row.losses,
        pd: row.pd,
      });
    }
    process.stdout.write(leagueId === LEAGUE_MAX ? ".\n" : ".");
  }

  console.log(
    `Collected ${all.length} teams (${LEAGUE_MAX - LEAGUE_MIN + 1} leagues × up to ${TOP_PER_CONF * 2} per league). Checking team pages for bots…`
  );
  for (let i = 0; i < all.length; i += TEAM_BOT_CHECK_CONCURRENCY) {
    const chunk = all.slice(i, i + TEAM_BOT_CHECK_CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        row.is_bot = await fetchTeamPageIsBot(row.team_url);
      })
    );
    process.stdout.write(".");
  }
  console.log();

  const botsConfRank1 = all.filter((r) => r.is_bot && r.conf_rank === 1);
  console.log("\nBots with conference rank 1 (excluded from ranking):");
  if (botsConfRank1.length === 0) {
    console.log("  (none)");
  } else {
    for (const r of botsConfRank1) {
      console.log(`  - ${r.team_name} (${r.league_name}, league ${r.league_id}, conf ${r.conf})`);
    }
  }
  console.log();

  const eligible = all.filter((r) => !r.is_bot);
  console.log(
    `Eligible (non-bot): ${eligible.length} / ${all.length}; storing top ${DISPLAY_TOP_N} after ranking.`
  );
  const ranked = rankAndTakeTop(eligible, DISPLAY_TOP_N);

  const { data: snap, error: snapErr } = await supabase
    .from("promotions_snapshots")
    .insert({ tier: tierId })
    .select("id")
    .single();
  if (snapErr || !snap) {
    console.error("promotions_snapshots insert:", snapErr?.message);
    process.exit(1);
  }

  const entryRows = ranked.map((t) => ({
    snapshot_id: snap.id,
    display_rank: t.display_rank,
    league_id: t.league_id,
    conf: t.conf,
    conf_rank: t.conf_rank,
    team_name: t.team_name,
    team_url: t.team_url,
    wins: t.wins,
    losses: t.losses,
    pd: t.pd,
    league_name: t.league_name,
  }));

  const { error: insErr } = await supabase.from("promotions_entries").insert(entryRows);
  if (insErr) {
    console.error("promotions_entries insert:", insErr.message);
    process.exit(1);
  }

  await pruneOldSnapshots(supabase, tierId);

  console.log(`OK [${tierId}]: snapshot ${snap.id}, ${entryRows.length} rows.`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const arg = process.argv[2]?.toLowerCase();

  if (arg === "league2") {
    await runTier(supabase, "league2");
  } else if (arg === "league3" || !arg) {
    await runTier(supabase, "league3");
  } else if (arg === "all") {
    await runTier(supabase, "league3");
    await runTier(supabase, "league2");
  } else {
    console.error(`Usage: node scripts/fetch-promotions-leagues.mjs [league3|league2|all]\n  Default: league3`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
