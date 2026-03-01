/**
 * Validate scoring formula against Season 70 data
 * Run: npx ts-node scripts/validate-scoring.ts
 */

import * as fs from "fs";
import * as path from "path";

// Import scoring formula (inline for standalone run)
interface PlayerGameStats {
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

function statsToFantasyPoints(stats: PlayerGameStats): number {
  const dr = stats.tr - stats.or;
  return (
    stats.pts * 1.0 +
    dr * 1.2 +
    stats.or * 1.5 +
    stats.ast * 1.5 +
    stats.stl * 2.0 +
    stats.blk * 2.0 -
    stats.to * 1.0 -
    stats.pf * 0.5 +
    stats.tpMade * 0.5
  );
}

function fantasyPPGToPrice(ppg: number): number {
  if (ppg >= 25) return 10;
  if (ppg >= 22) return 9;
  if (ppg >= 19) return 8;
  if (ppg >= 16) return 7;
  if (ppg >= 13) return 6;
  if (ppg >= 10) return 5;
  if (ppg >= 7) return 4;
  if (ppg >= 4) return 3;
  if (ppg >= 2) return 2;
  return 1;
}

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

function main() {
  const dataPath = path.join(__dirname, "../data/season70_stats.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  const results: Array<{
    name: string;
    pts: number;
    rtng: number;
    fantasyPPG: number;
    price: number;
  }> = [];

  for (const p of data.players as Season70Player[]) {
    const stats: PlayerGameStats = {
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

    results.push({
      name: p.name,
      pts: p.pts,
      rtng: p.rtng,
      fantasyPPG: Math.round(fantasyPPG * 100) / 100,
      price,
    });
  }

  // Sort by fantasy PPG descending
  results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);

  console.log("\n=== Season 70 Scoring Formula Validation ===\n");
  console.log("Player               | PTS   | RTNG | Fantasy PPG | $");
  console.log("--------------------|-------|------|--------------|---");

  for (const r of results) {
    console.log(
      `${r.name.padEnd(20)} | ${r.pts.toFixed(1).padStart(5)} | ${r.rtng.toFixed(1).padStart(4)} | ${r.fantasyPPG.toFixed(2).padStart(12)} | ${r.price}`
    );
  }

  // Summary stats
  const fantasyPPGs = results.map((r) => r.fantasyPPG);
  const avg = fantasyPPGs.reduce((a, b) => a + b, 0) / fantasyPPGs.length;
  const min = Math.min(...fantasyPPGs);
  const max = Math.max(...fantasyPPGs);

  console.log("\n--- Summary ---");
  console.log(`Fantasy PPG: min=${min.toFixed(2)}, max=${max.toFixed(2)}, avg=${avg.toFixed(2)}`);

  // Price distribution
  const distribution: Record<number, number> = {};
  for (const r of results) {
    distribution[r.price] = (distribution[r.price] || 0) + 1;
  }
  console.log("Price distribution:", distribution);

  // Correlation check: RTNG vs Fantasy PPG
  const rtngs = results.map((r) => r.rtng);
  const fppg = results.map((r) => r.fantasyPPG);
  const n = results.length;
  const meanRtng = rtngs.reduce((a, b) => a + b, 0) / n;
  const meanFppg = fppg.reduce((a, b) => a + b, 0) / n;
  let cov = 0,
    varRtng = 0,
    varFppg = 0;
  for (let i = 0; i < n; i++) {
    cov += (rtngs[i] - meanRtng) * (fppg[i] - meanFppg);
    varRtng += (rtngs[i] - meanRtng) ** 2;
    varFppg += (fppg[i] - meanFppg) ** 2;
  }
  const correlation = cov / Math.sqrt(varRtng * varFppg);
  console.log(`RTNG vs Fantasy PPG correlation: ${correlation.toFixed(3)}`);
}

main();
