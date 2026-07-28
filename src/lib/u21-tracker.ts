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

export interface U21TrackerPlayerSeries {
  playerId: number;
  name: string;
  points: {
    week: number;
    dmi: number | null;
    gameShape: number | null;
    salary: number | null;
    scrapedAt: string;
  }[];
}

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

export async function loadCountrySeries(
  season: number,
  countryId: number
): Promise<{
  meta: U21TrackerMeta | null;
  country: { countryId: number; name: string; pool: string } | null;
  weeks: number[];
  players: U21TrackerPlayerSeries[];
}> {
  const meta = await loadTrackerMeta(season);
  let weeks = meta?.weeks?.length ? [...meta.weeks].sort((a, b) => a - b) : await listLocalWeeks(season);
  if (!weeks.length) {
    // Try remote meta failed earlier; still attempt common weeks later if needed.
    weeks = await listLocalWeeks(season);
  }

  const weekFiles = (
    await Promise.all(weeks.map(async (week) => ({ week, file: await loadTrackerWeek(season, week) })))
  ).filter((row) => row.file);

  const countryMeta =
    meta?.countries.find((c) => c.countryId === countryId) ??
    weekFiles
      .map((row) => row.file!.countries.find((c) => c.countryId === countryId))
      .find(Boolean) ??
    null;

  const byPlayer = new Map<number, U21TrackerPlayerSeries>();
  for (const { week, file } of weekFiles) {
    const country = file!.countries.find((c) => c.countryId === countryId);
    if (!country) continue;
    for (const player of country.players || []) {
      const series = byPlayer.get(player.playerId) ?? {
        playerId: player.playerId,
        name: player.name,
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

  const players = [...byPlayer.values()]
    .map((p) => ({
      ...p,
      points: p.points.sort((a, b) => a.week - b.week),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    meta,
    country: countryMeta
      ? {
          countryId: countryMeta.countryId,
          name: countryMeta.name,
          pool: countryMeta.pool,
        }
      : null,
    weeks: weekFiles.map((w) => w.week).sort((a, b) => a - b),
    players,
  };
}
