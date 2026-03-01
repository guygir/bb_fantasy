import { NextRequest, NextResponse } from "next/server";
import { getCurrentPuzzleDate, getDailyPlayer } from "@/lib/u21dle/daily";
import { getU21dlePlayerById } from "@/lib/u21dle/players";
import { generateFeedback, isCorrectGuess } from "@/lib/u21dle/feedback";
import { U21DLE_CONFIG } from "@/lib/u21dle/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { date: string; playerId: number; guessesUsed: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { date, playerId, guessesUsed } = body;
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
