/**
 * Parse all boxscore XML files in data/ and write player_game_stats + match_scores
 * Run: node scripts/process-boxscores.mjs [season]
 *
 * Prerequisite: Run fetch-boxscore for each match first, e.g.:
 *   npm run fetch-boxscore 83641
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const ISRAEL_TEAM_ID = 1015;
const SEASON = process.argv[2] ? parseInt(process.argv[2], 10) : 71;

function parseNum(val) {
  if (val == null || val === "" || val === "N/A") return 0;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

function sumMinutes(minBlock) {
  if (!minBlock) return 0;
  const pg = parseNum(minBlock.match(/<PG>([^<]*)<\/PG>/)?.[1]);
  const sg = parseNum(minBlock.match(/<SG>([^<]*)<\/SG>/)?.[1]);
  const sf = parseNum(minBlock.match(/<SF>([^<]*)<\/SF>/)?.[1]);
  const pf = parseNum(minBlock.match(/<PF>([^<]*)<\/PF>/)?.[1]);
  const c = parseNum(minBlock.match(/<C>([^<]*)<\/C>/)?.[1]);
  return pg + sg + sf + pf + c;
}

function statsToFantasyPoints(stats) {
  const dr = stats.tr - stats.or;
  return (
    stats.pts * 1.0 +
    dr * 1.2 +
    stats.or * 1.5 +
    stats.ast * 1.5 +
    stats.stl * 2.0 +
    stats.blk * 2.0 -
    stats.to * 1.0 -
    stats.pf * 0.5 +
    stats.tpMade * 0.5
  );
}

function parseBoxscoreXml(xml, teamId = ISRAEL_TEAM_ID) {
  const matchIdMatch = xml.match(/<match\s+id=['"](\d+)['"][^>]*>/);
  if (!matchIdMatch) return null;

  const matchId = matchIdMatch[1];
  const homeTeamBlock = xml.match(/<homeTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/homeTeam>/);
  const awayTeamBlock = xml.match(/<awayTeam\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/awayTeam>/);

  if (!homeTeamBlock || !awayTeamBlock) return null;

  const homeTeamId = homeTeamBlock[1];
  const awayTeamId = awayTeamBlock[1];
  const homeContent = homeTeamBlock[2];
  const awayContent = awayTeamBlock[2];

  const homeScore = parseNum(homeContent.match(/<score[^>]*>([^<]*)<\/score>/)?.[1]);
  const awayScore = parseNum(awayContent.match(/<score[^>]*>([^<]*)<\/score>/)?.[1]);

  const israelContent = String(teamId) === homeTeamId ? homeContent : awayContent;
  const boxscoreMatch = israelContent.match(/<boxscore>([\s\S]*?)<\/boxscore>/);
  if (!boxscoreMatch) return null;

  const boxscore = boxscoreMatch[1];
  const playerStats = [];

  const playerBlocks = [...boxscore.matchAll(/<player\s+id=['"](\d+)['"][^>]*>([\s\S]*?)<\/player>/g)];
  for (const p of playerBlocks) {
    const playerId = parseInt(p[1], 10);
    const block = p[2];

    const firstName = block.match(/<firstName>([^<]*)<\/firstName>/)?.[1] ?? "";
    const lastName = block.match(/<lastName>([^<]*)<\/lastName>/)?.[1] ?? "";
    const name = `${firstName} ${lastName}`.trim() || `Player ${playerId}`;

    const perfMatch = block.match(/<performance>([\s\S]*?)<\/performance>/);
    if (!perfMatch) continue;
    const perf = perfMatch[1];
    if (perf.includes("<dnp/>")) continue;

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

    playerStats.push({
      playerId,
      matchId,
      name,
      ...stats,
      fantasyPoints: statsToFantasyPoints(stats),
    });
  }

  return {
    matchId,
    homeScore,
    awayScore,
    playerStats,
  };
}

async function run() {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith("bbapi_boxscore_") && f.endsWith(".xml"));
  const matchIds = files.map((f) => f.replace("bbapi_boxscore_", "").replace(".xml", ""));

  console.log("Found", matchIds.length, "boxscore(s):", matchIds.join(", ") || "(none)");

  const allStats = [];
  const matchScores = {};

  for (const matchId of matchIds) {
    const path = join(DATA_DIR, `bbapi_boxscore_${matchId}.xml`);
    const xml = readFileSync(path, "utf-8");
    const parsed = parseBoxscoreXml(xml);
    if (parsed) {
      allStats.push(...parsed.playerStats);
      matchScores[matchId] = { homeScore: parsed.homeScore, awayScore: parsed.awayScore };
    }
  }

  const statsPath = join(DATA_DIR, `player_game_stats_s${SEASON}.json`);
  const scoresPath = join(DATA_DIR, `match_scores_s${SEASON}.json`);

  writeFileSync(
    statsPath,
    JSON.stringify(
      {
        meta: { season: SEASON, source: "bbapi_boxscore", updated: new Date().toISOString(), matchIds },
        stats: allStats,
      },
      null,
      2
    )
  );

  writeFileSync(
    scoresPath,
    JSON.stringify(
      {
        meta: { season: SEASON, updated: new Date().toISOString() },
        scores: matchScores,
      },
      null,
      2
    )
  );

  console.log("Wrote", allStats.length, "player-game stats to", statsPath);
  console.log("Wrote", Object.keys(matchScores).length, "match scores to", scoresPath);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
