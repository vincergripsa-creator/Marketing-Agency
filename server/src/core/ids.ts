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
