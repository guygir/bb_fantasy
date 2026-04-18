import { NextResponse } from "next/server";
import { bbSiteLogin, fetchPlayerInjuryFromSite } from "@/lib/bb-scraper";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ countryId: string }> }
) {
  const { countryId } = await params;
  const id = parseInt(countryId, 10);
  if (isNaN(id) || id < 1 || id > 98) {
    return NextResponse.json({ error: "countryId must be between 1 and 98" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const playerIdsParam = searchParams.get("playerIds");
  if (!playerIdsParam) {
    return NextResponse.json({ error: "playerIds query param required" }, { status: 400 });
  }

  const playerIds = playerIdsParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  if (playerIds.length === 0) {
    return NextResponse.json({ error: "No valid player IDs" }, { status: 400 });
  }

  if (!process.env.BB_PASSWORD?.trim()) {
    return NextResponse.json({ error: "BB_PASSWORD is not configured" }, { status: 503 });
  }

  try {
    const cookie = await bbSiteLogin();
    const results = await Promise.all(
      playerIds.map(async (playerId) => ({
        playerId,
        injuryDaysRemaining: await fetchPlayerInjuryFromSite(playerId, cookie),
      }))
    );
    return NextResponse.json({ players: results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
