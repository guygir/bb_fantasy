import { getSupabase } from "@/lib/supabase";

export type PromotionEntry = {
  display_rank: number;
  league_id: number;
  conf: number;
  conf_rank: number;
  team_name: string;
  wins: number;
  losses: number;
  pd: number;
  league_name: string;
};

export async function getLatestPromotions(): Promise<{
  snapshotAt: string | null;
  entries: PromotionEntry[];
  error: string | null;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { snapshotAt: null, entries: [], error: "Supabase is not configured." };
  }

  try {
    const supabase = getSupabase();
    const { data: snap, error: snapErr } = await supabase
      .from("promotions_snapshots")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapErr) {
      return { snapshotAt: null, entries: [], error: snapErr.message };
    }
    if (!snap) {
      return { snapshotAt: null, entries: [], error: null };
    }

    const { data: rows, error: entErr } = await supabase
      .from("promotions_entries")
      .select(
        "display_rank, league_id, conf, conf_rank, team_name, wins, losses, pd, league_name"
      )
      .eq("snapshot_id", snap.id)
      .order("display_rank", { ascending: true });

    if (entErr) {
      return { snapshotAt: null, entries: [], error: entErr.message };
    }

    return {
      snapshotAt: snap.created_at,
      entries: (rows ?? []) as PromotionEntry[],
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { snapshotAt: null, entries: [], error: msg };
  }
}
