/** How many buyers a niche holds a day, on each channel (channels §3.5). */
import type { ChannelId, NicheTruth, WorldState } from '../shared.js';
import { CONVERSION } from './balance.js';
import { cellOf } from './channels.js';

/** Landing views a niche absorbs on a channel before saturating. Channels add room: that is how they scale the agency. */
export function nichePool(_w: WorldState, n: NicheTruth, channel: ChannelId = 'tiktok'): number {
  const pool = CONVERSION.poolBase + CONVERSION.poolDemand * n.demand;
  return channel === 'tiktok' ? pool : pool * cellOf(n, channel).poolShare;
}

/**
 * Share of a channel's views that still finds a buyer today. Pools are neither shared nor apart: `overlap` of the other
 * channels' views lands in this one too. With no other views, this is the one-pool formula the market always had.
 */
export function poolSaturation(pool: number, views: number, others: number, overlap: number): number {
  const eff = views + overlap * others;
  return eff > 0 ? (pool * (1 - Math.exp(-eff / pool))) / eff : 1;
}
