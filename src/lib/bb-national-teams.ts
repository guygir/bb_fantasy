export type NationalTeamLevel = "u21" | "nt";

export const NATIONAL_TEAM_LEVELS: Record<
  NationalTeamLevel,
  { rosterPath: "jnt" | "nt"; label: string; analyzerPath: string }
> = {
  u21: {
    rosterPath: "jnt",
    label: "U21 National Team",
    analyzerPath: "/rosters",
  },
  nt: {
    rosterPath: "nt",
    label: "National Team",
    analyzerPath: "/nt-analyzer",
  },
};

export function parseNationalTeamLevel(value: string | null): NationalTeamLevel | null {
  return value === "u21" || value === "nt" ? value : null;
}

export function getPlayerBbUrl(playerId: number): string {
  return `https://buzzerbeater.com/player/${playerId}/overview.aspx`;
}
