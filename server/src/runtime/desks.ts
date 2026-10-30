/** Stable desks of the pixel world (ui §2.1). Dormant until P12.1: the client derives a desk while none is set. */
import type { WorldState } from '../shared.js';
import type { Pillar } from './pillars.js';

export function syncDesks(_world: WorldState): void {
  /* P12.1 */
}

export const desksPillar: Pillar = { stepEnd: syncDesks };
