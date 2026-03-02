"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import { config } from "@/lib/config";

interface U21dleStatsAndLeaderboardProps {
  puzzleDate?: string | null;
  /** When true, refetch stats/leaderboard (e.g. after game ends) */
  gameOver?: boolean;
}

interface StatsData {
  totalGames: number;
  wins: number;
  winPercent: number;
  currentStreak: number;
  maxStreak: number;
  averageGuesses: number;
  solvedDistribution: Record<string, number>;
  cheatDistribution: Record<string, number>;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  extra?: { guesses?: number; time?: number; isSolved?: boolean; usedCheat?: boolean };
}

export function U21dleStatsAndLeaderboard({ puzzleDate, gameOver }: U21dleStatsAndLeaderboardProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchData = useCallback(
    async (token: string | null) => {
      const opts = { cache: "no-store" as RequestCache };
      const date = puzzleDate ?? new Date().toISOString().slice(0, 10);
      const [s, lb] = await Promise.all([
        token
          ? fetch("/api/u21dle/stats", { headers: { Authorization: `Bearer ${token}` }, ...opts })
              .then(async (r) => {
                if (!r.ok) return null;
                try {
                  const d = await r.json();
                  return d.success ? d.data : null;
                } catch {
                  return null;
                }
              })
              .catch(() => null)
          : Promise.resolve(null),
        fetch(`/api/u21dle/leaderboard?type=daily&date=${encodeURIComponent(date)}`, opts)
          .then(async (r) => {
            if (!r.ok) return [];
            try {
              const d = await r.json();
              return d.success && d.data?.entries ? d.data.entries : [];
            } catch {
              return [];
            }
          })
          .catch(() => []),
      ]);
      return { stats: s, leaderboard: lb };
    },
    [puzzleDate]
  );

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const init = async () => {
      const { data: { session } } = await client.auth.getSession();
      if (cancelled) return;
      const { stats: s, leaderboard: lb } = await fetchData(session?.access_token ?? null);
      if (!cancelled) {
        setStats(s);
        setLeaderboard(lb);
      }
      setLoading(false);
    };
    init();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        fetchData(session?.access_token ?? null).then(({ stats: s, leaderboard: lb }) => {
          if (!cancelled) {
            setStats(s);
            setLeaderboard(lb);
          }
        });
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchData]);

  // Refetch when game ends (parent sets gameOver=true)
  useEffect(() => {
    if (!gameOver) return;
    const client = supabase;
    if (!client) return;
    client.auth.getSession().then(({ data: { session } }) => {
      fetchData(session?.access_token ?? null).then(({ stats: s, leaderboard: lb }) => {
        setStats(s);
        setLeaderboard(lb);
      });
    });
  }, [gameOver, fetchData]);

  if (loading) {
    return (
      <div className="mt-6 rounded-lg border border-bb-border bg-card-bg p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border border-bb-border bg-card-bg p-6">
        <h2 className="text-xl font-bold mb-4">Your Stats</h2>
        {stats !== null ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.totalGames}</div>
                <div className="text-sm text-gray-500">Played</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.winPercent}%</div>
                <div className="text-sm text-gray-500">Win Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.currentStreak}</div>
                <div className="text-sm text-gray-500">Streak</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.maxStreak}</div>
                <div className="text-sm text-gray-500">Max Streak</div>
              </div>
            </div>
            {(Object.keys(stats.solvedDistribution).length > 0 || stats.totalGames > 0) && (
              <div>
                <h3 className="font-semibold mb-2">Guess Distribution</h3>
                <div className="flex items-end justify-center gap-1 h-24">
                  {[...Array.from({ length: config.u21dle.maxGuesses }, (_, i) => i + 1), "Failed"].map((label) => {
                    const total = label === "Failed" ? stats.totalGames - stats.wins : (stats.solvedDistribution[String(label)] ?? 0);
                    const cheat = label === "Failed" ? 0 : (stats.cheatDistribution?.[String(label)] ?? 0);
                    const clean = total - cheat;
                    const max = Math.max(...Object.values(stats.solvedDistribution), stats.totalGames - stats.wins, 1);
                    const h = max > 0 ? (total / max) * 80 : 0;
                    const ch = max > 0 ? (cheat / max) * 80 : 0;
                    return (
                      <div key={String(label)} className="flex flex-col items-center flex-1 min-w-[28px]">
                        <div className="w-full flex flex-col" style={{ height: `${h}px` }}>
                          {ch > 0 && (
                            <div className="bg-amber-400 text-amber-950 text-xs font-bold w-full flex items-center justify-center rounded-t" style={{ height: `${ch}px` }}>
                              {cheat}
                            </div>
                          )}
                          {clean > 0 && (
                            <div className="bg-emerald-600 text-white text-xs font-bold w-full flex items-center justify-center flex-1 rounded-b" style={{ height: `${h - ch}px` }}>
                              {clean}
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-semibold mt-1">{label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-500 text-center py-8">
            <Link href="/login" className="text-exact hover:underline font-medium">Sign in</Link> to track your stats.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-bb-border bg-card-bg p-6 w-full">
        <h2 className="text-xl font-bold mb-4">Today&apos;s Top 5</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bb-border">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Player</th>
                <th className="text-center py-2 px-2">Result</th>
                <th className="text-center py-2 px-2">Guesses</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-gray-500">
                    No entries yet.
                  </td>
                </tr>
              ) : (
                leaderboard.slice(0, 5).map((e) => {
                  const isCleanWin = e.extra?.isSolved && !e.extra?.usedCheat;
                  const isCheatWin = e.extra?.isSolved && e.extra?.usedCheat;
                  const isFailed = !e.extra?.isSolved;
                  return (
                    <tr
                      key={e.userId}
                      className={`border-b border-bb-border ${
                        isCleanWin
                          ? "bg-emerald-50 text-emerald-900"
                          : isCheatWin
                            ? "bg-amber-50 text-amber-900"
                            : isFailed
                              ? "bg-red-50 text-red-900"
                              : ""
                      }`}
                    >
                      <td className="py-2 px-2 font-medium">{e.rank}</td>
                      <td className="py-2 px-2 font-medium">{e.nickname}</td>
                      <td className="text-center py-2 px-2">
                        {isCleanWin ? "✓ Win" : isCheatWin ? "🟡 Win*" : "✗ Failed"}
                      </td>
                      <td className="text-center py-2 px-2">{e.extra?.guesses ?? "–"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
