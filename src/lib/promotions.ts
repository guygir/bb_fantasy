import { getSupabase } from "@/lib/supabase";
import type { PromotionTierId } from "@/lib/promotions-tier";
import { PROMOTION_TIERS } from "@/lib/promotions-tier";

/** Max rows returned for /promotions (matches fetch script cap) */
const PROMOTIONS_DISPLAY_LIMIT = 32;

export type PlayoffStatus =
  | "In Quarters"
  | "In Semis"
  | "In Finals"
  | "Champ"
  | "Lost Finals"
  | "Lost Semis"
  | "Lost Quarters"
  | "Not in playoff";

function normalizePlayoffStatus(raw: unknown): PlayoffStatus {
  if (raw === "Champ") return "Champ";
  if (raw === "In Quarters") return "In Quarters";
  if (raw === "In Semis") return "In Semis";
  if (raw === "In Finals") return "In Finals";
  if (raw === "Lost Finals") return "Lost Finals";
  if (raw === "Lost Semis") return "Lost Semis";
  if (raw === "Lost Quarters") return "Lost Quarters";
  if (raw === "Not in playoff") return "Not in playoff";
  /** Legacy snapshot values (pre-029) */
  if (raw === "In playoff") return "In Quarters";
  if (raw === "Out of playoff") return "Not in playoff";
  /** Pre-migration rows (is_champ) */
  if (raw === "Yes") return "Champ";
  if (raw === "No") return "Not in playoff";
  return "Not in playoff";
}

export type PromotionEntry = {
  display_rank: number;
  league_id: number;
  conf: number;
  conf_rank: number;
  team_name: string;
  /** BuzzerBeater team page URL from standings link */
  team_url: string | null;
  wins: number;
  losses: number;
  pd: number;
  league_name: string;
  /** From league overview playoff bracket (#playoff) */
  playoff_status: PlayoffStatus;
  /** Movement vs previous snapshot’s overall rank (lower rank # = better) */
  latestRankChange: LatestRankChange;
};

/** Compared to the same team’s position in the prior snapshot (if any). */
export type LatestRankChange =
  | { kind: "up"; magnitude: number }
  | { kind: "down"; magnitude: number }
  | { kind: "same" }
  | { kind: "none" }; // first snapshot, or team was not in previous list

function normalizeTeamName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function teamKey(leagueId: number, conf: number, teamName: string): string {
  return `${leagueId}:${conf}:${normalizeTeamName(teamName)}`;
}

/** Non-champion rows that count toward the green promotion band (same order as the table). */
function promotionBandTeamKeys(
  rows: Array<{ display_rank: number; league_id: number; conf: number; team_name: string; playoff_status: PlayoffStatus }>,
  bandSize: number
): Set<string> {
  let left = bandSize;
  const out = new Set<string>();
  const sorted = [...rows].sort((a, b) => a.display_rank - b.display_rank);
  for (const r of sorted) {
    if (r.playoff_status === "Champ") continue;
    if (left <= 0) break;
    out.add(teamKey(r.league_id, r.conf, r.team_name));
    left--;
  }
  return out;
}

export type PromotionNewsBulletType = "champ" | "entered_band" | "left_band" | "will_enter_band" | "info";
export type PromotionNewsBullet = { text: string; type: PromotionNewsBulletType };

export type PromotionNewsBlock = {
  /** Snapshot times for the card header */
  snapshotAt: string | null;
  previousSnapshotAt: string | null;
  bullets: PromotionNewsBullet[];
  /** True when a prior snapshot exists (even if bullets are empty) */
  hasCompare: boolean;
};

/** Get team ID from team_url */
function parseTeamIdFromUrl(url: string | null): number | null {
  if (!url) return null;
  const match = url.match(/\/team\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Calculate "to-be-promoted" team keys: teams that will enter the band when
 * two green-band teams from the same league finish their finals.
 */
function toBePromotedTeamKeys(
  rows: Row[],
  bandSize: number,
  finalsByLeague: Record<string, FinalsInfo> | null
): Set<string> {
  if (!finalsByLeague) return new Set();
  
  // First, identify green band teams (non-champ, first bandSize)
  let greenLeft = bandSize;
  const greenIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].playoff_status === "Champ") continue;
    if (greenLeft > 0) {
      greenLeft--;
      greenIndices.push(i);
    }
  }
  
  // Group green teams by league
  const greenTeamsByLeague = new Map<number, number[]>();
  for (const i of greenIndices) {
    const leagueId = rows[i].league_id;
    if (!greenTeamsByLeague.has(leagueId)) {
      greenTeamsByLeague.set(leagueId, []);
    }
    greenTeamsByLeague.get(leagueId)!.push(i);
  }
  
  // Count extra slots from leagues where both finalists are in green band
  let extraSlots = 0;
  for (const [leagueId, indices] of greenTeamsByLeague) {
    if (indices.length < 2) continue;
    const fi = finalsByLeague[String(leagueId)];
    if (!fi || fi.leftTeamId == null || fi.rightTeamId == null) continue;
    
    const finalistIds = new Set([fi.leftTeamId, fi.rightTeamId]);
    const greenFinalists = indices.filter(i => {
      const teamId = parseTeamIdFromUrl(rows[i].team_url);
      return teamId != null && finalistIds.has(teamId);
    });
    
    if (greenFinalists.length === 2) {
      extraSlots++;
    }
  }
  
  // Get the next N teams outside the band
  const result = new Set<string>();
  const greenIndexSet = new Set(greenIndices);
  for (let i = 0; i < rows.length && extraSlots > 0; i++) {
    if (rows[i].playoff_status === "Champ") continue;
    if (greenIndexSet.has(i)) continue;
    result.add(teamKey(rows[i].league_id, rows[i].conf, rows[i].team_name));
    extraSlots--;
  }
  
  return result;
}

function buildLeague3PromotionNews(
  currentRows: Row[],
  previousRows: Row[] | null,
  currentBandSize: number,
  previousBandSize: number,
  numBotLeagues: number | null,
  previousNumBotLeagues: number | null,
  snapshotAt: string | null,
  previousSnapshotAt: string | null,
  currentFinalsByLeague: Record<string, FinalsInfo> | null,
  previousFinalsByLeague: Record<string, FinalsInfo> | null
): PromotionNewsBlock {
  // No previous snapshot at all
  if (previousRows === null) {
    return {
      snapshotAt,
      previousSnapshotAt,
      bullets: [],
      hasCompare: false,
    };
  }
  
  // Previous snapshot exists but is empty (e.g., season transition, scrape failure)
  // Treat all current band entries as "entered_band"
  if (previousRows.length === 0) {
    const bullets: PromotionNewsBullet[] = [];
    const currBand = promotionBandTeamKeys(currentRows, currentBandSize);
    const currByKey = new Map<string, Row>();
    for (const r of currentRows) {
      currByKey.set(teamKey(r.league_id, r.conf, r.team_name), r);
    }
    for (const k of currBand) {
      const r = currByKey.get(k)!;
      bullets.push({ text: `${r.team_name} entered the promotion band.`, type: "entered_band" });
    }
    // Also report any champions
    for (const r of currentRows) {
      if (r.playoff_status === "Champ") {
        bullets.push({
          text: `${r.team_name} won the league championship (${r.league_name}).`,
          type: "champ",
        });
      }
    }
    return {
      snapshotAt,
      previousSnapshotAt,
      bullets,
      hasCompare: true,
    };
  }

  const bullets: PromotionNewsBullet[] = [];

  const prevByKey = new Map<string, Row>();
  for (const r of previousRows) {
    prevByKey.set(teamKey(r.league_id, r.conf, r.team_name), r);
  }
  const currByKey = new Map<string, Row>();
  for (const r of currentRows) {
    currByKey.set(teamKey(r.league_id, r.conf, r.team_name), r);
  }

  const prevChampKeys = new Set<string>();
  const currChampKeys = new Set<string>();
  for (const r of previousRows) {
    if (r.playoff_status === "Champ") prevChampKeys.add(teamKey(r.league_id, r.conf, r.team_name));
  }
  for (const r of currentRows) {
    if (r.playoff_status === "Champ") currChampKeys.add(teamKey(r.league_id, r.conf, r.team_name));
  }

  // Track new champions (teams that just won)
  const newChampKeys = new Set<string>();
  for (const k of currChampKeys) {
    if (!prevChampKeys.has(k)) {
      newChampKeys.add(k);
      const r = currByKey.get(k)!;
      bullets.push({
        text: `${r.team_name} won the league championship (${r.league_name}).`,
        type: "champ",
      });
    }
  }
  for (const k of prevChampKeys) {
    if (!currChampKeys.has(k)) {
      const r = prevByKey.get(k)!;
      bullets.push({
        text: `${r.team_name} is no longer listed as playoff champion (${r.league_name}).`,
        type: "info",
      });
    }
  }

  if (
    previousNumBotLeagues != null &&
    numBotLeagues != null &&
    previousNumBotLeagues !== numBotLeagues
  ) {
    bullets.push({
      text: `Bot leagues: ${previousNumBotLeagues} → ${numBotLeagues} (promotion band size changed).`,
      type: "info",
    });
  }

  const prevBand = promotionBandTeamKeys(previousRows, previousBandSize);
  const currBand = promotionBandTeamKeys(currentRows, currentBandSize);

  for (const k of currBand) {
    if (!prevBand.has(k)) {
      const r = currByKey.get(k)!;
      bullets.push({ text: `${r.team_name} entered the promotion band.`, type: "entered_band" });
    }
  }
  for (const k of prevBand) {
    if (!currBand.has(k)) {
      // Only count as "left" if they didn't become champion (champs don't leave, they graduate)
      if (newChampKeys.has(k)) continue;
      const r = prevByKey.get(k)!;
      bullets.push({ text: `${r.team_name} left the promotion band.`, type: "left_band" });
    }
  }

  // To-be-promoted band changes
  const prevToBePromoted = toBePromotedTeamKeys(previousRows, previousBandSize, previousFinalsByLeague);
  const currToBePromoted = toBePromotedTeamKeys(currentRows, currentBandSize, currentFinalsByLeague);

  for (const k of currToBePromoted) {
    if (!prevToBePromoted.has(k)) {
      const r = currByKey.get(k)!;
      bullets.push({ text: `${r.team_name} will enter the promotion band soon.`, type: "will_enter_band" });
    }
  }

  return {
    snapshotAt,
    previousSnapshotAt,
    bullets,
    hasCompare: true,
  };
}

function computeRankChange(
  prevRank: number | undefined,
  newRank: number
): LatestRankChange {
  if (prevRank === undefined) return { kind: "none" };
  const diff = prevRank - newRank;
  if (diff > 0) return { kind: "up", magnitude: diff };
  if (diff < 0) return { kind: "down", magnitude: Math.abs(diff) };
  return { kind: "same" };
}

type Row = Omit<PromotionEntry, "latestRankChange">;

type FinalsInfo = {
  leftTeamId: number | null;
  rightTeamId: number | null;
  leftWins: number;
  rightWins: number;
  champTeamId: number | null;
};

type SnapRow = {
  id: string;
  created_at: string;
  promotion_band_size: number | null;
  num_bot_leagues: number | null;
  finals_by_league: Record<string, FinalsInfo> | null;
};

export type { FinalsInfo };

export async function getLatestPromotions(tier: PromotionTierId): Promise<{
  snapshotAt: string | null;
  previousSnapshotAt: string | null;
  entries: PromotionEntry[];
  /** From snapshot; League III uses dynamic band */
  promotionBandSize: number;
  numBotLeagues: number | null;
  /** League III only: digest vs previous snapshot */
  promotionNews: PromotionNewsBlock | null;
  /** League III: finals series per league (best of 3). Key = league_id. */
  finalsByLeague: Record<string, FinalsInfo> | null;
  error: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const fallbackBand = PROMOTION_TIERS[tier].promotionBandSize;

  if (!url || !anonKey) {
    return {
      snapshotAt: null,
      previousSnapshotAt: null,
      entries: [],
      promotionBandSize: fallbackBand,
      numBotLeagues: null,
      promotionNews: null,
      finalsByLeague: null,
      error: "Supabase is not configured.",
    };
  }

  try {
    const supabase = getSupabase();
    const { data: snaps, error: snapsErr } = await supabase
      .from("promotions_snapshots")
      .select("id, created_at, promotion_band_size, num_bot_leagues, finals_by_league")
      .eq("tier", tier)
      .order("created_at", { ascending: false })
      .limit(2);

    if (snapsErr) {
      return {
        snapshotAt: null,
        previousSnapshotAt: null,
        entries: [],
        promotionBandSize: fallbackBand,
        numBotLeagues: null,
        promotionNews: null,
        finalsByLeague: null,
        error: snapsErr.message,
      };
    }
    if (!snaps?.length) {
      return {
        snapshotAt: null,
        previousSnapshotAt: null,
        entries: [],
        promotionBandSize: fallbackBand,
        numBotLeagues: null,
        promotionNews: null,
        finalsByLeague: null,
        error: null,
      };
    }

    const currentSnap = snaps[0] as SnapRow;
    const previousSnap = snaps.length >= 2 ? (snaps[1] as SnapRow) : null;

    const { data: rows, error: entErr } = await supabase
      .from("promotions_entries")
      .select(
        "display_rank, league_id, conf, conf_rank, team_name, team_url, wins, losses, pd, league_name, playoff_status"
      )
      .eq("snapshot_id", currentSnap.id)
      .lte("display_rank", PROMOTIONS_DISPLAY_LIMIT)
      .order("display_rank", { ascending: true });

    if (entErr) {
      return {
        snapshotAt: null,
        previousSnapshotAt: null,
        entries: [],
        promotionBandSize: fallbackBand,
        numBotLeagues: null,
        promotionNews: null,
        finalsByLeague: null,
        error: entErr.message,
      };
    }

    const rawRows = rows ?? [];
    const currentRows = rawRows.map((r) => ({
      ...r,
      playoff_status: normalizePlayoffStatus((r as { playoff_status?: unknown }).playoff_status),
    })) as Row[];

    let prevRankByTeam = new Map<string, number>();
    let previousRowsFull: Row[] | null = null;
    if (previousSnap) {
      const { data: prevRows } = await supabase
        .from("promotions_entries")
        .select(
          "display_rank, league_id, conf, conf_rank, team_name, team_url, wins, losses, pd, league_name, playoff_status"
        )
        .eq("snapshot_id", previousSnap.id)
        .lte("display_rank", PROMOTIONS_DISPLAY_LIMIT)
        .order("display_rank", { ascending: true });

      prevRankByTeam = new Map(
        (prevRows ?? []).map((p) => [
          teamKey(p.league_id, p.conf, p.team_name),
          p.display_rank,
        ])
      );
      previousRowsFull = (prevRows ?? []).map((r) => ({
        ...r,
        playoff_status: normalizePlayoffStatus((r as { playoff_status?: unknown }).playoff_status),
      })) as Row[];
    }

    const entries: PromotionEntry[] = currentRows.map((row) => ({
      ...row,
      latestRankChange: previousSnap
        ? computeRankChange(
            prevRankByTeam.get(teamKey(row.league_id, row.conf, row.team_name)),
            row.display_rank
          )
        : { kind: "none" },
    }));

    let promotionBandSize = fallbackBand;
    let numBotLeagues: number | null = currentSnap.num_bot_leagues ?? null;

    if (tier === "league3") {
      if (currentSnap.promotion_band_size != null) {
        promotionBandSize = currentSnap.promotion_band_size;
      }
    } else {
      promotionBandSize = currentSnap.promotion_band_size ?? fallbackBand;
    }

    let previousBandSize = fallbackBand;
    if (tier === "league3" && previousSnap?.promotion_band_size != null) {
      previousBandSize = previousSnap.promotion_band_size;
    } else if (previousSnap) {
      previousBandSize = previousSnap.promotion_band_size ?? fallbackBand;
    }

    let promotionNews: PromotionNewsBlock | null = null;
    // Build promotion news for both league2 and league3
    const currentFinals = (currentSnap.finals_by_league as Record<string, FinalsInfo> | null) ?? null;
    const previousFinals = previousSnap 
      ? (previousSnap.finals_by_league as Record<string, FinalsInfo> | null) ?? null 
      : null;
    promotionNews = buildLeague3PromotionNews(
      currentRows,
      previousRowsFull,
      promotionBandSize,
      previousBandSize,
      numBotLeagues,
      previousSnap?.num_bot_leagues ?? null,
      currentSnap.created_at,
      previousSnap?.created_at ?? null,
      currentFinals,
      previousFinals
    );

    return {
      snapshotAt: currentSnap.created_at,
      previousSnapshotAt: previousSnap?.created_at ?? null,
      entries,
      promotionBandSize,
      numBotLeagues,
      promotionNews,
      finalsByLeague: (currentSnap.finals_by_league as Record<string, FinalsInfo> | null) ?? null,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      snapshotAt: null,
      previousSnapshotAt: null,
      entries: [],
      promotionBandSize: fallbackBand,
      numBotLeagues: null,
      promotionNews: null,
      finalsByLeague: null,
      error: msg,
    };
  }
}
