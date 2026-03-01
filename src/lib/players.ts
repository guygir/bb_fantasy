/**
 * Players data - Season 71 with BBAPI details (position, DMI, salary)
 * Uses cached player_details_s{N}.json when available (run: npm run fetch-player-details)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { bbapiLogin, bbapiPlayer } from "./bbapi";
import { config } from "./config";
import { statsToFantasyPoints, fantasyPPGToPrice } from "./scoring";
import type { PlayerWithDetails } from "./types";

interface SeasonPlayer {
  playerId: number;
  name: string;
  gp: number;
  min: number;
  fgMade: number;
  fgAtt: number;
  tpMade: number;
  tpAtt: number;
  ftMade: number;
  ftAtt: number;
  or: number;
  tr: number;
  ast: number;
  to: number;
  stl: number;
  blk: number;
  pf: number;
  pts: number;
  rtng: number;
}

function parsePlayerXml(xml: string): { position: string; dmi: number; salary: number; gameShape: number | null } | null {
  const posMatch = xml.match(/<bestPosition>([^<]*)<\/bestPosition>/);
  const dmiMatch = xml.match(/<dmi>(\d+)<\/dmi>/);
  const salaryMatch = xml.match(/<salary>(\d+)<\/salary>/);
  const gameShapeMatch = xml.match(/<gameShape>(\d+)<\/gameShape>/);
  if (!posMatch && !dmiMatch && !salaryMatch && !gameShapeMatch) return null;
  return {
    position: posMatch?.[1] ?? "?",
    dmi: dmiMatch ? parseInt(dmiMatch[1], 10) : 0,
    salary: salaryMatch ? parseInt(salaryMatch[1], 10) : 0,
    gameShape: gameShapeMatch ? parseInt(gameShapeMatch[1], 10) : null,
  };
}

function loadPlayerDetailsCache(season: number): Record<number, { position: string; dmi: number | null; salary: number | null; gameShape: number | null }> {
  const path = join(process.cwd(), "data", `player_details_s${season}.json`);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.details ?? {};
  } catch {
    return {};
  }
}

export async function getPlayersWithDetails(season: number): Promise<PlayerWithDetails[]> {
  const dataPath = join(process.cwd(), "data", `season${season}_stats.json`);
  if (!existsSync(dataPath)) {
    throw new Error(`No stats for season ${season}`);
  }

  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const players: SeasonPlayer[] = data.players ?? [];
  const cache = loadPlayerDetailsCache(season);

  const { session, ok } = await bbapiLogin(config.bbapi.login, config.bbapi.code);

  const results: PlayerWithDetails[] = await Promise.all(
    players.map(async (p) => {
      const stats = {
        min: p.min,
        fgMade: p.fgMade,
        fgAtt: p.fgAtt,
        tpMade: p.tpMade,
        tpAtt: p.tpAtt,
        ftMade: p.ftMade,
        ftAtt: p.ftAtt,
        or: p.or,
        tr: p.tr,
        ast: p.ast,
        to: p.to,
        stl: p.stl,
        blk: p.blk,
        pf: p.pf,
        pts: p.pts,
        rtng: p.rtng,
      };
      const fantasyPPG = statsToFantasyPoints(stats);
      const inGamePrice = fantasyPPGToPrice(fantasyPPG);

      let position = "?";
      let dmi: number | null = null;
      let salary: number | null = null;
      let gameShape: number | null = null;

      const cached = cache[p.playerId];
      if (cached) {
        position = cached.position;
        dmi = cached.dmi;
        salary = cached.salary;
        gameShape = cached.gameShape ?? null;
      } else if (ok) {
        try {
          const xml = await bbapiPlayer(session, p.playerId);
          const details = parsePlayerXml(xml);
          if (details) {
            position = details.position;
            dmi = details.dmi || null;
            salary = details.salary || null;
            gameShape = details.gameShape ?? null;
          }
        } catch {
          // Ignore - use defaults
        }
      }

      return {
        playerId: p.playerId,
        name: p.name,
        image: `https://buzzerbeater.com/player/${p.playerId}/overview.aspx`,
        position,
        dmi,
        salary,
        inGamePrice,
        avgRating: p.rtng,
        pts: p.pts,
        fantasyPPG,
        gameShape,
      };
    })
  );

  return results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);
}
