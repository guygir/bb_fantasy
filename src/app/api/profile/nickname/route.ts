import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });
}

/**
 * PATCH /api/profile/nickname
 * Body: { nickname: string }
 * Updates the authenticated user's nickname. Requires auth.
 */
export async function PATCH(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { nickname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
  }

  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (nickname.length < 2) {
    return NextResponse.json(
      { success: false, error: "Nickname must be at least 2 characters" },
      { status: 400 }
    );
  }
  if (nickname.length > 30) {
    return NextResponse.json(
      { success: false, error: "Nickname must be at most 30 characters" },
      { status: 400 }
    );
  }

  const supabase = getSupabase(token);
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Server config error" }, { status: 500 });
  }

  const { data: user } = await supabase.auth.getUser(token);
  if (!user?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ nickname, updated_at: new Date().toISOString() })
    .eq("user_id", user.user.id);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { success: false, error: "Nickname is already taken" },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { nickname } });
}
