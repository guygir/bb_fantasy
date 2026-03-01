"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LeaderboardType = "daily" | "alltime-wins" | "alltime-winpercent" | "alltime-avgguesses";

interface Entry {
  rank: number;
  userId: string;
  nickname: string;
  value: number;
  extra?: {
    guesses?: number;
    time?: number;
    wins?: number;
    totalGames?: number;
    winPercent?: number;
    avgGuesses?: number;
    isSolved?: boolean;
    usedCheat?: boolean;
  };
}

export default function U21dleLeaderboardPage() {
  const [type, setType] = useState<LeaderboardType>("alltime-wins");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type });
    if (type === "daily") params.set("date", date);
    fetch(`/api/u21dle/leaderboard?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.entries) {
          setEntries(data.data.entries);
        } else {
          setEntries([]);
        }
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [type, date]);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">U21dle Leaderboard</h1>
      <p className="mt-1 text-gray-600">Top players</p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setType("alltime-wins")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            type === "alltime-wins" ? "bg-exact text-white" : "border border-bb-border bg-card-bg text-gray-700 hover:bg-gray-100"
          }`}
        >
          All-time wins
        </button>
        <button
          onClick={() => setType("alltime-winpercent")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            type === "alltime-winpercent" ? "bg-exact text-white" : "border border-bb-border bg-card-bg text-gray-700 hover:bg-gray-100"
          }`}
        >
          Win %
        </button>
        <button
          onClick={() => setType("alltime-avgguesses")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            type === "alltime-avgguesses" ? "bg-exact text-white" : "border border-bb-border bg-card-bg text-gray-700 hover:bg-gray-100"
          }`}
        >
          Avg guesses
        </button>
        <button
          onClick={() => setType("daily")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            type === "daily" ? "bg-exact text-white" : "border border-bb-border bg-card-bg text-gray-700 hover:bg-gray-100"
          }`}
        >
          Daily
        </button>
      </div>

      {type === "daily" && (
        <div className="mt-4">
          <label className="text-sm text-gray-600">Date: </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="ml-2 rounded border border-bb-border px-3 py-1.5 text-sm"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <p className="mt-8 text-gray-600">No entries yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-bb-border">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-card-bg">
                <th className="border border-bb-border px-4 py-2 text-left">#</th>
                <th className="border border-bb-border px-4 py-2 text-left">Player</th>
                <th className="border border-bb-border px-4 py-2 text-right">
                  {type === "daily" ? "Guesses" : type === "alltime-wins" ? "Wins" : type === "alltime-winpercent" ? "Win %" : "Avg"}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.userId} className="hover:bg-card-bg">
                  <td className="border border-bb-border px-4 py-2">{e.rank}</td>
                  <td className="border border-bb-border px-4 py-2 font-medium">{e.nickname}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">
                    {type === "daily" ? (
                      <span>
                        {e.extra?.guesses ?? "-"}
                        {e.extra?.usedCheat && (
                          <span className="ml-1 text-yellow-600" title="Cheat win">*</span>
                        )}
                      </span>
                    ) : type === "alltime-wins" ? (
                      e.value
                    ) : type === "alltime-winpercent" ? (
                      `${e.value.toFixed(1)}%`
                    ) : type === "alltime-avgguesses" ? (
                      e.extra?.avgGuesses?.toFixed(1) ?? "-"
                    ) : (
                      e.value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 flex gap-4">
        <Link
          href="/u21dle"
          className="rounded-lg bg-exact px-4 py-2 text-sm font-medium text-white hover:bg-[#5a9a54]"
        >
          Play U21dle
        </Link>
        <Link
          href="/u21dle/stats"
          className="rounded-lg border border-bb-border bg-card-bg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          My stats
        </Link>
      </div>
    </div>
  );
}
