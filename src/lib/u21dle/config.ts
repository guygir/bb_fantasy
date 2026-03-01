/**
 * U21dle Game Configuration
 *
 * Centralized configuration for the Israel U21 player guessing game
 */

export const U21DLE_CONFIG = {
  /** Maximum number of guesses allowed per puzzle */
  MAX_GUESSES: 6,

  /** Number of days to exclude recently used players (for random selection) */
  EXCLUDE_RECENT_DAYS: 30,

  /** Number of days ahead to generate puzzles (for cron buffer) */
  PUZZLE_BUFFER_DAYS: 3,

  /** Minimum GP for a player to be eligible as daily puzzle */
  MIN_GP_ELIGIBLE: 8,
} as const;
