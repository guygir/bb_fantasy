#!/usr/bin/env node
/**
 * Generate U21dle daily puzzle(s) - writes to Supabase only.
 * Never overwrites existing dates. Uses deterministic hash for new dates.
 *
 * Usage:
 *   node scripts/generate-u21dle-daily-supabase.mjs           # 3 days from now
 *   node scripts/generate-u21dle-daily-supabase.mjs 2026-02-25  # single date
 *   node scripts/generate-u21dle-daily-supabase.mjs 2026-02-25 2026-03-01  # range
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env.local)
 */

import { config } from "dotenv";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env.local") });
const PLAYERS_PATH = join(ROOT, "data", "u21dle_players.json");

const MIN_GP = 8;
/** Generate for 3 days from now (so you have 3 days notice if cron fails) */
const DAYS_AHEAD = 3;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function getEligiblePlayers() {
  const data = JSON.parse(readFileSync(PLAYERS_PATH, "utf-8"));
  return (data.players || []).filter((p) => p.gp >= MIN_GP);
}

function pickPlayerForDate(dateStr, eligible) {
  const idx = hashString(dateStr) % eligible.length;
  return eligible[idx].playerId;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const eligible = getEligiblePlayers();
  if (eligible.length === 0) {
    console.error("No eligible players (gp >= " + MIN_GP + ")");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Which dates to generate
  const today = new Date();
  const dates = [];
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (arg1 && arg2) {
    const start = new Date(arg1);
    const end = new Date(arg2);
    for (let d = new Date(start); d <= end; ) {
      dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (arg1) {
    dates.push(toDateStr(new Date(arg1)));
  } else {
    const d = new Date(today);
    d.setDate(d.getDate() + DAYS_AHEAD);
    dates.push(toDateStr(d));
  }

  // Fetch existing dates from Supabase
  const { data: existing } = await supabase
    .from("u21dle_daily")
    .select("puzzle_date")
    .in("puzzle_date", dates);
  const existingSet = new Set((existing ?? []).map((r) => r.puzzle_date));

  let inserted = 0;
  for (const dateStr of dates) {
    if (existingSet.has(dateStr)) {
      console.log(`${dateStr} -> (already exists, skipped)`);
      continue;
    }
    const playerId = pickPlayerForDate(dateStr, eligible);
    const player = eligible.find((p) => p.playerId === playerId);
    const { error } = await supabase.from("u21dle_daily").insert({
      puzzle_date: dateStr,
      player_id: playerId,
    });
    if (error) {
      // Race: another process may have inserted; treat as success
      if (error.code === "23505") {
        console.log(`${dateStr} -> ${player?.name ?? playerId} (already exists)`);
      } else {
        console.error(`${dateStr}: ${error.message}`);
      }
      continue;
    }
    console.log(`${dateStr} -> ${player?.name ?? playerId} (${playerId})`);
    inserted++;
  }

  console.log(`\nInserted ${inserted} new puzzle(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
