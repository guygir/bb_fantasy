import type { Metadata } from "next";
import Link from "next/link";
import type { LatestRankChange } from "@/lib/promotions";
import { getLatestPromotions } from "@/lib/promotions";

export const metadata: Metadata = {
  title: "League III Promotions | BB Israel U21 Fantasy",
  description:
    "Israel League III conference leaders (scraped from BuzzerBeater) ranked for promotion tracking.",
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
      <span className="text-gray-400" title="No previous snapshot or team was outside top 32 last time">
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
      <span className="inline-flex flex-wrap items-center gap-x-1 text-sm">
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
    <span className="inline-flex flex-wrap items-center gap-x-1 text-sm">
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

export default async function PromotionsPage() {
  const { snapshotAt, previousSnapshotAt, entries, error } = await getLatestPromotions();

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Israel League III — Promotions outlook</h2>
      <div className="mb-4 max-w-3xl text-sm text-gray-600">
        <p className="mb-1 font-medium text-bb-text">Ranking</p>
        <ol className="ml-5 list-decimal space-y-0.5">
          <li>Not a bot — teams with &quot;Managed by a computerized player&quot; on the team page are excluded.</li>
          <li>Conference rank (all 1st-place finishes before 2nd, before 3rd).</li>
          <li>Wins — higher is better.</li>
          <li>Point differential — higher is better.</li>
        </ol>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      )}

      {!error && entries.length === 0 && (
        <p className="text-gray-500">
          No snapshot yet. After the migration is applied and{" "}
          <code className="rounded bg-gray-100 px-1">npm run fetch-promotions</code> has run, the
          table will appear here.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <p className="mb-4 text-sm text-gray-500">
            Last updated: {formatSnapshot(snapshotAt)}
            {previousSnapshotAt != null && (
              <>
                {" "}
                · Compared to: {formatSnapshot(previousSnapshotAt)}
              </>
            )}
          </p>
          <div className="overflow-x-auto rounded-lg border border-bb-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card-bg">
                  <th className="border border-bb-border px-3 py-2 text-right">#</th>
                  <th className="border border-bb-border px-3 py-2 text-left">Team</th>
                  <th className="border border-bb-border px-3 py-2 text-left">League</th>
                  <th className="border border-bb-border px-3 py-2 text-right">Conf rank</th>
                  <th className="border border-bb-border px-3 py-2 text-right">W</th>
                  <th className="border border-bb-border px-3 py-2 text-right">L</th>
                  <th className="border border-bb-border px-3 py-2 text-right">PD</th>
                  <th className="border border-bb-border px-3 py-2 text-left">Latest change</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => {
                  const inPromotionBand = row.display_rank <= 8;
                  const leagueUrl = `https://buzzerbeater.com/league/${row.league_id}/overview.aspx`;
                  return (
                  <tr
                    key={`${row.display_rank}-${row.league_id}-${row.conf}-${row.conf_rank}`}
                    className={
                      inPromotionBand
                        ? "bg-green-50 hover:bg-green-100/90"
                        : "hover:bg-gray-50/80"
                    }
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
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-8 text-sm text-gray-500">
        <Link href="/" className="text-exact hover:underline font-medium">
          ← Home
        </Link>
      </p>
    </div>
  );
}
