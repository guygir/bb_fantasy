import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season") ?? "71", 10);

  try {
    const supabase = getSupabaseAdmin();
    
    const { data: matches, error: matchesError } = await supabase
      .from("fantasy_matches")
      .select("match_id, home_score, away_score")
      .eq("season", season)
      .order("match_id", { ascending: true });

    const { data: schedule, error: scheduleError } = await supabase
      .from("fantasy_schedule")
      .select("match_id, match_type, match_date")
      .eq("season", season)
      .order("match_date", { ascending: true });

    return NextResponse.json({
      season,
      fantasy_matches: {
        count: matches?.length ?? 0,
        error: matchesError?.message ?? null,
        rows: matches ?? [],
      },
      fantasy_schedule: {
        count: schedule?.length ?? 0,
        error: scheduleError?.message ?? null,
        rows: schedule ?? [],
      },
      // Check if SF (84052) is present
      sf_84052_in_matches: matches?.some((m) => String(m.match_id) === "84052") ?? false,
      sf_84052_in_schedule: schedule?.some((s) => String(s.match_id) === "84052") ?? false,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
