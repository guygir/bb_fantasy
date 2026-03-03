#!/usr/bin/env node
/**
 * Validate rosters, FP, and leaderboard for all playing users.
 * Run: node scripts/validate-rosters.mjs [season]
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env") });
config({ path: join(ROOT, ".env.local") });

const SEASON = parseInt(process.argv[2] || "71", 10);
const GAME_DURATION_MS = 2 * 60 * 60 * 1000;
const today = new Date().toISOString().slice(0, 10);
const now = Date.now();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const [rostersRes, statsRes, scheduleRes, subsRes, profilesRes] = await Promise.all([
    supabase.from("fantasy_user_rosters").select("user_id, player_ids, player_names, total_fantasy_points, pending_subs, picked_at").eq("season", SEASON),
    supabase.from("fantasy_player_game_stats").select("player_id, match_id, name, fantasy_points").eq("season", SEASON),
    supabase.from("fantasy_schedule").select("match_id, match_date, match_start").eq("season", SEASON).not("match_date", "is", null).order("match_date", { ascending: true }),
    supabase.from("fantasy_roster_substitutions").select("user_id, removed_player_ids, added_player_ids, created_at, effective_match_id").eq("season", SEASON).order("created_at", { ascending: true }),
    supabase.from("profiles").select("user_id, nickname, username"),
  ]);

  const rosters = rostersRes.data ?? [];
  const stats = statsRes.data ?? [];
  const schedule = (scheduleRes.data ?? []).map((r, i) => ({ ...r, weekNum: i + 1 }));
  const subs = subsRes.data ?? [];
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname ?? p.username ?? "?"]));

  // Last played match = week 6
  let lastPlayedMatchId = null;
  for (let i = schedule.length - 1; i >= 0; i--) {
    const row = schedule[i];
    const ms = row.match_start;
    const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
    const isPlayed = row.match_date < today || (row.match_date === today && now >= matchStartMs + GAME_DURATION_MS);
    if (isPlayed) {
      lastPlayedMatchId = row.match_id;
      break;
    }
  }

  const week6MatchId = lastPlayedMatchId;
  const week6Row = schedule.find((r) => r.match_id === week6MatchId);
  const weekNum = week6Row?.weekNum ?? 6;

  const pointsMap = new Map();
  for (const s of stats) {
    pointsMap.set(`${s.player_id}:${s.match_id}`, { fp: Number(s.fantasy_points ?? 0), name: s.name });
  }

  const subsByUser = new Map();
  for (const sub of subs) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  const nameMap = new Map();
  for (const s of stats) {
    if (s.name) nameMap.set(s.player_id, s.name);
  }

  console.log(`\n=== Validation: Season ${SEASON} ===`);
  console.log(`Last played match (Week ${weekNum}): ${week6MatchId}`);
  console.log(`Total players with stats for match ${week6MatchId}: ${stats.filter((s) => String(s.match_id) === String(week6MatchId)).length}`);
  console.log("");

  const results = [];

  for (const r of rosters) {
    if (!r.player_ids?.length) continue;

    const userId = r.user_id;
    const nickname = profiles.get(userId) ?? "?";
    const currentRoster = r.player_ids;
    const userSubs = subsByUser.get(userId) ?? [];
    const pickedAtMs = r.picked_at ? new Date(r.picked_at).getTime() : 0;

    // Week 6 roster: current roster (if no pending_subs for match) or current + pending_subs applied
    const ps = r.pending_subs;
    const rosterForWeek6 =
      ps?.effective_match_id && String(ps.effective_match_id) === String(week6MatchId)
        ? currentRoster.filter((id) => !(ps.removed_ids ?? []).includes(id)).concat(ps.added_ids ?? [])
        : currentRoster;

    // Expected FP for week 6 (last played match)
    let week6FP = 0;
    const week6Breakdown = [];
    for (const pid of rosterForWeek6) {
      const rec = pointsMap.get(`${pid}:${week6MatchId}`);
      const fp = rec?.fp ?? 0;
      week6FP += fp;
      const name = (r.player_names ?? {})[String(pid)] ?? nameMap.get(pid) ?? `Player ${pid}`;
      week6Breakdown.push({ pid, name, fp });
    }

    // Total FP from roster (stored)
    const storedTotalFP = r.total_fantasy_points != null ? Number(r.total_fantasy_points) : null;

    // Has subs? (current roster = week 6 roster only if no subs)
    const hasSubs = userSubs.length > 0;
    const rosterMatchesWeek6 = hasSubs
      ? JSON.stringify([...currentRoster].sort()) === JSON.stringify([...rosterForWeek6].sort())
      : true;

    results.push({
      nickname,
      userId,
      currentRoster,
      rosterForWeek6,
      rosterMatchesWeek6,
      hasSubs,
      subsCount: userSubs.length,
      week6FP,
      week6Breakdown,
      storedTotalFP,
    });
  }

  // Leaderboard (from stored total_fantasy_points)
  const leaderboard = [...results]
    .sort((a, b) => (b.storedTotalFP ?? 0) - (a.storedTotalFP ?? 0))
    .map((r, i) => ({ ...r, rank: i + 1 }));

  for (const u of leaderboard) {
    console.log(`--- ${u.nickname} (rank ${u.rank}) ---`);
    console.log(`  User ID: ${u.userId}`);
    console.log(`  Current roster: [${u.currentRoster.join(", ")}]`);
    console.log(`  Week ${weekNum} roster: [${u.rosterForWeek6.join(", ")}]`);
    console.log(`  Current roster = Week ${weekNum} roster: ${u.rosterMatchesWeek6 ? "YES ✓" : "NO (has subs)"}`);
    console.log(`  Subs: ${u.subsCount}`);
    console.log(`  Week ${weekNum} FP breakdown:`);
    for (const b of u.week6Breakdown) {
      console.log(`    ${b.name} (${b.pid}): ${b.fp.toFixed(1)} FP`);
    }
    console.log(`  Week ${weekNum} total: ${u.week6FP.toFixed(1)} FP`);
    console.log(`  Stored total_fantasy_points: ${u.storedTotalFP != null ? u.storedTotalFP.toFixed(1) : "NULL (run sync)"}`);
    console.log("");
  }

  console.log("=== Leaderboard (by stored total_fantasy_points) ===");
  for (const u of leaderboard) {
    console.log(`  ${u.rank}. ${u.nickname}: ${(u.storedTotalFP ?? 0).toFixed(1)} FP`);
  }
  console.log("");

  // Verify: recompute total from all matches for each user
  console.log("=== Cross-check: recomputed total vs stored ===");
  for (const r of rosters) {
    if (!r.player_ids?.length) continue;
    const userId = r.user_id;
    const nickname = profiles.get(userId) ?? "?";
    const userSubs = subsByUser.get(userId) ?? [];
    const pickedAtMs = r.picked_at ? new Date(r.picked_at).getTime() : 0;

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

    let recomputedTotal = 0;
    for (const row of schedule) {
      const ms = row.match_start;
      const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
      if (pickedAtMs >= matchStartMs) continue;
      if (row.match_date > today) continue;
      if (row.match_date === today && (!ms || now < matchStartMs + GAME_DURATION_MS)) continue;

      const matchId = row.match_id;
      let rosterIds;
      if (matchId === week6MatchId) {
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
        recomputedTotal += pointsMap.get(`${pid}:${matchId}`)?.fp ?? 0;
      }
    }

    const stored = r.total_fantasy_points != null ? Number(r.total_fantasy_points) : null;
    const match = stored != null && Math.abs(stored - recomputedTotal) < 0.01;
    console.log(`  ${nickname}: stored=${stored != null ? stored.toFixed(1) : "NULL"}, recomputed=${recomputedTotal.toFixed(1)} ${match ? "✓" : "MISMATCH"}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
