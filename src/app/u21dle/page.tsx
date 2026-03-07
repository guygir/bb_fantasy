"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import { config } from "@/lib/config";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";
import {
  type U21dlePlayer,
  type PlayerFeedback,
  ATTRIBUTE_LABELS,
  formatAttributeValue,
  feedbackToEmojiRow,
  computeCheatCandidates,
} from "@/lib/u21dle/feedback";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";
import { U21dleStatsAndLeaderboard } from "./U21dleStatsAndLeaderboard";

interface GuessItem {
  player: U21dlePlayer;
  feedback: PlayerFeedback;
}

interface Answer {
  playerId: number;
  name: string;
}

export default function U21dlePage() {
  const [puzzleDate, setPuzzleDate] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [guessHistory, setGuessHistory] = useState<GuessItem[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTimerActive, setIsTimerActive] = useState(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<U21dlePlayer[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<U21dlePlayer | null>(null);
  const [justSelected, setJustSelected] = useState(false);
  const [copied, setCopied] = useState(false);

  const maxGuesses = U21DLE_CONFIG.MAX_GUESSES;

  const [loadError, setLoadError] = useState<string | null>(null);

  // Cheat mode: show remaining candidates (like Riftle)
  const [cheatMode, setCheatMode] = useState(false);
  const [cheatEverEnabled, setCheatEverEnabled] = useState(false);
  const [showCheatWarning, setShowCheatWarning] = useState(false);
  const [cheatWarningSeen, setCheatWarningSeen] = useState(() => {
    try {
      return localStorage.getItem("u21dle_cheat_warning_seen") === "true";
    } catch {
      return false;
    }
  });
  const [allPlayers, setAllPlayers] = useState<U21dlePlayer[]>([]);

  // Load daily puzzle
  useEffect(() => {
    setLoadError(null);
    fetch("/api/u21dle/daily")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.date) {
          setPuzzleDate(data.data.date);
        } else {
          setPuzzleDate(null);
        }
        setLoading(false);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
  }, []);

  // Load all players for cheat panel when cheat mode is on
  useEffect(() => {
    if (!cheatMode || gameOver) return;
    fetch("/api/u21dle/eligible?light=1")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.players) {
          setAllPlayers(data.data.players);
        }
      })
      .catch(() => setAllPlayers([]));
  }, [cheatMode, gameOver]);

  // Load saved state: Supabase first (when auth), then localStorage
  useEffect(() => {
    if (!puzzleDate) return;
    let cancelled = false;
    (async () => {
      try {
        const session = (await supabase?.auth.getSession())?.data?.session;
        if (session?.access_token) {
          const res = await fetch(`/api/u21dle/game-state?date=${encodeURIComponent(puzzleDate)}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const json = await res.json();
          if (json.success && json.data && !cancelled) {
            const d = json.data;
            setGuessHistory(d.guessHistory ?? []);
            setGameOver(d.gameOver ?? false);
            setWon(d.won ?? false);
            if (d.elapsed != null) setElapsedTime(d.elapsed);
            if (d.answer) setAnswer(d.answer);
            if (d.usedCheat) {
              setCheatEverEnabled(true);
              setCheatMode(!d.gameOver);
            }
            return;
          }
        }
        const key = `u21dle_${puzzleDate}`;
        const saved = localStorage.getItem(key);
        if (!saved) return;
        const { guesses, gameOver: go, won: w, elapsed, answer: a } = JSON.parse(saved);
        if (!Array.isArray(guesses) || guesses.length === 0) return;
        if (go && a?.playerId) {
          const res = await fetch(
            `/api/u21dle/verify?date=${encodeURIComponent(puzzleDate)}&playerId=${a.playerId}`
          );
          const { valid } = (await res.json()) as { valid?: boolean };
          if (!valid && !cancelled) {
            localStorage.removeItem(key);
            return;
          }
        }
        if (!cancelled) {
          setGuessHistory(guesses);
          setGameOver(go ?? false);
          setWon(w ?? false);
          if (elapsed != null) setElapsedTime(elapsed);
          if (a) setAnswer(a);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [puzzleDate]);

  // Save state to localStorage
  useEffect(() => {
    if (!puzzleDate || guessHistory.length === 0) return;
    const key = `u21dle_${puzzleDate}`;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          guesses: guessHistory,
          gameOver,
          won,
          elapsed: elapsedTime,
          answer: gameOver ? answer : undefined,
        })
      );
    } catch {
      // ignore
    }
  }, [puzzleDate, guessHistory, gameOver, won, elapsedTime, answer]);

  // Search suggestions
  useEffect(() => {
    if (justSelected) return;
    if (searchQuery.length < 2) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/u21dle/players?q=${encodeURIComponent(searchQuery)}`)
        .then((r) => r.json())
        .then((data) => setSuggestions(data.players || []))
        .finally(() => setSearchLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery, justSelected]);

  // Timer
  useEffect(() => {
    if (gameOver || loading) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      if (isTimerActive) setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameOver, loading, isTimerActive]);

  useEffect(() => {
    const handleVisibilityChange = () => setIsTimerActive(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  async function submitGuess() {
    if (!selectedPlayer || !puzzleDate || submitting || gameOver) return;
    setSubmitting(true);
    try {
      const session = (await supabase?.auth.getSession())?.data?.session;
      const res = await fetch("/api/u21dle/guess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          date: puzzleDate,
          playerId: selectedPlayer.playerId,
          guessesUsed: guessHistory.length,
          guessHistory,
          elapsed: elapsedTime,
          usedCheat: cheatEverEnabled,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error ?? "Failed to submit guess");
        return;
      }
      const { feedback, isSolved, gameOver: go, guessedPlayer, answer: a } = json.data;
      const newHistory = [...guessHistory, { player: guessedPlayer, feedback }];
      setGuessHistory(newHistory);
      setGameOver(go);
      setWon(isSolved);
      if (a) setAnswer(a);
    } catch (e) {
      alert("Failed to submit guess");
    } finally {
      setSearchQuery("");
      setSelectedPlayer(null);
      setSuggestions([]);
      setSubmitting(false);
    }
  }

  function getFeedbackColor(fb: string): string {
    if (fb === "exact") return "bg-exact";
    if (fb === "high") return "bg-high";
    return "bg-low";
  }

  function handleShare() {
    if (!puzzleDate || guessHistory.length === 0) return;
    const result = won ? "Won" : "Failed";
    const grid = guessHistory.map((g) => feedbackToEmojiRow(g.feedback)).join("\n");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://bb-fantasy.vercel.app";
    const url = `${baseUrl}/u21dle`;
    const text = `U21dle ${puzzleDate}\nI ${result}, using ${guessHistory.length}/${maxGuesses} guesses.\n${grid}\n\nProve your worth at ${url}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-gray-600">Loading puzzle...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-800">Failed to load puzzle</p>
          <p className="mt-1 text-sm text-red-600">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-exact px-4 py-2 text-sm font-medium text-white hover:bg-[#5a9a54]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!puzzleDate) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <div className="text-center text-gray-600">
          No puzzle available yet. Today&apos;s puzzle is coming up shortly!
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">U21dle</h1>
        <p className="mt-1 text-gray-600">
          Guess the Israel U21 player from season {config.u21dle.minSeason} to season {config.u21dle.maxSeason} in {maxGuesses} tries
        </p>
        {puzzleDate && (
          <p className="mt-1 text-sm text-gray-500">
            Puzzle for {new Date(puzzleDate).toLocaleDateString()}
          </p>
        )}
        {!gameOver && (
          <p className="mt-1 text-sm text-gray-600">
            Time: {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, "0")}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-bb-border bg-white p-6 shadow-sm">
        {!gameOver && (
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1 min-w-0">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setJustSelected(false);
                }}
                placeholder="Type a player name (min 2 chars)..."
                className="w-full rounded-lg border border-bb-border px-4 py-3 focus:ring-2 focus:ring-exact focus:border-exact"
                disabled={submitting}
              />
              {searchLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                </div>
              )}
              {suggestions.length > 0 && !searchLoading && (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-bb-border bg-white shadow-lg">
                  {suggestions.map((p) => (
                    <button
                      key={p.playerId}
                      onClick={() => {
                        setSelectedPlayer(p);
                        setSearchQuery(p.name);
                        setSuggestions([]);
                        setJustSelected(true);
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-card-bg"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={submitGuess}
              disabled={!selectedPlayer || submitting}
              className="mt-4 w-full rounded-lg bg-exact py-3 font-semibold text-white transition hover:bg-[#5a9a54] disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit Guess"}
            </button>
            <p className="mt-2 text-center text-sm text-gray-500">
              {guessHistory.length} / {maxGuesses} guesses used
            </p>
            <button
              type="button"
              onClick={() => {
                const newVal = !cheatMode;
                if (newVal && !cheatWarningSeen) {
                  setShowCheatWarning(true);
                  return;
                }
                setCheatMode(newVal);
                if (newVal && !cheatEverEnabled) setCheatEverEnabled(true);
              }}
              className={`mt-3 w-full rounded-lg border px-4 py-2 text-sm font-medium ${
                cheatMode
                  ? "border-yellow-500 bg-yellow-50 text-yellow-800"
                  : "border-bb-border bg-card-bg text-gray-700 hover:bg-gray-100"
              }`}
            >
              {cheatMode ? "🟡 Cheat ON" : "⬜ Cheat OFF"}
            </button>
            </div>

            {cheatMode && (
              <div className="w-full sm:w-64 flex-shrink-0">
                <div className="rounded-lg border-2 border-yellow-400 overflow-hidden">
                  <div className="bg-yellow-400 text-gray-900 text-xs font-bold px-3 py-1">
                    Possible Players ({computeCheatCandidates(guessHistory, allPlayers).length})
                  </div>
                  <div className="overflow-y-auto max-h-80 bg-white border-t border-yellow-200">
                    {computeCheatCandidates(guessHistory, allPlayers).map((p) => (
                      <div
                        key={p.playerId}
                        className="flex items-center gap-2 px-2 py-2 border-b border-gray-100 last:border-0"
                      >
                        <PlayerAvatar playerId={p.playerId} name={p.name} />
                        <span className="text-sm font-medium truncate">{p.name}</span>
                      </div>
                    ))}
                    {computeCheatCandidates(guessHistory, allPlayers).length === 0 && (
                      <div className="px-3 py-4 text-xs text-gray-500 text-center">No matching players</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {gameOver && (
          <div
            className={`mb-6 rounded-lg p-4 ${
              won ? "bg-green-50" : "bg-red-50"
            }`}
          >
            <h2 className="text-center text-xl font-bold">
              {won ? "🎉 Congratulations!" : "😔 Game Over"}
            </h2>
            <p className="mt-1 text-center">
              {won
                ? `You guessed ${answer?.name ?? "the player"} in ${guessHistory.length} ${guessHistory.length === 1 ? "try" : "tries"}!`
                : answer && `The player was: ${answer.name}`}
            </p>
            <p className="mt-1 text-center text-sm text-gray-600">
              Time: {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, "0")}
            </p>
            {answer && (
              <div className="mt-4 flex justify-center">
                <PlayerAvatar playerId={answer.playerId} name={answer.name} />
              </div>
            )}
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleShare}
                className={`rounded-lg px-6 py-2 font-semibold transition ${
                  copied
                    ? "bg-exact text-white"
                    : "bg-card-bg text-bb-text border border-bb-border hover:bg-[#e8e9eb]"
                }`}
              >
                {copied ? "Copied!" : "Share Results"}
              </button>
            </div>
          </div>
        )}

        {guessHistory.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold">Your Guesses</h3>
            <div className="space-y-3">
              {[...guessHistory].reverse().map((item, idx) => {
                const guessNum = guessHistory.length - idx;
                return (
                <div
                  key={guessNum}
                  className="rounded-lg border border-bb-border bg-card-bg p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="w-16 shrink-0 text-sm font-medium text-gray-500">Guess {guessNum}:</span>
                    <PlayerAvatar playerId={item.player.playerId} name={item.player.name} />
                    <span className="font-semibold">{item.player.name}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {(
                      ["gp", "pts", "season", "height", "potential", "trophies"] as const
                    ).map((attr) => {
                      const fb = item.feedback[attr] ?? (attr === "season" ? (item.feedback as { age?: "exact" | "high" | "low" }).age : undefined);
                      const val = item.player[attr] ?? (attr === "season" ? (item.player as { age?: number }).age : undefined);
                      return (
                        <div key={attr} className="text-center">
                          <div className="mb-1 text-xs text-gray-500">
                            {ATTRIBUTE_LABELS[attr]}
                          </div>
                          <div
                            className={`${getFeedbackColor(fb)} rounded px-2 py-1 text-sm font-semibold text-white`}
                          >
                            {val != null ? formatAttributeValue(attr, val) : "–"}
                            {fb !== "exact" && (
                              <span className="ml-1">{fb === "high" ? "↓" : "↑"}</span>
                            )}
                          </div>
                          </div>
                        );
                    })}
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-6">
        <U21dleStatsAndLeaderboard puzzleDate={puzzleDate} gameOver={gameOver} />

        <div className="rounded-lg border border-bb-border bg-card-bg p-4 text-sm text-gray-600">
          <p className="font-semibold">How to play</p>
          <p className="mt-1">
            Guess the Israel U21 player from seasons 60–70.
          </p>
          <p className="mt-1">
            Each guess shows feedback: 🟩 exact, 🟧 too high (↓), 🟦 too low (↑).
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/u21dle/players" className="text-exact hover:underline font-medium">
              View all eligible players →
            </Link>
            <Link href="/u21dle/help" className="text-exact hover:underline font-medium">
              Full rules & help →
            </Link>
          </p>
        </div>

        {showCheatWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h2 className="text-xl font-bold text-center mb-3">Enable Cheat Mode?</h2>
              <p className="text-sm text-gray-600 mb-4">
                Cheat Mode shows you all players still consistent with your guesses — but it comes at a cost.
                A cheat win counts <strong>less than a clean win</strong> and <strong>more than a loss</strong> on the leaderboard.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowCheatWarning(false)}
                  className="rounded-lg border border-bb-border px-4 py-2 text-sm font-medium hover:bg-gray-100"
                >
                  No
                </button>
                <button
                  onClick={() => {
                    try {
                      localStorage.setItem("u21dle_cheat_warning_seen", "true");
                    } catch {}
                    setCheatWarningSeen(true);
                    setShowCheatWarning(false);
                    setCheatMode(true);
                    if (!cheatEverEnabled) setCheatEverEnabled(true);
                  }}
                  className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-600"
                >
                  Yes, enable
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
