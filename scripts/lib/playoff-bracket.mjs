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
 * Parse the finals series score (best of 3: first to 2 wins takes the trophy).
 * Returns { leftWins, rightWins } or null if not in finals / element not found.
 * 
 * Element #cphContent_playoffs_pnlScoreFinal contains individual GAME scores, not series scores.
 * Examples:
 *   - "128 - 71" (one game played, left team won → series 1-0)
 *   - "57 - 82" (one game played, right team won → series 0-1)
 *   - "128 - 71 57 - 82" (two games, split → series 1-1)
 *   - "128 - 71 90 - 85" (two games, left won both → series 2-0)
 * 
 * We parse all game scores and count wins for each side.
 */
export function parseFinalsSeriesScore(html) {
  const $ = load(html);
  const panel = $("#cphContent_playoffs_pnlScoreFinal");
  if (!panel.length) return null;
  
  const text = panel.text().trim();
  if (!text) return null;
  
  // Find all game scores like "128 - 71" or "57-82"
  const gamePattern = /(\d+)\s*[-–—]\s*(\d+)/g;
  let match;
  let leftWins = 0;
  let rightWins = 0;
  
  while ((match = gamePattern.exec(text)) !== null) {
    const leftScore = parseInt(match[1], 10);
    const rightScore = parseInt(match[2], 10);
    if (leftScore > rightScore) {
      leftWins++;
    } else if (rightScore > leftScore) {
      rightWins++;
    }
    // Ties don't count (shouldn't happen in basketball)
  }
  
  // If no games found, return null
  if (leftWins === 0 && rightWins === 0) {
    // Check if element exists but has no scores yet (0-0 series)
    return { leftWins: 0, rightWins: 0 };
  }
  
  return { leftWins, rightWins };
}

/**
 * Get finals info: teams and series score.
 * Returns { leftTeamId, rightTeamId, leftWins, rightWins, champTeamId } or null if not in playoffs.
 */
export function parseFinalsInfo(html) {
  const $ = load(html);
  if (!$("#playoff").length) return null;
  
  const leftTeamId = getTeamId($, "cphContent_playoffs_teamLeftFinal");
  const rightTeamId = getTeamId($, "cphContent_playoffs_teamRightFinal");
  const champTeamId = getTeamId($, "cphContent_playoffs_trophy");
  
  // If trophy exists, series is 2-0 or 2-1 for the winner
  // Otherwise check the pnlScoreFinal for current score
  let leftWins = 0;
  let rightWins = 0;
  
  if (champTeamId != null) {
    // Finals decided - champion has 2 wins
    if (champTeamId === leftTeamId) {
      leftWins = 2;
      // rightWins could be 0 or 1, but we don't know from just the trophy
    } else if (champTeamId === rightTeamId) {
      rightWins = 2;
    }
  }
  
  // Try to get series score from panel (may provide more detail)
  const seriesScore = parseFinalsSeriesScore(html);
  if (seriesScore) {
    leftWins = seriesScore.leftWins;
    rightWins = seriesScore.rightWins;
  }
  
  return {
    leftTeamId,
    rightTeamId,
    leftWins,
    rightWins,
    champTeamId,
  };
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

  // Lost Semis: both finalists known (lf+rf populated) but team is in a semi slot and not a finalist.
  // This must trigger even before the Finals are played (trophyId may still be null).
  if (lf != null && rf != null) {
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
