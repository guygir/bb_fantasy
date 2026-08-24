/**
 * BB season calendar: each season is 98 days (14 weeks).
 * Anchor: season 72 starts 2026-05-02 UTC.
 *
 * Override with CURRENT_SEASON / NEXT_PUBLIC_CURRENT_SEASON when needed.
 */

export const SEASON_ANCHOR = 72;
export const SEASON_ANCHOR_START_MS = Date.UTC(2026, 4, 2); // 2026-05-02
export const SEASON_DURATION_DAYS = 98;

export function getSeasonStartMs(season) {
  return SEASON_ANCHOR_START_MS - (SEASON_ANCHOR - season) * SEASON_DURATION_DAYS * 86400000;
}

/** Infer the BB season number from the 98-day calendar. */
export function resolveCurrentSeason(now = new Date()) {
  const diffDays = Math.floor((now.getTime() - SEASON_ANCHOR_START_MS) / 86400000);
  return SEASON_ANCHOR + Math.floor(diffDays / SEASON_DURATION_DAYS);
}

function envSeasonOverride() {
  const raw = process.env.NEXT_PUBLIC_CURRENT_SEASON ?? process.env.CURRENT_SEASON;
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Env override if set, otherwise calendar-inferred season. */
export function resolveCurrentSeasonFromEnv(now = new Date()) {
  return envSeasonOverride() ?? resolveCurrentSeason(now);
}

/** 1-based week within the season (1–14), or null outside the window. */
export function currentWeekForSeason(season, now = new Date()) {
  const diffDays = Math.floor((now.getTime() - getSeasonStartMs(season)) / 86400000);
  if (diffDays < 0 || diffDays >= SEASON_DURATION_DAYS) return null;
  return Math.floor(diffDays / 7) + 1;
}

/**
 * First date that counts for return-vs-new roster classification.
 * W1 is U21 training. Competitive tracking starts Sunday of W2
 * (season start Saturday + 8 days). Saturday of W2 does not count.
 */
export function competitiveRosterStartMs(season) {
  return getSeasonStartMs(season) + 8 * 86400000;
}

/** YYYY-MM-DD (UTC) of Sunday of W2. */
export function competitiveRosterStartDate(season) {
  return new Date(competitiveRosterStartMs(season)).toISOString().slice(0, 10);
}
