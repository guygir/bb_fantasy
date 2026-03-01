import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSubWindow } from "@/lib/sub-lock";

export const dynamic = "force-dynamic";

function getSupabaseWithAuth(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/**
 * GET /api/sub-window/season/71
 * Returns whether substitutions are allowed (1h after prev game until 1h before next).
 * With Authorization header: also returns subsUsedThisWindow (one round per game).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 71);
  let userId: string | undefined;
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const supabase = getSupabaseWithAuth(authHeader);
    if (supabase) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: { user } } = await supabase.auth.getUser(token ?? "");
      userId = user?.id;
    }
  }
  try {
    const window = await getSubWindow(seasonNum, userId);
    return NextResponse.json(window);
  } catch (e) {
    return NextResponse.json({ open: false }, { status: 500 });
  }
}
