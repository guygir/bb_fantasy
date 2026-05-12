import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = config.game.currentSeason;
  
  const results: Record<string, unknown> = {
    season: s,
    seasonType: typeof s,
    timestamp: new Date().toISOString(),
  };

  // Test Supabase connection
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const supabase = getSupabaseAdmin();
    
    const [scheduleRes, matchesRes] = await Promise.all([
      supabase
        .from("fantasy_schedule")
        .select("match_id")
        .eq("season", s),
      supabase
        .from("fantasy_matches")
        .select("match_id, home_score, away_score")
        .eq("season", s),
    ]);
    
    // Also get total count without season filter
    const { count: totalCount } = await supabase
      .from("fantasy_matches")
      .select("*", { count: "exact", head: true });

    // Try with explicit number
    const { data: matchesNum } = await supabase
      .from("fantasy_matches")
      .select("match_id")
      .eq("season", Number(s));
    
    // Try with string
    const { data: matchesStr } = await supabase
      .from("fantasy_matches")
      .select("match_id")
      .eq("season", String(s));

    // Try with full columns + Number(s)
    const { data: matchesFull, error: fullErr } = await supabase
      .from("fantasy_matches")
      .select("match_id, home_score, away_score")
      .eq("season", Number(s));

    results.supabase = {
      scheduleRows: scheduleRes.data?.length ?? 0,
      scheduleError: scheduleRes.error?.message ?? null,
      matchesRows: matchesRes.data?.length ?? 0,
      matchesWithNumber: matchesNum?.length ?? 0,
      matchesWithString: matchesStr?.length ?? 0,
      matchesFullCols: matchesFull?.length ?? 0,
      matchesFullColsErr: fullErr?.message ?? null,
      matchesTotalCount: totalCount,
      matchesError: matchesRes.error?.message ?? null,
      matchSample: matchesFull?.slice(0, 2),
    };
  } catch (e) {
    results.supabase = { error: String(e) };
  }

  // Check env vars (existence only, not values)
  results.env = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseUrlPrefix: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30),
    hasSupabaseAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasSupabaseService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10),
    hasBbapiLogin: !!process.env.BBAPI_LOGIN,
    hasBbapiCode: !!process.env.BBAPI_CODE,
  };

  // Also try with anon key to compare
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const anonClient = getSupabase();
    const { data: anonMatches } = await anonClient
      .from("fantasy_matches")
      .select("match_id")
      .eq("season", s);
    results.anonMatches = anonMatches?.length ?? 0;
  } catch (e) {
    results.anonMatches = { error: String(e) };
  }

  return NextResponse.json(results);
}
