/**
 * App config - BBAPI credentials, game rules
 * Users will eventually sign up with their own BBAPI; for now hardcoded.
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
    israelU21TeamId: 1015,
  },
} as const;
