import { NextRequest, NextResponse } from "next/server";
import { getCurrentPuzzleDate, getDailyPlayer } from "@/lib/u21dle/daily";
import { getU21dlePlayerById } from "@/lib/u21dle/players";
import { generateFeedback, isCorrectGuess } from "@/lib/u21dle/feedback";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";
import { getPuzzleIdByDate, upsertGuess, updateUserStats } from "@/lib/u21dle/supabase";

export const dynamic = "force-dynamic";

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

  const currentDate = await getCurrentPuzzleDate();
  if (!currentDate) {
    return NextResponse.json(
      { success: false, error: "No puzzle available yet. Today's puzzle is coming up shortly!" },
      { status: 404 }
    );
  }

  if (date !== currentDate) {
    return NextResponse.json(
      { success: false, error: "Can only submit for the current puzzle" },
      { status: 400 }
    );
  }

  const dailyPlayer = await getDailyPlayer(currentDate);
  if (!dailyPlayer) {
    return NextResponse.json(
      { success: false, error: "Puzzle not found" },
      { status: 404 }
    );
  }

  const guessedPlayer = getU21dlePlayerById(playerId);
  if (!guessedPlayer) {
    return NextResponse.json(
      { success: false, error: "Player not found" },
      { status: 404 }
    );
  }

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
        age: guessedPlayer.age,
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
