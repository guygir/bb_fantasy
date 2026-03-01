import { stat } from "fs/promises";
import { join } from "path";

/**
 * Get mtime (ms) of player face image for cache busting.
 * Returns null if file doesn't exist.
 */
export async function getFaceMtime(playerId: number): Promise<number | null> {
  const path = join(process.cwd(), "public", "player-faces", `${playerId}.png`);
  try {
    const st = await stat(path);
    return st.mtimeMs;
  } catch {
    return null;
  }
}
