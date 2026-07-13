"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BB_COUNTRY_NAMES } from "@/lib/bb-countries";
import type { FinalsInfo, PlayoffStatus, PromotionEntry } from "@/lib/promotions";
import type { PromotionLevel } from "@/lib/promotions-on-demand";

type CustomPromotionsResult = {
  countryId: number;
  countryName: string;
  level: PromotionLevel;
  generatedAt: string;
  leagueCount: number;
  targetLevel: "I" | PromotionLevel;
  targetLevelLeagueCount: number;
  sourceLevelLeagueCount: number;
  fullyBotSourceLeagueCount: number;
  automaticChampionSlots: number;
  demotionSlotsPerTargetLeague: number;
  demotionSlotsFromTargetLevel: number;
  promotionBandSize: number;
  entries: PromotionEntry[];
  finalsByLeague: Record<string, FinalsInfo> | null;
  warnings: string[];
};

const LEVELS: PromotionLevel[] = ["II", "III", "IV", "V"];

function parseTeamIdFromUrl(url: string | null): number | null {
  if (!url) return null;
  const match = url.match(/\/team\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBandCalculation(result: CustomPromotionsResult): string {
  const activeSourceLeagues = result.sourceLevelLeagueCount - result.fullyBotSourceLeagueCount;
  return `calculation: ${result.targetLevelLeagueCount} level ${result.targetLevel} league(s) × ${result.demotionSlotsPerTargetLeague} demotion slots = ${result.demotionSlotsFromTargetLevel}; ${activeSourceLeagues} non-bot level ${result.level} champion slot(s) are automatic, so ${result.demotionSlotsFromTargetLevel} − ${activeSourceLeagues} = ${result.promotionBandSize}.`;
}

function playoffText(row: PromotionEntry, finalsByLeague: Record<string, FinalsInfo> | null): { text: string; className: string } {
  if (row.playoff_status !== "In Finals") {
    const outStatuses: PlayoffStatus[] = ["Lost Quarters", "Lost Semis", "Lost Finals", "Not in playoff"];
    return {
      text: row.playoff_status,
      className: outStatuses.includes(row.playoff_status) ? "text-gray-500" : "font-medium text-blue-700",
    };
  }

  const teamId = parseTeamIdFromUrl(row.team_url);
  const finals = finalsByLeague?.[String(row.league_id)];
  if (!teamId || !finals) return { text: "In Finals", className: "font-medium text-blue-700" };

  const isLeft = teamId === finals.leftTeamId;
  const wins = isLeft ? finals.leftWins : finals.rightWins;
  const losses = isLeft ? finals.rightWins : finals.leftWins;
  if (wins > losses) return { text: `In Finals: Leading ${wins}-${losses}`, className: "font-medium text-green-700" };
  if (wins < losses) return { text: `In Finals: Trailing ${wins}-${losses}`, className: "font-medium text-red-700" };
  return { text: `In Finals: Tied ${wins}-${losses}`, className: "font-medium text-blue-700" };
}

function buildRowClasses(entries: PromotionEntry[], bandSize: number): string[] {
  let greenLeft = bandSize;
  return entries.map((row) => {
    if (row.playoff_status === "Champ") return "bg-yellow-100 hover:bg-yellow-200/90";
    if (greenLeft > 0) {
      greenLeft -= 1;
      return "bg-green-50 hover:bg-green-100/90";
    }
    return "hover:bg-gray-50/80";
  });
}

export default function CustomPromotionsPage() {
  const countries = useMemo(
    () =>
      Object.entries(BB_COUNTRY_NAMES)
        .map(([id, name]) => ({ id: Number(id), name }))
        .concat({ id: 99, name: "Utopia" })
        .sort((a, b) => a.name.localeCompare(b.name)),
    []
  );
  const [countryId, setCountryId] = useState(99);
  const [level, setLevel] = useState<PromotionLevel>("III");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomPromotionsResult | null>(null);
  const rowClasses = useMemo(
    () => (result ? buildRowClasses(result.entries, result.promotionBandSize) : []),
    [result]
  );

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/promotions/custom?countryId=${countryId}&level=${level}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate promotions table");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-sm text-gray-600">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-bb-text sm:text-xl">Custom Promotions Outlook</h2>
          <p className="mt-1 text-sm text-gray-500">
            Generate an on-demand promotion table for any public BuzzerBeater country and level.
          </p>
        </div>
        <Link href="/promotions" className="text-exact hover:underline">
          Israel III snapshot
        </Link>
      </div>

      <div className="mb-5 rounded-lg border border-bb-border bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Country</span>
            <select
              value={countryId}
              onChange={(e) => setCountryId(Number(e.target.value))}
              className="w-full rounded-md border border-bb-border bg-white px-3 py-2 text-bb-text"
            >
              {countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name} ({country.id})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Level</span>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as PromotionLevel)}
              className="w-full rounded-md border border-bb-border bg-white px-3 py-2 text-bb-text"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded-md bg-exact px-4 py-2 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Uses only league overview pages and standings <code className="rounded bg-gray-100 px-1">teamName isbot</code>{" "}
          bot detection. Results are cached briefly per country and level.
        </p>
      </div>

      {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {result && (
        <div>
          <div className="mb-4 rounded-lg border border-bb-border bg-white p-4">
            <h3 className="font-semibold text-bb-text">
              {result.countryName} League {result.level} - Promotions outlook
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Generated {formatGeneratedAt(result.generatedAt)}. Covered {result.sourceLevelLeagueCount} level{" "}
              {result.level} leagues. Promotion band size: {result.promotionBandSize} ({formatBandCalculation(result)})
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Ranking: conference rank, wins, point differential. CPU teams marked with{" "}
              <code className="rounded bg-gray-100 px-1">isbot</code> in standings are excluded. Champions are yellow
              and skip the green promotion count.
            </p>
          </div>

          {result.warnings.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <strong>Warnings:</strong> {result.warnings.join(" ")}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-bb-border bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-card-bg text-left text-gray-700">
                  <th className="border border-bb-border px-3 py-2">#</th>
                  <th className="border border-bb-border px-3 py-2">Team</th>
                  <th className="border border-bb-border px-3 py-2">League</th>
                  <th className="border border-bb-border px-3 py-2">Conf</th>
                  <th className="border border-bb-border px-3 py-2">Conf Rank</th>
                  <th className="border border-bb-border px-3 py-2">W-L</th>
                  <th className="border border-bb-border px-3 py-2">PD</th>
                  <th className="border border-bb-border px-3 py-2">Playoff</th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((row, index) => {
                  const playoff = playoffText(row, result.finalsByLeague);
                  return (
                    <tr key={`${row.league_id}-${row.conf}-${row.team_name}`} className={rowClasses[index]}>
                      <td className="border border-bb-border px-3 py-2 font-medium tabular-nums">{row.display_rank}</td>
                      <td className="border border-bb-border px-3 py-2">
                        {row.team_url ? (
                          <a href={row.team_url} target="_blank" rel="noopener noreferrer" className="font-medium text-exact hover:underline">
                            {row.team_name}
                          </a>
                        ) : (
                          <span className="font-medium text-bb-text">{row.team_name}</span>
                        )}
                      </td>
                      <td className="border border-bb-border px-3 py-2">{row.league_name}</td>
                      <td className="border border-bb-border px-3 py-2 tabular-nums">{row.conf}</td>
                      <td className="border border-bb-border px-3 py-2 tabular-nums">{row.conf_rank}</td>
                      <td className="border border-bb-border px-3 py-2 tabular-nums">
                        {row.wins}-{row.losses}
                      </td>
                      <td className="border border-bb-border px-3 py-2 tabular-nums">{row.pd}</td>
                      <td className={`border border-bb-border px-3 py-2 ${playoff.className}`}>{playoff.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
