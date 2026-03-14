/**
 * Fantasy scoring formula - re-exports from scoring-core.mjs (single source of truth)
 */

import {
  statsToFantasyPoints as statsToFantasyPointsCore,
  fantasyPPGToPrice as fantasyPPGToPriceCore,
  weightedPPGFromGameFPs as weightedPPGFromGameFPsCore,
  MIN_GAMES_FOR_ADJUSTMENT,
  MAX_CHANGE_HIGH_CONFIDENCE,
  MAX_CHANGE_DEFAULT,
  getMaxPriceChange,
} from "./scoring-core.mjs";

export {
  MIN_GAMES_FOR_ADJUSTMENT,
  MAX_CHANGE_HIGH_CONFIDENCE,
  MAX_CHANGE_DEFAULT,
  getMaxPriceChange,
};

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

export const statsToFantasyPoints = statsToFantasyPointsCore;
export const fantasyPPGToPrice = fantasyPPGToPriceCore;
export const weightedPPGFromGameFPs = weightedPPGFromGameFPsCore;
