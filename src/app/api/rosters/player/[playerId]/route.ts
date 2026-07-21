import { NextResponse } from "next/server";
import {
  bbSiteLogin,
  fetchPlayerAvailableSeasons,
  fetchPlayerGameLog,
  fetchPlayerInfoFromBBAPI,
  aggregateGameLogs,
  type SeasonGameLog,
} from "@/lib/bb-scraper";
import { parseNationalTeamLevel } from "@/lib/bb-national-teams";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const DEFAULT_U21_SEASONS = Array.from(
  { length: config.game.currentSeason - config.u21dle.minSeason + 1 },
  (_, i) => config.u21dle.minSeason + i
);

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
  // For NT, when seasons are omitted, use the player's BB season dropdown (no U21dle min floor).
  const { searchParams } = new URL(request.url);
  const seasonsParam = searchParams.get("seasons");
  const levelParam = searchParams.get("level");
  const level = levelParam === null ? "u21" : parseNationalTeamLevel(levelParam);
  if (levelParam !== null && !level) {
    return NextResponse.json({ error: "level must be either u21 or nt" }, { status: 400 });
  }

  let seasons: number[] | null = seasonsParam
    ? seasonsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0)
    : null;

  try {
    // Fetch BBAPI player info and BB site login in parallel
    const [cookie, playerInfo] = await Promise.all([
      bbSiteLogin(),
      fetchPlayerInfoFromBBAPI(id),
    ]);

    if (!seasons) {
      if (level === "nt") {
        seasons = await fetchPlayerAvailableSeasons(id, cookie);
        if (seasons.length === 0) seasons = DEFAULT_U21_SEASONS;
      } else {
        seasons = DEFAULT_U21_SEASONS;
      }
    }

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
