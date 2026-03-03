import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const CAP = Number(process.env.FANTASY_CAP ?? 30);
const ROSTER_SIZE = Number(process.env.ROSTER_SIZE ?? 5);

function getSupabaseWithAuth(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/**
 * GET /api/roster/season/71
 * Returns the current user's roster. Uses service role to avoid RLS issues (e.g. BBAPI users on Vercel).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 71);

  const authHeader = _request.headers.get("Authorization");
  const supabase = getSupabaseWithAuth(authHeader);
  if (!supabase) {
    return NextResponse.json({ error: "Server config error" }, { status: 500 });
  }

  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token ?? "");
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("fantasy_user_rosters")
    .select("*")
    .eq("user_id", user.id)
    .eq("season", seasonNum)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ roster: data });
}

/**
 * POST /api/roster/season/71
 * Body: { playerIds: number[], playerPrices: Record<string,number>, playerNames: Record<string,string> }
 * Saves roster using service role to avoid RLS issues (e.g. BBAPI users on Vercel).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 71);

  const authHeader = request.headers.get("Authorization");
  const supabase = getSupabaseWithAuth(authHeader);
  if (!supabase) {
    return NextResponse.json({ error: "Server config error" }, { status: 500 });
  }

  const token = authHeader?.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token ?? "");
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { playerIds?: number[]; playerPrices?: Record<string, number>; playerNames?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { playerIds = [], playerPrices = {}, playerNames = {} } = body;
  if (!Array.isArray(playerIds) || playerIds.length !== ROSTER_SIZE) {
    return NextResponse.json(
      { error: `Must select exactly ${ROSTER_SIZE} players` },
      { status: 400 }
    );
  }

  const totalCost = playerIds.reduce(
    (sum, id) => sum + (playerPrices[String(id)] ?? 0),
    0
  );
  if (totalCost > CAP) {
    return NextResponse.json(
      { error: `Total cost $${totalCost} exceeds $${CAP} cap` },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("nickname").eq("user_id", user.id).maybeSingle();
  const nickname = profile?.nickname ?? null;

  const { error } = await admin.from("fantasy_user_rosters").upsert(
    {
      user_id: user.id,
      season: seasonNum,
      player_ids: playerIds,
      player_prices: playerPrices,
      player_names: playerNames,
      nickname,
      picked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,season" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
