#!/usr/bin/env node
/**
 * Sync fantasy game data from JSON files to Supabase.
 * Run after fetch/process scripts. Populates fantasy_players, fantasy_player_details,
 * fantasy_player_prices, fantasy_player_game_stats, fantasy_matches, fantasy_schedule.
 *
 * Usage: node scripts/sync-fantasy-to-supabase.mjs [season]
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env.local)
 */

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Load .env first, then .env.local (so .env.local overrides - matches Next.js behavior)
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const SEASON = parseInt(process.argv[2] || "71", 10);

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const dataDir = join(ROOT, "data");

  // 1. fantasy_players (from season{N}_stats.json)
  const statsData = loadJson(join(dataDir, `season${SEASON}_stats.json`));
  if (statsData?.players?.length) {
    const rows = statsData.players.map((p) => ({
      season: SEASON,
      player_id: p.playerId,
      name: p.name,
      gp: p.gp ?? 0,
      min: p.min ?? null,
      pts: p.pts ?? null,
      tr: p.tr ?? null,
      ast: p.ast ?? null,
      stl: p.stl ?? null,
      blk: p.blk ?? null,
      to: p.to ?? null,
      rtng: p.rtng ?? null,
    }));
    const { error } = await supabase.from("fantasy_players").upsert(rows, {
      onConflict: "season,player_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_players:", error.message);
    else console.log(`fantasy_players: ${rows.length} rows`);
  }

  // 2. fantasy_player_details (from player_details_s{N}.json)
  const detailsData = loadJson(join(dataDir, `player_details_s${SEASON}.json`));
  if (detailsData?.details) {
    const rows = Object.entries(detailsData.details).map(([playerId, d]) => ({
      season: SEASON,
      player_id: parseInt(playerId, 10),
      position: d.position ?? null,
      dmi: d.dmi ?? null,
      salary: d.salary ?? null,
      game_shape: d.gameShape ?? null,
    }));
    const { error } = await supabase.from("fantasy_player_details").upsert(rows, {
      onConflict: "season,player_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_player_details:", error.message);
    else console.log(`fantasy_player_details: ${rows.length} rows`);
  }

  // 3. fantasy_player_prices (from player_prices_s{N}.json - current only, one row per player)
  const pricesData = loadJson(join(dataDir, `player_prices_s${SEASON}.json`));
  if (pricesData?.current && Object.keys(pricesData.current).length > 0) {
    const rows = Object.entries(pricesData.current).map(([playerId, price]) => ({
      season: SEASON,
      player_id: parseInt(playerId, 10),
      price,
    }));
    const { error } = await supabase.from("fantasy_player_prices").upsert(rows, {
      onConflict: "season,player_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_player_prices:", error.message);
    else console.log(`fantasy_player_prices: ${rows.length} rows`);
  }

  // 4. fantasy_player_game_stats (from player_game_stats_s{N}.json)
  const gameStatsData = loadJson(join(dataDir, `player_game_stats_s${SEASON}.json`));
  const syncedMatchIds = new Set();
  if (gameStatsData?.stats?.length) {
    const rows = gameStatsData.stats.map((s) => {
      syncedMatchIds.add(String(s.matchId));
      return {
        season: SEASON,
        player_id: s.playerId,
        match_id: String(s.matchId),
        name: s.name ?? null,
        min: s.min ?? null,
        pts: s.pts ?? null,
        tr: s.tr ?? null,
        ast: s.ast ?? null,
        stl: s.stl ?? null,
        blk: s.blk ?? null,
        to: s.to ?? null,
        fantasy_points: s.fantasyPoints ?? 0,
      };
    });
    const { error } = await supabase.from("fantasy_player_game_stats").upsert(rows, {
      onConflict: "season,player_id,match_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_player_game_stats:", error.message);
    else console.log(`fantasy_player_game_stats: ${rows.length} rows`);
  }

  // 4b. Apply pending subs for matches we just synced
  const byMatch = new Map();
  if (syncedMatchIds.size > 0) {
    const { data: rosters } = await supabase
      .from("fantasy_user_rosters")
      .select("user_id, player_ids, player_prices, player_names, pending_subs")
      .eq("season", SEASON)
      .not("pending_subs", "is", null);
    for (const r of rosters ?? []) {
      const mid = r.pending_subs?.effective_match_id;
      if (mid && syncedMatchIds.has(mid)) {
        if (!byMatch.has(mid)) byMatch.set(mid, []);
        byMatch.get(mid).push(r);
      }
    }
  }
  for (const matchId of syncedMatchIds) {
    const toApply = byMatch.get(matchId) ?? [];
    for (const r of toApply) {
      const ps = r.pending_subs;
      const removedIds = ps.removed_ids ?? [];
      const addedIds = ps.added_ids ?? [];
      const addedPrices = ps.added_prices ?? {};
      const addedNames = ps.added_names ?? {};
      const currentIds = r.player_ids ?? [];
      const currentPrices = r.player_prices ?? {};
      const currentNames = r.player_names ?? {};
      const keptIds = currentIds.filter((id) => !removedIds.includes(id));
      const newIds = [...keptIds, ...addedIds];
      const newPrices = { ...currentPrices };
      const newNames = { ...currentNames };
      for (const id of removedIds) {
        delete newPrices[String(id)];
        delete newNames[String(id)];
      }
      for (const id of addedIds) {
        newPrices[String(id)] = addedPrices[String(id)] ?? 0;
        newNames[String(id)] = addedNames[String(id)] ?? `Player ${id}`;
      }
      const removedPrices = {};
      for (const id of removedIds) {
        removedPrices[String(id)] = currentPrices[String(id)] ?? 0;
      }
      const { error: subErr } = await supabase.from("fantasy_roster_substitutions").insert({
        user_id: r.user_id,
        season: SEASON,
        removed_player_ids: removedIds,
        added_player_ids: addedIds,
        removed_prices: removedPrices,
        added_prices: addedPrices,
        effective_match_id: matchId,
      });
      if (subErr) {
        console.error("apply pending_subs sub insert:", subErr.message);
        continue;
      }
      const { error: rosterErr } = await supabase
        .from("fantasy_user_rosters")
        .update({
          player_ids: newIds,
          player_prices: newPrices,
          player_names: newNames,
          pending_subs: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", r.user_id)
        .eq("season", SEASON);
      if (rosterErr) {
        console.error("apply pending_subs roster update:", rosterErr.message);
      } else {
        console.log(`Applied pending subs for user ${r.user_id} (match ${matchId})`);
      }
    }
  }

  // 5. fantasy_matches (from match_scores_s{N}.json)
  const matchData = loadJson(join(dataDir, `match_scores_s${SEASON}.json`));
  if (matchData?.scores) {
    const rows = Object.entries(matchData.scores).map(([matchId, s]) => ({
      season: SEASON,
      match_id: matchId,
      home_score: s.homeScore ?? null,
      away_score: s.awayScore ?? null,
    }));
    const { error } = await supabase.from("fantasy_matches").upsert(rows, {
      onConflict: "season,match_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_matches:", error.message);
    else console.log(`fantasy_matches: ${rows.length} rows`);
  }

  // 6. fantasy_schedule (from bbapi_schedule_s{N}.json)
  const scheduleData = loadJson(join(dataDir, `bbapi_schedule_s${SEASON}.json`));
  if (scheduleData?.matches?.length) {
    const rows = scheduleData.matches.map((m) => ({
      season: SEASON,
      match_id: String(m.id),
      match_date: m.start ? m.start.slice(0, 10) : null,
      match_start: m.start || null,
      home_team_id: m.homeTeamId ? parseInt(m.homeTeamId, 10) : null,
      away_team_id: m.awayTeamId ? parseInt(m.awayTeamId, 10) : null,
    }));
    const { error } = await supabase.from("fantasy_schedule").upsert(rows, {
      onConflict: "season,match_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_schedule:", error.message);
    else console.log(`fantasy_schedule: ${rows.length} rows`);
  }

  // 6b. Compute and store total_fantasy_points per user (single source of truth for leaderboard)
  const GAME_DURATION_MS = 2 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const { data: fpRosters } = await supabase
    .from("fantasy_user_rosters")
    .select("user_id, player_ids, picked_at, pending_subs")
    .eq("season", SEASON);
  const { data: fpStats } = await supabase
    .from("fantasy_player_game_stats")
    .select("player_id, match_id, fantasy_points")
    .eq("season", SEASON);
  const { data: fpSchedule } = await supabase
    .from("fantasy_schedule")
    .select("match_id, match_date, match_start")
    .eq("season", SEASON)
    .not("match_date", "is", null)
    .order("match_date", { ascending: true });
  const { data: fpSubs } = await supabase
    .from("fantasy_roster_substitutions")
    .select("user_id, removed_player_ids, added_player_ids, created_at, effective_match_id")
    .eq("season", SEASON)
    .order("created_at", { ascending: true });

  const pointsMap = new Map();
  for (const s of fpStats ?? []) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, Number(s.fantasy_points ?? 0));
  }
  let lastPlayedMatchId = null;
  for (let i = (fpSchedule ?? []).length - 1; i >= 0; i--) {
    const row = fpSchedule[i];
    const ms = row.match_start;
    const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
    const isPlayed = row.match_date < today || (row.match_date === today && now >= matchStartMs + GAME_DURATION_MS);
    if (isPlayed) {
      lastPlayedMatchId = row.match_id;
      break;
    }
  }
  const subsByUser = new Map();
  for (const sub of fpSubs ?? []) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  for (const r of fpRosters ?? []) {
    if (!r.player_ids?.length) continue;
    const pickedAtMs = r.picked_at ? new Date(r.picked_at).getTime() : 0;
    const userSubs = subsByUser.get(r.user_id) ?? [];

    let initialIds = [...r.player_ids];
    for (let i = userSubs.length - 1; i >= 0; i--) {
      const s = userSubs[i];
      const removed = s.removed_player_ids ?? [];
      const added = s.added_player_ids ?? [];
      const anyAddedPresent = added.length > 0 && added.some((id) => initialIds.includes(id));
      if (anyAddedPresent) {
        initialIds = initialIds.filter((id) => !added.includes(id)).concat(removed);
      }
    }

    let total = 0;
    for (const row of fpSchedule ?? []) {
      const ms = row.match_start;
      const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
      if (pickedAtMs >= matchStartMs) continue;
      if (row.match_date > today) continue;
      if (row.match_date === today && (!ms || now < matchStartMs + GAME_DURATION_MS)) continue;

      const matchId = row.match_id;
      let rosterIds;
      if (matchId === lastPlayedMatchId) {
        const ps = r.pending_subs;
        if (ps?.effective_match_id && String(ps.effective_match_id) === String(matchId)) {
          const removed = ps.removed_ids ?? [];
          const added = ps.added_ids ?? [];
          rosterIds = r.player_ids.filter((id) => !removed.includes(id)).concat(added);
        } else {
          rosterIds = [...r.player_ids];
        }
      } else {
        const matchCutoff = new Date(row.match_date + "T23:59:59.999Z").getTime();
        rosterIds = [...initialIds];
        for (const s of userSubs) {
          const effectiveMatchId = s.effective_match_id;
          const createdAt = new Date(s.created_at).getTime();
          const appliesToThisMatch = effectiveMatchId
            ? String(effectiveMatchId) === String(matchId)
            : createdAt <= matchCutoff;
          if (appliesToThisMatch) {
            const removed = s.removed_player_ids ?? [];
            const added = s.added_player_ids ?? [];
            const allRemovedPresent = removed.length > 0 && removed.every((id) => rosterIds.includes(id));
            if (allRemovedPresent) {
              rosterIds = rosterIds.filter((id) => !removed.includes(id)).concat(added);
            }
          }
        }
      }

      for (const pid of rosterIds) {
        total += pointsMap.get(`${pid}:${matchId}`) ?? 0;
      }
    }

    const { error: updErr } = await supabase
      .from("fantasy_user_rosters")
      .update({ total_fantasy_points: total, updated_at: new Date().toISOString() })
      .eq("user_id", r.user_id)
      .eq("season", SEASON);
    if (updErr) {
      console.error("total_fantasy_points update:", updErr.message);
    }
  }
  console.log(`Updated total_fantasy_points for ${(fpRosters ?? []).filter((r) => r.player_ids?.length).length} rosters`);

  // 7. Overpriced auto-sub: if no pending_subs but roster cost (current prices) > $30,
  //    set pending_subs (highest→cheapest) for next match. User can change or clear before it applies.
  const CAP = 30;
  const nowIso = new Date().toISOString();
  const { data: nextMatchRow } = await supabase
    .from("fantasy_schedule")
    .select("match_id")
    .eq("season", SEASON)
    .gt("match_start", nowIso)
    .order("match_start", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextMatchId = nextMatchRow?.match_id;

  const { data: priceRows } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price")
    .eq("season", SEASON);
  const currentPrices = {};
  for (const r of priceRows ?? []) {
    currentPrices[r.player_id] = r.price;
  }
  const { data: allRosters } = await supabase
    .from("fantasy_user_rosters")
    .select("user_id, player_ids, player_prices, player_names, pending_subs")
    .eq("season", SEASON);
  const { data: playerRows } = await supabase
    .from("fantasy_players")
    .select("player_id, name")
    .eq("season", SEASON);
  const playerNames = Object.fromEntries((playerRows ?? []).map((p) => [p.player_id, p.name ?? `Player ${p.player_id}`]));
  const poolPlayerIds = new Set((playerRows ?? []).map((p) => p.player_id));
  const cheapestByPrice = [...poolPlayerIds]
    .filter((pid) => currentPrices[pid] != null)
    .sort((a, b) => (currentPrices[a] ?? 99) - (currentPrices[b] ?? 99));

  for (const r of allRosters ?? []) {
    if (r.pending_subs != null) continue; // User has pending subs, skip
    if (!nextMatchId) continue; // No upcoming match, skip
    const ids = r.player_ids ?? [];
    if (ids.length !== 5) continue;
    const cost = ids.reduce((s, pid) => s + (currentPrices[pid] ?? 0), 0);
    if (cost <= CAP) continue;

    const byPrice = [...ids].sort((a, b) => (currentPrices[b] ?? 0) - (currentPrices[a] ?? 0));
    const toRemove = byPrice[0];
    const rosterSet = new Set(ids);
    const cheapest = cheapestByPrice.find((pid) => !rosterSet.has(pid));
    if (!cheapest) continue;

    const newCost = ids.filter((id) => id !== toRemove).concat([cheapest]).reduce((s, pid) => s + (currentPrices[pid] ?? 0), 0);
    if (newCost > CAP) continue; // Can't fix with single swap

    const pendingSubs = {
      removed_ids: [toRemove],
      added_ids: [cheapest],
      added_prices: { [String(cheapest)]: currentPrices[cheapest] ?? 0 },
      added_names: { [String(cheapest)]: playerNames[cheapest] ?? `Player ${cheapest}` },
      effective_match_id: nextMatchId,
    };

    const { error: rosterErr } = await supabase
      .from("fantasy_user_rosters")
      .update({
        pending_subs: pendingSubs,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", r.user_id)
      .eq("season", SEASON);
    if (rosterErr) {
      console.error("overpriced auto-sub pending_subs:", rosterErr.message);
    } else {
      console.log(`Overpriced auto-sub (pending) for user ${r.user_id}: ${toRemove}→${cheapest} (cost ${cost}→${newCost})`);
    }
  }

  // Show price simulation (empty start → End $ = synced prices)
  console.log("\n--- Price simulation (empty start) ---");
  const sim = spawnSync("node", ["scripts/simulate-prices.mjs", String(SEASON)], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  if (sim.stdout) console.log(sim.stdout);
  if (sim.stderr && sim.status !== 0) console.error(sim.stderr);

  console.log(`\nDone syncing season ${SEASON} to Supabase`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
