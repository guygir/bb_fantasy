/**
 * Scrape Israel League III (league ids 1004–1019): top 3 per conference (6 per league), rank, keep top 32, store in Supabase.
 * Run: node scripts/fetch-promotions-leagues.mjs
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

const LEAGUE_MIN = 1004;
const LEAGUE_MAX = 1019;
/** Rows after header: 1st, 2nd, 3rd in conference standings */
const TOP_PER_CONF = 3;
/** After ranking all scraped teams, keep only this many for the site and DB */
const DISPLAY_TOP_N = 32;
const FETCH_TIMEOUT_MS = 25000;
const USER_AGENT = "Mozilla/5.0 (compatible; BBIsraelFantasy/1.0; +https://github.com)";

function parseTdInt(text) {
  const n = parseInt(String(text).replace(/[^-\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseStandingsRow($, tr) {
  const tds = $(tr).find("td");
  if (tds.length < 8) return null;
  const rank = parseTdInt($(tds[0]).text());
  const teamName = $(tds[1]).find("a").first().text().trim() || $(tds[1]).text().trim();
  const wins = parseTdInt($(tds[2]).text());
  const losses = parseTdInt($(tds[3]).text());
  const pd = parseTdInt($(tds[7]).text());
  if (!teamName || rank < 1) return null;
  return { conf_rank: rank, team_name: teamName, wins, losses, pd };
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

/**
 * Sort collected teams, then keep top N:
 * 1) conference rank ascending (1 before 2 before 3)
 * 2) wins descending
 * 3) PD descending
 */
function rankAndTakeTop(teams, topN) {
  const sorted = [...teams].sort((a, b) => {
    if (a.conf_rank !== b.conf_rank) return a.conf_rank - b.conf_rank;
    if (a.wins !== b.wins) return b.wins - a.wins;
    return b.pd - a.pd;
  });
  return sorted.slice(0, topN).map((t, i) => ({ ...t, display_rank: i + 1 }));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
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
        wins: row.wins,
        losses: row.losses,
        pd: row.pd,
      });
    }
    process.stdout.write(leagueId === LEAGUE_MAX ? ".\n" : ".");
  }

  console.log(
    `Collected ${all.length} teams (${LEAGUE_MAX - LEAGUE_MIN + 1} leagues × up to ${TOP_PER_CONF * 2} per league); storing top ${DISPLAY_TOP_N}.`
  );
  const ranked = rankAndTakeTop(all, DISPLAY_TOP_N);

  const { data: snap, error: snapErr } = await supabase
    .from("promotions_snapshots")
    .insert({})
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

  // Keep the two newest snapshots so /promotions can show "Latest change" vs the previous run.
  const { data: snapList, error: listErr } = await supabase
    .from("promotions_snapshots")
    .select("id")
    .order("created_at", { ascending: false });
  if (listErr) {
    console.warn("Cleanup list snapshots:", listErr.message);
  } else if (snapList && snapList.length > 2) {
    const toDelete = snapList.slice(2).map((s) => s.id);
    const { error: delErr } = await supabase.from("promotions_snapshots").delete().in("id", toDelete);
    if (delErr) {
      console.warn("Cleanup old snapshots:", delErr.message);
    }
  }

  console.log(`OK: snapshot ${snap.id}, ${entryRows.length} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
