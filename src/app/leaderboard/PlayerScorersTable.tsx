"use client";

import { useState, useMemo } from "react";

type SortKey = "name" | "gamesPlayed" | "totalFantasyPoints" | "lastGameFP";
type SortDir = "asc" | "desc";

interface PlayerTotal {
  playerId: number;
  name: string;
  gamesPlayed: number;
  totalFantasyPoints: number;
  lastGameFP: number;
}

const COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Player" },
  { key: "gamesPlayed", label: "GP", align: "right" },
  { key: "totalFantasyPoints", label: "Total FP", align: "right" },
  { key: "lastGameFP", label: "Last game FP", align: "right" },
];

function getVal(p: PlayerTotal, key: SortKey): string | number {
  switch (key) {
    case "name": return p.name;
    case "gamesPlayed": return p.gamesPlayed;
    case "totalFantasyPoints": return p.totalFantasyPoints;
    case "lastGameFP": return p.lastGameFP;
    default: return "";
  }
}

export function PlayerScorersTable({ data }: { data: PlayerTotal[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalFantasyPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const va = getVal(a, sortKey);
      const vb = getVal(b, sortKey);
      const cmp = typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb)
        : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-bb-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-card-bg">
            <th className="border border-bb-border px-4 py-2 text-right w-12">#</th>
            {COLS.map(({ key, label, align }) => (
              <th
                key={key}
                className={`border border-bb-border px-4 py-2 cursor-pointer hover:bg-gray-100 ${align === "right" ? "text-right" : "text-left"}`}
                onClick={() => toggleSort(key)}
                title={`Sort by ${label}`}
              >
                {label} {sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.playerId} className="hover:bg-card-bg">
              <td className="border border-bb-border px-4 py-2 text-right">{i + 1}</td>
              <td className="border border-bb-border px-4 py-2 font-medium">{p.name}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.gamesPlayed}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.totalFantasyPoints.toFixed(1)}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.lastGameFP.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
