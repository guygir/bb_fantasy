/**
 * Fantasy game data from Supabase.
 * Used when sync-fantasy has populated the tables. Returns same shapes as JSON-based libs.
 */

import { createClient } from "@supabase/supabase-js";
import { loadPlayerGameStats } from "./boxscore";
import { statsToFantasyPoints, fantasyPPGToPrice } from "./scoring";
import type { PlayerWithDetails } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSupabase() {
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Check if fantasy tables have data for season */
export async function hasFantasyData(season: number): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("fantasy_players")
    .select("player_id")
    .eq("season", season)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/** Get current price for a player (latest effective_from) */
async function getCurrentPrices(season: number): Promise<Record<number, number>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price, effective_from")
    .eq("season", season)
    .order("effective_from", { ascending: false });
  if (error || !data) return {};
  const out: Record<number, number> = {};
  for (const row of data) {
    if (out[row.player_id] == null) out[row.player_id] = row.price;
  }
  return out;
}

/** Get players with details from Supabase (same shape as getPlayersWithDetails) */
export async function getPlayersFromSupabase(season: number): Promise<PlayerWithDetails[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const [playersRes, detailsRes, pricesRes] = await Promise.all([
    supabase.from("fantasy_players").select("*").eq("season", season),
    supabase.from("fantasy_player_details").select("*").eq("season", season),
    getCurrentPrices(season),
  ]);

  const players = playersRes.data ?? [];
  const detailsMap = new Map(
    (detailsRes.data ?? []).map((d) => [d.player_id, d])
  );

  const results: PlayerWithDetails[] = players.map((p) => {
    const d = detailsMap.get(p.player_id);
    const stats = {
      min: p.min,
      fgMade: 0,
      fgAtt: 0,
      tpMade: 0,
      tpAtt: 0,
      ftMade: 0,
      ftAtt: 0,
      or: 0,
      tr: p.tr ?? 0,
      ast: p.ast ?? 0,
      to: p.to ?? 0,
      stl: p.stl ?? 0,
      blk: p.blk ?? 0,
      pf: 0,
      pts: p.pts ?? 0,
      rtng: p.rtng ?? 0,
    };
    const fantasyPPG = statsToFantasyPoints(stats);
    const currentPrice = pricesRes[p.player_id];
    const inGamePrice = currentPrice ?? fantasyPPGToPrice(fantasyPPG);

    return {
      playerId: p.player_id,
      name: p.name,
      image: `https://buzzerbeater.com/player/${p.player_id}/overview.aspx`,
      position: d?.position ?? "?",
      dmi: d?.dmi ?? null,
      salary: d?.salary ?? null,
      inGamePrice,
      avgRating: p.rtng ?? 0,
      pts: p.pts ?? 0,
      fantasyPPG,
      gameShape: d?.game_shape ?? null,
    };
  });

  return results.sort((a, b) => b.fantasyPPG - a.fantasyPPG);
}

/** Get price data from Supabase (same shape as loadPriceData) */
export async function getPriceDataFromSupabase(season: number): Promise<{
  meta: { season: number; updated: string };
  current: Record<number, number>;
  history: Record<number, { playerId: number; price: number; effectiveFrom: string }[]>;
} | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price, effective_from")
    .eq("season", season)
    .order("effective_from", { ascending: false });

  if (error || !data) return null;

  const current: Record<number, number> = {};
  const history: Record<number, { playerId: number; price: number; effectiveFrom: string }[]> = {};

  for (const row of data) {
    if (current[row.player_id] == null) current[row.player_id] = row.price;
    const arr = history[row.player_id] ?? [];
    arr.push({
      playerId: row.player_id,
      price: row.price,
      effectiveFrom: row.effective_from,
    });
    history[row.player_id] = arr;
  }

  return {
    meta: { season, updated: new Date().toISOString() },
    current,
    history,
  };
}

/** Get player game stats from Supabase */
export async function getPlayerGameStatsFromSupabase(season: number): Promise<
  { playerId: number; matchId: string; name: string; fantasyPoints: number }[] | null
> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("fantasy_player_game_stats")
    .select("player_id, match_id, name, fantasy_points")
    .eq("season", season);

  if (error || !data) return null;

  return data.map((r) => ({
    playerId: r.player_id,
    matchId: r.match_id,
    name: r.name ?? "",
    fantasyPoints: r.fantasy_points ?? 0,
  }));
}

/** Get player game stats - Supabase first, JSON fallback. Use in server components. */
export async function getPlayerGameStats(
  season: number
): Promise<{ playerId: number; matchId: string; name: string; fantasyPoints: number }[]> {
  if (await hasFantasyData(season)) {
    const stats = await getPlayerGameStatsFromSupabase(season);
    if (stats) return stats;
  }
  return loadPlayerGameStats(season);
}

/** User standings: users ranked by roster total fantasy points. Requires Supabase data. */
export async function getUserStandings(season: number): Promise<
  { rank: number; userId: string; nickname: string; totalFantasyPoints: number }[]
> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const [rostersRes, statsRes, profilesRes] = await Promise.all([
    supabase.from("fantasy_user_rosters").select("user_id, player_ids").eq("season", season),
    supabase.from("fantasy_player_game_stats").select("player_id, fantasy_points").eq("season", season),
    supabase.from("profiles").select("user_id, nickname"),
  ]);

  const rosters = rostersRes.data ?? [];
  const stats = statsRes.data ?? [];
  const profiles = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.nickname ?? "?"]));

  const pointsByPlayer = new Map<number, number>();
  for (const s of stats) {
    pointsByPlayer.set(s.player_id, (pointsByPlayer.get(s.player_id) ?? 0) + Number(s.fantasy_points ?? 0));
  }

  const standings = rosters
    .filter((r) => r.player_ids?.length)
    .map((r) => {
      const total = (r.player_ids as number[]).reduce((sum, pid) => sum + (pointsByPlayer.get(pid) ?? 0), 0);
      return {
        userId: r.user_id,
        nickname: profiles.get(r.user_id) ?? "?",
        totalFantasyPoints: total,
      };
    })
    .sort((a, b) => b.totalFantasyPoints - a.totalFantasyPoints)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return standings;
}
