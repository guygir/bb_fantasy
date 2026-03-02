/**
 * Validate scoring formula against Season 70 data
 * Run: node scripts/validate-scoring.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { statsToFantasyPoints, fantasyPPGToPrice } = await import(join(__dirname, "../src/lib/scoring-core.mjs"));

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
