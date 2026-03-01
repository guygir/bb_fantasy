"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import { config } from "@/lib/config";

const CAP = config.game.cap;
const ROSTER_SIZE = config.game.rosterSize;
const SEASON = config.game.currentSeason;

interface Player {
  playerId: number;
  name: string;
  inGamePrice: number;
  fantasyPPG: number;
  position: string;
}

export default function PickTeamPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

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
    Promise.all([
      fetch(`/api/players/season/${SEASON}`).then(async (r) => {
        if (!r.ok) return { players: [] };
        const data = await r.json();
        return Array.isArray(data.players) ? data : { players: data.players ?? [] };
      }),
      supabase.from("fantasy_user_rosters").select("*").eq("season", SEASON).maybeSingle(),
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
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Pick load error:", err);
        setLoading(false);
      });
  }, [userId]);

  const totalCost = Array.from(picked).reduce((sum, id) => sum + (prices[id] ?? 0), 0);
  const canAdd = picked.size < ROSTER_SIZE && totalCost < CAP;
  const isValid = picked.size === ROSTER_SIZE && totalCost <= CAP;

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
    const playerIds = Array.from(picked);
    const playerPrices: Record<string, number> = {};
    const playerNames: Record<string, string> = {};
    for (const id of playerIds) {
      playerPrices[String(id)] = prices[id] ?? 0;
      playerNames[String(id)] = names[id] ?? "";
    }
    const { error } = await supabase.from("fantasy_user_rosters").upsert(
      {
        user_id: userId,
        season: SEASON,
        player_ids: playerIds,
        player_prices: playerPrices,
        player_names: playerNames,
        picked_at: new Date().toISOString(),
      },
      { onConflict: "user_id,season" }
    );
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
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
        Select exactly {ROSTER_SIZE} players within ${CAP} cap. Prices from Season {SEASON} fantasy PPG.
      </p>

      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm">
          Picked: <strong>{picked.size}</strong> / {ROSTER_SIZE}
        </span>
        <span className="text-sm">
          Total: <strong>${totalCost}</strong> / ${CAP}
        </span>
        {isValid && (
          <button
            onClick={save}
            className="rounded-lg bg-exact px-4 py-2 text-sm font-semibold text-white hover:bg-[#5a9a54] transition-colors"
          >
            {saved ? "Saved!" : "Save Roster"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-bb-border rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-card-bg">
              <th className="border border-bb-border px-4 py-2 text-left w-10"></th>
              <th className="border border-bb-border px-4 py-2 text-left">Player</th>
              <th className="border border-bb-border px-4 py-2 text-left">Pos</th>
              <th className="border border-bb-border px-4 py-2 text-right">$</th>
              <th className="border border-bb-border px-4 py-2 text-right">FP/G</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
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
                  <td className="border border-bb-border px-4 py-2 font-medium">{p.name}</td>
                  <td className="border border-bb-border px-4 py-2">{p.position}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">${p.inGamePrice}</td>
                  <td className="border border-bb-border px-4 py-2 text-right">{p.fantasyPPG.toFixed(1)}</td>
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
