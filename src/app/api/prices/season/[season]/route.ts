import { NextResponse } from "next/server";
import { loadPriceData } from "@/lib/prices";
import { hasFantasyData, getPriceDataFromSupabase } from "@/lib/fantasy-db";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices/season/[season]
 * Returns current prices and history (Supabase first, JSON fallback).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || config.game.currentSeason;

  if (await hasFantasyData(seasonNum)) {
    const data = await getPriceDataFromSupabase(seasonNum);
    if (data) return NextResponse.json(data);
  }
  const data = loadPriceData(seasonNum);
  return NextResponse.json(data);
}
