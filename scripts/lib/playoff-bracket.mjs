/**
 * League overview playoff bracket (`#playoff` inside `#playoffsBox`): granular round + outcome per team.
 *
 * Tree (BuzzerBeater ids): quarter pairs feed semi slots — team1left+team2left → team1leftSemiFinal;
 * team1right+team2right → team1rightSemiFinal; team3/4 columns → team2leftSemiFinal / team2rightSemifinal.
 * Finals: teamLeftFinal vs teamRightFinal; trophy = champion. When finals are decided, semi anchors can still
 * show eliminated teams (semi losers) — those are classified Lost Semis, not “still in semis”.
 */

import { load } from "cheerio";

/** Quarter pair → semi slot (left bracket halves). */
const FEEDS = [
  {
    q: ["cphContent_playoffs_team1left", "cphContent_playoffs_team2left"],
    semi: "cphContent_playoffs_team1leftSemiFinal",
  },
  {
    q: ["cphContent_playoffs_team1right", "cphContent_playoffs_team2right"],
    semi: "cphContent_playoffs_team1rightSemiFinal",
  },
  {
    q: ["cphContent_playoffs_team3left", "cphContent_playoffs_team4left"],
    semi: "cphContent_playoffs_team2leftSemiFinal",
  },
  {
    q: ["cphContent_playoffs_team3right", "cphContent_playoffs_team4right"],
    semi: "cphContent_playoffs_team2rightSemifinal",
  },
];

const SEMI_FINAL_IDS = [
  "cphContent_playoffs_team1leftSemiFinal",
  "cphContent_playoffs_team1rightSemiFinal",
  "cphContent_playoffs_team2leftSemiFinal",
  "cphContent_playoffs_team2rightSemifinal",
];

/** BuzzerBeater team id from any team page URL or path (matches `/team/{id}` anywhere in the string). */
function teamIdFromHref(href) {
  if (!href || typeof href !== "string") return null;
  const m = href.match(/\/team\/(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Exported for promotions fetch — same as parsing href from standings / team links. */
export function parseTeamIdFromUrl(url) {
  return teamIdFromHref(url);
}

function getTeamId($, anchorId) {
  const href = $(`#${anchorId}`).attr("href");
  return teamIdFromHref(href);
}

/** Trophy team id if playoff decided, else null */
export function parseTrophyTeamId(html) {
  const $ = load(html);
  if (!$("#playoff").length) return null;
  return getTeamId($, "cphContent_playoffs_trophy");
}

/**
 * @typedef {'In Quarters' | 'In Semis' | 'In Finals' | 'Champ' | 'Lost Finals' | 'Lost Semis' | 'Lost Quarters' | 'Not in playoff'} PlayoffGranularStatus
 */

/**
 * @param {string} html - league overview HTML
 * @param {number} teamId - BuzzerBeater team id
 * @returns {PlayoffGranularStatus | null} null = team not present in bracket markup
 */
export function parsePlayoffStatusForTeam(html, teamId) {
  const $ = load(html);
  const playoff = $("#playoff");
  if (!playoff.length) return null;

  const trophyId = getTeamId($, "cphContent_playoffs_trophy");
  if (trophyId === teamId) return "Champ";

  const lf = getTeamId($, "cphContent_playoffs_teamLeftFinal");
  const rf = getTeamId($, "cphContent_playoffs_teamRightFinal");

  if (trophyId != null && (teamId === lf || teamId === rf) && teamId !== trophyId) {
    return "Lost Finals";
  }

  if (trophyId != null && lf != null && rf != null) {
    const finalists = new Set([lf, rf]);
    for (const anchorId of SEMI_FINAL_IDS) {
      const sid = getTeamId($, anchorId);
      if (sid === teamId && sid != null && !finalists.has(sid)) {
        return "Lost Semis";
      }
    }
  }

  /** Finals not decided: team is one of the two finalists (check before semis — BB may list both slots). */
  if (trophyId == null && (teamId === lf || teamId === rf)) {
    return "In Finals";
  }

  /** Semis round — team occupies a semifinal anchor. */
  for (const id of SEMI_FINAL_IDS) {
    if (getTeamId($, id) === teamId) return "In Semis";
  }

  /** Quarters: pair → semi feed. */
  for (const { q, semi } of FEEDS) {
    const q1 = getTeamId($, q[0]);
    const q2 = getTeamId($, q[1]);
    const semiT = getTeamId($, semi);
    if (![q1, q2].includes(teamId)) continue;
    if (semiT == null) return "In Quarters";
    if (semiT === teamId) return "In Semis";
    return "Lost Quarters";
  }

  let seen = false;
  playoff.find('a[href*="/team/"]').each((_, el) => {
    const id = teamIdFromHref($(el).attr("href"));
    if (id === teamId) seen = true;
  });
  if (!seen) return null;

  return "Not in playoff";
}
