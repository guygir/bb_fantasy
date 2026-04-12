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
import { parsePlayoffStatusForTeam, parseTrophyTeamId } from "./lib/playoff-bracket.mjs";

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

/** BuzzerBeater team id from a team overview URL, or null */
function parseTeamIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/team\/(\d+)\//i);
  return m ? parseInt(m[1], 10) : null;
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
  const teamClass = (teamCell.attr("class") || "").trim();
  /** League III: BB marks CPU teams with `teamName isbot` on the standings cell */
  const is_bot_standings = /\bisbot\b/.test(teamClass);
  const link = teamCell.find("a").first();
  const teamName = link.text().trim() || teamCell.text().trim();
  const teamUrl = resolveTeamPageUrl(link.attr("href"));
  const wins = parseTdInt($(tds[2]).text());
  const losses = parseTdInt($(tds[3]).text());
  const pd = parseTdInt($(tds[7]).text());
  if (!teamName || rank < 1) return null;
  return {
    conf_rank: rank,
    team_name: teamName,
    team_url: teamUrl,
    wins,
    losses,
    pd,
    is_bot_standings,
  };
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

async function fetchLeagueOverviewHtml(leagueId) {
  const url = `https://buzzerbeater.com/league/${leagueId}/overview.aspx`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** True if all 16 team rows in both conferences are CPU (team cell class isbot). */
function isLeagueFullyBot(html) {
  const $ = load(html);
  const lis = $("#standings ul.leagueStandings > li");
  if (lis.length < 2) return false;
  const bots = [];
  for (let conf = 0; conf < 2; conf++) {
    $(lis[conf])
      .find("table.standings tr")
      .each((i, tr) => {
        if (i === 0) return;
        const tds = $(tr).find("td");
        if (tds.length < 8) return;
        const teamCell = $(tds[1]);
        const cls = (teamCell.attr("class") || "").trim();
        bots.push(/\bisbot\b/.test(cls));
      });
  }
  if (bots.length !== 16) return false;
  return bots.every(Boolean);
}

/** League III: 20 L2 demotion slots; band = 20 − (16 − #bot leagues) */
function promotionBandSizeLeague3(numBotLeagues) {
  const n = 20 - (16 - numBotLeagues);
  return Math.max(0, Math.min(32, n));
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

  let numBotLeagues = 0;
  let promotionBandSize = 5;

  const all = [];
  /** League III: overview HTML per league (playoff bracket parsing). */
  const leagueHtmlById = new Map();
  process.stdout.write("Fetching league overviews…");
  for (let leagueId = LEAGUE_MIN; leagueId <= LEAGUE_MAX; leagueId++) {
    const html = await fetchLeagueOverviewHtml(leagueId);
    leagueHtmlById.set(leagueId, html);
    if (!html) {
      console.warn(`\nLeague ${leagueId}: failed to fetch`);
      process.stdout.write("x");
      continue;
    }
    if (tierId === "league3" && isLeagueFullyBot(html)) {
      numBotLeagues += 1;
    }
    const { leagueName, rows } = parseLeaguePage(html);
    for (const row of rows) {
      all.push({
        league_id: leagueId,
        league_name: leagueName,
        conf: row.conf,
        conf_rank: row.conf_rank,
        team_name: row.team_name,
        team_url: row.team_url,
        wins: row.wins,
        losses: row.losses,
        pd: row.pd,
        is_bot_standings: row.is_bot_standings,
      });
    }
    process.stdout.write(leagueId === LEAGUE_MAX ? ".\n" : ".");
  }

  if (tierId === "league3") {
    promotionBandSize = promotionBandSizeLeague3(numBotLeagues);
    console.log(
      `Bot leagues (all 16 teams CPU): ${numBotLeagues} / ${LEAGUE_MAX - LEAGUE_MIN + 1} → promotion band size = 20 − (16 − ${numBotLeagues}) = ${promotionBandSize}`
    );
    const champLines = [];
    for (const [lid, h] of leagueHtmlById) {
      if (!h) continue;
      const tid = parseTrophyTeamId(h);
      if (tid != null) champLines.push(`league ${lid}: team ${tid}`);
    }
    if (champLines.length > 0) {
      console.log(`Playoff champions (trophy link): ${champLines.join("; ")}`);
    } else {
      console.log("Playoff champions (trophy link): (none — no #cphContent_playoffs_trophy on any league overview)");
    }
  }

  if (tierId === "league3") {
    console.log(
      `Collected ${all.length} teams (${LEAGUE_MAX - LEAGUE_MIN + 1} leagues × up to ${TOP_PER_CONF * 2} per league). Bot detection: standings team cell class "isbot" (no per-team page fetches).`
    );
    let botsFromStandings = 0;
    for (const row of all) {
      row.is_bot = row.is_bot_standings === true;
      if (row.is_bot) botsFromStandings += 1;
    }
    console.log(`  CPU teams (isbot) in scraped rows: ${botsFromStandings}`);
  } else {
    console.log(
      `Collected ${all.length} teams (${LEAGUE_MAX - LEAGUE_MIN + 1} leagues × up to ${TOP_PER_CONF * 2} per league). Checking team pages for bots (League II)…`
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
  }

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

  const snapPayload =
    tierId === "league3"
      ? { tier: tierId, promotion_band_size: promotionBandSize, num_bot_leagues: numBotLeagues }
      : { tier: tierId, promotion_band_size: 5, num_bot_leagues: null };

  const { data: snap, error: snapErr } = await supabase
    .from("promotions_snapshots")
    .insert(snapPayload)
    .select("id")
    .single();
  if (snapErr || !snap) {
    console.error("promotions_snapshots insert:", snapErr?.message);
    process.exit(1);
  }

  const entryRows = ranked.map((t) => {
    let playoff_status = "Not in playoff";
    if (tierId === "league3") {
      const h = leagueHtmlById.get(t.league_id);
      const rowTeamId = parseTeamIdFromUrl(t.team_url);
      if (h && rowTeamId != null) {
        playoff_status = parsePlayoffStatusForTeam(h, rowTeamId) ?? "Not in playoff";
      }
    }
    return {
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
      playoff_status,
    };
  });

  const { error: insErr } = await supabase.from("promotions_entries").insert(entryRows);
  if (insErr) {
    console.error("promotions_entries insert:", insErr.message);
    process.exit(1);
  }

  if (tierId === "league3") {
    for (const [lid, h] of leagueHtmlById) {
      if (!h) continue;
      const tid = parseTrophyTeamId(h);
      if (tid == null) continue;
      const found = ranked.some((t) => parseTeamIdFromUrl(t.team_url) === tid);
      if (!found) {
        console.warn(
          `League ${lid}: playoff champion (team ${tid}) not in eligible top ${DISPLAY_TOP_N} — Champ row will not appear (CPU excluded or below cut).`
        );
      }
    }
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
