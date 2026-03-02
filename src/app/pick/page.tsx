"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import { config } from "@/lib/config";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";

const CAP = config.game.cap;
const ROSTER_SIZE = config.game.rosterSize;
const SEASON = config.game.currentSeason;

type SortKey = "name" | "position" | "inGamePrice" | "lastGameFP" | "totalFP";
type SortDir = "asc" | "desc";

interface Player {
  playerId: number;
  name: string;
  inGamePrice: number;
  lastGameFP?: number;
  totalFP?: number;
  position: string;
}

function getVal(p: Player, key: SortKey): string | number {
  switch (key) {
    case "name": return p.name;
    case "position": return p.position ?? "";
    case "inGamePrice": return p.inGamePrice;
    case "lastGameFP": return p.lastGameFP ?? -1;
    case "totalFP": return p.totalFP ?? -1;
    default: return "";
  }
}

export default function PickTeamPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("totalFP");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      const rosterHeaders = session?.access_token
        ? { headers: { Authorization: `Bearer ${session.access_token}` } }
        : {};
      Promise.all([
        fetch(`/api/players/season/${SEASON}`).then(async (r) => {
          if (!r.ok) return { players: [] };
          const data = await r.json();
          return Array.isArray(data.players) ? data : { players: data.players ?? [] };
        }),
        fetch(`/api/roster/season/${SEASON}`, rosterHeaders).then(async (r) => {
          if (!r.ok) return { roster: null };
          const data = await r.json();
          return { data: data.roster };
        }),
      ])
      .then(([playerData, rosterRes]) => {
        const list = (playerData.players ?? []) as Player[];
        setPlayers(Array.isArray(list) ? list : []);
        const row = rosterRes.data;
        if (row?.player_ids?.length) {
          const prices: Record<number, number> = {};
          const names: Record<number, string> = {};
          for (const id of row.player_ids) {
            const k = String(id);
            if (row.player_prices?.[k] != null) prices[id] = Number(row.player_prices[k]);
            if (row.player_names?.[k]) names[id] = String(row.player_names[k]);
          }
          setPicked(new Set(row.player_ids));
          setPrices(prices);
          setNames(names);
          if (row.player_ids.length === ROSTER_SIZE) {
            window.location.href = "/roster";
            return;
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Pick load error:", err);
        setLoading(false);
      });
    });
  }, [userId]);

  const totalCost = Array.from(picked).reduce((sum, id) => sum + (prices[id] ?? 0), 0);
  const canAdd = picked.size < ROSTER_SIZE && totalCost < CAP;
  const isValid = picked.size === ROSTER_SIZE && totalCost <= CAP;

  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const va = getVal(a, sortKey);
      const vb = getVal(b, sortKey);
      const cmp = typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [players, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggle = (p: Player) => {
    const id = p.playerId;
    if (picked.has(id)) {
      const next = new Set(picked);
      next.delete(id);
      setPicked(next);
      const nextPrices = { ...prices };
      const nextNames = { ...names };
      delete nextPrices[id];
      delete nextNames[id];
      setPrices(nextPrices);
      setNames(nextNames);
    } else if (canAdd && totalCost + p.inGamePrice <= CAP) {
      setPicked(new Set([...picked, id]));
      setPrices({ ...prices, [id]: p.inGamePrice });
      setNames({ ...names, [id]: p.name });
    }
  };

  const save = async () => {
    if (!supabase || !userId) return;
    setSaveError(null);
    const playerIds = Array.from(picked);
    const playerPrices: Record<string, number> = {};
    const playerNames: Record<string, string> = {};
    for (const id of playerIds) {
      playerPrices[String(id)] = prices[id] ?? 0;
      playerNames[String(id)] = names[id] ?? "";
    }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/roster/season/${SEASON}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ playerIds, playerPrices, playerNames }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveError(data.error ?? "Failed to save roster");
      return;
    }
    try {
      sessionStorage.setItem(`hasRoster_${SEASON}`, "true");
    } catch {}
    setSaved(true);
    setTimeout(() => {
      window.location.href = "/roster";
    }, 500);
  };

  if (!authChecked || loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-exact border-t-transparent" />
        <p className="text-gray-500">Loading players...</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div>
        <h2 className="mb-4 text-xl font-bold text-bb-text">Pick Your Team</h2>
        <p className="text-gray-600">
          <Link href="/login" className="text-exact hover:underline font-medium">
            Sign in
          </Link>{" "}
          to pick your team (5 players, $30 cap).
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-bb-text">Pick Your Team</h2>
      <p className="mb-6 text-sm text-gray-600">
        Select exactly {ROSTER_SIZE} players within ${CAP} cap. Prices from current market (same as Players page).
      </p>

      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm">
          Picked: <strong>{picked.size}</strong> / {ROSTER_SIZE}
        </span>
        <span className="text-sm">
          Total: <strong>${totalCost}</strong> / ${CAP}
        </span>
        {isValid && (
          <>
            <button
              onClick={save}
              disabled={saved}
              className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] transition-colors disabled:opacity-70"
            >
              {saved ? "Saved!" : "Save Roster"}
            </button>
            {saveError && (
              <span className="text-sm text-red-600">{saveError}</span>
            )}
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-bb-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left w-10"></th>
              <th className="border border-bb-border px-4 py-2 text-left">Photo</th>
              <th
                className="border border-bb-border px-4 py-2 text-left cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort("name")}
                title="Sort by Player"
              >
                Player {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th
                className="border border-bb-border px-4 py-2 text-left cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort("position")}
                title="Sort by Pos"
              >
                Pos {sortKey === "position" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th
                className="border border-bb-border px-4 py-2 text-right cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort("inGamePrice")}
                title="Sort by $"
              >
                $ {sortKey === "inGamePrice" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th
                className="border border-bb-border px-4 py-2 text-right cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort("lastGameFP")}
                title="Sort by Last game FP"
              >
                Last game FP {sortKey === "lastGameFP" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
              <th
                className="border border-bb-border px-4 py-2 text-right cursor-pointer hover:bg-gray-100"
                onClick={() => toggleSort("totalFP")}
                title="Sort by Total FP"
              >
                Total FP {sortKey === "totalFP" ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const isPicked = picked.has(p.playerId);
              const wouldExceed = !isPicked && totalCost + p.inGamePrice > CAP;
              const disabled = !isPicked && (!canAdd || wouldExceed);
              return (
                <tr
                  key={p.playerId}
                  onClick={() => !disabled && toggle(p)}
                  className={`cursor-pointer hover:bg-card-bg transition-colors ${isPicked ? "bg-low/20" : ""} ${disabled ? "opacity-50" : ""}`}
                >
                  <td className="border border-bb-border px-4 py-2">
                    {isPicked ? (
                      <span className="text-exact font-bold">✓</span>
                    ) : (
                      <span className="text-bb-border">○</span>
                    )}
                  </td>
                  <td className="border border-bb-border px-4 py-2">
                    <PlayerAvatar playerId={p.playerId} name={p.name} compact />
                  </td>
                  <td className="border border-bb-border px-4 py-2 font-medium">{p.name}</td>
                  <td className="border border-bb-border px-4 py-2">{p.position}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">${p.inGamePrice}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">{(p.lastGameFP ?? 0).toFixed(1)}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">{(p.totalFP ?? 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        <Link href="/roster" className="text-exact hover:underline font-medium">View My Roster</Link>
        {" · "}
        <Link href="/leaderboard" className="text-exact hover:underline font-medium">Leaderboard</Link>
      </p>
    </div>
  );
}
