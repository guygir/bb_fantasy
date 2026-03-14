export interface PlayerWithDetails {
  playerId: number;
  name: string;
  image: string;
  position: string;
  dmi: number | null;
  salary: number | null;
  inGamePrice: number;
  /** Previous week price (from history when available). For display: prev → current */
  previousPrice?: number | null;
  avgRating: number;
  pts: number;
  fantasyPPG: number;
  gameShape: number | null;
  /** Fantasy points in most recent match played (same as roster "Last week"). 0 if DNP. */
  lastGameFP?: number | null;
  /** Total fantasy points (games played only) */
  totalFP?: number | null;
  /** File mtime for player face cache busting (optional) */
  faceMtime?: number | null;
}
