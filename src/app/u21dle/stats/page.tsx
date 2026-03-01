"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";

interface StatsData {
  totalGames: number;
  wins: number;
  failedGames: number;
  winPercent: number;
  currentStreak: number;
  maxStreak: number;
  averageGuesses: number;
  solvedDistribution: Record<string, number>;
  lastPlayedDate: string | null;
}

export default function U21dleStatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase?.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) {
        setError("Sign in to view your stats");
        setLoading(false);
        return;
      }
      fetch("/api/u21dle/stats", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.data) {
            setStats(data.data);
          } else {
            setError(data.error ?? "Failed to load");
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-gray-600">Loading stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-800">{error}</p>
          <p className="mt-2 text-sm text-gray-600">
            <Link href="/login" className="text-exact hover:underline font-medium">
              Sign in
            </Link>{" "}
            to track your U21dle stats.
          </p>
          <Link
            href="/u21dle"
            className="mt-4 inline-block rounded-lg bg-exact px-4 py-2 text-sm font-medium text-white hover:bg-[#5a9a54]"
          >
            Back to U21dle
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">My U21dle Stats</h1>
      <p className="mt-1 text-gray-600">Your game statistics</p>

      {stats && stats.totalGames > 0 ? (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.totalGames}</p>
              <p className="text-sm text-gray-500">Games</p>
            </div>
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.wins}</p>
              <p className="text-sm text-gray-500">Wins</p>
            </div>
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.winPercent}%</p>
              <p className="text-sm text-gray-500">Win %</p>
            </div>
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.averageGuesses.toFixed(1)}</p>
              <p className="text-sm text-gray-500">Avg guesses</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.currentStreak}</p>
              <p className="text-sm text-gray-500">Current streak</p>
            </div>
            <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-center">
              <p className="text-2xl font-bold">{stats.maxStreak}</p>
              <p className="text-sm text-gray-500">Max streak</p>
            </div>
          </div>

          {Object.keys(stats.solvedDistribution).length > 0 && (
            <div className="rounded-lg border border-bb-border bg-card-bg p-4">
              <p className="font-semibold text-gray-700">Solved in X guesses</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map((n) => {
                  const count = stats.solvedDistribution[String(n)] ?? 0;
                  return (
                    <div key={n} className="flex items-center gap-1">
                      <span className="text-sm text-gray-500">{n}:</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-6 text-gray-600">No games played yet. Play U21dle to see your stats!</p>
      )}

      <div className="mt-8 flex gap-4">
        <Link
          href="/u21dle"
          className="rounded-lg bg-exact px-4 py-2 text-sm font-medium text-white hover:bg-[#5a9a54]"
        >
          Play U21dle
        </Link>
        <Link
          href="/u21dle/leaderboard"
          className="rounded-lg border border-bb-border bg-card-bg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
