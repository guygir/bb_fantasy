#!/usr/bin/env node
/**
 * Generate U21dle daily puzzle(s)
 *
 * Writes data/u21dle_daily.json with date -> playerId mapping.
 * Uses deterministic hash when no existing file; otherwise merges new dates.
 *
 * Usage:
 *   node scripts/generate-u21dle-daily.mjs
 *   node scripts/generate-u21dle-daily.mjs 2026-02-25
 *   node scripts/generate-u21dle-daily.mjs 2026-02-25 2026-03-01  (range)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAYERS_PATH = join(ROOT, "data", "u21dle_players.json");
const DAILY_PATH = join(ROOT, "data", "u21dle_daily.json");

const MIN_GP = 8;
const PUZZLE_BUFFER_DAYS = 3;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function getEligiblePlayers() {
  const data = JSON.parse(readFileSync(PLAYERS_PATH, "utf-8"));
  return (data.players || []).filter((p) => p.gp >= MIN_GP);
}

/**
 * Pick a player using balanced selection.
 * If all players have the same count → pick randomly from all.
 * Otherwise → take the min count, pick randomly only from players with that min.
 */
function pickBalancedPlayer(eligible, countByPlayer) {
  const counts = eligible.map((p) => countByPlayer.get(p.playerId) ?? 0);
  const minCount = Math.min(...counts);
  const allSame = counts.every((c) => c === minCount);
  const pool = allSame
    ? eligible
    : eligible.filter((p) => (countByPlayer.get(p.playerId) ?? 0) === minCount);
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx].playerId;
}

function main() {
  const eligible = getEligiblePlayers();
  if (eligible.length === 0) {
    console.error("No eligible players (gp >= " + MIN_GP + ")");
    process.exit(1);
  }

  let existing = {};
  if (existsSync(DAILY_PATH)) {
    try {
      existing = JSON.parse(readFileSync(DAILY_PATH, "utf-8"));
    } catch {
      // ignore
    }
  }

  // Build pick counts from existing (date -> playerId)
  const countByPlayer = new Map();
  for (const playerId of Object.values(existing)) {
    if (typeof playerId === "number") {
      countByPlayer.set(playerId, (countByPlayer.get(playerId) ?? 0) + 1);
    }
  }

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
    for (let i = 0; i <= PUZZLE_BUFFER_DAYS; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(toDateStr(d));
    }
  }

  const updates = { ...existing };
  for (const dateStr of dates) {
    const playerId = pickBalancedPlayer(eligible, countByPlayer);
    updates[dateStr] = playerId;
    const player = eligible.find((p) => p.playerId === playerId);
    console.log(`${dateStr} -> ${player?.name ?? playerId} (${playerId})`);
    countByPlayer.set(playerId, (countByPlayer.get(playerId) ?? 0) + 1);
  }

  writeFileSync(DAILY_PATH, JSON.stringify(updates, null, 2), "utf-8");
  console.log("\nWrote " + DAILY_PATH);
}

main();
