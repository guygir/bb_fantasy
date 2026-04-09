import type { Metadata } from "next";
import { PROMOTION_TIERS } from "@/lib/promotions-tier";
import { getLatestPromotions } from "@/lib/promotions";
import { PromotionsView } from "../PromotionsView";

export const metadata: Metadata = {
  title: "League II Promotions | BB Israel U21 Fantasy",
  description:
    "Israel League II conference leaders (scraped from BuzzerBeater) ranked for promotion tracking.",
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function PromotionsLeague2Page() {
  const tier = PROMOTION_TIERS.league2;
  const {
    snapshotAt,
    previousSnapshotAt,
    entries,
    error,
    promotionBandSize,
    numBotLeagues,
  } = await getLatestPromotions("league2");

  return (
    <PromotionsView
      tierId="league2"
      tier={tier}
      snapshotAt={snapshotAt}
      previousSnapshotAt={previousSnapshotAt}
      entries={entries}
      error={error}
      promotionBandSize={promotionBandSize}
      numBotLeagues={numBotLeagues}
    />
  );
}
