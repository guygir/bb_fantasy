export type PromotionTierId = "league3" | "league2";

export type PromotionTierConfig = {
  leagueMin: number;
  leagueMax: number;
  /** Fallback when snapshot has no promotion_band_size (pre-migration) */
  promotionBandSize: number;
  pageTitle: string;
  path: string;
  /** Shown in copy (league ID range) */
  leagueIdRange: string;
  /** Other tier path for cross-link */
  otherTierPath: string;
  otherTierShortLabel: string;
  /** First bullet under Ranking — how CPU teams are detected */
  botRuleLine: string;
};

/** League III: 20 L2 demotion slots; bot league = all 16 teams are CPU on standings */
export function promotionBandSizeLeague3(numBotLeagues: number): number {
  const n = 20 - (16 - numBotLeagues);
  return Math.max(0, Math.min(32, n));
}

export const PROMOTION_TIERS: Record<PromotionTierId, PromotionTierConfig> = {
  league3: {
    leagueMin: 1004,
    leagueMax: 1019,
    promotionBandSize: 9,
    pageTitle: "Israel League III — Promotions outlook",
    path: "/promotions",
    leagueIdRange: "1004–1019",
    otherTierPath: "/promotions/2",
    otherTierShortLabel: "League II",
    botRuleLine:
      'Not a bot — teams whose standings row has class "isbot" on the team name cell (CPU teams) are excluded.',
  },
  league2: {
    leagueMin: 1000,
    leagueMax: 1003,
    promotionBandSize: 5,
    pageTitle: "Israel League II — Promotions outlook",
    path: "/promotions/2",
    leagueIdRange: "1000–1003",
    otherTierPath: "/promotions",
    otherTierShortLabel: "League III",
    botRuleLine:
      'Not a bot — teams with "Managed by a computerized player" in the team page logobox are excluded.',
  },
};
