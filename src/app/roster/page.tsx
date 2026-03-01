"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import { config } from "@/lib/config";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";

const SEASON = config.game.currentSeason;
const CAP = config.game.cap;
const MAX_SWAP = 2;

interface Roster {
  playerIds: number[];
  playerPrices: Record<number, number>;
  playerNames: Record<number, string>;
  pickedAt: string;
}

interface GameStat {
  playerId: number;
  matchId: string;
  name: string;
  fantasyPoints: number;
}

interface WeeklyEntry {
  week: number;
  matchDate: string;
  matchId: string;
  roster: { playerId: number; name: string; points: number }[];
  total: number;
}

interface Player {
  playerId: number;
  name: string;
  inGamePrice: number;
  fantasyPPG: number;
  position: string;
}

export default function MyRosterPage() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [stats, setStats] = useState<GameStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [subWindow, setSubWindow] = useState<{ open: boolean; nextOpenAt?: string; nextCloseAt?: string; subsUsedThisWindow?: boolean } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [subMode, setSubMode] = useState(false);
  const [toRemove, setToRemove] = useState<Set<number>>(new Set());
  const [toAdd, setToAdd] = useState<Map<number, Player>>(new Map());
  const [subError, setSubError] = useState<string | null>(null);
  const [subSaving, setSubSaving] = useState(false);
  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyEntry[]>([]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthChecked(true);
      if (!session?.user) {
        setLoading(false);
        return;
      }
      setUserId(session.user.id);
    });
  }, []);

  useEffect(() => {
    if (!userId || !supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch(`/api/sub-window/season/${SEASON}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
        .then((r) => (r.ok ? r.json() : { open: false }))
        .then(setSubWindow)
        .catch(() => setSubWindow({ open: false }));
    });
  }, [userId]);

  useEffect(() => {
    if (!userId || !supabase) return;
    const sb = supabase;
    sb.auth.getSession().then(({ data: { session } }) => {
      Promise.all([
        sb.from("fantasy_user_rosters").select("*").eq("season", SEASON).maybeSingle(),
        fetch(`/api/stats/season/${SEASON}`, { cache: "no-store" }).then(async (r) => {
          if (!r.ok) return { stats: [] };
          const data = await r.json();
          return Array.isArray(data.stats) ? data : { stats: data.stats ?? [] };
        }),
        fetch(`/api/players/season/${SEASON}`).then(async (r) => {
          if (!r.ok) return { players: [] };
          const data = await r.json();
          return Array.isArray(data.players) ? data : { players: data.players ?? [] };
        }),
        fetch(`/api/roster/season/${SEASON}/weekly-history`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        }).then(async (r) => {
          if (!r.ok) return { weeks: [] };
          const data = await r.json();
          return { weeks: data.weeks ?? [] };
        }),
      ])
      .then(([rosterRes, statsData, playerData, weeklyData]) => {
        setPlayers((playerData.players ?? []) as Player[]);
        setWeeklyHistory((weeklyData.weeks ?? []) as WeeklyEntry[]);
        const row = rosterRes.data;
        if (row?.player_ids?.length) {
          const prices: Record<number, number> = {};
          const names: Record<number, string> = {};
          for (const id of row.player_ids) {
            const k = String(id);
            if (row.player_prices?.[k] != null) prices[id] = Number(row.player_prices[k]);
            if (row.player_names?.[k]) names[id] = String(row.player_names[k]);
          }
          setRoster({
            playerIds: row.player_ids,
            playerPrices: prices,
            playerNames: names,
            pickedAt: row.picked_at ?? new Date().toISOString(),
          });
        } else {
          setRoster(null);
        }
        setStats((statsData.stats ?? []) as GameStat[]);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Roster load error:", err);
        setLoading(false);
      });
    });
  }, [userId]);

  if (!authChecked || loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-exact border-t-transparent" />
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
        <p className="text-gray-600">
          <Link href="/login" className="text-exact hover:underline font-medium">
            Sign in
          </Link>{" "}
          to view your roster.
        </p>
      </div>
    );
  }

  if (!roster || roster.playerIds.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
        <p className="text-gray-600">
          You haven&apos;t picked a team yet.{" "}
          <Link href="/pick" className="text-exact hover:underline font-medium">
            Pick your team
          </Link>{" "}
          (5 players, $30 cap).
        </p>
      </div>
    );
  }

  const totalCost = roster.playerIds.reduce((sum, id) => sum + (roster.playerPrices[id] ?? 0), 0);
  const pointsByPlayer = new Map<number, number>();
  for (const s of stats) {
    if (roster.playerIds.includes(s.playerId)) {
      pointsByPlayer.set(s.playerId, (pointsByPlayer.get(s.playerId) ?? 0) + s.fantasyPoints);
    }
  }
  const totalFantasyPoints = Array.from(pointsByPlayer.values()).reduce((a, b) => a + b, 0);
  const gamesPlayed = new Set(stats.filter((s) => roster!.playerIds.includes(s.playerId)).map((s) => s.matchId)).size;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
      <p className="mb-6 text-sm text-gray-600">
        Picked {new Date(roster.pickedAt).toLocaleDateString()}. Total: ${totalCost} · Fantasy points from {gamesPlayed} game(s).
      </p>

      <div className="mb-6 rounded-lg border border-bb-border bg-card-bg p-4">
        <div className="flex gap-8">
          <div>
            <span className="text-sm text-gray-500">Total cost</span>
            <p className="text-xl font-bold">${totalCost}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Fantasy points</span>
            <p className="text-xl font-bold">{totalFantasyPoints.toFixed(1)}</p>
          </div>
        </div>
      </div>

      {subWindow && (
        <div className="mb-6 rounded-lg border border-bb-border bg-card-bg p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-600">Substitutions</h3>
          {subWindow.open ? (
            subWindow.subsUsedThisWindow ? (
              <p className="text-sm text-gray-600">
                You&apos;ve already made substitutions for the next game. Changes apply when the game is played.
              </p>
            ) : subMode ? (
              <SubstitutionForm
                roster={roster}
                players={players}
                toRemove={toRemove}
                toAdd={toAdd}
                setToRemove={setToRemove}
                setToAdd={setToAdd}
                onCancel={() => {
                  setSubMode(false);
                  setToRemove(new Set());
                  setToAdd(new Map());
                  setSubError(null);
                }}
                onSave={async () => {
                  if (!userId || !supabase) return;
                  const removedIds = Array.from(toRemove);
                  const addedIds = Array.from(toAdd.keys());
                  if (removedIds.length !== addedIds.length || removedIds.length === 0) {
                    setSubError("Swap 1 or 2 players (removed = added)");
                    return;
                  }
                  const addedPrices: Record<string, number> = {};
                  const addedNames: Record<string, string> = {};
                  for (const [id, p] of toAdd) {
                    addedPrices[String(id)] = p.inGamePrice;
                    addedNames[String(id)] = p.name;
                  }
                  setSubSaving(true);
                  setSubError(null);
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch(`/api/roster/season/${SEASON}/substitute`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                    },
                    body: JSON.stringify({
                      removedIds,
                      addedIds,
                      addedPrices,
                      addedNames,
                    }),
                  });
                  const data = await res.json().catch(() => ({}));
                  setSubSaving(false);
                  if (!res.ok) {
                    setSubError(data.error ?? "Failed to save");
                    return;
                  }
                  setSubMode(false);
                  setToRemove(new Set());
                  setToAdd(new Map());
                  window.location.reload();
                }}
                saving={subSaving}
                error={subError}
              />
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  Swap up to 2 players. Window closes 1h before next game.
                  {subWindow.nextCloseAt && (
                    <span className="ml-2 font-medium text-bb-text">
                      <SubWindowCountdown closeAt={subWindow.nextCloseAt} />
                    </span>
                  )}
                </p>
                <button
                  onClick={() => setSubMode(true)}
                  className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] transition-colors"
                >
                  Make substitutions
                </button>
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">
              Substitutions closed. Opens 1h after previous game until 1h before next game.
              {subWindow.nextOpenAt && (
                <> Next open: {new Date(subWindow.nextOpenAt).toLocaleString()}</>
              )}
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-bb-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left">Photo</th>
              <th className="border border-bb-border px-4 py-2 text-left">Player</th>
              <th className="border border-bb-border px-4 py-2 text-right">$</th>
            </tr>
          </thead>
          <tbody>
            {roster.playerIds.map((id) => (
              <tr key={id} className="hover:bg-card-bg">
                <td className="border border-bb-border px-4 py-2">
                  <PlayerAvatar playerId={id} name={roster.playerNames[id] ?? `Player ${id}`} />
                </td>
                <td className="border border-bb-border px-4 py-2 font-medium">{roster.playerNames[id] ?? `Player ${id}`}</td>
                <td className="border border-bb-border px-4 py-2 text-right">${roster.playerPrices[id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {weeklyHistory.length > 0 && (
        <div className="mt-6 rounded-lg border border-bb-border bg-card-bg p-4">
          <h3 className="mb-4 text-sm font-medium text-gray-600">My Scores (Weekly History)</h3>
          <div className="space-y-6">
            {[...weeklyHistory].reverse().map((w) => (
              <div key={w.matchId} className="rounded-lg border border-bb-border bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">Week {w.week}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(w.matchDate).toLocaleDateString()} · Total: {w.total.toFixed(1)} FP
                  </span>
                </div>
                <div className="flex flex-wrap gap-4">
                  {w.roster.map((p) => (
                    <div
                      key={p.playerId}
                      className="flex items-center gap-3 rounded-lg border border-bb-border bg-card-bg px-3 py-2"
                    >
                      <PlayerAvatar playerId={p.playerId} name={p.name} />
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-sm text-gray-600">{p.points.toFixed(1)} FP</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-sm text-gray-500">
        <Link href="/leaderboard" className="text-exact hover:underline font-medium">Leaderboard</Link>
      </p>
    </div>
  );
}

function SubWindowCountdown({ closeAt }: { closeAt: string }) {
  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const ms = new Date(closeAt).getTime() - Date.now();
      if (ms <= 0) {
        setLeft("closing soon");
        return;
      }
      const h = Math.floor(ms / (60 * 60 * 1000));
      const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
      setLeft(`${h}h ${m}m left`);
    };
    update();
    const id = setInterval(update, 60 * 1000);
    return () => clearInterval(id);
  }, [closeAt]);

  return <>{left ?? "…"}</>;
}

function SubstitutionForm({
  roster,
  players,
  toRemove,
  toAdd,
  setToRemove,
  setToAdd,
  onCancel,
  onSave,
  saving,
  error,
}: {
  roster: Roster;
  players: Player[];
  toRemove: Set<number>;
  toAdd: Map<number, Player>;
  setToRemove: (s: Set<number>) => void;
  setToAdd: (m: Map<number, Player>) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const keptIds = roster.playerIds.filter((id) => !toRemove.has(id));
  const keptCost = keptIds.reduce((s, id) => s + (roster.playerPrices[id] ?? 0), 0);
  const addedCost = Array.from(toAdd.values()).reduce((s, p) => s + p.inGamePrice, 0);
  const newTotal = keptCost + addedCost;
  const isValid = toRemove.size === toAdd.size && toRemove.size >= 1 && toRemove.size <= MAX_SWAP && newTotal <= CAP;

  const toggleRemove = (id: number) => {
    const next = new Set(toRemove);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SWAP) next.add(id);
    setToRemove(next);
    if (next.size < toAdd.size) {
      const nextAdd = new Map(toAdd);
      const keys = Array.from(nextAdd.keys());
      for (let i = 0; i < toAdd.size - next.size; i++) nextAdd.delete(keys[i]);
      setToAdd(nextAdd);
    }
  };

  const addOrReplace = (p: Player) => {
    if (roster.playerIds.includes(p.playerId) && !toRemove.has(p.playerId)) return;
    const next = new Map(toAdd);
    if (next.has(p.playerId)) {
      next.delete(p.playerId);
      setToAdd(next);
      return;
    }
    if (next.size < toRemove.size && keptCost + addedCost + p.inGamePrice <= CAP) {
      next.set(p.playerId, p);
      setToAdd(next);
      return;
    }
    if (next.size === toRemove.size) {
      for (const [id, existing] of next) {
        const wouldCost = keptCost + addedCost - existing.inGamePrice + p.inGamePrice;
        if (wouldCost <= CAP) {
          next.delete(id);
          next.set(p.playerId, p);
          setToAdd(next);
          return;
        }
      }
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">Remove up to 2, add up to 2. Keep cost ≤ ${CAP}.</p>
      <div className="flex flex-wrap gap-4 mb-4">
        {roster.playerIds.map((id) => (
          <button
            key={id}
            onClick={() => toggleRemove(id)}
            className={`px-3 py-1.5 rounded border text-sm ${toRemove.has(id) ? "border-red-500 bg-red-50 text-red-700" : "border-bb-border hover:bg-card-bg"}`}
          >
            {roster.playerNames[id] ?? `Player ${id}`} {toRemove.has(id) ? "✓ remove" : "remove"}
          </button>
        ))}
      </div>
      <h4 className="text-sm font-medium mb-2">Add (click to select):</h4>
      <div className="flex flex-wrap gap-2 mb-4 max-h-32 overflow-y-auto">
        {players
          .filter((p) => !roster.playerIds.includes(p.playerId) || toRemove.has(p.playerId))
          .map((p) => (
            <button
              key={p.playerId}
              onClick={() => addOrReplace(p)}
              className={`px-2 py-1 rounded border text-xs ${toAdd.has(p.playerId) ? "border-exact bg-green-50 text-exact" : "border-bb-border hover:bg-card-bg"}`}
            >
              {p.name} ${p.inGamePrice}
            </button>
          ))}
      </div>
      <p className="text-sm mb-3">New total: ${newTotal} / ${CAP}</p>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!isValid || saving} className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-bb-border px-4 py-2 text-sm font-medium hover:bg-card-bg">
          Cancel
        </button>
      </div>
    </div>
  );
}
