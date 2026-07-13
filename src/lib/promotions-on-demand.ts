import { load } from "cheerio";
import { getCountryName } from "@/lib/bb-countries";
import type { FinalsInfo, PlayoffStatus, PromotionEntry } from "@/lib/promotions";

export type PromotionLevel = "II" | "III" | "IV" | "V";

export type DiscoveredLeague = {
  id: number;
  level: "I" | PromotionLevel;
  ordinal: number | null;
  name: string;
  url: string;
};

export type CustomPromotionsResult = {
  countryId: number;
  countryName: string;
  level: PromotionLevel;
  generatedAt: string;
  leagueCount: number;
  targetLevel: "I" | PromotionLevel;
  targetLevelLeagueCount: number;
  sourceLevelLeagueCount: number;
  fullyBotSourceLeagueCount: number;
  automaticChampionSlots: number;
  demotionSlotsPerTargetLeague: number;
  demotionSlotsFromTargetLevel: number;
  promotionBandSize: number;
  entries: PromotionEntry[];
  finalsByLeague: Record<string, FinalsInfo> | null;
  warnings: string[];
};

type ParsedStandingRow = {
  league_id: number;
  league_name: string;
  conf: number;
  conf_rank: number;
  team_name: string;
  team_url: string | null;
  wins: number;
  losses: number;
  pd: number;
  is_bot: boolean;
};

const BB_ORIGIN = "https://www2.buzzerbeater.com";
const FETCH_TIMEOUT_MS = 25000;
const USER_AGENT = "Mozilla/5.0 (compatible; BBFantasyPromotions/1.0; +https://github.com)";
const TOP_PER_CONF = 3;
const DISPLAY_TOP_N = 32;
const LEAGUE_FETCH_CONCURRENCY = 8;
const CACHE_TTL_MS = 10 * 60 * 1000;

const LEVELS: PromotionLevel[] = ["II", "III", "IV", "V"];
const LEVEL_ORDER: Record<"I" | PromotionLevel, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
};

const cache = new Map<string, { expiresAt: number; value: CustomPromotionsResult }>();

function parseTdInt(text: string): number {
  const n = parseInt(String(text).replace(/[^-\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function resolveUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, BB_ORIGIN).href;
  } catch {
    return null;
  }
}

function parseTeamIdFromHref(href: string | undefined | null): number | null {
  if (!href) return null;
  const m = href.match(/\/team\/(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function getTeamId($: ReturnType<typeof load>, anchorId: string): number | null {
  return parseTeamIdFromHref($(`#${anchorId}`).attr("href"));
}

function normalizeLevel(input: string | null): PromotionLevel | null {
  const value = input?.trim().toUpperCase();
  if (value === "2") return "II";
  if (value === "3") return "III";
  if (value === "4") return "IV";
  if (value === "5") return "V";
  return LEVELS.includes(value as PromotionLevel) ? (value as PromotionLevel) : null;
}

export function parsePromotionLevel(input: string | null): PromotionLevel | null {
  return normalizeLevel(input);
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.9" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverCountryLeagues(countryId: number): Promise<DiscoveredLeague[]> {
  const html = await fetchText(`${BB_ORIGIN}/country/${countryId}/leagueList.aspx`);
  const $ = load(html);
  const leagues: DiscoveredLeague[] = [];
  const seen = new Set<number>();

  $('a[href*="/league/"][href*="/overview.aspx"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const idMatch = href.match(/\/league\/(\d+)\/overview\.aspx/i);
    if (!idMatch) return;

    const id = parseInt(idMatch[1], 10);
    if (!Number.isFinite(id) || seen.has(id)) return;

    const name = $(el).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const levelMatch = name.match(/\b(II|III|IV|V)\.(\d+)\b/);
    let level: "I" | PromotionLevel | null = null;
    let ordinal: number | null = null;

    if (levelMatch) {
      level = levelMatch[1] as PromotionLevel;
      ordinal = parseInt(levelMatch[2], 10);
    } else if (name && !/\b(II|III|IV|V)\./.test(name)) {
      level = "I";
    }

    if (!level) return;
    seen.add(id);
    leagues.push({
      id,
      level,
      ordinal,
      name,
      url: resolveUrl(href) ?? `${BB_ORIGIN}/league/${id}/overview.aspx`,
    });
  });

  return leagues.sort((a, b) => {
    if (LEVEL_ORDER[a.level] !== LEVEL_ORDER[b.level]) return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    return (a.ordinal ?? 0) - (b.ordinal ?? 0);
  });
}

function parseLeaguePage(html: string, leagueId: number): { leagueName: string; rows: ParsedStandingRow[]; isFullyBot: boolean } {
  const $ = load(html);
  const leagueName =
    $("#titlebar h1").first().text().replace(/\s+/g, " ").trim() ||
    $("title").text().replace(/^BuzzerBeater\s*\|\s*/i, "").replace(/\s*\|\s*League Overview$/i, "").trim() ||
    `League ${leagueId}`;

  const rows: ParsedStandingRow[] = [];
  const lis = $("#standings ul.leagueStandings > li");
  const allBotFlags: boolean[] = [];

  for (let conf = 1; conf <= 2; conf++) {
    const trs = $(lis[conf - 1]).find("table.standings tr");
    trs.each((i, tr) => {
      if (i === 0) return;
      const tds = $(tr).find("td");
      if (tds.length < 8) return;
      const teamCell = $(tds[1]);
      allBotFlags.push(/\bisbot\b/.test(teamCell.attr("class") ?? ""));
    });

    for (let i = 1; i <= TOP_PER_CONF; i++) {
      const tr = trs.eq(i);
      const tds = tr.find("td");
      if (tds.length < 8) continue;

      const rank = parseTdInt($(tds[0]).text());
      const teamCell = $(tds[1]);
      const link = teamCell.find("a").first();
      const teamName = link.text().trim() || teamCell.text().trim();
      if (!teamName || rank < 1) continue;

      rows.push({
        league_id: leagueId,
        league_name: leagueName,
        conf,
        conf_rank: rank,
        team_name: teamName,
        team_url: resolveUrl(link.attr("href")),
        wins: parseTdInt($(tds[2]).text()),
        losses: parseTdInt($(tds[3]).text()),
        pd: parseTdInt($(tds[7]).text()),
        is_bot: /\bisbot\b/.test(teamCell.attr("class") ?? ""),
      });
    }
  }

  return { leagueName, rows, isFullyBot: allBotFlags.length === 16 && allBotFlags.every(Boolean) };
}

function parseFinalsSeriesScore(html: string): { leftWins: number; rightWins: number } | null {
  const $ = load(html);
  const panel = $("#cphContent_playoffs_pnlScoreFinal");
  if (!panel.length) return null;

  const text = panel.text().trim();
  if (!text) return { leftWins: 0, rightWins: 0 };

  const gamePattern = /(\d+)\s*[-–—]\s*(\d+)/g;
  let match: RegExpExecArray | null;
  let leftWins = 0;
  let rightWins = 0;
  while ((match = gamePattern.exec(text)) !== null) {
    const leftScore = parseInt(match[1], 10);
    const rightScore = parseInt(match[2], 10);
    if (leftScore > rightScore) leftWins += 1;
    if (rightScore > leftScore) rightWins += 1;
  }
  return { leftWins, rightWins };
}

function parseFinalsInfo(html: string): FinalsInfo | null {
  const $ = load(html);
  if (!$("#playoff").length) return null;

  const leftTeamId = getTeamId($, "cphContent_playoffs_teamLeftFinal");
  const rightTeamId = getTeamId($, "cphContent_playoffs_teamRightFinal");
  const champTeamId = getTeamId($, "cphContent_playoffs_trophy");
  const series = parseFinalsSeriesScore(html);

  let leftWins = series?.leftWins ?? 0;
  let rightWins = series?.rightWins ?? 0;
  if (!series && champTeamId != null) {
    if (champTeamId === leftTeamId) leftWins = 2;
    if (champTeamId === rightTeamId) rightWins = 2;
  }

  return { leftTeamId, rightTeamId, leftWins, rightWins, champTeamId };
}

const SEMI_FINAL_IDS = [
  "cphContent_playoffs_team1leftSemiFinal",
  "cphContent_playoffs_team1rightSemiFinal",
  "cphContent_playoffs_team2leftSemiFinal",
  "cphContent_playoffs_team2rightSemifinal",
];

const FEEDS = [
  { q: ["cphContent_playoffs_team1left", "cphContent_playoffs_team2left"], semi: "cphContent_playoffs_team1leftSemiFinal" },
  { q: ["cphContent_playoffs_team1right", "cphContent_playoffs_team2right"], semi: "cphContent_playoffs_team1rightSemiFinal" },
  { q: ["cphContent_playoffs_team3left", "cphContent_playoffs_team4left"], semi: "cphContent_playoffs_team2leftSemiFinal" },
  { q: ["cphContent_playoffs_team3right", "cphContent_playoffs_team4right"], semi: "cphContent_playoffs_team2rightSemifinal" },
];

function parsePlayoffStatusForTeam(html: string, teamId: number): PlayoffStatus {
  const $ = load(html);
  const playoff = $("#playoff");
  if (!playoff.length) return "Not in playoff";

  const trophyId = getTeamId($, "cphContent_playoffs_trophy");
  if (trophyId === teamId) return "Champ";

  const lf = getTeamId($, "cphContent_playoffs_teamLeftFinal");
  const rf = getTeamId($, "cphContent_playoffs_teamRightFinal");
  if (trophyId != null && (teamId === lf || teamId === rf)) return "Lost Finals";

  if (lf != null && rf != null) {
    const finalists = new Set([lf, rf]);
    for (const anchorId of SEMI_FINAL_IDS) {
      const sid = getTeamId($, anchorId);
      if (sid === teamId && !finalists.has(sid)) return "Lost Semis";
    }
  }

  if (trophyId == null && (teamId === lf || teamId === rf)) return "In Finals";

  for (const id of SEMI_FINAL_IDS) {
    if (getTeamId($, id) === teamId) return "In Semis";
  }

  for (const { q, semi } of FEEDS) {
    const q1 = getTeamId($, q[0]);
    const q2 = getTeamId($, q[1]);
    const semiT = getTeamId($, semi);
    if (![q1, q2].includes(teamId)) continue;
    if (semiT == null) return "In Quarters";
    if (semiT === teamId) return "In Semis";
    return "Lost Quarters";
  }

  return "Not in playoff";
}

function rankRows(rows: ParsedStandingRow[]): ParsedStandingRow[] {
  return [...rows].sort((a, b) => {
    if (a.conf_rank !== b.conf_rank) return a.conf_rank - b.conf_rank;
    if (a.wins !== b.wins) return b.wins - a.wins;
    return b.pd - a.pd;
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function buildBandCalculation(
  allLeagues: DiscoveredLeague[],
  sourceLevel: PromotionLevel,
  fullyBotSourceLeagueCount: number,
  countryId: number
): {
  targetLevel: "I" | PromotionLevel;
  targetLevelLeagueCount: number;
  sourceLevelLeagueCount: number;
  fullyBotSourceLeagueCount: number;
  automaticChampionSlots: number;
  demotionSlotsPerTargetLeague: number;
  demotionSlotsFromTargetLevel: number;
  promotionBandSize: number;
} {
  const targetLevelOrder = LEVEL_ORDER[sourceLevel] - 1;
  const targetLevel = (Object.entries(LEVEL_ORDER).find(([, order]) => order === targetLevelOrder)?.[0] ?? "I") as
    | "I"
    | PromotionLevel;
  const targetLeagueCount = allLeagues.filter((l) => l.level === targetLevel).length;
  const sourceLeagueCount = allLeagues.filter((l) => l.level === sourceLevel).length;
  const automaticChampionSlots = Math.max(0, sourceLeagueCount - fullyBotSourceLeagueCount);
  const demotionSlotsPerTargetLeague = countryId === 99 ? 6 : 5;
  const demotionSlotsFromTargetLevel = targetLeagueCount * demotionSlotsPerTargetLeague;
  return {
    targetLevel,
    targetLevelLeagueCount: targetLeagueCount,
    sourceLevelLeagueCount: sourceLeagueCount,
    fullyBotSourceLeagueCount,
    automaticChampionSlots,
    demotionSlotsPerTargetLeague,
    demotionSlotsFromTargetLevel,
    promotionBandSize: Math.max(0, demotionSlotsFromTargetLevel - automaticChampionSlots),
  };
}

export async function generateCustomPromotions(countryId: number, level: PromotionLevel): Promise<CustomPromotionsResult> {
  const cacheKey = `${countryId}:${level}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const warnings: string[] = [];
  const countryName = getCountryName(countryId);
  const allLeagues = await discoverCountryLeagues(countryId);
  const sourceLeagues = allLeagues.filter((l) => l.level === level);

  if (sourceLeagues.length === 0) {
    throw new Error(`${countryName} does not have level ${level} leagues.`);
  }

  const overviewResults = await mapWithConcurrency(sourceLeagues, LEAGUE_FETCH_CONCURRENCY, async (league) => {
    try {
      const html = await fetchText(league.url);
      return { league, html };
    } catch (e) {
      warnings.push(`Failed to fetch ${league.name}: ${e instanceof Error ? e.message : String(e)}`);
      return { league, html: null };
    }
  });

  const allRows: ParsedStandingRow[] = [];
  const htmlByLeagueId = new Map<number, string>();
  const finalsByLeague: Record<string, FinalsInfo> = {};
  let fullyBotSourceLeagueCount = 0;

  for (const { league, html } of overviewResults) {
    if (!html) continue;
    htmlByLeagueId.set(league.id, html);
    const parsed = parseLeaguePage(html, league.id);
    if (parsed.isFullyBot) fullyBotSourceLeagueCount += 1;
    allRows.push(...parsed.rows);
    const finals = parseFinalsInfo(html);
    if (finals && (finals.leftTeamId != null || finals.rightTeamId != null || finals.champTeamId != null)) {
      finalsByLeague[String(league.id)] = finals;
    }
  }

  const eligible = rankRows(allRows.filter((r) => !r.is_bot)).slice(0, DISPLAY_TOP_N);
  const entries: PromotionEntry[] = eligible.map((row, index) => {
    const teamId = parseTeamIdFromHref(row.team_url);
    const html = htmlByLeagueId.get(row.league_id);
    return {
      display_rank: index + 1,
      league_id: row.league_id,
      conf: row.conf,
      conf_rank: row.conf_rank,
      team_name: row.team_name,
      team_url: row.team_url,
      wins: row.wins,
      losses: row.losses,
      pd: row.pd,
      league_name: row.league_name,
      playoff_status: html && teamId != null ? parsePlayoffStatusForTeam(html, teamId) : "Not in playoff",
      latestRankChange: { kind: "none" },
    };
  });

  const bandCalculation = buildBandCalculation(allLeagues, level, fullyBotSourceLeagueCount, countryId);
  const result: CustomPromotionsResult = {
    countryId,
    countryName,
    level,
    generatedAt: new Date().toISOString(),
    leagueCount: allLeagues.length,
    targetLevel: bandCalculation.targetLevel,
    targetLevelLeagueCount: bandCalculation.targetLevelLeagueCount,
    sourceLevelLeagueCount: bandCalculation.sourceLevelLeagueCount,
    fullyBotSourceLeagueCount: bandCalculation.fullyBotSourceLeagueCount,
    automaticChampionSlots: bandCalculation.automaticChampionSlots,
    demotionSlotsPerTargetLeague: bandCalculation.demotionSlotsPerTargetLeague,
    demotionSlotsFromTargetLevel: bandCalculation.demotionSlotsFromTargetLevel,
    promotionBandSize: bandCalculation.promotionBandSize,
    entries,
    finalsByLeague: Object.keys(finalsByLeague).length ? finalsByLeague : null,
    warnings,
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}
