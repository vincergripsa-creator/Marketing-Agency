/** Growth stages and their policy (scale §4.2). Dormant until P10.1: `growthOn` false, every decision stays today's (D47). */
import type { StagePolicy, WorldState } from '../shared.js';

export function growthOn(_w: WorldState): boolean {
  return false;
}

/** Only growthOn branches read it, so nothing reaches it before P10.1. */
export function policyOf(_w: WorldState): StagePolicy {
  throw new Error('not landed');
}
