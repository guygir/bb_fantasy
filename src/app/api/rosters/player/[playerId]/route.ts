import { NextResponse } from "next/server";
import {
  bbSiteLogin,
  fetchPlayerGameLog,
  fetchPlayerInfoFromBBAPI,
  aggregateGameLogs,
  type SeasonGameLog,
} from "@/lib/bb-scraper";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const DEFAULT_SEASONS = [
  config.u21dle.minSeason,
  config.u21dle.minSeason + 1,
  config.u21dle.minSeason + 2,
  config.u21dle.minSeason + 3,
  config.u21dle.minSeason + 4,
  config.u21dle.minSeason + 5,
  config.u21dle.minSeason + 6,
  config.u21dle.minSeason + 7,
  config.u21dle.minSeason + 8,
  config.u21dle.minSeason + 9,
  config.u21dle.maxSeason,
  config.game.currentSeason,
].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;
  const id = parseInt(playerId, 10);
  if (isNaN(id) || id < 1) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }

  if (!process.env.BB_PASSWORD?.trim()) {
    return NextResponse.json(
      { error: "BB_PASSWORD is not configured on this server" },
      { status: 503 }
    );
  }

  // Allow caller to specify seasons via ?seasons=67,68,69
  const { searchParams } = new URL(request.url);
  const seasonsParam = searchParams.get("seasons");
  const seasons: number[] = seasonsParam
    ? seasonsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0)
    : DEFAULT_SEASONS;

  try {
    // Fetch BBAPI player info and BB site login in parallel
    const [cookie, playerInfo] = await Promise.all([
      bbSiteLogin(),
      fetchPlayerInfoFromBBAPI(id),
    ]);

    const seasonLogs: SeasonGameLog[] = [];
    let injuryDays = "";
    let sitePlayerInfo = null;

    for (const season of seasons) {
      try {
        const result = await fetchPlayerGameLog(id, season, cookie);
        // Capture injury + site player info from the first successful fetch
        if (result.injuryDays || !injuryDays) injuryDays = result.injuryDays;
        if (!sitePlayerInfo && result.sitePlayerInfo) sitePlayerInfo = result.sitePlayerInfo;
        if (result.games.length > 0) {
          seasonLogs.push({ season, games: result.games });
        }
      } catch {
        // Season may not exist for this player — skip silently
      }
    }

    const aggregations = aggregateGameLogs(seasonLogs);

    // Use BBAPI playerInfo if available; fall back to BB site HTML parsing.
    // Either way, overlay the injury days from the BB site (more reliable than BBAPI).
    const baseInfo = playerInfo ?? sitePlayerInfo;
    const enrichedPlayerInfo = baseInfo
      ? { ...baseInfo, injuryDaysRemaining: injuryDays }
      : null;

    return NextResponse.json({
      playerId: id,
      playerInfo: enrichedPlayerInfo,
      seasons: seasonLogs,
      aggregations,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
