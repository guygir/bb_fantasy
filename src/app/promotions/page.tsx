import type { Metadata } from "next";
import { PROMOTION_TIERS } from "@/lib/promotions-tier";
import { getLatestPromotions } from "@/lib/promotions";
import { PromotionsView } from "./PromotionsView";

export const metadata: Metadata = {
  title: "League III Promotions | BB Israel U21 Fantasy",
  description:
    "Israel League III conference leaders (scraped from BuzzerBeater) ranked for promotion tracking.",
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PromotionsPage() {
  const tier = PROMOTION_TIERS.league3;
  const {
    snapshotAt,
    previousSnapshotAt,
    entries,
    error,
    promotionBandSize,
    numBotLeagues,
    promotionNews,
  } = await getLatestPromotions("league3");

  return (
    <PromotionsView
      tierId="league3"
      tier={tier}
      snapshotAt={snapshotAt}
      previousSnapshotAt={previousSnapshotAt}
      entries={entries}
      error={error}
      promotionBandSize={promotionBandSize}
      numBotLeagues={numBotLeagues}
      promotionNews={promotionNews}
    />
  );
}
