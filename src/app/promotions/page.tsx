import type { Metadata } from "next";
import Link from "next/link";
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

export default async function PromotionsPage() {
  const { snapshotAt, entries, error } = await getLatestPromotions();

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Israel League III — Promotions outlook</h2>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Top three teams in each conference in every Israel League III division (league IDs 1004–1019;
        six teams per league, up to 120 total). The table lists everyone, sorted by conference rank
        (all #1s before #2s before #3s), then wins, then point differential. Data is refreshed on a
        schedule from{" "}
        <a
          href="https://buzzerbeater.com"
          className="text-exact hover:underline font-medium"
          target="_blank"
          rel="noopener noreferrer"
        >
          BuzzerBeater
        </a>
        .
      </p>

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
          </p>
          <div className="overflow-x-auto rounded-lg border border-bb-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card-bg">
                  <th className="border border-bb-border px-3 py-2 text-right">#</th>
                  <th className="border border-bb-border px-3 py-2 text-left">Team</th>
                  <th className="border border-bb-border px-3 py-2 text-left">League</th>
                  <th className="border border-bb-border px-3 py-2 text-center">Conf</th>
                  <th className="border border-bb-border px-3 py-2 text-right">Conf rank</th>
                  <th className="border border-bb-border px-3 py-2 text-right">W</th>
                  <th className="border border-bb-border px-3 py-2 text-right">L</th>
                  <th className="border border-bb-border px-3 py-2 text-right">PD</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={`${row.league_id}-${row.conf}-${row.display_rank}`} className="hover:bg-gray-50/80">
                    <td className="border border-bb-border px-3 py-2 text-right tabular-nums">
                      {row.display_rank}
                    </td>
                    <td className="border border-bb-border px-3 py-2 font-medium">{row.team_name}</td>
                    <td className="border border-bb-border px-3 py-2 text-gray-700">
                      {row.league_name}{" "}
                      <span className="text-gray-400">({row.league_id})</span>
                    </td>
                    <td className="border border-bb-border px-3 py-2 text-center">{row.conf}</td>
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
                  </tr>
                ))}
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
