import type { WorldState } from '../shared.js';

/** Deterministic, human-readable ids: "prd_12", "tsk_340". */
export function nextId(world: WorldState, prefix: string): string {
  world.idCounter += 1;
  return `${prefix}_${world.idCounter}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

/** FNV-1a 32-bit hash — deterministic variety without touching the simulation RNG. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final avalanche (murmur3 fmix32) so low bits — used for `% n` choices — are well mixed
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
