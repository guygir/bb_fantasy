import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
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

  const window = await getSubWindow(seasonNum, user.id);
  if (!window.open) {
    return NextResponse.json(
      { error: "Substitutions are locked. Window opens 1h after previous game until 1h before next." },
      { status: 400 }
    );
  }

  let body: { removedIds?: number[]; addedIds?: number[]; addedPrices?: Record<string, number>; addedNames?: Record<string, string>; clear?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Clear pending subs - block if current roster would exceed cap
  if (body.clear === true) {
    const [{ data: roster }, { data: priceRows }] = await Promise.all([
      admin.from("fantasy_user_rosters").select("player_ids").eq("user_id", user.id).eq("season", seasonNum).maybeSingle(),
      admin.from("fantasy_player_prices").select("player_id, price").eq("season", seasonNum).range(0, 999),
    ]);
    const ids = (roster?.player_ids ?? []) as number[];
    const prices: Record<number, number> = {};
    for (const r of priceRows ?? []) prices[r.player_id] = r.price;
    const totalCost = ids.reduce((s, id) => s + (prices[id] ?? 0), 0);
    if (totalCost > CAP) {
      return NextResponse.json(
        { error: `Cannot clear: your current roster would cost $${totalCost} (over $${CAP} cap). Make substitutions first.` },
        { status: 400 }
      );
    }
    const { error: clearErr } = await admin
      .from("fantasy_user_rosters")
      .update({ pending_subs: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("season", seasonNum);
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!window.nextMatchId) {
    return NextResponse.json(
      { error: "No upcoming game to apply substitutions to." },
      { status: 400 }
    );
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

  // Use service role for roster fetch to avoid RLS issues (e.g. BBAPI users).
  // User is already verified via JWT; we only fetch their own roster.
  const [{ data: roster, error: rosterFetchError }, { data: priceRows }] = await Promise.all([
    admin
      .from("fantasy_user_rosters")
      .select("player_ids, player_prices, player_names")
      .eq("user_id", user.id)
      .eq("season", seasonNum)
      .maybeSingle(),
    admin
      .from("fantasy_player_prices")
      .select("player_id, price")
      .eq("season", seasonNum),
  ]);

  if (rosterFetchError || !roster?.player_ids?.length) {
    return NextResponse.json(
      { error: "No roster found. Pick your team first." },
      { status: 400 }
    );
  }

  const currentIds = roster.player_ids as number[];
  const currentNames = (roster.player_names ?? {}) as Record<string, string>;
  const marketPrices: Record<number, number> = {};
  for (const r of priceRows ?? []) {
    if (marketPrices[r.player_id] == null) marketPrices[r.player_id] = r.price;
  }

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

  const rosterPrices = (roster.player_prices ?? {}) as Record<string, number>;
  const keptCost = keptIds.reduce(
    (s, id) => s + (marketPrices[id] ?? rosterPrices[String(id)] ?? 0),
    0
  );
  const addedCost = addedIds.reduce(
    (s, id) => s + (marketPrices[id] ?? addedPrices[String(id)] ?? 0),
    0
  );
  if (keptCost + addedCost > CAP) {
    return NextResponse.json({ error: `Total cost exceeds $${CAP} cap` }, { status: 400 });
  }

  // Store pending subs on roster; applied when sync runs after game is played
  const pendingSubs = {
    removed_ids: removedIds,
    added_ids: addedIds,
    added_prices: addedPrices,
    added_names: addedNames,
    effective_match_id: window.nextMatchId,
  };

  const { error: rosterError } = await admin
    .from("fantasy_user_rosters")
    .update({
      pending_subs: pendingSubs,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("season", seasonNum);

  if (rosterError) {
    return NextResponse.json({ error: rosterError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
