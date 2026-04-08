import { getSupabase } from "@/lib/supabase";
import type { PromotionTierId } from "@/lib/promotions-tier";

/** Max rows returned for /promotions (matches fetch script cap) */
const PROMOTIONS_DISPLAY_LIMIT = 32;

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

export async function getLatestPromotions(
  tier: PromotionTierId
): Promise<{
  snapshotAt: string | null;
  previousSnapshotAt: string | null;
  entries: PromotionEntry[];
  error: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      snapshotAt: null,
      previousSnapshotAt: null,
      entries: [],
      error: "Supabase is not configured.",
    };
  }

  try {
    const supabase = getSupabase();
    const { data: snaps, error: snapsErr } = await supabase
      .from("promotions_snapshots")
      .select("id, created_at")
      .eq("tier", tier)
      .order("created_at", { ascending: false })
      .limit(2);

    if (snapsErr) {
      return {
        snapshotAt: null,
        previousSnapshotAt: null,
        entries: [],
        error: snapsErr.message,
      };
    }
    if (!snaps?.length) {
      return { snapshotAt: null, previousSnapshotAt: null, entries: [], error: null };
    }

    const currentSnap = snaps[0];
    const previousSnap = snaps.length >= 2 ? snaps[1] : null;

    const { data: rows, error: entErr } = await supabase
      .from("promotions_entries")
      .select(
        "display_rank, league_id, conf, conf_rank, team_name, team_url, wins, losses, pd, league_name"
      )
      .eq("snapshot_id", currentSnap.id)
      .lte("display_rank", PROMOTIONS_DISPLAY_LIMIT)
      .order("display_rank", { ascending: true });

    if (entErr) {
      return {
        snapshotAt: null,
        previousSnapshotAt: null,
        entries: [],
        error: entErr.message,
      };
    }

    const currentRows = (rows ?? []) as Row[];

    let prevRankByTeam = new Map<string, number>();
    if (previousSnap) {
      const { data: prevRows } = await supabase
        .from("promotions_entries")
        .select("display_rank, league_id, conf, team_name")
        .eq("snapshot_id", previousSnap.id)
        .lte("display_rank", PROMOTIONS_DISPLAY_LIMIT)
        .order("display_rank", { ascending: true });

      prevRankByTeam = new Map(
        (prevRows ?? []).map((p) => [
          teamKey(p.league_id, p.conf, p.team_name),
          p.display_rank,
        ])
      );
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

    return {
      snapshotAt: currentSnap.created_at,
      previousSnapshotAt: previousSnap?.created_at ?? null,
      entries,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      snapshotAt: null,
      previousSnapshotAt: null,
      entries: [],
      error: msg,
    };
  }
}
