/**
 * Data layer - reads from JSON for now; will switch to Supabase later
 */

import { readFileSync } from "fs";
import { join } from "path";
import { statsToFantasyPoints, fantasyPPGToPrice } from "./scoring";

interface Season70Player {
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

export interface PlayerWithPrice {
  playerId: number;
  name: string;
  price: number;
  pts: number;
  rtng: number;
  fantasyPPG: number;
}

export async function playersWithPrices(): Promise<PlayerWithPrice[]> {
  const dataPath = join(process.cwd(), "data", "season70_stats.json");
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));

  const results: PlayerWithPrice[] = (data.players as Season70Player[]).map((p) => {
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
    const price = fantasyPPGToPrice(fantasyPPG);

    return {
      playerId: p.playerId,
      name: p.name,
      price,
      pts: p.pts,
      rtng: p.rtng,
      fantasyPPG,
    };
  });

  return results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);
}
