"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";
import {
  type U21dlePlayer,
  type PlayerFeedback,
  ATTRIBUTE_LABELS,
  formatAttributeValue,
  feedbackToEmojiRow,
} from "@/lib/u21dle/feedback";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";

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

  // Load daily puzzle (date only, no answer)
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

  // Load saved state from localStorage
  useEffect(() => {
    if (!puzzleDate) return;
    const key = `u21dle_${puzzleDate}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const { guesses, gameOver: go, won: w, elapsed, answer: a } = JSON.parse(saved);
        if (Array.isArray(guesses) && guesses.length > 0) {
          setGuessHistory(guesses);
          setGameOver(go ?? false);
          setWon(w ?? false);
          if (elapsed != null) setElapsedTime(elapsed);
          if (a) setAnswer(a);
        }
      }
    } catch {
      // ignore
    }
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
      const res = await fetch("/api/u21dle/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: puzzleDate,
          playerId: selectedPlayer.playerId,
          guessesUsed: guessHistory.length,
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
    const text = `U21dle ${puzzleDate}\nI ${result}, using ${guessHistory.length}/${maxGuesses} guesses.\n${grid}\n\n`;
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
        <p className="mt-1 text-gray-600">Guess the Israel U21 player in {maxGuesses} tries</p>
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
          <div className="mb-6">
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
                ? `You guessed the player in ${guessHistory.length} ${guessHistory.length === 1 ? "try" : "tries"}!`
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
                      ["gp", "pts", "age", "height", "potential", "trophies"] as const
                    ).map((attr) => {
                      const fb = item.feedback[attr];
                      const val = item.player[attr];
                      return (
                        <div key={attr} className="text-center">
                          <div className="mb-1 text-xs text-gray-500">
                            {ATTRIBUTE_LABELS[attr]}
                          </div>
                          <div
                            className={`${getFeedbackColor(fb)} rounded px-2 py-1 text-sm font-semibold text-white`}
                          >
                            {formatAttributeValue(attr, val)}
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

      <div className="mt-6 rounded-lg border border-bb-border bg-card-bg p-4 text-sm text-gray-600">
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
    </div>
  );
}
