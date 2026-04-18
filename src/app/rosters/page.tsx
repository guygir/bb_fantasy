"use client";

import { useState } from "react";
import { BB_COUNTRY_NAMES } from "@/lib/bb-countries";

interface RosterPlayer {
  playerId: number;
  name: string;
}

interface GameLogEntry {
  date: string;
  position: string;
  minutes: number;
  fgMade: number;
  fgAtt: number;
  tpMade: number;
  tpAtt: number;
  ftMade: number;
  ftAtt: number;
  oreb: number;
  treb: number;
  ast: number;
  to: number;
  stl: number;
  blk: number;
  pf: number;
  pts: number;
  rating: number | null;
  gameType: string;
}

interface SeasonGameLog {
  season: number;
  games: GameLogEntry[];
}

interface PlayerInfo {
  playerId: number;
  firstName: string;
  lastName: string;
  age: number | null;
  height: number | null;
  dmi: number | null;
  salary: number | null;
  bestPosition: string | null;
  gameShape: number | null;
  potential: number | null;
}

interface PlayerStats {
  playerId: number;
  playerInfo: PlayerInfo | null;
  seasons: SeasonGameLog[];
  aggregations: {
    minutesByPosition: Record<string, number>;
    minutesBySeason: Record<number, number>;
    gamesBySeason: Record<number, number>;
    minutesBySeasonWeekPosition: Record<number, Record<number, Record<string, number>>>;
    minutesBySeasonPosition: Record<number, Record<string, number>>;
  };
}

const ALL_COUNTRIES = Object.entries(BB_COUNTRY_NAMES)
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.name.localeCompare(b.name));


const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];
const NON_COUNTING_TYPES = new Set(["BBM", "National Team"]);

// Position colours for the stacked bar chart
const POSITION_COLORS: Record<string, { bg: string; label: string }> = {
  PG: { bg: "#ef4444", label: "PG" },  // red
  SG: { bg: "#f97316", label: "SG" },  // orange
  SF: { bg: "#eab308", label: "SF" },  // yellow
  PF: { bg: "#22c55e", label: "PF" },  // green
  C:  { bg: "#3b82f6", label: "C"  },  // blue
};
const DEFAULT_COLOR = "#a855f7"; // purple for unknown positions

function posColor(pos: string): string {
  return POSITION_COLORS[pos]?.bg ?? DEFAULT_COLOR;
}

function sortPositions(pos: string[]): string[] {
  return [...pos].sort(
    (a, b) =>
      (POSITION_ORDER.indexOf(a) === -1 ? 99 : POSITION_ORDER.indexOf(a)) -
      (POSITION_ORDER.indexOf(b) === -1 ? 99 : POSITION_ORDER.indexOf(b))
  );
}

function PlayerFace({ playerId, name }: { playerId: number; name: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="h-20 w-20 rounded-xl bg-gray-200 flex items-center justify-center text-2xl font-bold text-gray-500 shrink-0">
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={`/player-faces/${playerId}.png`}
      alt={name}
      className="h-20 w-20 rounded-xl object-cover bg-gray-100 shrink-0"
      onError={() => setErr(true)}
    />
  );
}

/** Stacked bar chart: weeks 1–14 on x-axis, minutes stacked by position (grows upward).
 *  Each colored segment shows its own minute count inside it (or below if too small). */
function WeeklyMinutesChart({
  weekMap,
  positions,
}: {
  weekMap: Record<number, Record<string, number>>;
  positions: string[];
}) {
  const allWeeks = Array.from({ length: 14 }, (_, i) => i + 1);
  const totals = allWeeks.map((w) => positions.reduce((s, p) => s + (weekMap[w]?.[p] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);
  const CHART_H = 200;
  const BAR_W = 38;
  const GAP = 5;
  // Minimum segment height to show label inside; below this we show it above the bar externally
  const MIN_LABEL_H = 16;

  return (
    <div>
      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-3">
        {positions.map((pos) => (
          <span key={pos} className="flex items-center gap-1 text-xs text-gray-600">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: posColor(pos) }} />
            {pos}
          </span>
        ))}
      </div>

      {/* Chart area */}
      <div className="overflow-x-auto pb-1">
        <div
          className="flex items-end"
          style={{ height: CHART_H + 32, gap: GAP, minWidth: allWeeks.length * (BAR_W + GAP) }}
        >
          {allWeeks.map((w, wi) => {
            const total = totals[wi];
            const segments = positions
              .map((pos) => ({ pos, mins: weekMap[w]?.[pos] ?? 0 }))
              .filter((s) => s.mins > 0);
            const totalBarH = total > 0 ? Math.max(Math.round((total / maxTotal) * CHART_H), 4) : 0;

            return (
              <div
                key={w}
                className="relative flex flex-col justify-end shrink-0"
                style={{ width: BAR_W, height: CHART_H + 32 }}
              >
                {/* Bar — built from bottom up as a flex column in reverse */}
                <div
                  className="relative w-full rounded-t overflow-visible"
                  style={{ height: totalBarH }}
                  title={`W${w}: ${segments.map((s) => `${s.pos} ${s.mins}`).join(" + ")}${total > 0 ? ` = ${total}` : " (no games)"}`}
                >
                  {/* Render segments from bottom (first position) to top (last) */}
                  {(() => {
                    let offsetFromBottom = 0;
                    return segments.map(({ pos, mins }) => {
                      const segH = Math.max(Math.round((mins / maxTotal) * CHART_H), 2);
                      const bottom = offsetFromBottom;
                      offsetFromBottom += segH;
                      const showInside = segH >= MIN_LABEL_H;
                      return (
                        <div
                          key={pos}
                          className="absolute left-0 right-0 flex items-center justify-center overflow-hidden"
                          style={{
                            bottom,
                            height: segH,
                            background: posColor(pos),
                          }}
                        >
                          {showInside && (
                            <span
                              className="text-[10px] font-bold leading-none select-none"
                              style={{ color: "rgba(255,255,255,0.92)", textShadow: "0 0 3px rgba(0,0,0,0.4)" }}
                            >
                              {mins}
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}
                  {/* For segments too small to label inside, stack tiny labels above bar */}
                  {segments.some(({ mins }) => {
                    const segH = Math.max(Math.round((mins / maxTotal) * CHART_H), 2);
                    return segH < MIN_LABEL_H;
                  }) && (
                    <div
                      className="absolute left-0 right-0 flex flex-col-reverse items-center gap-px"
                      style={{ bottom: totalBarH + 2 }}
                    >
                      {segments
                        .filter(({ mins }) => Math.max(Math.round((mins / maxTotal) * CHART_H), 2) < MIN_LABEL_H)
                        .map(({ pos, mins }) => (
                          <span
                            key={pos}
                            className="text-[9px] font-bold leading-none"
                            style={{ color: posColor(pos) }}
                          >
                            {mins}
                          </span>
                        ))}
                    </div>
                  )}
                </div>

                {/* Week label */}
                <div className="mt-1 text-center text-[10px] text-gray-500 leading-none">W{w}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function RostersPage() {
  const [search, setSearch] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [countryId, setCountryId] = useState<number | null>(null);
  const [countryLabel, setCountryLabel] = useState("");

  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);

  const [selectedPlayer, setSelectedPlayer] = useState<RosterPlayer | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);

  const suggestions =
    search.trim().length > 0
      ? ALL_COUNTRIES.filter((c) =>
          c.name.toLowerCase().includes(search.trim().toLowerCase())
        ).slice(0, 8)
      : [];

  async function loadRoster(id: number) {
    setRosterLoading(true);
    setRosterError(null);
    setTeamName(null);
    setPlayers([]);
    setSelectedPlayer(null);
    setPlayerStats(null);
    setStatsError(null);
    try {
      const res = await fetch(`/api/rosters/country/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTeamName(data.teamName);
      setPlayers(data.players ?? []);
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
    } finally {
      setRosterLoading(false);
    }
  }

  function selectCountry(id: number, name: string) {
    setCountryId(id);
    setCountryLabel(name);
    setSearch(name);
    setShowSuggestions(false);
    loadRoster(id);
  }

  async function loadPlayerStats(player: RosterPlayer) {
    setSelectedPlayer(player);
    setPlayerStats(null);
    setStatsError(null);
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/rosters/player/${player.playerId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPlayerStats(data);
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatsLoading(false);
    }
  }

  void countryId;

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="mb-6 text-xl font-bold">National Team Rosters</h2>

      {/* Country search */}
      <div className="mb-6 relative max-w-xs">
        <label className="mb-1 block text-sm font-medium text-gray-700">Search country</label>
        <input
          type="text"
          value={search}
          placeholder="e.g. Israel, Bra, USA…"
          onChange={(e) => {
            setSearch(e.target.value);
            setShowSuggestions(true);
            if (e.target.value !== countryLabel) {
              setCountryLabel("");
            }
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="w-full rounded-lg border border-bb-border bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-exact"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full rounded-lg border border-bb-border bg-white shadow-lg overflow-hidden">
            {suggestions.map(({ id, name }) => (
              <li key={id}>
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-card-bg transition-colors"
                  onMouseDown={() => selectCountry(id, name)}
                >
                  <span className="font-medium">{name}</span>
                  <span className="ml-2 text-xs text-gray-400">U21 National Team</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {showSuggestions && search.trim().length > 0 && suggestions.length === 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-bb-border bg-white px-3 py-2 text-sm text-gray-400 shadow-lg">
            No countries match &ldquo;{search}&rdquo;
          </div>
        )}
      </div>

      {rosterLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-exact border-t-transparent" />
          Loading roster…
        </div>
      )}
      {rosterError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {rosterError}
        </div>
      )}

      {/* Team name + player list */}
      {!rosterLoading && teamName && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-bb-text">{teamName}</h3>
          {players.length === 0 ? (
            <p className="text-sm text-gray-500">No players found for this roster.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {players.map((p) => (
                <button
                  key={p.playerId}
                  onClick={() => loadPlayerStats(p)}
                  className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                    selectedPlayer?.playerId === p.playerId
                      ? "border-exact bg-exact/10 font-semibold text-exact"
                      : "border-bb-border bg-white hover:bg-card-bg text-bb-text"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player stats panel */}
      {selectedPlayer && (
        <div className="rounded-xl border border-bb-border bg-card-bg p-5">
          {statsLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-exact border-t-transparent" />
              Fetching game history — this may take 5–15 seconds…
            </div>
          )}

          {statsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {statsError}
            </div>
          )}

          {playerStats && !statsLoading && (
            <>
              {/* Player header */}
              <div className="mb-5 flex items-start gap-4">
                <PlayerFace playerId={selectedPlayer.playerId} name={selectedPlayer.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-bb-text">{selectedPlayer.name}</h3>
                    <a
                      href={`https://buzzerbeater.com/player/${selectedPlayer.playerId}/overview.aspx`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-exact hover:underline"
                    >
                      View on BB ↗
                    </a>
                  </div>
                  {playerStats.playerInfo ? (
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                      {playerStats.playerInfo.age !== null && (
                        <div><span className="text-xs text-gray-500 block">Age</span><strong>{playerStats.playerInfo.age}</strong></div>
                      )}
                      {playerStats.playerInfo.bestPosition && (
                        <div><span className="text-xs text-gray-500 block">Position</span><strong>{playerStats.playerInfo.bestPosition}</strong></div>
                      )}
                      {playerStats.playerInfo.height !== null && (
                        <div><span className="text-xs text-gray-500 block">Height</span><strong>{playerStats.playerInfo.height}&Prime;</strong></div>
                      )}
                      {playerStats.playerInfo.gameShape !== null && (
                        <div><span className="text-xs text-gray-500 block">Game Shape</span><strong>{playerStats.playerInfo.gameShape}</strong></div>
                      )}
                      {playerStats.playerInfo.dmi !== null && (
                        <div><span className="text-xs text-gray-500 block">DMI</span><strong>{playerStats.playerInfo.dmi.toLocaleString()}</strong></div>
                      )}
                      {playerStats.playerInfo.salary !== null && (
                        <div><span className="text-xs text-gray-500 block">Salary</span><strong>${playerStats.playerInfo.salary.toLocaleString()}</strong></div>
                      )}
                      {playerStats.playerInfo.potential !== null && (
                        <div><span className="text-xs text-gray-500 block">Potential</span><strong>{playerStats.playerInfo.potential}</strong></div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Player info unavailable</p>
                  )}
                </div>
              </div>

              {playerStats.seasons.length === 0 && (
                <p className="text-sm text-gray-500 italic mt-2">No game history found for this player.</p>
              )}

              {/* Per-season sections */}
              {[...playerStats.seasons]
                .sort((a, b) => b.season - a.season)
                .map(({ season, games }) => {
                  const weekMap = playerStats.aggregations.minutesBySeasonWeekPosition[season] ?? {};
                  const seasonPositions = sortPositions(
                    Object.keys(playerStats.aggregations.minutesBySeasonPosition[season] ?? {})
                  );
                  const allWeeks = Object.keys(weekMap).map(Number).sort((a, b) => a - b);
                  const countingGames = games.filter((g) => !NON_COUNTING_TYPES.has(g.gameType));
                  const maxPosMinutes = Math.max(
                    ...Object.values(playerStats.aggregations.minutesBySeasonPosition[season] ?? {}),
                    0
                  );

                  return (
                    <div key={season} className="mb-8 border-t border-bb-border pt-5">
                      <h4 className="mb-4 text-base font-semibold text-bb-text">
                        Season {season}
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          {countingGames.length} counting game{countingGames.length !== 1 ? "s" : ""}
                          {" / "}{games.length} total
                        </span>
                      </h4>

                      <div className="flex gap-6 mb-5">
                        {/* Stacked bar chart */}
                        <div className="rounded-lg border border-bb-border bg-white p-4 w-3/4 min-w-0">
                          <h5 className="mb-3 text-sm font-semibold text-gray-700">
                            Minutes per Week
                          </h5>
                          {allWeeks.length > 0 ? (
                            <WeeklyMinutesChart weekMap={weekMap} positions={seasonPositions} />
                          ) : (
                            <p className="text-xs text-gray-400 italic">No counting games this season</p>
                          )}
                        </div>

                        {/* Minutes by position this season */}
                        <div className="rounded-lg border border-bb-border bg-white p-4 w-1/4 min-w-0">
                          <h5 className="mb-3 text-sm font-semibold text-gray-700">
                            Minutes by Position
                          </h5>
                          {seasonPositions.length > 0 ? (
                            <div className="space-y-2">
                              {seasonPositions.map((pos) => {
                                const mins = playerStats.aggregations.minutesBySeasonPosition[season]?.[pos] ?? 0;
                                const pct = maxPosMinutes > 0 ? Math.round((mins / maxPosMinutes) * 100) : 0;
                                return (
                                  <div key={pos} className="flex items-center gap-2">
                                    <span className="w-8 text-xs font-medium text-gray-700 shrink-0">{pos}</span>
                                    <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                                      <div
                                        className="h-full rounded-full"
                                        style={{ width: `${pct}%`, background: posColor(pos) }}
                                      />
                                    </div>
                                    <span className="w-14 text-right text-xs text-gray-600 shrink-0">{mins} min</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">No counting games this season</p>
                          )}
                        </div>
                      </div>

                      {/* Week × position table */}
                      {allWeeks.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-bb-border">
                          <table className="border-collapse text-xs">
                            <thead>
                              <tr className="bg-card-bg text-gray-600">
                                <th className="border border-bb-border px-2 py-1.5 text-left sticky left-0 bg-card-bg z-10">Pos</th>
                                {allWeeks.map((w) => (
                                  <th key={w} className="border border-bb-border px-2 py-1.5 text-center w-10">W{w}</th>
                                ))}
                                <th className="border border-bb-border px-2 py-1.5 text-right bg-gray-50/80">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {seasonPositions.map((pos) => {
                                const rowTotal = allWeeks.reduce(
                                  (s, w) => s + (weekMap[w]?.[pos] ?? 0),
                                  0
                                );
                                return (
                                  <tr key={pos} className="hover:bg-card-bg">
                                    <td className="border border-bb-border px-2 py-1 font-medium sticky left-0 bg-white">{pos}</td>
                                    {allWeeks.map((w) => {
                                      const mins = weekMap[w]?.[pos] ?? 0;
                                      return (
                                        <td
                                          key={w}
                                          className={`border border-bb-border px-2 py-1 text-center ${mins > 0 ? "font-semibold text-bb-text" : "text-gray-200"}`}
                                        >
                                          {mins > 0 ? mins : "—"}
                                        </td>
                                      );
                                    })}
                                    <td className="border border-bb-border px-2 py-1 text-right font-semibold bg-gray-50/80">{rowTotal}</td>
                                  </tr>
                                );
                              })}
                              <tr className="bg-gray-50/80 font-semibold text-gray-600">
                                <td className="border border-bb-border px-2 py-1 sticky left-0 bg-gray-50">Total</td>
                                {allWeeks.map((w) => {
                                  const t = seasonPositions.reduce((s, p) => s + (weekMap[w]?.[p] ?? 0), 0);
                                  return (
                                    <td key={w} className="border border-bb-border px-2 py-1 text-center">
                                      {t || "—"}
                                    </td>
                                  );
                                })}
                                <td className="border border-bb-border px-2 py-1 text-right">
                                  {seasonPositions.reduce(
                                    (s, pos) => s + (playerStats.aggregations.minutesBySeasonPosition[season]?.[pos] ?? 0),
                                    0
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
