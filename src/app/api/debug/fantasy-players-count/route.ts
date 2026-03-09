import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPlayersFromSupabase } from "@/lib/fantasy-db";

export const dynamic = "force-dynamic";

/** Debug: raw count vs getPlayersFromSupabase result */
export async function GET(request: Request) {
  const season = parseInt(new URL(request.url).searchParams.get("season") ?? "71", 10);
  try {
    const supabase = getSupabaseAdmin();
    const { count: rawCount, error: countErr } = await supabase
      .from("fantasy_players")
      .select("*", { count: "exact", head: true })
      .eq("season", season);
    const { data: rawRows, error: rowsErr } = await supabase
      .from("fantasy_players")
      .select("player_id, name")
      .eq("season", season);
    const fromLib = await getPlayersFromSupabase(season);
    return NextResponse.json(
      {
        season,
        rawCount: countErr ? null : rawCount,
        rawRowsCount: rowsErr ? null : (rawRows ?? []).length,
        rawPlayerIds: (rawRows ?? []).map((r) => r.player_id).sort((a, b) => a - b),
        fromLibCount: fromLib?.length ?? null,
        fromLibPlayerIds: fromLib?.map((p) => p.playerId).sort((a, b) => a - b) ?? null,
        countError: countErr?.message ?? null,
        rowsError: rowsErr?.message ?? null,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
