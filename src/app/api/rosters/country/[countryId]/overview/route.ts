import { NextResponse } from "next/server";
import { bbSiteLogin, fetchPlayerGameLog } from "@/lib/bb-scraper";
import { getSeasonStartDate, getGameWeek, isCountingGame } from "@/lib/bb-countries";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

async function batchAsync<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const chunk = await Promise.all(slice.map(fn));
    results.push(...chunk);
  }
  return results;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ countryId: string }> }
) {
  const { countryId } = await params;
  const id = parseInt(countryId, 10);
  if (isNaN(id) || id < 1 || id > 98) {
    return NextResponse.json({ error: "countryId must be between 1 and 98" }, { status: 400 });
  }

  if (!process.env.BB_PASSWORD?.trim()) {
    return NextResponse.json({ error: "BB_PASSWORD is not configured" }, { status: 503 });
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
    return NextResponse.json({ error: "No valid player IDs provided" }, { status: 400 });
  }

  const season = config.game.currentSeason;
  const seasonStart = getSeasonStartDate(season);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - seasonStart.getTime()) / 86400000);
  const currentWeek = diffDays >= 0 && diffDays < 98 ? Math.floor(diffDays / 7) + 1 : null;

  try {
    const cookie = await bbSiteLogin();

    const players = await batchAsync(playerIds, 4, async (playerId) => {
      try {
        const { games, injuryDays } = await fetchPlayerGameLog(playerId, season, cookie);

        const weekMinutesByPosition: Record<string, number> = {};
        const seasonMinutesByPosition: Record<string, number> = {};
        let weekTotal = 0;
        let seasonTotal = 0;

        for (const g of games) {
          if (!isCountingGame(g.gameType)) continue;
          const week = getGameWeek(g.date, season);
          if (week === null) continue;

          if (g.position) {
            seasonMinutesByPosition[g.position] =
              (seasonMinutesByPosition[g.position] ?? 0) + g.minutes;
          }
          seasonTotal += g.minutes;

          if (currentWeek !== null && week === currentWeek) {
            if (g.position) {
              weekMinutesByPosition[g.position] =
                (weekMinutesByPosition[g.position] ?? 0) + g.minutes;
            }
            weekTotal += g.minutes;
          }
        }

        return {
          playerId,
          weekMinutesByPosition,
          seasonMinutesByPosition,
          weekTotal,
          seasonTotal,
          injuryDaysRemaining: injuryDays,
          error: null as string | null,
        };
      } catch (e) {
        return {
          playerId,
          weekMinutesByPosition: {} as Record<string, number>,
          seasonMinutesByPosition: {} as Record<string, number>,
          weekTotal: 0,
          seasonTotal: 0,
          injuryDaysRemaining: "",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    return NextResponse.json({ currentSeason: season, currentWeek, players });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
