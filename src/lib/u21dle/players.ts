/**
 * U21dle players - load from JSON
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { U21dlePlayer } from "./feedback";
import { U21DLE_CONFIG } from "./config";

let cachedPlayers: U21dlePlayer[] | null = null;

export function getU21dlePlayers(): U21dlePlayer[] {
  if (cachedPlayers) return cachedPlayers;
  const path = join(process.cwd(), "data", "u21dle_players.json");
  const data = JSON.parse(readFileSync(path, "utf-8"));
  cachedPlayers = data.players as U21dlePlayer[];
  return cachedPlayers;
}

export function getEligiblePlayers(): U21dlePlayer[] {
  return getU21dlePlayers().filter((p) => p.gp >= U21DLE_CONFIG.MIN_GP_ELIGIBLE);
}

export function searchU21dlePlayers(query: string, limit = 10): U21dlePlayer[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const players = getU21dlePlayers();
  const matches = players.filter((p) => p.name.toLowerCase().includes(q));
  return matches.slice(0, limit);
}

export function getU21dlePlayerById(playerId: number): U21dlePlayer | undefined {
  return getU21dlePlayers().find((p) => p.playerId === playerId);
}
