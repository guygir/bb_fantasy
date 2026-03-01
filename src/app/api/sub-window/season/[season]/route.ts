import { NextResponse } from "next/server";
import { getSubWindow } from "@/lib/sub-lock";

export const dynamic = "force-dynamic";

/**
 * GET /api/sub-window/season/71
 * Returns whether substitutions are allowed (1h after prev game until 1h before next).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || Number(process.env.CURRENT_SEASON ?? process.env.NEXT_PUBLIC_CURRENT_SEASON ?? 71);
  try {
    const window = await getSubWindow(seasonNum);
    return NextResponse.json(window);
  } catch (e) {
    return NextResponse.json({ open: false }, { status: 500 });
  }
}
