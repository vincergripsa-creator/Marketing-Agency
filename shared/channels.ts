/** shared/channels.ts (new). Public facts: the UI and the agents may read them. */
import type { AdFormat, AdRatio } from './types.js';

export type ChannelId = 'tiktok' | 'meta' | 'youtube' | 'pinterest' | 'google';
export const CHANNEL_IDS: readonly ChannelId[] = ['tiktok', 'meta', 'youtube', 'pinterest', 'google'];

/** YouTube and Search share Google's account: a Google ban stops both. */
export type AdAccountId = 'tiktok' | 'meta' | 'google' | 'pinterest';

export interface ChannelPublic {
  id: ChannelId;
  label: string;            // 'TikTok', 'Facebook & Instagram', 'YouTube Shorts', 'Pinterest', 'Google Search'
  glyph: string;            // 2 letters for the totem: 'TK', 'FB', 'YT', 'PI', 'GO'
  color: string;            // hex
  account: AdAccountId;
  buying: 'cpm' | 'cpc';
  minDailyBudget: number;
  accepts: { format: AdFormat; ratio: AdRatio; fit: number }[]; // fit: public best-practice CTR factor of that ratio
  learning: { events: number; days: number } | null;
  stopLossSpend: number;
  testDays: number;
  verificationDays: number; // account review before the first campaign
}

const VIDEO: readonly AdFormat[] = ['faceless_voiceover', 'text_slideshow', 'ugc_avatar'];
const FEED: readonly AdFormat[] = [...VIDEO, 'carousel', 'static_image'];
const accepts = (formats: readonly AdFormat[], ratio: AdRatio, fit: number): ChannelPublic['accepts'] =>
  formats.map((format) => ({ format, ratio, fit }));

export const CHANNELS: Record<ChannelId, ChannelPublic> = {
  tiktok: {
    id: 'tiktok', label: 'TikTok', glyph: 'TK', color: '#ff0050', account: 'tiktok', buying: 'cpm', minDailyBudget: 5,
    accepts: accepts([...VIDEO, 'carousel'], '9:16', 1),
    learning: null, stopLossSpend: 25, testDays: 3, verificationDays: 0,
  },
  meta: {
    id: 'meta', label: 'Facebook & Instagram', glyph: 'FB', color: '#1877f2', account: 'meta', buying: 'cpm', minDailyBudget: 12,
    accepts: [...accepts(FEED, '4:5', 1), ...accepts(FEED, '1:1', 0.95), ...accepts(FEED, '9:16', 0.85)],
    learning: { events: 12, days: 7 }, stopLossSpend: 45, testDays: 5, verificationDays: 3,
  },
  youtube: {
    id: 'youtube', label: 'YouTube Shorts', glyph: 'YT', color: '#ff0000', account: 'google', buying: 'cpm', minDailyBudget: 8,
    accepts: accepts(VIDEO, '9:16', 1),
    learning: null, stopLossSpend: 30, testDays: 3, verificationDays: 1,
  },
  pinterest: {
    id: 'pinterest', label: 'Pinterest', glyph: 'PI', color: '#e60023', account: 'pinterest', buying: 'cpm', minDailyBudget: 6,
    accepts: [...accepts(['static_image'], '2:3', 1), ...accepts(['carousel'], '2:3', 0.9), ...accepts(VIDEO, '9:16', 0.7)],
    learning: { events: 6, days: 5 }, stopLossSpend: 30, testDays: 4, verificationDays: 1,
  },
  google: {
    id: 'google', label: 'Google Search', glyph: 'GO', color: '#34a853', account: 'google', buying: 'cpc', minDailyBudget: 6,
    accepts: accepts(['search_text'], 'text', 1),
    learning: { events: 8, days: 5 }, stopLossSpend: 25, testDays: 3, verificationDays: 2,
  },
};

export const channelOf = (x: { channel?: ChannelId }): ChannelId => x.channel ?? 'tiktok';

/** The ratio factor of a creative on a channel, null when the channel refuses it. An absent ratio is 9:16. */
export function acceptance(ch: ChannelId, c: { format: AdFormat; ratio?: AdRatio }): number | null {
  const ratio = c.ratio ?? '9:16';
  return CHANNELS[ch].accepts.find((a) => a.format === c.format && a.ratio === ratio)?.fit ?? null;
}
