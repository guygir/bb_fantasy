/**
 * Validate scoring formula against Season 70 data
 * Run: node scripts/validate-scoring.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function statsToFantasyPoints(stats) {
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

function fantasyPPGToPrice(ppg) {
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

const data = JSON.parse(
  readFileSync(join(__dirname, "../data/season70_stats.json"), "utf-8")
);

const results = data.players.map((p) => {
  const stats = {
    or: p.or,
    tr: p.tr,
    ast: p.ast,
    to: p.to,
    stl: p.stl,
    blk: p.blk,
    pf: p.pf,
    pts: p.pts,
    tpMade: p.tpMade,
  };
  const fantasyPPG = statsToFantasyPoints(stats);
  return {
    name: p.name,
    pts: p.pts,
    rtng: p.rtng,
    fantasyPPG,
    price: fantasyPPGToPrice(fantasyPPG),
  };
});

results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);

console.log("\n=== Season 70 Scoring Formula Validation ===\n");
console.log("Player               | PTS   | RTNG | Fantasy PPG | $");
console.log("--------------------|-------|------|--------------|---");

results.forEach((r) => {
  console.log(
    `${r.name.padEnd(20)} | ${r.pts.toFixed(1).padStart(5)} | ${r.rtng.toFixed(1).padStart(4)} | ${r.fantasyPPG.toFixed(2).padStart(12)} | ${r.price}`
  );
});

const distribution = {};
results.forEach((r) => {
  distribution[r.price] = (distribution[r.price] || 0) + 1;
});
console.log("\nPrice distribution:", distribution);

const fantasyPPGs = results.map((r) => r.fantasyPPG);
const avg = fantasyPPGs.reduce((a, b) => a + b, 0) / fantasyPPGs.length;
console.log(
  `\nFantasy PPG: min=${Math.min(...fantasyPPGs).toFixed(2)}, max=${Math.max(...fantasyPPGs).toFixed(2)}, avg=${avg.toFixed(2)}`
);
