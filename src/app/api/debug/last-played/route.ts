import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const GAME_DURATION_MS = 2 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season") ?? "71", 10);

  const supabase = getSupabaseAdmin();

  const { data: scheduleRows, error: scheduleErr } = await supabase
    .from("fantasy_schedule")
    .select("match_id, match_date, match_start")
    .eq("season", season)
    .not("match_date", "is", null)
    .order("match_date", { ascending: true })
    .range(0, 999);

  const schedule = (scheduleRows ?? []) as { match_id: string; match_date: string; match_start?: string | null }[];

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const analyzed = schedule.map((row, idx) => {
    const ms = row.match_start;
    const matchStartMs = ms ? new Date(ms).getTime() : new Date(row.match_date + "T12:00:00Z").getTime();
    const isPlayed = row.match_date < today || (row.match_date === today && now >= matchStartMs + GAME_DURATION_MS);
    return {
      weekNum: idx + 1,
      match_id: row.match_id,
      match_date: row.match_date,
      match_start: row.match_start,
      matchStartMs,
      isPlayed,
    };
  });

  let lastPlayedMatchId: string | null = null;
  let lastPlayedWeek = 0;
  for (let i = analyzed.length - 1; i >= 0; i--) {
    if (analyzed[i].isPlayed) {
      lastPlayedMatchId = analyzed[i].match_id;
      lastPlayedWeek = analyzed[i].weekNum;
      break;
    }
  }

  return NextResponse.json({
    season,
    serverTime: { today, now, nowIso },
    scheduleError: scheduleErr?.message ?? null,
    scheduleCount: schedule.length,
    lastFewMatches: analyzed.slice(-5),
    lastPlayedMatchId,
    lastPlayedWeek,
  });
}
