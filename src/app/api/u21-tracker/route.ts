import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { loadAllRosterChanges, loadCountrySeries } from "@/lib/u21-tracker";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = Number(searchParams.get("season") ?? config.game.currentSeason);
  const countryIdParam = searchParams.get("countryId");

  if (!Number.isFinite(season) || season < 1) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  if (countryIdParam == null) {
    const { meta, changesToday, changesThisWeek, onSale, onSaleUpdatedAt } =
      await loadAllRosterChanges(season);
    if (!meta) {
      return NextResponse.json(
        { error: `No U21 tracker data for season ${season} yet` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ...meta,
      changesToday,
      changesThisWeek,
      onSale,
      onSaleUpdatedAt,
    });
  }

  const countryId = Number(countryIdParam);
  if (!Number.isFinite(countryId) || countryId < 1) {
    return NextResponse.json({ error: "Invalid countryId" }, { status: 400 });
  }

  const series = await loadCountrySeries(season, countryId);
  if (!series.country && series.players.length === 0) {
    return NextResponse.json(
      { error: `No tracker data for country ${countryId} in season ${season}` },
      { status: 404 }
    );
  }

  return NextResponse.json({ season, ...series });
}
