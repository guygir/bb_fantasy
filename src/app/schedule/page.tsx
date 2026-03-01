import Link from "next/link";
import { getSchedule } from "@/lib/schedule";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const SEASON = config.game.currentSeason;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatType(type: string) {
  if (type === "nt.friendly") return "SC";
  if (type === "nt.roundrobin") return "RR";
  return type;
}

export default async function SchedulePage() {
  const { matches, meta, error } = await getSchedule(SEASON);

  if (error) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Schedule (Season {meta?.season ?? SEASON})</h2>
        <p className="text-red-600">Failed to load: {error}</p>
        <p className="mt-2 text-sm text-gray-600">Check BBAPI credentials in .env (BBAPI_LOGIN, BBAPI_CODE)</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Schedule (Season {meta?.season ?? SEASON})</h2>
      <p className="mb-4 text-sm text-gray-600">
        {meta.source === "bbapi"
          ? "Live from BBAPI"
          : "Using cached schedule — BBAPI fetch failed (check BBAPI_LOGIN, BBAPI_CODE, or network). Run fantasy-weekly-sync to refresh."}
      </p>
      <div className="overflow-x-auto rounded-lg border border-bb-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left">Date</th>
              <th className="border border-bb-border px-4 py-2 text-left">Match</th>
              <th className="border border-bb-border px-4 py-2 text-left">Score</th>
              <th className="border border-bb-border px-4 py-2 text-left">Type</th>
              <th className="border border-bb-border px-4 py-2 text-left">Box</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className="hover:bg-card-bg">
                <td className="border border-bb-border px-4 py-2">{formatDate(m.start)}</td>
                <td className="border border-bb-border px-4 py-2">
                  {m.awayTeamName} @ {m.homeTeamName}
                </td>
                <td className="border border-bb-border px-4 py-2">
                  {m.awayScore != null && m.homeScore != null
                    ? `${m.awayScore} – ${m.homeScore}`
                    : "–"}
                </td>
                <td className="border border-bb-border px-4 py-2">{formatType(m.type)}</td>
                <td className="border border-bb-border px-4 py-2">
        <Link
          href={`https://buzzerbeater.com/match/${m.id}/boxscore.aspx`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-exact hover:underline font-medium"
        >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
