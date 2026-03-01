/**
 * Fantasy scoring formula - to be validated against Season 70 data
 *
 * Stats from BuzzerBeater boxscore:
 * MIN, FG (made-attempts), 3FG, FT, +/- , OR, TR, AST, TO, STL, BLK, PF, PTS, RTNG
 */

export interface PlayerGameStats {
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
  plusMinus?: number;
}

/**
 * Proposed formula - weights to be tuned based on Season 70 validation
 *
 * Design goals:
 * - PTS is primary (scoring matters)
 * - Rebounds, assists, stocks (STL, BLK) add value
 * - Turnovers and fouls subtract
 * - Similar production → similar fantasy score (for $ diversity)
 */
export function statsToFantasyPoints(stats: PlayerGameStats): number {
  const dr = stats.tr - stats.or; // defensive rebounds

  return (
    stats.pts * 1.0 +
    dr * 1.2 +
    stats.or * 1.5 +
    stats.ast * 1.5 +
    stats.stl * 2.0 +
    stats.blk * 2.0 -
    stats.to * 1.0 -
    stats.pf * 0.5 +
    stats.tpMade * 0.5 // small bonus for 3s (already in PTS)
  );
}

/**
 * Alternative: simpler formula using RTNG as base
 * Use if custom formula doesn't correlate well with perceived value
 */
export function statsToFantasyPointsSimple(stats: PlayerGameStats): number {
  return (
    stats.rtng * 1.0 +
    stats.stl * 1.0 +
    stats.blk * 1.0 -
    stats.to * 0.5
  );
}

/**
 * Map average fantasy PPG to price tier ($1-10)
 * To be calibrated from Season 70 data distribution
 */
export function fantasyPPGToPrice(ppg: number, percentiles?: number[]): number {
  // Placeholder - will use actual percentiles from data
  // Example tiers (to be replaced):
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
