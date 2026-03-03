import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/debug/leaderboard-nicknames
 * Admin: force-update nickname for a user. Body: { userId, nickname }.
 * Requires ?adminSecret=... matching ADMIN_SECRET in .env.local.
 */
export async function PATCH(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("adminSecret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { userId?: string; nickname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = body?.userId;
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  if (!userId || nickname.length < 2 || nickname.length > 30) {
    return NextResponse.json(
      { error: "Body: { userId: string, nickname: string (2-30 chars) }" },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { error: profileErr } = await admin
    .from("profiles")
    .update({ nickname, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }
  const { error: rosterErr } = await admin
    .from("fantasy_user_rosters")
    .update({ nickname, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, userId, nickname });
}

/**
 * GET /api/debug/leaderboard-nicknames?season=71
 * Debug nickname source for leaderboard. Returns raw profiles + rosters data.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season") ?? String(config.game.currentSeason), 10);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "No Supabase admin" }, { status: 500 });
  }

  const [rostersRes, profilesRes] = await Promise.all([
    admin.from("fantasy_user_rosters").select("user_id, total_fantasy_points, nickname").eq("season", season),
    admin.from("profiles").select("user_id, nickname, username"),
  ]);

  const rosters = rostersRes.data ?? [];
  const profiles = profilesRes.data ?? [];

  const profilesMap = new Map(profiles.map((p) => [p.user_id, p]));

  const debug = rosters.map((r) => {
    const profile = profilesMap.get(r.user_id);
    const profileNickname = profile?.nickname ?? profile?.username ?? null;
    const rosterNickname = (r.nickname as string | null)?.trim() || null;
    const resolved =
      (profileNickname ?? rosterNickname) || "?";
    return {
      user_id: r.user_id,
      profile_nickname: profileNickname,
      profile_username: profile?.username ?? null,
      roster_nickname: rosterNickname,
      resolved,
      total_fantasy_points: r.total_fantasy_points,
    };
  });

  return NextResponse.json({
    season,
    profilesCount: profiles.length,
    rostersCount: rosters.length,
    rawProfiles: profiles.map((p) => ({ user_id: p.user_id, nickname: p.nickname, username: p.username })),
    rawRosters: rosters.map((r) => ({ user_id: r.user_id, nickname: r.nickname })),
    debug,
  });
}
