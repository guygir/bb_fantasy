import { NextResponse } from "next/server";
import { getSchedule } from "@/lib/schedule";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const season = config.game.currentSeason;
  const schedule = await getSchedule(season);
  const match = schedule.matches.find((m) => m.id === "84444");

  return NextResponse.json({
    season,
    meta: schedule.meta,
    match84444: match ?? null,
    scoredMatches: schedule.matches
      .filter((m) => m.homeScore != null && m.awayScore != null)
      .map((m) => ({
        id: m.id,
        awayScore: m.awayScore,
        homeScore: m.homeScore,
      })),
  });
}
