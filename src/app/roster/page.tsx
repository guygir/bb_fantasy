"use client";

import { useEffect, useState, useRef } from "react";
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

interface PendingSubs {
  removed_ids: number[];
  added_ids: number[];
  added_prices: Record<string, number>;
  added_names: Record<string, string>;
  effective_match_id: string;
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
  const [pendingSubs, setPendingSubs] = useState<PendingSubs | null>(null);
  const [lastPlayedMatchId, setLastPlayedMatchId] = useState<string | null>(null);
  const [wasEligibleForLastPlayed, setWasEligibleForLastPlayed] = useState(false);
  const initializedFromPendingRef = useRef(false);

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

  // When we have pending subs and window is open, auto-show form and initialize from pendingSubs
  useEffect(() => {
    if (subWindow?.subsUsedThisWindow && pendingSubs) {
      setSubMode(true);
    }
  }, [subWindow?.subsUsedThisWindow, pendingSubs]);

  // Initialize toRemove/toAdd from pendingSubs when form is shown
  useEffect(() => {
    if (!pendingSubs || !players.length || !subMode) {
      if (!pendingSubs) initializedFromPendingRef.current = false;
      return;
    }
    if (initializedFromPendingRef.current) return;
    initializedFromPendingRef.current = true;
    setToRemove(new Set(pendingSubs.removed_ids));
    const addMap = new Map<number, Player>();
    for (const id of pendingSubs.added_ids) {
      const p = players.find((x) => x.playerId === id);
      addMap.set(id, p ?? {
        playerId: id,
        name: pendingSubs.added_names[String(id)] ?? `Player ${id}`,
        inGamePrice: pendingSubs.added_prices[String(id)] ?? 0,
        fantasyPPG: 0,
        position: "",
      });
    }
    setToAdd(addMap);
  }, [pendingSubs, subMode, players]);

  useEffect(() => {
    if (!userId || !supabase) return;
    const sb = supabase;
    sb.auth.getSession().then(({ data: { session } }) => {
      const rosterOpts = session?.access_token
        ? { headers: { Authorization: `Bearer ${session.access_token}` } }
        : {};
      Promise.all([
        fetch(`/api/roster/season/${SEASON}`, rosterOpts).then(async (r) => {
          if (!r.ok) return { roster: null };
          const data = await r.json();
          return { data: data.roster };
        }),
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
        fetch(`/api/roster/season/${SEASON}/weekly-history`, rosterOpts).then(async (r) => {
          if (!r.ok) return { weeks: [], lastPlayedMatchId: null, wasEligibleForLastPlayed: false };
          const data = await r.json();
          return {
            weeks: data.weeks ?? [],
            lastPlayedMatchId: data.lastPlayedMatchId ?? null,
            wasEligibleForLastPlayed: data.wasEligibleForLastPlayed ?? false,
          };
        }),
      ])
      .then(([rosterRes, statsData, playerData, weeklyData]) => {
        setPlayers((playerData.players ?? []) as Player[]);
        setWeeklyHistory((weeklyData.weeks ?? []) as WeeklyEntry[]);
        setLastPlayedMatchId(weeklyData.lastPlayedMatchId ?? null);
        setWasEligibleForLastPlayed(weeklyData.wasEligibleForLastPlayed ?? false);
        const row = rosterRes?.roster ?? rosterRes?.data;
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
          const ps = row.pending_subs;
          setPendingSubs(
            ps?.removed_ids?.length && ps?.added_ids?.length ? (ps as PendingSubs) : null
          );
        } else {
          setRoster(null);
          setPendingSubs(null);
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

  // Use current market prices for cap (prices change; over $30 requires sub)
  const currentPrices = Object.fromEntries(players.map((p) => [p.playerId, p.inGamePrice]));
  const totalCost = roster.playerIds.reduce(
    (sum, id) => sum + (currentPrices[id] ?? roster.playerPrices[id] ?? 0),
    0
  );
  // Fantasy points only from weeks where user had roster before match_start (derived from weeklyHistory)
  const totalFantasyPoints = weeklyHistory.reduce((s, w) => s + w.total, 0);
  const gamesPlayed = weeklyHistory.length;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">My Roster</h2>
      <p className="mb-6 text-sm text-gray-600">
        Picked {new Date(roster.pickedAt).toLocaleDateString()}. Total: ${totalCost} · Fantasy points from {gamesPlayed} game(s).
      </p>

      <div className="mb-6 rounded-lg border border-bb-border bg-card-bg p-4">
        <div className="flex flex-wrap gap-8">
          <div>
            <span className="text-sm text-gray-500">Total cost</span>
            <p className="text-xl font-bold">${totalCost}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Fantasy points</span>
            <p className="text-xl font-bold">{totalFantasyPoints.toFixed(1)}</p>
          </div>
          {weeklyHistory.length > 0 && (
            <div>
              <span className="text-sm text-gray-500">Last week (Week {weeklyHistory[weeklyHistory.length - 1]?.week})</span>
              <p className="text-xl font-bold">{weeklyHistory[weeklyHistory.length - 1]?.total.toFixed(1) ?? 0} FP</p>
            </div>
          )}
        </div>
      </div>

      {subWindow && (
        <div className="mb-6 rounded-lg border border-bb-border bg-card-bg p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-600">Substitutions</h3>
          {subWindow.open ? (
            subMode ? (
              <SubstitutionForm
                roster={roster}
                players={players}
                toRemove={toRemove}
                toAdd={toAdd}
                setToRemove={setToRemove}
                setToAdd={setToAdd}
                hasPendingSubs={!!pendingSubs}
                onClear={async () => {
                  if (!userId || !supabase) return;
                  const { data: { session } } = await supabase.auth.getSession();
                  const res = await fetch(`/api/roster/season/${SEASON}/substitute`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                    },
                    body: JSON.stringify({ clear: true }),
                  });
                  if (res.ok) {
                    setSubMode(false);
                    setToRemove(new Set());
                    setToAdd(new Map());
                    setPendingSubs(null);
                    initializedFromPendingRef.current = false;
                    window.location.reload();
                  }
                }}
                onCancel={() => {
                  setSubMode(false);
                  setToRemove(new Set());
                  setToAdd(new Map());
                  setSubError(null);
                  initializedFromPendingRef.current = false;
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
                  {pendingSubs ? "Edit substitutions" : "Make substitutions"}
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

      {(() => {
        // Last played match = most recent game that has finished (week 5)
        const matchIdForLastWeek = lastPlayedMatchId;
        const getPlayerFPInMatch = (playerId: number, matchId: string | null): number => {
          if (!matchId) return 0;
          const s = stats.find((x) => x.playerId === playerId && String(x.matchId) === String(matchId));
          return s?.fantasyPoints ?? 0;
        };
        // Current roster: show week 5 FP only if team was created before game 5
        const getCurrentRosterLastWeekFP = (playerId: number): number =>
          wasEligibleForLastPlayed ? getPlayerFPInMatch(playerId, matchIdForLastWeek) : 0;
        // Future team: always show week 5 FP (player attribute)
        const getFutureTeamLastWeekFP = (playerId: number): number =>
          getPlayerFPInMatch(playerId, matchIdForLastWeek);
        // Future team = current roster with pending subs applied (same order)
        const futureTeamIds = pendingSubs
          ? roster.playerIds.map((id) => {
              const removedIdx = pendingSubs.removed_ids.indexOf(id);
              return removedIdx >= 0 ? pendingSubs.added_ids[removedIdx] : id;
            })
          : null;
        const currentPricesMap = Object.fromEntries(players.map((p) => [p.playerId, p.inGamePrice]));
        const getFuturePlayer = (id: number) => ({
          name: pendingSubs?.added_ids?.includes(id)
            ? (pendingSubs.added_names[String(id)] ?? `Player ${id}`)
            : (roster.playerNames[id] ?? `Player ${id}`),
          price: pendingSubs?.added_ids?.includes(id)
            ? (pendingSubs.added_prices[String(id)] ?? 0)
            : (currentPricesMap[id] ?? roster.playerPrices[id] ?? 0),
        });
        const RosterRow = ({
          id,
          name,
          price,
          lastWeekFP,
          highlight,
        }: {
          id: number;
          name: string;
          price: number;
          lastWeekFP: number;
          highlight?: "red" | "green";
        }) => (
          <tr
            className={`hover:bg-card-bg ${
              highlight === "red" ? "bg-red-100" : highlight === "green" ? "bg-green-100" : ""
            }`}
          >
            <td className="border border-bb-border px-2 py-2">
              <PlayerAvatar playerId={id} name={name} />
            </td>
            <td className="border border-bb-border px-2 py-2 font-medium truncate w-32" title={name}>{name}</td>
            <td className="border border-bb-border px-2 py-2 text-right">${price}</td>
            <td className="border border-bb-border px-2 py-2 text-right text-gray-600">
              {lastWeekFP.toFixed(1)} FP
            </td>
          </tr>
        );
        return (
          <div className={`flex gap-6 ${pendingSubs ? "" : "max-w-[50%]"}`}>
            <div className={`overflow-x-auto border border-bb-border rounded-lg ${pendingSubs ? "w-1/2 min-w-0" : "w-full"}`}>
              <h3 className="mb-2 text-sm font-medium text-gray-600">Current roster</h3>
              <table className="w-full border-collapse table-fixed">
                  <thead>
                    <tr className="bg-card-bg">
                      <th className="border border-bb-border px-2 py-2 text-left w-14">Photo</th>
                      <th className="border border-bb-border px-2 py-2 text-left w-32">Player</th>
                      <th className="border border-bb-border px-2 py-2 text-right w-12">$</th>
                      <th className="border border-bb-border px-2 py-2 text-right w-16">Last week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.playerIds.map((id) => {
                      const isSubbedOut = pendingSubs?.removed_ids?.includes(id);
                      const price = currentPrices[id] ?? roster.playerPrices[id] ?? 0;
                      return (
                        <RosterRow
                          key={id}
                          id={id}
                          name={roster.playerNames[id] ?? `Player ${id}`}
                          price={price}
                          lastWeekFP={getCurrentRosterLastWeekFP(id)}
                          highlight={isSubbedOut ? "red" : undefined}
                        />
                      );
                    })}
                  </tbody>
                </table>
            </div>
            {pendingSubs && futureTeamIds && (
              <div className="w-1/2 min-w-0 overflow-x-auto border border-bb-border rounded-lg">
                <h3 className="mb-2 text-sm font-medium text-gray-600">Future team (next game)</h3>
                <table className="w-full border-collapse table-fixed">
                    <thead>
                      <tr className="bg-card-bg">
                        <th className="border border-bb-border px-2 py-2 text-left w-14">Photo</th>
                        <th className="border border-bb-border px-2 py-2 text-left w-32">Player</th>
                        <th className="border border-bb-border px-2 py-2 text-right w-12">$</th>
                        <th className="border border-bb-border px-2 py-2 text-right w-16">Last week</th>
                      </tr>
                    </thead>
                    <tbody>
                      {futureTeamIds.map((id) => {
                        const isSubbedIn = pendingSubs.added_ids.includes(id);
                        const fp = getFutureTeamLastWeekFP(id);
                        const { name, price } = getFuturePlayer(id);
                        return (
                          <RosterRow
                            key={id}
                            id={id}
                            name={name}
                            price={price}
                            lastWeekFP={fp}
                            highlight={isSubbedIn ? "green" : undefined}
                          />
                        );
                      })}
                    </tbody>
                  </table>
              </div>
            )}
          </div>
        );
      })()}

      <div className="mt-6 rounded-lg border border-bb-border bg-card-bg p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-600">My Scores (Weekly History)</h3>
        {weeklyHistory.length > 0 ? (
          <div className="space-y-6">
            {[...weeklyHistory].reverse().map((w) => (
              <div key={w.matchId} className="rounded-lg border border-bb-border bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">Week {w.week}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(w.matchDate).toLocaleDateString()} · Total: {w.total.toFixed(1)} FP
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-4">
                  {w.roster.map((p) => (
                    <div
                      key={p.playerId}
                      className="flex items-center gap-3 rounded-lg border border-bb-border bg-card-bg px-3 py-2 min-w-0"
                    >
                      <PlayerAvatar playerId={p.playerId} name={p.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" title={p.name}>{p.name}</p>
                        <p className="text-sm text-gray-600">{p.points.toFixed(1)} FP</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">New team… Your scores will appear here after games are played.</p>
        )}
      </div>

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
  hasPendingSubs,
  onClear,
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
  hasPendingSubs: boolean;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const keptIds = roster.playerIds.filter((id) => !toRemove.has(id));
  const currentPrices = Object.fromEntries(players.map((p) => [p.playerId, p.inGamePrice]));
  const keptCost = keptIds.reduce(
    (s, id) => s + (currentPrices[id] ?? roster.playerPrices[id] ?? 0),
    0
  );
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
          .filter((p) => !roster.playerIds.includes(p.playerId))
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
      <div className="flex flex-wrap gap-2">
        <button onClick={onSave} disabled={!isValid || saving} className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-bb-border px-4 py-2 text-sm font-medium hover:bg-card-bg">
          Cancel
        </button>
        {hasPendingSubs && (
          <button
            onClick={onClear}
            disabled={saving}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Clear pending subs
          </button>
        )}
      </div>
    </div>
  );
}
