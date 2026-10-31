/** The company's rules on channels (channels §7). Nothing hidden here: the market's own numbers live in sim/channelBalance.ts. */
import type { ChannelId, RoleId } from '../shared.js';

export const CHANNEL_POLICY = {
  unlock: {
    meta: { sales: 15, roas14d: 1.0 },              // TikTok proved the offer sells
    youtube: { cash: 300, masterQuality: 70 },      // an approved 9:16 worth reusing
    pinterest: { cash: 200, minRunwayDays: 21 },    // pays late
    google: { reviews: 5, rating: 4.0, pageQuality: 75 }, // landing quality
  },
  testShare: 0.2,          // of adCap
  maxTests: 3,
  retestDays: 14,
  retestCategoryMean: 0.45, // a killed line comes back early when its category does this well on the channel
  prove: { roas: 1.1, kill: 0.8, keep: 1.0, spendTimes: 3, extendOnce: true },
  rejections: 2,           // rule rejections before a (channel, niche) stops submitting
  lineKill: { losers: 2, spendTimes: 3, roas: 0.8 },
  channelKill: { days: 14, spend: 150, roas: 0.7, reopenDays: 14 },
  alloc: { windowDays: 10, minDays: 4, minSpendDay: 3, kappa: 1, floorRoas: 1.15, maxStep: 0.3, maxLineShare: 0.6, priorElasticity: { cpm: 0.75, cpc: 0.4, retarget: 0.35 }, trimDays: 3 },
  categoryPriorMax: 4,
  reward: { minSpend: 3, roasScale: 3, weightSpend: 20, weightMin: 0.5, weightMax: 3, categoryShare: 0.5 },
} as const;

/** Who buys on each channel. One buyer, one Google account: YouTube and Search share theirs. */
export const CHANNEL_ROLE: Record<ChannelId, RoleId> = {
  tiktok: 'media_buyer_tiktok',
  meta: 'media_buyer_meta',
  youtube: 'media_buyer_google',
  google: 'media_buyer_google',
  pinterest: 'media_buyer_pinterest',
};
