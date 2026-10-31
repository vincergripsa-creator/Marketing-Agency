/**
 * One ChannelAdapter per platform: the seam the real ad APIs plug into in phase 3 (channels §2.3). In V1 each one is the
 * virtual market's tools with its channel filled in, so it holds no rule of its own and never reads the market.
 */
import type { ChannelAdapter, MarketTools } from '../contracts.js';
import type { ChannelId } from '../shared.js';

export function virtualAdapter(id: ChannelId, tools: Pick<MarketTools, 'submitCreative' | 'createCampaign' | 'updateCampaign' | 'getPlatformReport'>): ChannelAdapter {
  return {
    id,
    review: (creativeId) => tools.submitCreative(creativeId, id),
    createCampaign: (input) => tools.createCampaign(id === 'tiktok' ? input : { ...input, channel: id }),
    updateCampaign: (campaignId, patch) => tools.updateCampaign(campaignId, patch),
    report: (sinceDay) => tools.getPlatformReport(id, sinceDay),
  };
}
