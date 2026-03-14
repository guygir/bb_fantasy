"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { PlayerWithDetails } from "@/lib/types";
import { PlayerAvatar } from "./PlayerAvatar";

type SortKey = "name" | "position" | "dmi" | "salary" | "gameShape" | "pts" | "avgRating" | "inGamePrice" | "lastGameFP" | "totalFP";
type SortDir = "asc" | "desc";

const COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Name" },
  { key: "position", label: "Pos" },
  { key: "dmi", label: "DMI", align: "right" },
  { key: "salary", label: "Salary", align: "right" },
  { key: "gameShape", label: "GS", align: "right" },
  { key: "pts", label: "PTS Avg", align: "right" },
  { key: "avgRating", label: "RTNG Avg", align: "right" },
  { key: "inGamePrice", label: "$ (Fantasy)", align: "right" },
  { key: "lastGameFP", label: "Last game FP (Fantasy)", align: "right" },
  { key: "totalFP", label: "Total FP (Fantasy)", align: "right" },
];

function getVal(p: PlayerWithDetails, key: SortKey): string | number {
  switch (key) {
    case "name": return p.name;
    case "position": return p.position ?? "";
    case "dmi": return p.dmi ?? -1;
    case "salary": return p.salary ?? -1;
    case "gameShape": return p.gameShape ?? -1;
    case "pts": return p.pts ?? -1;
    case "avgRating": return p.avgRating ?? -1;
    case "inGamePrice": return p.inGamePrice;
    case "lastGameFP": return p.lastGameFP ?? -1;
    case "totalFP": return p.totalFP ?? -1;
    default: return "";
  }
}

export function PlayersTable({ players }: { players: PlayerWithDetails[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalFP");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
      setSortDir("desc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-bb-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-card-bg">
            <th className="border border-bb-border px-4 py-2 text-left">Photo</th>
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
          {sorted.map((p) => (
            <tr key={p.playerId} className="hover:bg-card-bg">
              <td className="border border-bb-border px-4 py-2">
                <PlayerAvatar playerId={p.playerId} name={p.name} faceMtime={p.faceMtime} />
              </td>
              <td className="border border-bb-border px-4 py-2">
                <Link
                  href={`https://buzzerbeater.com/player/${p.playerId}/overview.aspx`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-exact hover:underline"
                >
                  {p.name}
                </Link>
              </td>
              <td className="border border-bb-border px-4 py-2">{p.position}</td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {p.dmi != null ? p.dmi.toLocaleString() : "–"}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {p.salary != null ? p.salary.toLocaleString() : "–"}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {p.gameShape != null ? p.gameShape : "–"}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.pts.toFixed(1)}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.avgRating.toFixed(1)}</td>
              <td className="border border-bb-border px-4 py-2 text-right font-medium">
                {p.previousPrice != null && p.previousPrice !== p.inGamePrice ? (
                  <>
                    <span className="text-gray-500">${p.previousPrice}</span>
                    <span className="mx-1 text-gray-400">→</span>
                    <span>${p.inGamePrice}</span>
                  </>
                ) : (
                  `$${p.inGamePrice}`
                )}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {(p.lastGameFP ?? 0).toFixed(1)}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {(p.totalFP ?? 0).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
