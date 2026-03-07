"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { U21dlePlayer } from "@/lib/u21dle/feedback";
import { PlayerAvatar } from "@/app/players/PlayerAvatar";

type SortKey = "name" | "gp" | "pts" | "age" | "season" | "height" | "potential" | "trophies";
type SortDir = "asc" | "desc";

const COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Name" },
  { key: "gp", label: "GP", align: "right" },
  { key: "pts", label: "PTS", align: "right" },
  { key: "age", label: "Age", align: "right" },
  { key: "season", label: "Season", align: "right" },
  { key: "height", label: "Height", align: "right" },
  { key: "potential", label: "Potential", align: "right" },
  { key: "trophies", label: "Trophies", align: "right" },
];

function getVal(p: U21dlePlayer & { faceMtime?: number | null; age?: number | null }, key: SortKey): string | number {
  switch (key) {
    case "name": return p.name;
    case "gp": return p.gp;
    case "pts": return p.pts;
    case "age": return p.age ?? -1;
    case "season": return p.season ?? -1;
    case "height": return p.height ?? -1;
    case "potential": return p.potential ?? -1;
    case "trophies": return p.trophies ?? -1;
    default: return "";
  }
}

function isRetiredEarly(
  p: U21dlePlayer & { age?: number | null },
  currentSeason: number
): boolean {
  const age = p.age;
  const season = p.season;
  if (age == null || season == null) return false;
  const expectedAge = (currentSeason - season) + 21;
  return age !== expectedAge;
}

export function U21dlePlayersTable({
  players,
  currentSeason,
}: {
  players: (U21dlePlayer & { faceMtime?: number | null; age?: number | null })[];
  currentSeason: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("gp");
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
            <tr
              key={p.playerId}
              className={isRetiredEarly(p, currentSeason) ? "bg-red-100 hover:bg-red-200" : "hover:bg-card-bg"}
            >
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
              <td className="border border-bb-border px-4 py-2 text-right">{p.gp}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.pts.toFixed(1)}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.age ?? "–"}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.season ?? "–"}</td>
              <td className="border border-bb-border px-4 py-2 text-right">
                {p.height != null ? `${p.height} cm` : "–"}
              </td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.potential ?? "–"}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{p.trophies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
