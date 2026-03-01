import { NextResponse } from "next/server";
import { loadPriceData } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices/season/71
 * Returns current prices and history (from player_prices JSON).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || 71;

  const data = loadPriceData(seasonNum);
  return NextResponse.json(data);
}
