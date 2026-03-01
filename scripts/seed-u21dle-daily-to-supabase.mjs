#!/usr/bin/env node
/**
 * Seed existing u21dle_daily.json into Supabase.
 * Skips dates that already exist (never overwrite).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from .env.local)
 */

import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
config({ path: join(ROOT, ".env.local") });
const DAILY_PATH = join(ROOT, "data", "u21dle_daily.json");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (!existsSync(DAILY_PATH)) {
    console.log("No u21dle_daily.json found, nothing to seed");
    return;
  }

  const data = JSON.parse(readFileSync(DAILY_PATH, "utf-8"));
  const entries = Object.entries(data).filter(
    ([, v]) => typeof v === "number"
  );
  if (entries.length === 0) {
    console.log("No entries in u21dle_daily.json");
    return;
  }

  const supabase = createClient(url, key);
  const dates = entries.map(([d]) => d);

  const { data: existing } = await supabase
    .from("u21dle_daily")
    .select("puzzle_date")
    .in("puzzle_date", dates);
  const existingSet = new Set((existing ?? []).map((r) => r.puzzle_date));

  const toInsert = entries
    .filter(([d]) => !existingSet.has(d))
    .map(([puzzle_date, player_id]) => ({ puzzle_date, player_id }));

  if (toInsert.length === 0) {
    console.log("All dates already in Supabase");
    return;
  }

  const { error } = await supabase.from("u21dle_daily").insert(toInsert);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Seeded ${toInsert.length} puzzle(s) to Supabase`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
