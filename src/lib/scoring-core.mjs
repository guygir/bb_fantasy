/**
 * Shared scoring logic - single source of truth for scripts and app.
 * Edit this file to adjust fantasy formula and PPG→Price tiers.
 *
 * Used by: src/lib/scoring.ts, scripts/update-prices.mjs, scripts/simulate-prices.mjs,
 *          scripts/process-boxscores.mjs, scripts/validate-scoring.mjs
 */

/**
 * Fantasy points from per-game stats.
 * Formula: PTS + DR*1.2 + OR*1.5 + AST*1.5 + STL*2 + BLK*2 - TO - PF*0.5 + 3PM*0.5
 */
export function statsToFantasyPoints(stats) {
  const dr = (stats.tr ?? 0) - (stats.or ?? 0);
  return (
    (stats.pts ?? 0) * 1.0 +
    dr * 1.2 +
    (stats.or ?? 0) * 1.5 +
    (stats.ast ?? 0) * 1.8 +
    (stats.stl ?? 0) * 2.0 +
    (stats.blk ?? 0) * 2.0 -
    (stats.to ?? 0) * 1.0 -
    (stats.pf ?? 0) * 1.0 +
    (stats.tpMade ?? 0) * 0.5
  );
}

/**
 * Price adjustment (per game): min games before adjusting, max change by confidence.
 * 1–3 games → ±1, 4+ games → ±2.
 */
export const MIN_GAMES_FOR_ADJUSTMENT = 2;
export const MAX_CHANGE_HIGH_CONFIDENCE = 2; // 4+ games
export const MAX_CHANGE_DEFAULT = 1; // 1–3 games

/** Max price change for a player with given games played */
export function getMaxPriceChange(gp) {
  return gp >= 3 ? MAX_CHANGE_HIGH_CONFIDENCE : MAX_CHANGE_DEFAULT;
}

/**
 * PPG → Price tiers ($1–$10). Adjust thresholds here.
 */
export function fantasyPPGToPrice(ppg) {
  if (ppg >= 27) return 10;
  if (ppg >= 24) return 9;
  if (ppg >= 21) return 8;
  if (ppg >= 18) return 7;
  if (ppg >= 15) return 6;
  if (ppg >= 12) return 5;
  if (ppg >= 9) return 4;
  if (ppg >= 6) return 3;
  if (ppg >= 3) return 2;
  return 1;
}

/**
 * Weighted PPG from game FPs: decay 30%/20%/10%/5%/2.5%... (last games more), scale to 100%.
 * Used for Option 5 price target (recent performance matters more).
 */
export function weightedPPGFromGameFPs(gameFPs) {
  if (!gameFPs?.length) return 0;
  const rawWeights = [0.3, 0.2, 0.1];
  for (let i = 3; i < 20; i++) rawWeights.push(rawWeights[i - 1] / 2);
  const n = Math.min(gameFPs.length, rawWeights.length);
  const usedWeights = rawWeights.slice(0, n);
  const totalWeight = usedWeights.reduce((s, w) => s + w, 0);
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += usedWeights[i] * gameFPs[gameFPs.length - 1 - i];
  }
  return totalWeight > 0 ? weightedSum / totalWeight : gameFPs.reduce((a, b) => a + b, 0) / gameFPs.length;
}
