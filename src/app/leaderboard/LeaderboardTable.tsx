"use client";

import { useState, useMemo } from "react";

type SortKey = "rank" | "nickname" | "totalFantasyPoints" | "lastWeekFP";
type SortDir = "asc" | "desc";

interface UserStanding {
  rank: number;
  userId: string;
  nickname: string;
  totalFantasyPoints: number;
  lastWeekFP: number;
  lastWeekNumber: number;
}

function getCols(lastWeekNumber: number): { key: SortKey; label: string; align?: "right" }[] {
  return [
    { key: "rank", label: "#", align: "right" },
    { key: "nickname", label: "User" },
    { key: "lastWeekFP", label: lastWeekNumber > 0 ? `Last week (Week ${lastWeekNumber}) FP` : "Last week FP", align: "right" },
    { key: "totalFantasyPoints", label: "Total FP", align: "right" },
  ];
}

export function LeaderboardTable({ data }: { data: UserStanding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalFantasyPoints");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const lastWeekNumber = data[0]?.lastWeekNumber ?? 0;
  const COLS = getCols(lastWeekNumber);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
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
      setSortDir(key === "nickname" ? "asc" : "desc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-bb-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-card-bg">
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
          {sorted.map((u, i) => (
            <tr key={u.userId} className="hover:bg-card-bg">
              <td className="border border-bb-border px-4 py-2 text-right">{sortKey === "rank" ? u.rank : i + 1}</td>
              <td className="border border-bb-border px-4 py-2 font-medium">{u.nickname}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{(u.lastWeekFP ?? 0).toFixed(1)}</td>
              <td className="border border-bb-border px-4 py-2 text-right">{u.totalFantasyPoints.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
