/**
 * Observable metrics the managers reason with (ads stats, orders, inbox) and the CFO's daily budget.
 * Only reads data the company can legitimately see — never the market's hidden truth.
 */
import type { Campaign, DailyAdStats, Product, WorldState } from '../shared.js';
import { sim } from './modules.js';
import { round2, sum, strArr } from './util.js';

export interface WindowMetrics {
  spend: number; revenue: number; adRevenue: number; impressions: number; clicks: number; landingViews: number;
  sales: number; adPurchases: number; refunds: number; refundRate: number; ctr: number; roas: number; days: number;
}

/** Product metrics from `sinceDay` (inclusive). ROAS = all revenue (net of refunds) / ad spend; Infinity when no spend but sales. */
export function productMetrics(world: WorldState, productId: string, sinceDay = 1): WindowMetrics {
  const ads = world.market.adStats.filter((s) => s.productId === productId && s.day >= sinceDay);
  const orders = world.market.orders.filter((o) => o.productId === productId && o.day >= sinceDay);
  const spend = sum(ads.map((s) => s.spend));
  const revenue = sum(orders.filter((o) => !o.refunded && !o.chargeback).map((o) => o.price));
  const impressions = sum(ads.map((s) => s.impressions));
  const clicks = sum(ads.map((s) => s.clicks));
  const refunds = orders.filter((o) => o.refunded || o.chargeback).length;
  return {
    spend: round2(spend),
    revenue: round2(revenue),
    adRevenue: round2(sum(ads.map((s) => s.revenue))),
    impressions, clicks,
    landingViews: sum(ads.map((s) => s.landingViews)),
    sales: orders.length,
    adPurchases: sum(ads.map((s) => s.purchases)),
    refunds,
    refundRate: orders.length ? refunds / orders.length : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    roas: spend > 0 ? revenue / spend : revenue > 0 ? Number.POSITIVE_INFINITY : 0,
    days: Math.max(1, world.day - sinceDay + 1),
  };
}

export interface CampaignMetrics { spend: number; revenue: number; roas: number; impressions: number; clicks: number; ctr: number; purchases: number; rows: DailyAdStats[] }

export function campaignMetrics(stats: readonly DailyAdStats[], campaignId: string, sinceDay = 1): CampaignMetrics {
  const rows = stats.filter((s) => s.campaignId === campaignId && s.day >= sinceDay);
  const spend = sum(rows.map((r) => r.spend));
  const revenue = sum(rows.map((r) => r.revenue));
  const impressions = sum(rows.map((r) => r.impressions));
  const clicks = sum(rows.map((r) => r.clicks));
  return {
    spend: round2(spend), revenue: round2(revenue), roas: spend > 0 ? revenue / spend : 0,
    impressions, clicks, ctr: impressions > 0 ? clicks / impressions : 0, purchases: sum(rows.map((r) => r.purchases)), rows,
  };
}

export function activeCampaigns(world: WorldState, productId?: string): Campaign[] {
  return world.company.campaigns.filter((c) => c.status === 'active' && (!productId || c.productId === productId));
}

export function isUpsellProduct(world: WorldState, productId: string): boolean {
  return world.company.products.some((p) => p.upsellProductId === productId && p.id !== productId);
}

export function parentOf(world: WorldState, productId: string): Product | undefined {
  return world.company.products.find((p) => p.upsellProductId === productId && p.id !== productId);
}

/** Quality complaints as DETECTED by our support agents (not the hidden ground truth). */
export function detectedComplaints(world: WorldState, productId: string, sinceDay = 1): number {
  let n = 0;
  for (const t of world.company.tasks) {
    if (t.kind !== 'reply_inbox' || t.status !== 'done' || !t.output || (t.dayDone ?? 0) < sinceDay) continue;
    const replies = Array.isArray(t.output.replies) ? (t.output.replies as Record<string, unknown>[]) : [];
    for (const r of replies) if (r.productId === productId && r.detected === 'plainte_qualite') n++;
  }
  return n;
}

/** Message ids already claimed by an open reply task. */
export function claimedMessageIds(world: WorldState): Set<string> {
  const s = new Set<string>();
  for (const t of world.company.tasks) {
    if ((t.kind !== 'reply_inbox' && t.kind !== 'handle_refund') || !['pending', 'in_progress', 'review', 'awaiting_founder'].includes(t.status)) continue;
    for (const id of strArr(t.input.messageIds)) s.add(id);
    if (typeof t.input.messageId === 'string') s.add(t.input.messageId);
  }
  return s;
}

// ───────────────────────────── CFO budget ─────────────────────────────

export interface Budget { adCap: number; survival: boolean; cash: number; runwayDays: number | null; rate: number; bankrupt: boolean }

/** Daily ad envelope: ≤ 15 % of cash, ≤ 8 % if runway < 14 days, 0 when bankrupt; survival below 30 % of start. */
export function computeBudget(world: WorldState): Budget {
  const fin = sim.financeSnapshot(world);
  const start = Math.max(1, world.scenario.startingCash);
  const lowRunway = fin.runwayDays !== null && fin.runwayDays < 14;
  const rate = lowRunway ? 0.08 : 0.15;
  const bankrupt = fin.bankrupt || fin.cash < 0 || world.status === 'bankrupt';
  const adCap = bankrupt || fin.cash <= 0 ? 0 : round2(fin.cash * rate);
  return { adCap, survival: fin.cash < 0.3 * start, cash: round2(fin.cash), runwayDays: fin.runwayDays, rate, bankrupt };
}

/** Today's budget as decided by the CFO this morning (falls back to a live computation). */
export function currentBudget(world: WorldState): Budget {
  for (let i = world.company.tasks.length - 1; i >= 0; i--) {
    const t = world.company.tasks[i]!;
    if (t.kind === 'budget_review' && t.status === 'done' && t.dayDone === world.day && t.output && typeof t.output.adCap === 'number') {
      const o = t.output;
      return {
        adCap: o.adCap as number, survival: o.survival === true, cash: Number(o.cash ?? 0),
        runwayDays: typeof o.runwayDays === 'number' ? o.runwayDays : null, rate: Number(o.rate ?? 0.15), bankrupt: o.bankrupt === true,
      };
    }
  }
  return computeBudget(world);
}

/** Sum of the daily budgets of active campaigns (optionally excluding one). */
export function committedAdBudget(world: WorldState, exceptCampaignId?: string): number {
  return round2(sum(activeCampaigns(world).filter((c) => c.id !== exceptCampaignId).map((c) => c.dailyBudget)));
}
