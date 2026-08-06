"use client";

import { useEffect, useMemo, useState } from "react";
import { config } from "@/lib/config";

interface CountryMeta {
  countryId: number;
  name: string;
  pool: string;
}

interface OnSalePlayer {
  playerId: number;
  name: string;
  countryId: number;
  countryName: string;
  pool?: string;
  dmi?: number | null;
}

function bbPlayerUrl(playerId: number): string {
  return `https://buzzerbeater.com/player/${playerId}/overview.aspx`;
}

interface MetaResponse {
  season: number;
  weeks: number[];
  countries: CountryMeta[];
  updatedAt?: string;
  changesToday?: RosterEvent[];
  changesThisWeek?: RosterEvent[];
  onSale?: OnSalePlayer[];
  onSaleUpdatedAt?: string;
}

const HIDDEN_COUNTRIES_KEY = "u21-tracker-hidden-change-countries";

function readHiddenCountries(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIDDEN_COUNTRIES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr.filter((n) => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

function writeHiddenCountries(ids: Set<number>) {
  localStorage.setItem(HIDDEN_COUNTRIES_KEY, JSON.stringify([...ids]));
}

interface PlayerPoint {
  week: number;
  dmi: number | null;
  gameShape: number | null;
  salary: number | null;
  scrapedAt: string;
}

interface PlayerSeries {
  playerId: number;
  name: string;
  active?: boolean;
  points: PlayerPoint[];
  teamKey?: string;
  teamName?: string;
  colorIndex?: number;
}

interface RosterEvent {
  ts: string;
  date: string;
  week: number;
  countryId: number;
  playerId: number;
  name: string;
  type: "joined" | "left" | "returned";
  weeksAway?: number;
  countryName?: string;
}

interface CountryResponse {
  season: number;
  country: CountryMeta | null;
  weeks: number[];
  players: PlayerSeries[];
  changesToday?: RosterEvent[];
  changesThisWeek?: RosterEvent[];
  onSale?: OnSalePlayer[];
}

type SortKey = "name" | "gameShape" | "dmi" | "salary";
type SortDir = "asc" | "desc";

const DEFAULT_VISIBLE_PER_TEAM = 3;

function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 12);
  const last = parts[parts.length - 1];
  return `${parts[0][0]}. ${last}`.slice(0, 16);
}

function isActive(player: PlayerSeries): boolean {
  return player.active !== false;
}

function topPlayerIdsByDmi(players: PlayerSeries[], n: number): Set<number> {
  const pool = players.filter(isActive);
  const source = pool.length ? pool : players;
  return new Set(
    [...source]
      .sort(
        (a, b) =>
          (latestPoint(b)?.dmi ?? Number.NEGATIVE_INFINITY) -
          (latestPoint(a)?.dmi ?? Number.NEGATIVE_INFINITY)
      )
      .slice(0, n)
      .map((p) => p.playerId)
  );
}

function hiddenExceptTopByDmi(players: PlayerSeries[], n: number): Set<number> {
  const keep = topPlayerIdsByDmi(players, n);
  return new Set(players.filter((p) => !keep.has(p.playerId)).map((p) => p.playerId));
}

const COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#4d7c0f",
  "#ea580c",
  "#0f766e",
  "#9333ea",
  "#b45309",
  "#0369a1",
  "#be123c",
  "#15803d",
  "#6d28d9",
  "#c2410c",
  "#155e75",
];

const DMI_STEP = 50_000;

function colorFor(index: number): string {
  return COLORS[index % COLORS.length];
}

function latestPoint(player: PlayerSeries): PlayerPoint | null {
  if (!player.points.length) return null;
  return [...player.points].sort((a, b) => b.week - a.week)[0];
}

function floorStrictMultiple(value: number, step: number): number {
  const floored = Math.floor(value / step) * step;
  const result = floored < value ? floored : floored - step;
  return Math.max(0, result);
}

function ceilStrictMultiple(value: number, step: number): number {
  const ceiled = Math.ceil(value / step) * step;
  return ceiled > value ? ceiled : ceiled + step;
}

function formatDmiTick(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(2)}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString()}`;
}

function formatEventType(ev: RosterEvent): string {
  if (ev.type === "returned") {
    const n = ev.weeksAway ?? 1;
    return `returned · ${n}w ago`;
  }
  return ev.type;
}

/**
 * Split DMI points into segments only when the player is missing an intermediate
 * chart week (a week that exists in the tracker). Sparse sampling (e.g. W0 + W13
 * with nothing in between yet) must stay one continuous line.
 */
function contiguousSegments(points: PlayerPoint[], chartWeeks: number[]): PlayerPoint[][] {
  const sorted = [...points].filter((p) => p.dmi != null).sort((a, b) => a.week - b.week);
  if (!sorted.length) return [];
  const present = new Set(sorted.map((p) => p.week));
  const segments: PlayerPoint[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const missingMiddle = chartWeeks.some(
      (w) => w > prev.week && w < cur.week && !present.has(w)
    );
    if (missingMiddle) segments.push([cur]);
    else segments[segments.length - 1].push(cur);
  }
  return segments;
}

export default function U21TrackerPage() {
  const season = config.game.currentSeason;
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(null);
  const [compareCountryId, setCompareCountryId] = useState<number | null>(null);
  const [primaryData, setPrimaryData] = useState<CountryResponse | null>(null);
  const [compareData, setCompareData] = useState<CountryResponse | null>(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState<string | null>(null);
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<number>>(new Set());
  const [hiddenChangeCountries, setHiddenChangeCountries] = useState<Set<number>>(new Set());

  useEffect(() => {
    setHiddenChangeCountries(readHiddenCountries());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/u21-tracker?season=${season}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setMeta(json);
          setMetaError(null);
        }
      } catch (e) {
        if (!cancelled) setMetaError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season]);

  function hideChangeCountry(countryId: number) {
    setHiddenChangeCountries((prev) => {
      const next = new Set(prev);
      next.add(countryId);
      writeHiddenCountries(next);
      return next;
    });
  }

  function clearHiddenChangeCountries() {
    setHiddenChangeCountries(new Set());
    writeHiddenCountries(new Set());
  }

  useEffect(() => {
    if (selectedCountryId == null) return;
    let cancelled = false;
    setCountryLoading(true);
    setCountryError(null);
    if (compareCountryId === selectedCountryId) setCompareCountryId(null);

    (async () => {
      try {
        const res = await fetch(`/api/u21-tracker?season=${season}&countryId=${selectedCountryId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setPrimaryData(json);
      } catch (e) {
        if (!cancelled) {
          setPrimaryData(null);
          setCountryError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setCountryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, selectedCountryId]);

  useEffect(() => {
    if (compareCountryId == null) {
      setCompareData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/u21-tracker?season=${season}&countryId=${compareCountryId}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setCompareData(json);
      } catch (e) {
        if (!cancelled) {
          setCompareData(null);
          setCountryError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [season, compareCountryId]);

  useEffect(() => {
    if (!primaryData?.players?.length) return;
    if (
      compareCountryId != null &&
      (!compareData?.players?.length || compareData.country?.countryId !== compareCountryId)
    ) {
      return;
    }
    const hidden = hiddenExceptTopByDmi(primaryData.players, DEFAULT_VISIBLE_PER_TEAM);
    if (compareData?.players?.length) {
      for (const id of hiddenExceptTopByDmi(compareData.players, DEFAULT_VISIBLE_PER_TEAM)) {
        hidden.add(id);
      }
    }
    setHiddenPlayers(hidden);
  }, [primaryData, compareData, compareCountryId]);

  const chartCountries = useMemo(() => {
    const list = meta?.countries ?? [];
    const worldCup = list.filter((c) => /world\s*cup/i.test(c.pool));
    return worldCup.length ? worldCup : list;
  }, [meta]);

  useEffect(() => {
    if (
      selectedCountryId != null &&
      chartCountries.length > 0 &&
      !chartCountries.some((c) => c.countryId === selectedCountryId)
    ) {
      setSelectedCountryId(null);
      setCompareCountryId(null);
    }
  }, [selectedCountryId, chartCountries]);

  useEffect(() => {
    if (
      compareCountryId != null &&
      chartCountries.length > 0 &&
      !chartCountries.some((c) => c.countryId === compareCountryId)
    ) {
      setCompareCountryId(null);
    }
  }, [compareCountryId, chartCountries]);

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chartCountries;
    return chartCountries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.pool.toLowerCase().includes(q)
    );
  }, [chartCountries, search]);

  const selectedCountry = chartCountries.find((c) => c.countryId === selectedCountryId) ?? null;
  const compareCountry = chartCountries.find((c) => c.countryId === compareCountryId) ?? null;

  const primaryPlayers = useMemo(() => {
    return (primaryData?.players ?? []).map((p, index) => ({
      ...p,
      teamKey: "primary",
      teamName: selectedCountry?.name ?? "Team A",
      colorIndex: index,
    }));
  }, [primaryData, selectedCountry]);

  const comparePlayers = useMemo(() => {
    return (compareData?.players ?? []).map((p, index) => ({
      ...p,
      teamKey: "compare",
      teamName: compareCountry?.name ?? "Team B",
      colorIndex: index + 18,
    }));
  }, [compareData, compareCountry]);

  const chartPlayers = useMemo(
    () => [...primaryPlayers, ...comparePlayers],
    [primaryPlayers, comparePlayers]
  );

  const chartWeeks = useMemo(() => {
    const weeks = new Set<number>([
      ...(primaryData?.weeks ?? []),
      ...(compareData?.weeks ?? []),
    ]);
    return [...weeks].sort((a, b) => a - b);
  }, [primaryData, compareData]);

  function togglePlayer(playerId: number) {
    setHiddenPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function showAll() {
    setHiddenPlayers(new Set());
  }

  function hideAll() {
    setHiddenPlayers(new Set(chartPlayers.map((p) => p.playerId)));
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="mb-2 text-xl font-bold">U21 Tracker</h2>
      <p className="mb-6 text-sm text-gray-600">
        Weekly DMI / game shape snapshots for U21 countries in the current stage (season {season}
        {chartCountries.length && chartCountries.some((c) => /world\s*cup/i.test(c.pool))
          ? " · World Cup"
          : ""}
        ).
        {meta?.updatedAt ? ` Last scrape: ${new Date(meta.updatedAt).toLocaleString()}.` : ""}
        {meta?.weeks?.length ? ` Weeks on file: ${meta.weeks.join(", ")}.` : ""}
      </p>

      {metaError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {metaError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-bb-border bg-white p-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">Search country</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Israel, Pool A…"
            className="mb-3 w-full rounded-lg border border-bb-border px-3 py-2 text-sm"
          />
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {filteredCountries.map((c) => (
              <button
                key={c.countryId}
                type="button"
                onClick={() => setSelectedCountryId(c.countryId)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selectedCountryId === c.countryId
                    ? "bg-exact/15 font-semibold text-exact"
                    : "hover:bg-card-bg text-bb-text"
                }`}
              >
                <span className="block">{c.name}</span>
                <span className="text-xs text-gray-400">{c.pool}</span>
              </button>
            ))}
            {!filteredCountries.length && (
              <p className="text-sm text-gray-400">No countries match.</p>
            )}
          </div>
        </aside>

        <section className="rounded-xl border border-bb-border bg-white p-4">
          {!selectedCountryId && meta && (
            <AggregatedChangesView
              changesToday={meta.changesToday ?? []}
              changesThisWeek={meta.changesThisWeek ?? []}
              onSale={meta.onSale ?? []}
              onSaleUpdatedAt={meta.onSaleUpdatedAt}
              hiddenCountries={hiddenChangeCountries}
              onHideCountry={hideChangeCountry}
              onClearHidden={clearHiddenChangeCountries}
            />
          )}
          {countryLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-exact border-t-transparent" />
              Loading country series…
            </div>
          )}
          {countryError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {countryError}
            </div>
          )}
          {selectedCountry && primaryData && !countryLoading && (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-bb-text">
                    {selectedCountry.name}
                    {compareCountry ? ` vs ${compareCountry.name}` : ""}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {selectedCountry.pool}
                    {compareCountry ? ` · ${compareCountry.pool}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-medium text-gray-600">
                    Compare with
                    <select
                      className="mt-1 block min-w-[180px] rounded-lg border border-bb-border px-2 py-1.5 text-sm"
                      value={compareCountryId ?? ""}
                      onChange={(e) =>
                        setCompareCountryId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">None</option>
                      {(chartCountries ?? [])
                        .filter((c) => c.countryId !== selectedCountryId)
                        .map((c) => (
                          <option key={c.countryId} value={c.countryId}>
                            {c.name} ({c.pool})
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={showAll}
                    className="rounded-lg border border-bb-border px-3 py-1.5 text-xs font-medium hover:bg-card-bg"
                  >
                    Show all
                  </button>
                  <button
                    type="button"
                    onClick={hideAll}
                    className="rounded-lg border border-bb-border px-3 py-1.5 text-xs font-medium hover:bg-card-bg"
                  >
                    Hide all
                  </button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                <DmiChart
                  weeks={chartWeeks}
                  players={chartPlayers}
                  hiddenPlayers={hiddenPlayers}
                />
                <ChangesPanel
                  primaryName={selectedCountry.name}
                  compareName={compareCountry?.name ?? null}
                  primaryToday={primaryData.changesToday ?? []}
                  primaryWeek={primaryData.changesThisWeek ?? []}
                  compareToday={compareData?.changesToday ?? []}
                  compareWeek={compareData?.changesThisWeek ?? []}
                  primaryOnSale={primaryData.onSale ?? []}
                  compareOnSale={compareData?.onSale ?? []}
                />
              </div>

              <div
                className={`mt-4 grid gap-3 ${
                  compareCountryId ? "lg:grid-cols-2" : "grid-cols-1"
                }`}
              >
                <PlayerTable
                  title={selectedCountry.name}
                  players={primaryPlayers}
                  hiddenPlayers={hiddenPlayers}
                  onToggle={togglePlayer}
                />
                {compareCountryId && (
                  <PlayerTable
                    title={compareCountry?.name ?? "Compare team"}
                    players={comparePlayers}
                    hiddenPlayers={hiddenPlayers}
                    onToggle={togglePlayer}
                  />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function AggregatedChangesView({
  changesToday,
  changesThisWeek,
  onSale,
  onSaleUpdatedAt,
  hiddenCountries,
  onHideCountry,
  onClearHidden,
}: {
  changesToday: RosterEvent[];
  changesThisWeek: RosterEvent[];
  onSale: OnSalePlayer[];
  onSaleUpdatedAt?: string;
  hiddenCountries: Set<number>;
  onHideCountry: (countryId: number) => void;
  onClearHidden: () => void;
}) {
  const todayRows = changesToday.filter((e) => !hiddenCountries.has(e.countryId));
  const weekRows = changesThisWeek.filter((e) => !hiddenCountries.has(e.countryId));
  const saleRows = onSale.filter((p) => !hiddenCountries.has(p.countryId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-bb-text">All countries — roster changes</h3>
          <p className="text-sm text-gray-500">
            Includes every tracked U21 country (not only World Cup). Select a country on the left for
            the DMI chart. Use × to hide a country from these lists.
          </p>
        </div>
        {hiddenCountries.size > 0 && (
          <button
            type="button"
            onClick={onClearHidden}
            className="rounded-lg border border-bb-border px-3 py-1.5 text-xs font-medium hover:bg-card-bg"
          >
            Show {hiddenCountries.size} hidden {hiddenCountries.size === 1 ? "country" : "countries"}
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <AggregatedChangesTable
          title="Changes today"
          rows={todayRows}
          showCountry
          onHideCountry={onHideCountry}
        />
        <AggregatedChangesTable
          title="Changes this week"
          rows={weekRows}
          showCountry
          onHideCountry={onHideCountry}
        />
        <OnSaleTable
          title="Currently on sale"
          rows={saleRows}
          showCountry
          updatedAt={onSaleUpdatedAt}
          onHideCountry={onHideCountry}
        />
      </div>
    </div>
  );
}

function OnSaleTable({
  title,
  rows,
  showCountry,
  updatedAt,
  onHideCountry,
}: {
  title: string;
  rows: OnSalePlayer[];
  showCountry?: boolean;
  updatedAt?: string;
  onHideCountry?: (countryId: number) => void;
}) {
  type SaleSortKey = "country" | "dmi" | "name";
  const [sortKey, setSortKey] = useState<SaleSortKey>(showCountry ? "dmi" : "dmi");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function onSort(key: SaleSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "country" || key === "name" ? "asc" : "desc");
    }
  }

  function marker(key: SaleSortKey) {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "▲" : "▼";
  }

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      let result = 0;
      if (sortKey === "country") {
        result =
          a.countryName.localeCompare(b.countryName) || a.name.localeCompare(b.name);
      } else if (sortKey === "name") {
        result = a.name.localeCompare(b.name);
      } else {
        result = (a.dmi ?? -Infinity) - (b.dmi ?? -Infinity);
        if (result === 0) result = a.name.localeCompare(b.name);
      }
      return sortDir === "asc" ? result : -result;
    });
    return list;
  }, [rows, sortKey, sortDir]);

  return (
    <div className="overflow-hidden rounded-lg border border-bb-border">
      <div className="border-b border-bb-border bg-card-bg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {title}
        {updatedAt ? (
          <span className="ml-2 font-normal normal-case text-gray-400">
            {updatedAt.includes("T")
              ? new Date(updatedAt).toLocaleString()
              : updatedAt}
          </span>
        ) : null}
      </div>
      {sorted.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-400">No players on sale</p>
      ) : (
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-white text-left text-gray-600">
                <th className="border-b border-bb-border px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onSort("name")}
                    className="inline-flex items-center gap-1 font-semibold hover:text-exact"
                  >
                    Player <span className="text-[10px] text-gray-400">{marker("name")}</span>
                  </button>
                </th>
                {showCountry && (
                  <th className="border-b border-bb-border px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onSort("country")}
                      className="inline-flex items-center gap-1 font-semibold hover:text-exact"
                    >
                      Country{" "}
                      <span className="text-[10px] text-gray-400">{marker("country")}</span>
                    </button>
                  </th>
                )}
                <th className="border-b border-bb-border px-2 py-2">
                  <button
                    type="button"
                    onClick={() => onSort("dmi")}
                    className="inline-flex items-center gap-1 font-semibold hover:text-exact"
                  >
                    DMI <span className="text-[10px] text-gray-400">{marker("dmi")}</span>
                  </button>
                </th>
                {onHideCountry && <th className="border-b border-bb-border px-2 py-2 w-8" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={`${p.countryId}-${p.playerId}`}>
                  <td className="border-b border-bb-border px-2 py-1.5 font-medium">
                    <a
                      href={bbPlayerUrl(p.playerId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-exact hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.name}
                    </a>
                  </td>
                  {showCountry && (
                    <td className="border-b border-bb-border px-2 py-1.5 text-gray-600">
                      {p.countryName}
                    </td>
                  )}
                  <td className="border-b border-bb-border px-2 py-1.5 text-gray-600 tabular-nums">
                    {p.dmi == null ? "—" : p.dmi.toLocaleString()}
                  </td>
                  {onHideCountry && (
                    <td className="border-b border-bb-border px-1 py-1.5 text-right">
                      <button
                        type="button"
                        title={`Hide ${p.countryName} from this list`}
                        onClick={() => onHideCountry(p.countryId)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AggregatedChangesTable({
  title,
  rows,
  showCountry,
  onHideCountry,
}: {
  title: string;
  rows: RosterEvent[];
  showCountry?: boolean;
  onHideCountry?: (countryId: number) => void;
}) {
  const sorted = [...rows].sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div className="overflow-hidden rounded-lg border border-bb-border">
      <div className="border-b border-bb-border bg-card-bg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      {sorted.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-400">No changes</p>
      ) : (
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-white text-left text-gray-600">
                <th className="border-b border-bb-border px-2 py-2 font-semibold">Player</th>
                {showCountry && (
                  <th className="border-b border-bb-border px-2 py-2 font-semibold">Country</th>
                )}
                <th className="border-b border-bb-border px-2 py-2 font-semibold">Change</th>
                <th className="border-b border-bb-border px-2 py-2 font-semibold">Date</th>
                {onHideCountry && <th className="border-b border-bb-border px-2 py-2 w-8" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((ev) => (
                <tr key={`${ev.ts}-${ev.playerId}-${ev.type}-${ev.countryId}`}>
                  <td className="border-b border-bb-border px-2 py-1.5 font-medium text-bb-text">
                    {ev.name}
                  </td>
                  {showCountry && (
                    <td className="border-b border-bb-border px-2 py-1.5 text-gray-600">
                      {ev.countryName || `Country ${ev.countryId}`}
                    </td>
                  )}
                  <td className="border-b border-bb-border px-2 py-1.5 text-gray-600">
                    {formatEventType(ev)}
                  </td>
                  <td className="border-b border-bb-border px-2 py-1.5 text-gray-500">
                    {ev.date}
                    <span className="text-gray-400"> · W{ev.week}</span>
                  </td>
                  {onHideCountry && (
                    <td className="border-b border-bb-border px-1 py-1.5 text-right">
                      <button
                        type="button"
                        title={`Hide ${ev.countryName || "country"} from this list`}
                        onClick={() => onHideCountry(ev.countryId)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChangesPanel({
  primaryName,
  compareName,
  primaryToday,
  primaryWeek,
  compareToday,
  compareWeek,
  primaryOnSale,
  compareOnSale,
}: {
  primaryName: string;
  compareName: string | null;
  primaryToday: RosterEvent[];
  primaryWeek: RosterEvent[];
  compareToday: RosterEvent[];
  compareWeek: RosterEvent[];
  primaryOnSale: OnSalePlayer[];
  compareOnSale: OnSalePlayer[];
}) {
  const saleRows = [
    ...primaryOnSale.map((p) => ({ ...p, countryName: primaryName })),
    ...compareOnSale.map((p) => ({
      ...p,
      countryName: compareName || p.countryName || "B",
    })),
  ];
  return (
    <div className="space-y-3">
      <ChangesTable
        title="Changes today"
        rows={[
          ...primaryToday.map((e) => ({ ...e, team: primaryName })),
          ...compareToday.map((e) => ({ ...e, team: compareName || "B" })),
        ]}
      />
      <ChangesTable
        title="Changes this week"
        rows={[
          ...primaryWeek.map((e) => ({ ...e, team: primaryName })),
          ...compareWeek.map((e) => ({ ...e, team: compareName || "B" })),
        ]}
      />
      <OnSaleTable
        title="Currently on sale"
        rows={saleRows}
        showCountry={Boolean(compareName)}
      />
    </div>
  );
}

function ChangesTable({
  title,
  rows,
}: {
  title: string;
  rows: (RosterEvent & { team: string })[];
}) {
  const sorted = [...rows].sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div className="overflow-hidden rounded-lg border border-bb-border">
      <div className="border-b border-bb-border bg-card-bg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      {sorted.length === 0 ? (
        <p className="px-2.5 py-3 text-[11px] text-gray-400">No changes</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto divide-y divide-bb-border text-[11px]">
          {sorted.map((ev) => (
            <li key={`${ev.ts}-${ev.playerId}-${ev.type}`} className="px-2.5 py-1.5">
              <div className="font-medium text-bb-text">{ev.name}</div>
              <div className="text-gray-500">
                {formatEventType(ev)}
                {ev.team ? ` · ${ev.team}` : ""} · {ev.date}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayerTable({
  title,
  players,
  hiddenPlayers,
  onToggle,
}: {
  title: string;
  players: PlayerSeries[];
  hiddenPlayers: Set<number>;
  onToggle: (playerId: number) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("dmi");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const decorated = players.map((player) => {
      const latest = latestPoint(player);
      return {
        player,
        name: player.name,
        gameShape: latest?.gameShape ?? null,
        dmi: latest?.dmi ?? null,
        salary: latest?.salary ?? null,
        active: isActive(player),
      };
    });
    decorated.sort((a, b) => {
      let result = 0;
      if (sortKey === "name") result = a.name.localeCompare(b.name);
      else if (sortKey === "gameShape") result = (a.gameShape ?? -Infinity) - (b.gameShape ?? -Infinity);
      else if (sortKey === "dmi") result = (a.dmi ?? -Infinity) - (b.dmi ?? -Infinity);
      else result = (a.salary ?? -Infinity) - (b.salary ?? -Infinity);
      if (result === 0) result = a.player.playerId - b.player.playerId;
      return sortDir === "asc" ? result : -result;
    });
    return decorated;
  }, [players, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function marker(key: SortKey) {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "▲" : "▼";
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-bb-border">
      <div className="border-b border-bb-border bg-card-bg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        {title}
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-white text-gray-600">
            {(
              [
                ["name", "Player"],
                ["gameShape", "GS"],
                ["dmi", "DMI"],
                ["salary", "Salary"],
              ] as const
            ).map(([key, label]) => (
              <th key={key} className="border-b border-bb-border px-2 py-2 text-left">
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className="inline-flex items-center gap-1 font-semibold hover:text-exact"
                >
                  {label} <span className="text-[10px] text-gray-400">{marker(key)}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ player, name, gameShape, dmi, salary, active }) => {
            const hidden = hiddenPlayers.has(player.playerId);
            return (
              <tr
                key={player.playerId}
                className={`cursor-pointer hover:bg-card-bg ${hidden ? "opacity-40" : ""} ${
                  !active ? "text-gray-500" : ""
                }`}
                onClick={() => onToggle(player.playerId)}
              >
                <td className="border-b border-bb-border px-2 py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        background: colorFor(player.colorIndex ?? 0),
                        opacity: active ? 1 : 0.45,
                      }}
                    />
                    <span className="font-medium">{name}</span>
                    {!active && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                        Left
                      </span>
                    )}
                  </span>
                </td>
                <td className="border-b border-bb-border px-2 py-1.5">{gameShape ?? "—"}</td>
                <td className="border-b border-bb-border px-2 py-1.5">
                  {dmi == null ? "—" : dmi.toLocaleString()}
                </td>
                <td className="border-b border-bb-border px-2 py-1.5">{formatMoney(salary)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DmiChart({
  weeks,
  players,
  hiddenPlayers,
}: {
  weeks: number[];
  players: PlayerSeries[];
  hiddenPlayers: Set<number>;
}) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    name: string;
    dmi: number;
    gameShape: number | null;
    week: number;
  } | null>(null);

  const width = 760;
  const height = 420;
  const pad = { top: 28, right: 108, bottom: 40, left: 58 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const visible = players.filter((p) => !hiddenPlayers.has(p.playerId));
  const dmiValues = players.flatMap((p) =>
    p.points.map((pt) => pt.dmi).filter((v): v is number => v != null)
  );
  const minDmi = dmiValues.length ? Math.min(...dmiValues) : 0;
  const maxDmi = dmiValues.length ? Math.max(...dmiValues) : DMI_STEP;
  const yMin = dmiValues.length ? floorStrictMultiple(minDmi, DMI_STEP) : 0;
  const yMax = dmiValues.length ? ceilStrictMultiple(maxDmi, DMI_STEP) : DMI_STEP;
  const xWeeks = weeks.length ? weeks : [0];

  const xPos = (week: number) => {
    if (xWeeks.length === 1) return pad.left + innerW / 2;
    const minW = xWeeks[0];
    const maxW = xWeeks[xWeeks.length - 1];
    return pad.left + ((week - minW) / (maxW - minW || 1)) * innerW;
  };
  const yPos = (dmi: number) => pad.top + ((yMax - dmi) / (yMax - yMin || 1)) * innerH;

  const range = Math.max(yMax - yMin, DMI_STEP);
  const roughStep = range / 6;
  const tickStep = Math.max(DMI_STEP, Math.ceil(roughStep / DMI_STEP) * DMI_STEP);
  const tickVals: number[] = [];
  for (let v = yMin; v <= yMax + 1; v += tickStep) tickVals.push(v);
  if (tickVals[tickVals.length - 1] !== yMax) tickVals.push(yMax);

  return (
    <div className="relative overflow-x-auto rounded-lg border border-bb-border bg-[#fcfbf8] p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[560px]"
        onMouseLeave={() => setTooltip(null)}
      >
        <rect
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          fill="#fffdf8"
          stroke="#e7e0d4"
        />
        {tickVals.map((val) => {
          const y = yPos(val);
          return (
            <g key={val}>
              <line
                x1={pad.left}
                x2={pad.left + innerW}
                y1={y}
                y2={y}
                stroke="#e7e0d4"
                strokeDasharray="4 4"
              />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">
                {formatDmiTick(val)}
              </text>
            </g>
          );
        })}

        {xWeeks.map((week) => (
          <text
            key={week}
            x={xPos(week)}
            y={height - 12}
            textAnchor="middle"
            fontSize="11"
            fill="#6b7280"
          >
            W{week}
          </text>
        ))}

        <text
          x={16}
          y={pad.top + innerH / 2}
          transform={`rotate(-90 16 ${pad.top + innerH / 2})`}
          textAnchor="middle"
          fontSize="12"
          fill="#4b5563"
        >
          DMI
        </text>

        {players.map((player) => {
          if (hiddenPlayers.has(player.playerId)) return null;
          const color = colorFor(player.colorIndex ?? 0);
          const dashed = player.teamKey === "compare";
          const segments = contiguousSegments(player.points, xWeeks);
          if (!segments.length) return null;
          const lastSeg = segments[segments.length - 1];
          const last = lastSeg[lastSeg.length - 1];
          const lastX = xPos(last.week);
          const lastY = yPos(last.dmi!);
          const label = shortPlayerName(player.name);
          return (
            <g key={`${player.teamKey}-${player.playerId}`} opacity={isActive(player) ? 0.95 : 0.55}>
              {segments.map((seg, segIdx) => {
                const path = seg
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(p.week)} ${yPos(p.dmi!)}`)
                  .join(" ");
                return (
                  <path
                    key={segIdx}
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    opacity="0.85"
                    strokeDasharray={dashed ? "5 4" : undefined}
                  />
                );
              })}
              {segments.flat().map((p) => (
                <g key={`${player.playerId}-${p.week}`}>
                  <circle
                    cx={xPos(p.week)}
                    cy={yPos(p.dmi!)}
                    r="5.5"
                    fill={color}
                    className="cursor-pointer"
                    onMouseEnter={() =>
                      setTooltip({
                        x: xPos(p.week),
                        y: yPos(p.dmi!),
                        name: player.name,
                        dmi: p.dmi!,
                        gameShape: p.gameShape,
                        week: p.week,
                      })
                    }
                    onMouseMove={() =>
                      setTooltip({
                        x: xPos(p.week),
                        y: yPos(p.dmi!),
                        name: player.name,
                        dmi: p.dmi!,
                        gameShape: p.gameShape,
                        week: p.week,
                      })
                    }
                  />
                  <text
                    x={xPos(p.week)}
                    y={yPos(p.dmi!) - 8}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={color}
                    pointerEvents="none"
                  >
                    {p.gameShape ?? "–"}
                  </text>
                </g>
              ))}
              <text
                x={lastX + 8}
                y={lastY + 3}
                fontSize="10"
                fontWeight="600"
                fill={color}
                pointerEvents="none"
              >
                {label}
              </text>
            </g>
          );
        })}

        {!visible.length && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="14" fill="#9ca3af">
            No players visible
          </text>
        )}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-bb-border bg-white px-2 py-1 text-[11px] shadow-md"
          style={{
            left: `min(calc(${(tooltip.x / width) * 100}% + 8px), calc(100% - 140px))`,
            top: `max(4px, calc(${(tooltip.y / height) * 100}% - 36px))`,
          }}
        >
          <div className="font-semibold text-bb-text">{tooltip.name}</div>
          <div className="text-gray-600">
            W{tooltip.week} · DMI {tooltip.dmi.toLocaleString()} · GS {tooltip.gameShape ?? "—"}
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {visible.map((player) => {
            const color = colorFor(player.colorIndex ?? 0);
            return (
              <span
                key={`${player.teamKey}-${player.playerId}`}
                className="inline-flex items-center gap-1 rounded border border-bb-border bg-white px-1.5 py-0.5 text-[11px] font-medium"
                style={{ color, opacity: isActive(player) ? 1 : 0.55 }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                {shortPlayerName(player.name)}
                {!isActive(player) ? " (left)" : ""}
              </span>
            );
          })}
        </div>
      )}
      <p className="mt-1 px-2 text-[11px] text-gray-500">
        X = season week · Y = DMI (50k bounds) · hover point for DMI/GS · gaps = off roster
        {players.some((p) => p.teamKey === "compare") ? " · dashed lines = compare team" : ""}
      </p>
    </div>
  );
}
