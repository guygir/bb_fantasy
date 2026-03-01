/**
 * U21dle Feedback Logic
 *
 * Handles numeric attribute comparison and feedback generation for player guesses.
 * All 6 attributes (GP, PTS, Age, Height, Potential, Trophies) use numeric feedback: exact/high/low.
 */

export type NumericFeedback = "exact" | "high" | "low";

export interface U21dlePlayer {
  playerId: number;
  name: string;
  gp: number;
  pts: number;
  age: number;
  height: number;
  potential: number;
  trophies: number;
}

export interface PlayerFeedback {
  gp: NumericFeedback;
  pts: NumericFeedback;
  age: NumericFeedback;
  height: NumericFeedback;
  potential: NumericFeedback;
  trophies: NumericFeedback;
}

/**
 * Get numeric feedback (exact/high/low)
 */
export function getNumericFeedback(
  guessed: number | null | undefined,
  actual: number | null | undefined
): NumericFeedback {
  if (guessed === null || guessed === undefined || actual === null || actual === undefined) {
    if (
      (guessed === null || guessed === undefined) &&
      (actual === null || actual === undefined)
    ) {
      return "exact";
    }
    return "exact";
  }
  if (guessed === actual) return "exact";
  return guessed > actual ? "high" : "low";
}

/**
 * Generate feedback for a guess
 */
export function generateFeedback(
  guessed: U21dlePlayer,
  actual: U21dlePlayer
): PlayerFeedback {
  return {
    gp: getNumericFeedback(guessed.gp, actual.gp),
    pts: getNumericFeedback(guessed.pts, actual.pts),
    age: getNumericFeedback(guessed.age, actual.age),
    height: getNumericFeedback(guessed.height, actual.height),
    potential: getNumericFeedback(guessed.potential, actual.potential),
    trophies: getNumericFeedback(guessed.trophies, actual.trophies),
  };
}

/**
 * Check if the guess is correct (playerId matches)
 */
export function isCorrectGuess(guessed: U21dlePlayer, actual: U21dlePlayer): boolean {
  return guessed.playerId === actual.playerId;
}

/**
 * Attribute labels for UI
 */
export const ATTRIBUTE_LABELS: Record<keyof PlayerFeedback, string> = {
  gp: "GP",
  pts: "PTS",
  age: "Age",
  height: "Height",
  potential: "Potential",
  trophies: "Trophies",
};

/**
 * Format attribute value for display
 */
export function formatAttributeValue(
  attribute: keyof PlayerFeedback,
  value: number
): string {
  if (value === null || value === undefined) return "N/A";
  if (attribute === "pts") return value.toFixed(1);
  return String(value);
}

/**
 * Compute players still consistent with all guesses made so far.
 * Used by Cheat Mode panel (like Riftle).
 *
 * For each attribute: exact → must match; high → candidate < guessed; low → candidate > guessed.
 */
export function computeCheatCandidates(
  guessHistory: Array<{ player: U21dlePlayer; feedback: PlayerFeedback }>,
  allPlayers: U21dlePlayer[]
): U21dlePlayer[] {
  if (guessHistory.length === 0) return allPlayers;

  return allPlayers.filter((candidate) => {
    for (const { player: guessed, feedback } of guessHistory) {
      const attrs = ["gp", "pts", "age", "height", "potential", "trophies"] as const;
      for (const attr of attrs) {
        const fb = feedback[attr];
        const gVal = guessed[attr];
        const cVal = candidate[attr];
        if (fb === "exact") {
          if (cVal !== gVal) return false;
        } else if (fb === "high") {
          if (cVal >= gVal) return false;
        } else if (fb === "low") {
          if (cVal <= gVal) return false;
        }
      }
    }
    return true;
  });
}

/**
 * Convert feedback to share emoji row
 * exact=🟩, high=🟧, low=🟦
 */
export function feedbackToEmojiRow(feedback: PlayerFeedback): string {
  const emoji: Record<NumericFeedback, string> = {
    exact: "🟩",
    high: "🟧",
    low: "🟦",
  };
  return (
    emoji[feedback.gp] +
    emoji[feedback.pts] +
    emoji[feedback.age] +
    emoji[feedback.height] +
    emoji[feedback.potential] +
    emoji[feedback.trophies]
  );
}
