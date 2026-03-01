import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSubWindow } from "@/lib/sub-lock";

export const dynamic = "force-dynamic";

const CAP = 30;
const ROSTER_SIZE = 5;
const MAX_SWAP = 2;

function getSupabaseWithAuth(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/**
 * POST /api/roster/season/71/substitute
 * Body: { removedIds: number[], addedIds: number[], addedPrices: Record<string,number>, addedNames: Record<string,string> }
 * Requires Authorization: Bearer <access_token> from client session.
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

  const window = await getSubWindow(seasonNum);
  if (!window.open) {
    return NextResponse.json(
      { error: "Substitutions are locked. Window opens 1h after previous game until 1h before next." },
      { status: 400 }
    );
  }

  let body: { removedIds: number[]; addedIds: number[]; addedPrices: Record<string, number>; addedNames: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { removedIds = [], addedIds = [], addedPrices = {}, addedNames = {} } = body;
  if (!Array.isArray(removedIds) || !Array.isArray(addedIds)) {
    return NextResponse.json({ error: "removedIds and addedIds must be arrays" }, { status: 400 });
  }

  if (removedIds.length !== addedIds.length || removedIds.length > MAX_SWAP || removedIds.length === 0) {
    return NextResponse.json(
      { error: `Swap 1 or 2 players (removed count must equal added count)` },
      { status: 400 }
    );
  }

  const { data: roster, error: rosterFetchError } = await supabase
    .from("fantasy_user_rosters")
    .select("player_ids, player_prices, player_names")
    .eq("user_id", user.id)
    .eq("season", seasonNum)
    .single();

  if (rosterFetchError || !roster?.player_ids?.length) {
    return NextResponse.json({ error: "No roster found" }, { status: 400 });
  }

  const currentIds = roster.player_ids as number[];
  const currentPrices = (roster.player_prices ?? {}) as Record<string, number>;
  const currentNames = (roster.player_names ?? {}) as Record<string, string>;

  for (const id of removedIds) {
    if (!currentIds.includes(id)) {
      return NextResponse.json({ error: `Player ${id} not on roster` }, { status: 400 });
    }
  }

  const keptIds = currentIds.filter((id) => !removedIds.includes(id));
  const newIds = [...keptIds, ...addedIds];

  if (newIds.length !== ROSTER_SIZE) {
    return NextResponse.json({ error: "Roster must have 5 players" }, { status: 400 });
  }

  const keptCost = keptIds.reduce((s, id) => s + (currentPrices[String(id)] ?? 0), 0);
  const addedCost = addedIds.reduce((s, id) => s + (addedPrices[String(id)] ?? 0), 0);
  if (keptCost + addedCost > CAP) {
    return NextResponse.json({ error: `Total cost exceeds $${CAP} cap` }, { status: 400 });
  }

  const newPrices: Record<string, number> = { ...currentPrices };
  const newNames: Record<string, string> = { ...currentNames };
  for (const id of removedIds) {
    delete newPrices[String(id)];
    delete newNames[String(id)];
  }
  for (const id of addedIds) {
    newPrices[String(id)] = addedPrices[String(id)] ?? 0;
    newNames[String(id)] = addedNames[String(id)] ?? `Player ${id}`;
  }

  const removedPrices: Record<string, number> = {};
  for (const id of removedIds) {
    removedPrices[String(id)] = currentPrices[String(id)] ?? 0;
  }

  const { error: subError } = await supabase.from("fantasy_roster_substitutions").insert({
    user_id: user.id,
    season: seasonNum,
    removed_player_ids: removedIds,
    added_player_ids: addedIds,
    removed_prices: removedPrices,
    added_prices: addedPrices,
  });

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  const { error: rosterError } = await supabase
    .from("fantasy_user_rosters")
    .update({
      player_ids: newIds,
      player_prices: newPrices,
      player_names: newNames,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("season", seasonNum);

  if (rosterError) {
    return NextResponse.json({ error: rosterError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
