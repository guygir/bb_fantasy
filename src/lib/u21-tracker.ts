import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

export interface U21TrackerPlayer {
  playerId: number;
  name: string;
  dmi: number | null;
  gameShape: number | null;
  salary?: number | null;
}

export interface U21TrackerCountryWeek {
  countryId: number;
  name: string;
  pool: string;
  players: U21TrackerPlayer[];
  error?: string;
}

export interface U21TrackerWeekFile {
  season: number;
  week: number;
  scrapedAt: string;
  source?: string;
  synthetic?: boolean;
  note?: string;
  countries: U21TrackerCountryWeek[];
}

export interface U21TrackerMeta {
  season: number;
  weeks: number[];
  countries: { countryId: number; name: string; pool: string }[];
  updatedAt?: string;
}

export interface U21TrackerStint {
  fromWeek: number;
  toWeek: number | null;
  fromDate: string;
  toDate: string | null;
}

export interface U21TrackerPlayerRecord {
  name: string;
  countryId: number;
  active: boolean;
  stints: U21TrackerStint[];
}

export interface U21TrackerPlayersFile {
  season: number;
  updatedAt?: string;
  players: Record<string, U21TrackerPlayerRecord>;
}

export type U21RosterEventType = "joined" | "left" | "returned";

export interface U21RosterEvent {
  ts: string;
  date: string;
  week: number;
  countryId: number;
  playerId: number;
  name: string;
  type: U21RosterEventType;
  weeksAway?: number;
}

export interface U21RosterEventsFile {
  season: number;
  events: U21RosterEvent[];
}

export interface U21TrackerPlayerSeries {
  playerId: number;
  name: string;
  active: boolean;
  stints: U21TrackerStint[];
  points: {
    week: number;
    dmi: number | null;
    gameShape: number | null;
    salary: number | null;
    scrapedAt: string;
  }[];
}

const SEASON_72_START = Date.UTC(2026, 4, 2);
const SEASON_DURATION_DAYS = 98;

function dataDir(season: number): string {
  return join(process.cwd(), "data", "u21-tracker", `s${season}`);
}

function githubRawBase(): string {
  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "guygir/bb_fantasy";
  const branch = process.env.U21_TRACKER_GITHUB_BRANCH || "main";
  return `https://raw.githubusercontent.com/${repo}/${branch}/data/u21-tracker`;
}

async function readJsonLocal<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readJsonRemote<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function israelDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentWeekForSeason(season: number, now = new Date()): number | null {
  const start = SEASON_72_START - (72 - season) * SEASON_DURATION_DAYS * 86400000;
  const diffDays = Math.floor((now.getTime() - start) / 86400000);
  if (diffDays < 0 || diffDays >= SEASON_DURATION_DAYS) return null;
  return Math.floor(diffDays / 7) + 1;
}

export async function loadTrackerMeta(season: number): Promise<U21TrackerMeta | null> {
  const local = await readJsonLocal<U21TrackerMeta>(join(dataDir(season), "meta.json"));
  if (local) return local;
  return readJsonRemote<U21TrackerMeta>(`${githubRawBase()}/s${season}/meta.json`);
}

export async function loadTrackerWeek(
  season: number,
  week: number
): Promise<U21TrackerWeekFile | null> {
  const local = await readJsonLocal<U21TrackerWeekFile>(join(dataDir(season), `w${week}.json`));
  if (local) return local;
  return readJsonRemote<U21TrackerWeekFile>(`${githubRawBase()}/s${season}/w${week}.json`);
}

export async function loadPlayersIndex(season: number): Promise<U21TrackerPlayersFile | null> {
  const local = await readJsonLocal<U21TrackerPlayersFile>(join(dataDir(season), "players.json"));
  if (local) return local;
  return readJsonRemote<U21TrackerPlayersFile>(`${githubRawBase()}/s${season}/players.json`);
}

export async function loadRosterEvents(season: number): Promise<U21RosterEventsFile | null> {
  const local = await readJsonLocal<U21RosterEventsFile>(
    join(dataDir(season), "roster-events.json")
  );
  if (local) return local;
  return readJsonRemote<U21RosterEventsFile>(`${githubRawBase()}/s${season}/roster-events.json`);
}

export async function listLocalWeeks(season: number): Promise<number[]> {
  const dir = dataDir(season);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => {
      const m = name.match(/^w(\d+)\.json$/);
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

function filterChanges(
  events: U21RosterEvent[],
  countryId: number,
  season: number
): { changesToday: U21RosterEvent[]; changesThisWeek: U21RosterEvent[] } {
  const today = israelDateString();
  const week = currentWeekForSeason(season);
  const forCountry = events.filter((e) => e.countryId === countryId);
  return {
    changesToday: forCountry.filter((e) => e.date === today),
    changesThisWeek: forCountry.filter((e) => (week == null ? false : e.week === week)),
  };
}

export async function loadCountrySeries(
  season: number,
  countryId: number
): Promise<{
  meta: U21TrackerMeta | null;
  country: { countryId: number; name: string; pool: string } | null;
  weeks: number[];
  players: U21TrackerPlayerSeries[];
  changesToday: U21RosterEvent[];
  changesThisWeek: U21RosterEvent[];
}> {
  const meta = await loadTrackerMeta(season);
  let weeks = meta?.weeks?.length
    ? [...meta.weeks].sort((a, b) => a - b)
    : await listLocalWeeks(season);
  if (!weeks.length) {
    weeks = await listLocalWeeks(season);
  }

  const [weekFiles, playersIndex, eventsFile] = await Promise.all([
    Promise.all(weeks.map(async (week) => ({ week, file: await loadTrackerWeek(season, week) }))),
    loadPlayersIndex(season),
    loadRosterEvents(season),
  ]);

  const presentWeekFiles = weekFiles.filter((row) => row.file);

  const countryMeta =
    meta?.countries.find((c) => c.countryId === countryId) ??
    presentWeekFiles
      .map((row) => row.file!.countries.find((c) => c.countryId === countryId))
      .find(Boolean) ??
    null;

  const byPlayer = new Map<number, U21TrackerPlayerSeries>();

  for (const { week, file } of presentWeekFiles) {
    const country = file!.countries.find((c) => c.countryId === countryId);
    if (!country) continue;
    for (const player of country.players || []) {
      const series = byPlayer.get(player.playerId) ?? {
        playerId: player.playerId,
        name: player.name,
        active: true,
        stints: [],
        points: [],
      };
      series.name = player.name || series.name;
      series.points.push({
        week,
        dmi: player.dmi,
        gameShape: player.gameShape,
        salary: player.salary ?? null,
        scrapedAt: file!.scrapedAt,
      });
      byPlayer.set(player.playerId, series);
    }
  }

  // Union players from roster index so leavers remain listable/graphable
  if (playersIndex?.players) {
    for (const [idStr, rec] of Object.entries(playersIndex.players)) {
      if (rec.countryId !== countryId) continue;
      const playerId = Number(idStr);
      const existing = byPlayer.get(playerId);
      if (existing) {
        existing.active = rec.active;
        existing.stints = rec.stints || [];
        existing.name = rec.name || existing.name;
      } else {
        byPlayer.set(playerId, {
          playerId,
          name: rec.name,
          active: rec.active,
          stints: rec.stints || [],
          points: [],
        });
      }
    }
  }

  const players = [...byPlayer.values()]
    .map((p) => ({
      ...p,
      points: p.points.sort((a, b) => a.week - b.week),
    }))
    .sort((a, b) => {
      // Active first, then by name
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const { changesToday, changesThisWeek } = filterChanges(
    eventsFile?.events || [],
    countryId,
    season
  );

  return {
    meta,
    country: countryMeta
      ? {
          countryId: countryMeta.countryId,
          name: countryMeta.name,
          pool: countryMeta.pool,
        }
      : null,
    weeks: presentWeekFiles.map((w) => w.week).sort((a, b) => a - b),
    players,
    changesToday,
    changesThisWeek,
  };
}
