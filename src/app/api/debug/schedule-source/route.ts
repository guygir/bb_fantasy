import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = config.game.currentSeason;
  
  const results: Record<string, unknown> = {
    season: s,
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
    
    results.supabase = {
      scheduleRows: scheduleRes.data?.length ?? 0,
      scheduleError: scheduleRes.error?.message ?? null,
      matchesRows: matchesRes.data?.length ?? 0,
      matchesError: matchesRes.error?.message ?? null,
      matchSample: matchesRes.data?.slice(0, 3),
    };
  } catch (e) {
    results.supabase = { error: String(e) };
  }

  // Check env vars (existence only, not values)
  results.env = {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasSupabaseService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasBbapiLogin: !!process.env.BBAPI_LOGIN,
    hasBbapiCode: !!process.env.BBAPI_CODE,
  };

  return NextResponse.json(results);
}
