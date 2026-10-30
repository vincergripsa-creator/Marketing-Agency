/** Which channels the company buys on (channels §7). Dormant until P5.1: TikTok alone, last click (D47). */
import type { ChannelId, WorldState } from '../shared.js';
import { allocationMorning } from './allocator.js';
import type { Pillar } from './pillars.js';

export function ensureChannelBook(_w: WorldState): void {
  /* P5.1: only when channelControl is not 'tiktok_only' */
}

export function openChannels(_w: WorldState): ChannelId[] {
  return ['tiktok'];
}

export function multiChannel(_w: WorldState): boolean {
  return false;
}

/** Reconciled credit of a (channel, niche). 1 = the shop's last click, as long as no report exists. */
export function creditOf(_w: WorldState, _ch: ChannelId, _nicheId: string): number {
  return 1;
}

export const channelsPillar: Pillar = {
  mount: ensureChannelBook,
  morning: allocationMorning,
};
