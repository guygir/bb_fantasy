export interface PlayerWithDetails {
  playerId: number;
  name: string;
  image: string;
  position: string;
  dmi: number | null;
  salary: number | null;
  inGamePrice: number;
  avgRating: number;
  pts: number;
  fantasyPPG: number;
  gameShape: number | null;
  /** File mtime for player face cache busting (optional) */
  faceMtime?: number | null;
}
