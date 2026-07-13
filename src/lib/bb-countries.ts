/**
 * Hardcoded BuzzerBeater country names (scraped April 2026) and season start dates.
 * Season 72 starts 2026-05-01; each season = 14 weeks (98 days).
 */

export const BB_COUNTRY_NAMES: Record<number, string> = {
  1: "USA",
  2: "Argentina",
  3: "Brasil",
  4: "Canada",
  5: "China",
  6: "Türkiye",
  7: "España",
  8: "Deutschland",
  9: "Sverige",
  10: "Italia",
  11: "France",
  12: "Hellas",
  13: "Belgium",
  14: "England",
  15: "Israel",
  16: "Nederland",
  17: "Australia",
  18: "Portugal",
  19: "Rossiya",
  20: "Lietuva",
  21: "Chile",
  22: "Colombia",
  23: "Hanguk",
  24: "Hrvatska",
  25: "Nigeria",
  26: "Norge",
  27: "Österreich",
  28: "Schweiz",
  29: "Srbija",
  30: "México",
  31: "Al Jazair",
  32: "Al Maghrib",
  33: "Ukraina",
  34: "Bolivia",
  35: "Bosna i Hercegovina",
  36: "Bulgaria",
  37: "Česká Rep.",
  38: "Costa Rica",
  39: "Danmark",
  40: "Ecuador",
  41: "Eesti",
  42: "India",
  43: "Indonesia",
  44: "Ireland",
  45: "Hong Kong",
  46: "Latvija",
  47: "Lubnan",
  48: "Magyarország",
  49: "Makedonija",
  50: "Malaysia",
  51: "Misr",
  52: "New Zealand",
  53: "Nippon",
  54: "Panama",
  55: "Paraguay",
  56: "Perú",
  57: "Pilipinas",
  58: "Polska",
  59: "Iran",
  60: "Rep. Dominicana",
  61: "România",
  62: "Sakartvelo",
  63: "Saudi Arabia",
  64: "Scotland",
  65: "Singapore",
  66: "Slovenija",
  67: "Slovensko",
  68: "South Africa",
  69: "Suomi",
  70: "Taiwan",
  71: "Tounes",
  72: "Prathet Thai",
  73: "Uruguay",
  74: "Venezuela",
  75: "Andorra",
  76: "Crna Gora",
  77: "Cyprus",
  78: "Ísland",
  79: "Shqipëria",
  80: "Puerto Rico",
  81: "Cymru",
  82: "Guatemala",
  83: "Kazakhstan",
  84: "U.A.E.",
  85: "Belarus",
  86: "Moldova",
  87: "Hayastan",
  88: "Azərbaycan",
  89: "Pakistan",
  90: "Malta",
  91: "Luxembourg",
  92: "Việt Nam",
  93: "Ghana",
  94: "Senegal",
  95: "Barbados",
  96: "Jamaica",
  97: "Macau",
  98: "Bahamas",
};

export function getCountryName(countryId: number): string {
  if (countryId === 99) return "Utopia";
  return BB_COUNTRY_NAMES[countryId] ?? `Country ${countryId}`;
}

export function getTeamName(countryId: number): string {
  const name = BB_COUNTRY_NAMES[countryId];
  return name ? `${name} U21 National Team` : `Country ${countryId} U21 National Team`;
}

/**
 * U21 analyzer week boundaries run Saturday to Saturday.
 * Season 72 week 1 starts on 2026-05-02; each prior season starts 98 days (14 weeks) earlier.
 */
const SEASON_72_START = new Date("2026-05-02T00:00:00Z");
const SEASON_DURATION_DAYS = 98;

export function getSeasonStartDate(season: number): Date {
  const deltaDays = (72 - season) * SEASON_DURATION_DAYS;
  const d = new Date(SEASON_72_START);
  d.setUTCDate(d.getUTCDate() - deltaDays);
  return d;
}

/**
 * Given a game date string (M/D/YYYY from BB) and a season number,
 * return the 1-based week number within that season (1–14).
 * Returns null if the date falls outside the 98-day season window.
 */
export function getGameWeek(dateStr: string, season: number): number | null {
  // Parse M/D/YYYY
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!m || !d || !y) return null;
  const gameDate = new Date(Date.UTC(y, m - 1, d));
  const seasonStart = getSeasonStartDate(season);
  const diffDays = Math.floor((gameDate.getTime() - seasonStart.getTime()) / 86400000);
  if (diffDays < 0 || diffDays >= SEASON_DURATION_DAYS) return null;
  return Math.floor(diffDays / 7) + 1;
}

/** Game types that do NOT count for minutes/stats aggregations */
export const NON_COUNTING_GAME_TYPES = new Set(["BBM", "National Team", "Private"]);

export function isCountingGame(gameType: string): boolean {
  return !NON_COUNTING_GAME_TYPES.has(gameType);
}
