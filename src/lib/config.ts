/**
 * App config - BBAPI credentials, game rules
 */

export const config = {
  bbapi: {
    baseUrl: "http://bbapi.buzzerbeater.com/",
    login: process.env.BBAPI_LOGIN ?? "PotatoJunior",
    code: process.env.BBAPI_CODE ?? "12341234",
  },
  game: {
    cap: Number(process.env.FANTASY_CAP ?? 30),
    rosterSize: Number(process.env.ROSTER_SIZE ?? 5),
    currentSeason: Number(process.env.NEXT_PUBLIC_CURRENT_SEASON ?? process.env.CURRENT_SEASON ?? 71),
    israelU21TeamId: Number(process.env.ISRAEL_U21_TEAM_ID ?? 1015),
  },
  u21dle: {
    minSeason: Number(process.env.U21DLE_MIN_SEASON ?? 60),
    maxSeason: Number(process.env.U21DLE_MAX_SEASON ?? 70),
    maxGuesses: Number(process.env.U21DLE_MAX_GUESSES ?? 5),
  },
} as const;
