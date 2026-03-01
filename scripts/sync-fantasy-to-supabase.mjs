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

  // 3. fantasy_player_prices (from player_prices_s{N}.json - current + history)
  const pricesData = loadJson(join(dataDir, `player_prices_s${SEASON}.json`));
  if (pricesData) {
    const seen = new Set();
    const rows = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const [playerId, price] of Object.entries(pricesData.current ?? {})) {
      const pid = parseInt(playerId, 10);
      const key = `${pid}-${today}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ season: SEASON, player_id: pid, price, effective_from: today });
      }
    }
    for (const [playerId, entries] of Object.entries(pricesData.history ?? {})) {
      for (const e of entries) {
        const pid = e.playerId ?? parseInt(playerId, 10);
        const ef = e.effectiveFrom ?? today;
        const key = `${pid}-${ef}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ season: SEASON, player_id: pid, price: e.price, effective_from: ef });
        }
      }
    }
    if (rows.length > 0) {
      const { error } = await supabase.from("fantasy_player_prices").upsert(rows, {
        onConflict: "season,player_id,effective_from",
        ignoreDuplicates: false,
      });
      if (error) console.error("fantasy_player_prices:", error.message);
      else console.log(`fantasy_player_prices: ${rows.length} rows`);
    }
  }

  // 4. fantasy_player_game_stats (from player_game_stats_s{N}.json)
  const gameStatsData = loadJson(join(dataDir, `player_game_stats_s${SEASON}.json`));
  if (gameStatsData?.stats?.length) {
    const rows = gameStatsData.stats.map((s) => ({
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
    }));
    const { error } = await supabase.from("fantasy_player_game_stats").upsert(rows, {
      onConflict: "season,player_id,match_id",
      ignoreDuplicates: false,
    });
    if (error) console.error("fantasy_player_game_stats:", error.message);
    else console.log(`fantasy_player_game_stats: ${rows.length} rows`);
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

  console.log(`\nDone syncing season ${SEASON} to Supabase`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
