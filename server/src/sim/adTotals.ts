/** A creative's ad figures added up: market.adStats only keeps the last days, a creative's card tells its whole life. */
import { round2 } from '../core/index.js';
import type { CreativeAdTotals, DailyAdStats } from '../shared.js';

export function addAdTotals(totals: Record<string, CreativeAdTotals>, row: DailyAdStats): void {
  const t = (totals[row.creativeId] ??= { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0, lastDay: 0 });
  t.spend = round2(t.spend + row.spend);
  t.impressions += row.impressions;
  t.clicks += row.clicks;
  t.purchases += row.purchases;
  t.revenue = round2(t.revenue + row.revenue);
  if (row.impressions > 0) t.lastDay = Math.max(t.lastDay, row.day);
}
