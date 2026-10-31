/**
 * Every number of the market's channels (channels §3, §4, §5.1). Hidden truth, like balance.ts, and apart from it: the one
 * calibration reaches them through applyOverrides, and balance.ts stays frozen until S14.
 */
import type { AdFormat, ChannelId } from '../shared.js';

/** A number is given once and for good. `truth` keys the cells of a seed; the others hang on the day's key. */
export const CHANNEL_STREAM = { truth: 0xc4a701, ads: 1001, organic: 1002, tails: 1003, claims: 1004, events: 1005, comments: 1006, signals: 1007, reviews: 1008 } as const;

export const CHANNEL_VARIATION = { fit: 0.25, cost: 0.15, intent: 0.15 };

export type PaidChannel = Exclude<ChannelId, 'tiktok'>;

/**
 * Google is Search: no fatigue, no pool (its queries cap it, see SEARCH), and only its landing rate, intent and moderation
 * numbers are read. YouTube and Search share one account, so they share strikes and banDays.
 */
export const CHANNEL_SIM: Record<PaidChannel, {
  cpmMult: number; ctrScale: number; intent: number; landingRate: number; fatigue: number; pool: number; overlap: number;
  affinityExp: number; falsePositive: number; strikes: number; banDays: number;
}> = {
  meta:      { cpmMult: 1.40, ctrScale: 0.62, intent: 2.10, landingRate: 0.80, fatigue: 110_000, pool: 1.3, overlap: 0.35, affinityExp: 1.6, falsePositive: 0.20, strikes: 3, banDays: 14 },
  youtube:   { cpmMult: 0.62, ctrScale: 0.50, intent: 1.15, landingRate: 0.72, fatigue:  90_000, pool: 0.7, overlap: 0.30, affinityExp: 2.0, falsePositive: 0.06, strikes: 2, banDays: 7 },
  pinterest: { cpmMult: 0.70, ctrScale: 0.45, intent: 1.20, landingRate: 0.90, fatigue: 240_000, pool: 0.8, overlap: 0.15, affinityExp: 0.8, falsePositive: 0.08, strikes: 3, banDays: 10 },
  google:    { cpmMult: 1,    ctrScale: 1,    intent: 2.80, landingRate: 0.92, fatigue: 1e12,    pool: 0,   overlap: 0,    affinityExp: 1,   falsePositive: 0.06, strikes: 2, banDays: 7 },
};

/** How much of the other channels' views also lands in TikTok's pool. TikTok's other numbers stay in ADS. */
export const TIKTOK_OVERLAP = 0.3;

export const FORMAT_FIT: Record<PaidChannel, Partial<Record<AdFormat, number>>> = {
  meta: { carousel: 1.15, ugc_avatar: 1.1, static_image: 1, faceless_voiceover: 0.95, text_slideshow: 0.9 },
  youtube: { faceless_voiceover: 1.15, ugc_avatar: 1, text_slideshow: 0.8 },
  pinterest: { static_image: 1, carousel: 0.9, faceless_voiceover: 0.7, text_slideshow: 0.7 },
  google: {},
};

/** Authored fit `[meta, youtube, pinterest, google]`, then Search clicks a day at demand 1, then CPC in €. */
export type ChannelFitRow = readonly [number, number, number, number, number, number];
export const CHANNEL_FIT: Record<string, ChannelFitRow> = {
  'sommeil-bebe':         [0.85, 0.45, 0.40, 0.80, 70, 0.55],
  'dme-diversification':  [0.80, 0.45, 0.70, 0.60, 35, 0.45],
  'proprete-chiot':       [0.70, 0.65, 0.30, 0.75, 55, 0.50],
  'chat-griffe-canape':   [0.60, 0.50, 0.35, 0.55, 35, 0.40],
  'oral-aide-soignante':  [0.70, 0.55, 0.20, 0.85, 45, 0.45],
  'urssaf-micro':         [0.60, 0.55, 0.15, 0.95, 90, 0.90],
  'freelance-linkedin':   [0.50, 0.50, 0.20, 0.50, 35, 1.40],
  'potager-balcon':       [0.75, 0.70, 0.90, 0.55, 35, 0.35],
  'ventre-apres-40':      [0.75, 0.45, 0.60, 0.60, 45, 1.10],
  'toeic-800':            [0.40, 0.80, 0.25, 0.85, 50, 0.70],
  'batch-cooking-budget': [0.60, 0.55, 0.90, 0.45, 30, 0.35],
  'mariage-moins-10k':    [0.70, 0.45, 0.95, 0.65, 40, 0.60],
  'revendre-vinted':      [0.55, 0.60, 0.30, 0.45, 25, 0.50],
  'japon-petit-budget':   [0.60, 0.80, 0.75, 0.65, 35, 0.55],
  'stress-bac':           [0.30, 0.60, 0.25, 0.40, 25, 0.40],
  'relooker-meuble':      [0.70, 0.70, 0.95, 0.45, 30, 0.35],
};
/** A niche added later. */
export const CHANNEL_FIT_DEFAULT: ChannelFitRow = [0.5, 0.5, 0.4, 0.5, 35, 0.6];

/** While a campaign learns: CTR × ctr, CPM × cpm, about -23 % ROAS. A raise above `raise` starts the phase over. */
export const LEARNING = { ctr: 0.85, cpm: 1.1, raise: 0.3 };

export const SEARCH = { baseCtr: 0.05, cpc: { min: 0.55, span: 1.1, exp: 1.5 }, qualityRef: 70, qualityCpcExp: 0.5, fitReach: { min: 0.6, span: 0.4 }, minRelevance: 0.5, maxRelevance: 1.3, bisections: 20 };

/** Paid exposure warms a niche, Search alone reads it: part of its last-click revenue was caused elsewhere. */
export const ASSIST = { decay: 0.8, weights: { tiktok: 1, meta: 1, youtube: 0.7, pinterest: 0.5 } as Partial<Record<ChannelId, number>>, halfStock: 0.5, maxLift: 0.6 };

/** Share of what a creative's family showed on the other channels that weighs on its fatigue here. */
export const FAMILY_FATIGUE = 0.25;

/** A paid pin keeps earning: free clicks on the 3 days after, as a share of the clicks paid for. */
export const PAID_TAIL = { channel: 'pinterest' as PaidChannel, shares: [0.25, 0.12, 0.06] as readonly number[], noiseSd: 0.3 };

/** `greed` stands for each platform's attribution window: Meta and Pinterest count views and long clicks, Search its own clicks. */
export const CLAIMS = { touchShare: 0.02, noiseSd: 0.25, greed: { tiktok: 0.35, meta: 0.60, youtube: 0.45, pinterest: 0.55, google: 0.10 } as Record<ChannelId, number> };

/** The silent drift: no event, the agency only sees the numbers move. It is why testing never ends. */
export const CHANNEL_EVENTS = { drift: { chance: 0.03, down: 0.75, up: 1.25 } };

/** What a planner tool says of a price: CPM and CPC limits of `bas` and `moyen`, and Keyword Planner's ±30 %. */
export const COST_HINT = { cpm: [6, 9] as const, cpc: [0.5, 0.9] as const, planner: 0.3 };
