/** Bounded memory (scale §7.2). Dormant until P9.2: nothing leaves the world. */
import type { WorldState } from '../shared.js';
import type { ArchiveBatch } from '../contracts.js';

export function compactWorld(w: WorldState): ArchiveBatch {
  return { day: w.day, rows: {}, dropFiles: [] };
}
