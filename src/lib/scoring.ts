/**
 * Fantasy scoring formula
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
}

export function statsToFantasyPoints(stats: PlayerGameStats): number {
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

export function fantasyPPGToPrice(ppg: number): number {
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
