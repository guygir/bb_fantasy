import { NextResponse } from "next/server";
import { bbSiteLogin, fetchCountryRoster } from "@/lib/bb-scraper";
import { parseNationalTeamLevel } from "@/lib/bb-national-teams";

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

  if (!process.env.BB_PASSWORD?.trim()) {
    return NextResponse.json(
      { error: "BB_PASSWORD is not configured on this server" },
      { status: 503 }
    );
  }

  const levelParam = new URL(request.url).searchParams.get("level");
  const level = levelParam === null ? "u21" : parseNationalTeamLevel(levelParam);
  if (!level) {
    return NextResponse.json({ error: "level must be either u21 or nt" }, { status: 400 });
  }

  try {
    const cookie = await bbSiteLogin();
    const { teamName, players } = await fetchCountryRoster(id, cookie, level);
    return NextResponse.json({ countryId: id, level, teamName, players });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
