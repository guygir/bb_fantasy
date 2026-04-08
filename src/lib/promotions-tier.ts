export type PromotionTierId = "league3" | "league2";

export type PromotionTierConfig = {
  leagueMin: number;
  leagueMax: number;
  /** Rows highlighted as current promotion band */
  promotionBandSize: number;
  pageTitle: string;
  path: string;
  /** Shown in copy (league ID range) */
  leagueIdRange: string;
  /** Other tier path for cross-link */
  otherTierPath: string;
  otherTierShortLabel: string;
};

export const PROMOTION_TIERS: Record<PromotionTierId, PromotionTierConfig> = {
  league3: {
    leagueMin: 1004,
    leagueMax: 1019,
    promotionBandSize: 8,
    pageTitle: "Israel League III — Promotions outlook",
    path: "/promotions",
    leagueIdRange: "1004–1019",
    otherTierPath: "/promotions/2",
    otherTierShortLabel: "League II",
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
  },
};
