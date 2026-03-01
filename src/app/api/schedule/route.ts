import { NextResponse } from "next/server";
import { bbapiLogin, bbapiSchedule } from "@/lib/bbapi";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season");
  const seasonNum = season ? parseInt(season, 10) : config.game.currentSeason;

  const { session, ok } = await bbapiLogin(config.bbapi.login, config.bbapi.code);
  if (!ok) {
    return NextResponse.json({ error: "BBAPI login failed" }, { status: 401 });
  }

  try {
    const xml = await bbapiSchedule(session, config.game.israelU21TeamId, seasonNum);

    // Parse matches - simple regex for structure
    const matches: Array<{
      id: string;
      start: string;
      type: string;
      awayTeamId: string;
      awayTeamName: string;
      awayScore: string | null;
      homeTeamId: string;
      homeTeamName: string;
      homeScore: string | null;
    }> = [];

    const matchBlockRegex =
      /<match id='(\d+)' start='([^']*)' type='([^']*)'>[\s\S]*?<awayTeam id='(\d+)'>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?[\s\S]*?<homeTeam id='(\d+)'>[\s\S]*?<teamName>([^<]*)<\/teamName>[\s\S]*?(?:<score[^>]*>(\d+)<\/score>)?/g;
    let m;
    while ((m = matchBlockRegex.exec(xml)) !== null) {
      matches.push({
        id: m[1],
        start: m[2],
        type: m[3],
        awayTeamId: m[4],
        awayTeamName: m[5],
        awayScore: m[6] || null,
        homeTeamId: m[7],
        homeTeamName: m[8],
        homeScore: m[9] || null,
      });
    }

    return NextResponse.json({
      meta: { source: "BBAPI", teamId: config.game.israelU21TeamId, season: seasonNum },
      matches,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
