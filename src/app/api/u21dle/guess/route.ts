import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getDailyPlayer } from "@/lib/u21dle/daily";
import { getU21dlePlayerById } from "@/lib/u21dle/players";
import { generateFeedback, isCorrectGuess } from "@/lib/u21dle/feedback";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";
import { getPuzzleIdByDate, upsertGuess, updateUserStats } from "@/lib/u21dle/supabase";
import { getSeasonPlayerIds } from "@/lib/fantasy-db";

export const dynamic = "force-dynamic";

function applySeasonOverride<T extends { playerId: number; season: number | null }>(
  player: T,
  season71Ids: Set<number>,
  currentSeason: number
): T {
  return season71Ids.has(player.playerId) ? { ...player, season: currentSeason } : player;
}

export async function POST(request: NextRequest) {
  let body: { date: string; playerId: number; guessesUsed: number; guessHistory?: unknown[]; elapsed?: number; usedCheat?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { date, playerId, guessesUsed, guessHistory = [], elapsed = 0, usedCheat = false } = body;
  if (!date || typeof playerId !== "number" || typeof guessesUsed !== "number") {
    return NextResponse.json(
      { success: false, error: "Missing date, playerId, or guessesUsed" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().split("T")[0];
  if (date > today) {
    return NextResponse.json(
      { success: false, error: "Cannot submit for a future puzzle" },
      { status: 400 }
    );
  }

  const currentSeason = config.game.currentSeason;
  const [dailyPlayerRaw, season71Ids] = await Promise.all([
    getDailyPlayer(date),
    getSeasonPlayerIds(currentSeason),
  ]);
  if (!dailyPlayerRaw) {
    return NextResponse.json(
      { success: false, error: "Puzzle not found" },
      { status: 404 }
    );
  }
  const dailyPlayer = applySeasonOverride(dailyPlayerRaw, season71Ids, currentSeason);

  const guessedPlayerRaw = getU21dlePlayerById(playerId);
  if (!guessedPlayerRaw) {
    return NextResponse.json(
      { success: false, error: "Player not found" },
      { status: 404 }
    );
  }
  const guessedPlayer = applySeasonOverride(guessedPlayerRaw, season71Ids, currentSeason);

  const feedback = generateFeedback(guessedPlayer, dailyPlayer);
  const isSolved = isCorrectGuess(guessedPlayer, dailyPlayer);
  const newGuessesUsed = guessesUsed + 1;
  const gameOver = isSolved || newGuessesUsed >= U21DLE_CONFIG.MAX_GUESSES;

  const newGuessHistory = [...(Array.isArray(guessHistory) ? guessHistory : []), { player: guessedPlayer, feedback }];
  const timeTaken = Math.round(typeof elapsed === "number" ? elapsed : 0);
  const totalScore = gameOver && isSolved ? U21DLE_CONFIG.MAX_GUESSES + 1 - newGuessesUsed : 0;

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (token) {
    const puzzleId = await getPuzzleIdByDate(date);
    if (puzzleId) {
      await upsertGuess(token, puzzleId, date, {
        guessHistory: newGuessHistory,
        guessesUsed: newGuessesUsed,
        isSolved: gameOver && isSolved,
        timeTakenSeconds: timeTaken,
        totalScore,
        usedCheat,
      });
      if (gameOver) {
        await updateUserStats(token, date, { won: isSolved, guessesUsed: newGuessesUsed, usedCheat });
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      feedback,
      isSolved,
      gameOver,
      guessesUsed: newGuessesUsed,
      guessedPlayer: {
        playerId: guessedPlayer.playerId,
        name: guessedPlayer.name,
        gp: guessedPlayer.gp,
        pts: guessedPlayer.pts,
        season: guessedPlayer.season,
        height: guessedPlayer.height,
        potential: guessedPlayer.potential,
        trophies: guessedPlayer.trophies,
      },
      answer: gameOver
        ? {
            playerId: dailyPlayer.playerId,
            name: dailyPlayer.name,
          }
        : null,
    },
  });
}
