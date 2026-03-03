import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";

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
 * GET /api/profile
 * Returns the current user's profile (nickname). Server-side fetch avoids client cache issues.
 * Use Cache-Control: no-store so hard refresh always gets fresh data.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ nickname: null }, {
      status: 200,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  const supabaseAuth = getSupabase(token);
  if (!supabaseAuth) {
    return NextResponse.json({ nickname: null }, {
      status: 500,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  const { data: user } = await supabaseAuth.auth.getUser(token);
  if (!user?.user) {
    return NextResponse.json({ nickname: null }, {
      status: 200,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.user.id)
    .maybeSingle();

  const nickname = data?.nickname ?? null;
  return NextResponse.json(
    { nickname },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
