/** A niche's daily buyer pool. P4.1 gives it `channel` and runSales calls it. */
import type { ChannelId, NicheTruth, WorldState } from '../shared.js';
import { CONVERSION } from './balance.js';

export function nichePool(_w: WorldState, n: NicheTruth, _channel?: ChannelId): number {
  return CONVERSION.poolBase + CONVERSION.poolDemand * n.demand;
}
