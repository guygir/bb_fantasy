import { NextResponse } from "next/server";
import { getPlayersWithDetails } from "@/lib/players";
import { hasFantasyData, getPlayersFromSupabase } from "@/lib/fantasy-db";
import { loadPriceData } from "@/lib/prices";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Get previous week price from history (JSON). history[playerId][1] = previous when newest-first. */
function getPreviousPrices(season: number): Record<number, number> {
  try {
    const data = loadPriceData(season);
    const out: Record<number, number> = {};
    for (const [playerIdStr, entries] of Object.entries(data.history ?? {})) {
      const arr = entries as { price: number }[];
      if (arr.length >= 2) out[Number(playerIdStr)] = arr[1].price;
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ season: string }> }
) {
  const { season } = await params;
  const seasonNum = parseInt(season, 10) || config.game.currentSeason;

  const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" };

  try {
    if (await hasFantasyData(seasonNum)) {
      const players = await getPlayersFromSupabase(seasonNum);
      if (players) {
        // Use previous_price from Supabase (synced from JSON history) for price arrows
        return NextResponse.json(
          {
            meta: { season: seasonNum, source: "supabase", count: players.length },
            players: players.map((p) => ({ ...p, previousPrice: p.previousPrice ?? null })),
          },
          { headers: noCache }
        );
      }
    }
    const previousPrices = getPreviousPrices(seasonNum);
    const players = await getPlayersWithDetails(seasonNum);
    return NextResponse.json(
      {
        meta: { season: seasonNum, source: "stats+bbapi", count: players.length },
        players: players.map((p) => ({
          ...p,
          previousPrice: previousPrices[p.playerId] ?? null,
        })),
      },
      { headers: noCache }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 404 }
    );
  }
}
