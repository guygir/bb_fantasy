import Link from "next/link";
import { getNextPromotionsScheduledRunUtc } from "@/lib/promotions-schedule";
import type { LatestRankChange, PromotionEntry } from "@/lib/promotions";
import type { PromotionTierConfig, PromotionTierId } from "@/lib/promotions-tier";

function formatSnapshot(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function LatestChangeCell({ change }: { change: LatestRankChange }) {
  if (change.kind === "none") {
    return (
      <span className="text-gray-400" title="No previous snapshot or team was outside the ranked list last time">
        —
      </span>
    );
  }
  if (change.kind === "same") {
    return (
      <span className="text-gray-700" aria-label="Same overall rank as previous update">
        Same rank
      </span>
    );
  }
  if (change.kind === "up") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <span className="text-gray-700">Moved:</span>
        <span
          className="inline-flex items-center gap-0.5 font-medium tabular-nums text-green-600"
          aria-label={`Moved up ${change.magnitude} places in overall rank`}
        >
          <span aria-hidden>↑</span>
          {change.magnitude}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="text-gray-700">Moved:</span>
      <span
        className="inline-flex items-center gap-0.5 font-medium tabular-nums text-red-600"
        aria-label={`Moved down ${change.magnitude} places in overall rank`}
      >
        <span aria-hidden>↓</span>
        {change.magnitude}
      </span>
    </span>
  );
}

/** Green = first `bandSize` rows that are not champion (yellow). Champs skip the green quota. */
function buildRowStyles(entries: PromotionEntry[], bandSize: number): { row: PromotionEntry; className: string }[] {
  let greenLeft = bandSize;
  const out: { row: PromotionEntry; className: string }[] = [];
  for (const row of entries) {
    if (row.is_champ === "Yes") {
      out.push({ row, className: "bg-yellow-100 hover:bg-yellow-200/90" });
    } else if (greenLeft > 0) {
      greenLeft -= 1;
      out.push({ row, className: "bg-green-50 hover:bg-green-100/90" });
    } else {
      out.push({ row, className: "hover:bg-gray-50/80" });
    }
  }
  return out;
}

type PromotionsViewProps = {
  tierId: PromotionTierId;
  tier: PromotionTierConfig;
  snapshotAt: string | null;
  previousSnapshotAt: string | null;
  entries: PromotionEntry[];
  error: string | null;
  promotionBandSize: number;
  numBotLeagues: number | null;
};

export function PromotionsView({
  tierId,
  tier,
  snapshotAt,
  previousSnapshotAt,
  entries,
  error,
  promotionBandSize,
  numBotLeagues,
}: PromotionsViewProps) {
  const nextScheduledAt = formatSnapshot(getNextPromotionsScheduledRunUtc().toISOString());
  const band = promotionBandSize;
  const styledRows = entries.length > 0 ? buildRowStyles(entries, band) : [];

  return (
    <div className="text-sm text-gray-600">
      <h2 className="mb-3 text-lg font-semibold text-bb-text sm:text-xl">{tier.pageTitle}</h2>
      <div className="mb-4 max-w-3xl">
        <p className="mb-1 font-medium text-bb-text">Ranking</p>
        <ol className="ml-5 list-decimal space-y-0.5">
          <li>{tier.botRuleLine}</li>
          <li>Conference rank (all 1st-place finishes before 2nd, before 3rd).</li>
          <li>Wins — higher is better.</li>
          <li>Point differential — higher is better.</li>
        </ol>
        {tierId === "league3" && numBotLeagues != null && (
          <p className="mt-3 text-gray-500">
            Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span>. League II has 5
            demotion slots per league × 4 leagues = <strong className="text-bb-text">20</strong> demotions, so 20
            promotion slots from League III. A League III division is a{" "}
            <strong className="text-bb-text">bot league</strong> if all 16 teams are CPU (standings{" "}
            <code className="rounded bg-gray-100 px-1">isbot</code>). Promotion band size ={" "}
            <strong className="font-mono text-bb-text">20 − (16 − bot leagues)</strong> → with{" "}
            <strong className="text-bb-text">{numBotLeagues}</strong> bot league{numBotLeagues === 1 ? "" : "s"}:{" "}
            <strong className="text-bb-text">{band}</strong> rows. Rows are highlighted{" "}
            <strong className="text-bb-text">green</strong> in rank order until that many non-champion slots are
            filled; <strong className="text-bb-text">Is champ? = Yes</strong> uses yellow and does not consume a
            green slot.
          </p>
        )}
        {tierId === "league2" && (
          <p className="mt-3 text-gray-500">
            Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span> · First{" "}
            <span className="font-medium text-bb-text">{band}</span> non-champion rows (green) are the promotion
            band; champions (yellow) skip the green count.
          </p>
        )}
        {tierId === "league3" && numBotLeagues == null && (
          <p className="mt-3 text-gray-500">
            Leagues covered: <span className="font-medium text-bb-text">{tier.leagueIdRange}</span> · Run{" "}
            <code className="rounded bg-gray-100 px-1">npm run fetch-promotions</code> after migration{" "}
            <code className="rounded bg-gray-100 px-1">027</code> so the snapshot stores bot-league counts (formula{" "}
            <span className="font-mono">20 − (16 − bot leagues)</span>). Until then, green rows use the fallback band
            size <strong className="text-bb-text">{band}</strong> when present.
          </p>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          {error}
        </p>
      )}

      {!error && entries.length === 0 && (
        <p className="text-gray-600">
          No snapshot yet. After migrations are applied and{" "}
          <code className="rounded bg-gray-100 px-1">npm run fetch-promotions</code> has run, the table will appear
          here.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <p className="mb-4 text-gray-500">
            Last updated: {formatSnapshot(snapshotAt)}
            {previousSnapshotAt != null && (
              <>
                {" "}
                · Compared to: {formatSnapshot(previousSnapshotAt)}
              </>
            )}
            {" "}
            · Next scheduled update: {nextScheduledAt}
            {" "}
            · Promotion band (green target): <strong className="text-bb-text">{band}</strong> non-champion rows
          </p>
          <div className="overflow-x-auto rounded-lg border border-bb-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card-bg">
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">#</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Team</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">League</th>
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">Conf rank</th>
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">W</th>
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">L</th>
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">PD</th>
                  <th className="border border-bb-border px-3 py-2 text-left font-medium">Latest change</th>
                  <th className="border border-bb-border px-3 py-2 text-right font-medium">Is champ?</th>
                </tr>
              </thead>
              <tbody>
                {styledRows.map(({ row, className }) => {
                  const leagueUrl = `https://buzzerbeater.com/league/${row.league_id}/overview.aspx`;
                  return (
                    <tr
                      key={`${row.display_rank}-${row.league_id}-${row.conf}-${row.conf_rank}`}
                      className={className}
                    >
                      <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                        {row.display_rank}
                      </td>
                      <td className="border border-bb-border px-3 py-2 font-medium">
                        {row.team_url ? (
                          <a
                            href={row.team_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-exact hover:underline"
                          >
                            {row.team_name}
                          </a>
                        ) : (
                          row.team_name
                        )}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-gray-700">
                        <a
                          href={leagueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-exact hover:underline font-medium"
                        >
                          {row.league_name}{" "}
                          <span className="font-normal text-gray-400">({row.league_id})</span>
                        </a>
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                        {row.conf_rank}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                        {row.wins}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                        {row.losses}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                        {row.pd}
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-left">
                        <LatestChangeCell change={row.latestRankChange} />
                      </td>
                      <td className="border border-bb-border px-3 py-2 text-right font-medium text-bb-text">
                        {row.is_champ}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-gray-500">
        <Link href="/" className="text-exact hover:underline font-medium">
          ← Home
        </Link>
        <Link href={tier.otherTierPath} className="text-exact hover:underline font-medium">
          {tier.otherTierShortLabel} promotions →
        </Link>
      </p>
    </div>
  );
}
