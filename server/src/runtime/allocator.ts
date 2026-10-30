/** Budget between channels (channels §7.4). Dormant until P5.2: with one channel there is nothing to allocate. */
import type { Campaign, WorldState } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';

/** The plan's daily budget for a campaign; null keeps today's scale and trim rules (D26). */
export function planTarget(_w: WorldState, _c: Campaign): number | null {
  return null;
}

/** Ritual allocate_channels, once 2 channels have active campaigns. */
export async function allocationMorning(_ctx: RuntimeCtx): Promise<void> {
  /* P5.2 */
}
