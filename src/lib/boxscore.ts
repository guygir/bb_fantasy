/**
 * Boxscore parser - BBAPI XML → per-game stats + fantasy points
 * Filters to Israel U21 (team 1015) players only.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { statsToFantasyPoints } from "./scoring";
import { config } from "./config";

export interface PlayerGameStat {
  playerId: number;
  matchId: string;
  name: string;
  min: number;
  fgMade: number;
  fgAtt: number;
  tpMade: number;
  tpAtt: number;
  ftMade: number;
  ftAtt: number;
  or: number;
  tr: number;
  ast: number;
  to: number;
  stl: number;
  blk: number;
  pf: number;
  pts: number;
  rtng: number;
  fantasyPoints: number;
}

export interface ParsedBoxscore {
  matchId: string;
  startTime: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  homeTeamName: string;
  awayTeamName: string;
  playerStats: PlayerGameStat[];
}

function parseNum(val: string | undefined): number {
  if (val == null || val === "" || val === "N/A") return 0;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

function sumMinutes(minBlock: string): number {
  const pg = parseNum(minBlock.match(/<PG>([^<]*)<\/PG>/)?.[1]);
  const sg = parseNum(minBlock.match(/<SG>([^<]*)<\/SG>/)?.[1]);
  const sf = parseNum(minBlock.match(/<SF>([^<]*)<\/SF>/)?.[1]);
  const pf = parseNum(minBlock.match(/<PF>([^<]*)<\/PF>/)?.[1]);
  const c = parseNum(minBlock.match(/<C>([^<]*)<\/C>/)?.[1]);
  return pg + sg + sf + pf + c;
}

/**
 * Parse BBAPI boxscore XML. Returns Israel U21 player stats + match scores.
 */
export function parseBoxscoreXml(xml: string, teamId: number = config.game.israelU21TeamId): ParsedBoxscore | null {
  const matchIdMatch = xml.match(/<match\s+id=['"](\d+)['"][^>]*>/);
  const startMatch = xml.match(/<startTime>([^<]*)<\/startTime>/);
  if (!matchIdMatch) return null;

  const matchId = matchIdMatch[1];

  // Find home and away teams - support both id='1015' and id="1015"
  const homeTeamMatch = xml.match(new RegExp(`<homeTeam\\s+id=['"](${teamId})['"][^>]*>([\\s\\S]*?)<\\/homeTeam>`));
  const awayTeamMatch = xml.match(/<awayTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/awayTeam>/);

  // If Israel is away, we need awayTeam
  const homeTeamBlock = xml.match(/<homeTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/homeTeam>/);
  const awayTeamBlock = xml.match(/<awayTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/awayTeam>/);

  if (!homeTeamBlock || !awayTeamBlock) return null;

  const homeTeamId = homeTeamBlock[1];
  const awayTeamId = awayTeamBlock[1];
  const homeContent = homeTeamBlock[2];
  const awayContent = awayTeamBlock[2];

  const homeTeamName = homeContent.match(/<teamName>([^<]*)<\/teamName>/)?.[1] ?? "";
  const awayTeamName = awayContent.match(/<teamName>([^<]*)<\/teamName>/)?.[1] ?? "";

  const homeScore = parseNum(homeContent.match(/<score[^>]*>([^<]*)<\/score>/)?.[1]);
  const awayScore = parseNum(awayContent.match(/<score[^>]*>([^<]*)<\/score>/)?.[1]);

  // Get boxscore for Israel (either home or away)
  const israelContent = String(teamId) === homeTeamId ? homeContent : awayContent;
  const boxscoreMatch = israelContent.match(/<boxscore>([\s\S]*?)<\/boxscore>/);
  if (!boxscoreMatch) return null;

  const boxscore = boxscoreMatch[1];
  const playerStats: PlayerGameStat[] = [];

  const playerBlocks = boxscore.matchAll(/<player\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/player>/g);
  for (const p of playerBlocks) {
    const playerId = parseInt(p[1], 10);
    const block = p[2];

    const firstName = block.match(/<firstName>([^<]*)<\/firstName>/)?.[1] ?? "";
    const lastName = block.match(/<lastName>([^<]*)<\/lastName>/)?.[1] ?? "";
    const name = `${firstName} ${lastName}`.trim() || `Player ${playerId}`;

    const perfMatch = block.match(/<performance>([\s\S]*?)<\/performance>/);
    if (!perfMatch) continue;

    const perf = perfMatch[1];
    if (perf.includes("<dnp/>")) continue; // DNP = 0, skip or include with 0s

    const minBlock = block.match(/<minutes>([\s\S]*?)<\/minutes>/)?.[1] ?? "";
    const min = sumMinutes(minBlock);

    const fgm = parseNum(perf.match(/<fgm>([^<]*)<\/fgm>/)?.[1]);
    const fga = parseNum(perf.match(/<fga>([^<]*)<\/fga>/)?.[1]);
    const tpm = parseNum(perf.match(/<tpm>([^<]*)<\/tpm>/)?.[1]);
    const tpa = parseNum(perf.match(/<tpa>([^<]*)<\/tpa>/)?.[1]);
    const ftm = parseNum(perf.match(/<ftm>([^<]*)<\/ftm>/)?.[1]);
    const fta = parseNum(perf.match(/<fta>([^<]*)<\/fta>/)?.[1]);
    const oreb = parseNum(perf.match(/<oreb>([^<]*)<\/oreb>/)?.[1]);
    const reb = parseNum(perf.match(/<reb>([^<]*)<\/reb>/)?.[1]);
    const ast = parseNum(perf.match(/<ast>([^<]*)<\/ast>/)?.[1]);
    const to = parseNum(perf.match(/<to>([^<]*)<\/to>/)?.[1]);
    const stl = parseNum(perf.match(/<stl>([^<]*)<\/stl>/)?.[1]);
    const blk = parseNum(perf.match(/<blk>([^<]*)<\/blk>/)?.[1]);
    const pf = parseNum(perf.match(/<pf>([^<]*)<\/pf>/)?.[1]);
    const pts = parseNum(perf.match(/<pts>([^<]*)<\/pts>/)?.[1]);
    const rtng = parseNum(perf.match(/<rating>([^<]*)<\/rating>/)?.[1]);

    const stats = {
      min,
      fgMade: fgm,
      fgAtt: fga,
      tpMade: tpm,
      tpAtt: tpa,
      ftMade: ftm,
      ftAtt: fta,
      or: oreb,
      tr: reb,
      ast,
      to,
      stl,
      blk,
      pf,
      pts,
      rtng,
    };

    const fantasyPoints = statsToFantasyPoints(stats);

    playerStats.push({
      playerId,
      matchId,
      name,
      ...stats,
      fantasyPoints,
    });
  }

  return {
    matchId,
    startTime: startMatch?.[1] ?? "",
    homeTeamId,
    awayTeamId,
    homeScore,
    awayScore,
    homeTeamName,
    awayTeamName,
    playerStats,
  };
}

/**
 * Load all parsed player_game_stats from JSON (written by process-boxscores script).
 */
export function loadPlayerGameStats(season: number = 71): PlayerGameStat[] {
  const path = join(process.cwd(), "data", `player_game_stats_s${season}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.stats ?? [];
  } catch {
    return [];
  }
}

/**
 * Load match scores from JSON (written by process-boxscores script).
 */
export function loadMatchScores(season: number = 71): Record<string, { homeScore: number; awayScore: number }> {
  const path = join(process.cwd(), "data", `match_scores_s${season}.json`);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data.scores ?? {};
  } catch {
    return {};
  }
}

/**
 * Parse a single boxscore XML file from data/
 */
export function parseBoxscoreFile(matchId: string): ParsedBoxscore | null {
  const path = join(process.cwd(), "data", `bbapi_boxscore_${matchId}.xml`);
  if (!existsSync(path)) return null;
  const xml = readFileSync(path, "utf-8");
  return parseBoxscoreXml(xml);
}
