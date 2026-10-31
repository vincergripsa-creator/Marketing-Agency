/**
 * Observable metrics the managers reason with (ads stats, orders, inbox) and the CFO's daily budget.
 * Only reads data the company can legitimately see — never the market's hidden truth.
 */
import type { Campaign, DailyAdStats, Product, WorldState } from '../shared.js';
import { sim } from './modules.js';
import { ORG } from './org/constants.js';
import { payrollToday, SURVIVAL_CASH } from './org/payroll.js';
import { median, round2, sum, strArr } from './util.js';

export interface WindowMetrics {
  spend: number; revenue: number; adRevenue: number; impressions: number; clicks: number; landingViews: number;
  sales: number; adPurchases: number; refunds: number; refundRate: number; ctr: number; roas: number; days: number;
}

/**
 * Product metrics from `sinceDay` (inclusive). ROAS = all revenue (net of refunds) / ad spend; Infinity when no spend
 * but sales. Announced outage days are left out of the ad figures: nothing could sell, they measure nothing.
 */
export function productMetrics(world: WorldState, productId: string, sinceDay = 1): WindowMetrics {
  const outage = sim.announcedOutageDays(world);
  const ads = world.market.adStats.filter((s) => s.productId === productId && s.day >= sinceDay && !outage.includes(s.day));
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

/** An upsell lives off its parent's buyers, so only while the parent is on sale: an orphan is a guide like any other. */
export function isUpsellProduct(world: WorldState, productId: string): boolean {
  return world.company.products.some((p) => p.upsellProductId === productId && p.id !== productId && p.status === 'live');
}

export function parentOf(world: WorldState, productId: string): Product | undefined {
  return world.company.products.find((p) => p.upsellProductId === productId && p.id !== productId);
}

/** A follow-up with at least this share of the new text of the guide it follows is worth its price. */
const FOLLOW_UP_DEPTH = 0.9;

/**
 * The highest price a follow-up can be sold at, null when `p` follows nothing: never above the guide it follows,
 * and below it as long as it holds less to read. A buyer compares the two side by side on the last page.
 */
export function followUpLimit(world: WorldState, p: Product): number | null {
  const parent = parentOf(world, p.id);
  if (!parent || !(parent.price > 0)) return null;
  const deep = !!p.content && !!parent.content && sim.guideSubstance(p.content).freshWords >= sim.guideSubstance(parent.content).freshWords * FOLLOW_UP_DEPTH;
  return deep ? parent.price : parent.price - 1;
}

/** Insults and jokes say nothing about the guide, and neither does a review of the support: a brief is built on what readers say about the content. */
const NOT_FEEDBACK = /\b(fuyez|arnaques?|escrocs?|vendeurs? de vent|mdr|lol|ptdr|ratio|pigeons?|bouffons?|clowns?)\b|n['’]est pas possible|pas achet|\bsupport\b|service client|z[ée]ro r[ée]ponse/i;

export function isProductFeedback(text: string): boolean {
  return !NOT_FEEDBACK.test(text);
}

/** The author really bought this product: what we can check on our own orders, without guessing who is a troll. */
export function fromBuyer(world: WorldState, messageId: unknown, productId: string): boolean {
  const msg = world.market.inbox.find((m) => m.id === messageId);
  return !!msg?.orderId && world.market.orders.some((o) => o.id === msg.orderId && o.productId === productId);
}

/** Quality complaints as DETECTED by our support agents, from real buyers (not the hidden ground truth). */
export function detectedComplaints(world: WorldState, productId: string, sinceDay = 1): number {
  let n = 0;
  for (const t of world.company.tasks) {
    if (t.kind !== 'reply_inbox' || t.status !== 'done' || !t.output || (t.dayDone ?? 0) < sinceDay) continue;
    const replies = Array.isArray(t.output.replies) ? (t.output.replies as Record<string, unknown>[]) : [];
    for (const r of replies) if (r.productId === productId && r.detected === 'plainte_qualite' && fromBuyer(world, r.messageId, productId)) n++;
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

// ───────────────────────────── price evidence ─────────────────────────────

/** Paid landing views needed at a price before it counts as measured (revenue per visitor). */
export const PRICE_EVIDENCE_VIEWS = 150;
/** A price earning less than this share of the best measured price per visitor has lost. */
export const PRICE_ROLLBACK_RATIO = 0.85;
/** With no measure above the best price, buyers are assumed to accept this much over what the market pays. */
export const MARKET_PRICE_MARGIN = 1.25;

export interface PriceTier { price: number; views: number; revenue: number; rpv: number }

/** What each price really earned per paid visitor (the price of a day = the last one set on or before it). */
export function priceTiers(world: WorldState, p: Product): PriceTier[] {
  const priceOn = (day: number): number => {
    let price = p.priceHistory[0]?.price ?? p.price;
    for (const h of p.priceHistory) if (h.day <= day) price = h.price;
    return price;
  };
  const tiers = new Map<number, { views: number; revenue: number }>();
  for (const s of world.market.adStats) {
    if (s.productId !== p.id) continue;
    const t = tiers.get(priceOn(s.day)) ?? { views: 0, revenue: 0 };
    t.views += s.landingViews;
    t.revenue += s.revenue;
    tiers.set(priceOn(s.day), t);
  }
  return [...tiers].map(([price, t]) => ({ price, ...t, rpv: t.views > 0 ? t.revenue / t.views : 0 })).sort((a, b) => a.price - b.price);
}

/**
 * How high buyers have shown they will go. Measured prices decide: above the best measured price, a tier that earned
 * less per visitor is a wall. Where nothing was measured yet, one step is allowed up to what the market pays (median of
 * customers' anchors and competitors), not the highest anchor anyone ever quoted.
 */
export function priceCeiling(world: WorldState, p: Product): { ceiling: number; why: string } {
  const measured = measuredCeiling(world, p);
  const limit = followUpLimit(world, p);
  return limit !== null && limit < measured.ceiling ? { ceiling: limit, why: 'une suite ne se vend pas plus cher que le guide qu’elle prolonge' } : measured;
}

function measuredCeiling(world: WorldState, p: Product): { ceiling: number; why: string } {
  const { research } = world.company;
  const anchors = (research.voc[p.nicheId]?.priceAnchors ?? []).filter((x) => x > 0);
  const rivals = (research.competitors[p.nicheId] ?? []).map((c) => c.price).filter((x) => x > 0);
  const market = Math.max(median(anchors) ?? 0, median(rivals) ?? 0);
  const marketCap = market > 0 ? market * MARKET_PRICE_MARGIN : 49;
  const measured = priceTiers(world, p).filter((t) => t.views >= PRICE_EVIDENCE_VIEWS);
  if (!measured.length) return { ceiling: marketCap, why: `marché à ${round2(market)} €` };
  const best = measured.reduce((a, b) => (b.rpv > a.rpv ? b : a));
  const proven = Math.max(...measured.filter((t) => t.rpv >= best.rpv * PRICE_ROLLBACK_RATIO).map((t) => t.price));
  if (measured.some((t) => t.price > proven)) return { ceiling: proven, why: `au-dessus de ${proven} €, le revenu par visiteur baisse` };
  return { ceiling: Math.max(proven, marketCap), why: `${proven} € tient, le marché paie ${round2(market)} €` };
}

// ───────────────────────────── CFO budget ─────────────────────────────

export interface Budget { adCap: number; survival: boolean; cash: number; runwayDays: number | null; rate: number; bankrupt: boolean; outage: boolean }

/** Daily ad envelope: ≤ 15 % of the cash left once a week of pay is set aside, ≤ 8 % if runway < 14 days, 0 when bankrupt or on an announced outage day; survival below 30 % of start. */
export function computeBudget(world: WorldState): Budget {
  const fin = sim.financeSnapshot(world);
  const start = Math.max(1, world.scenario.startingCash);
  const lowRunway = fin.runwayDays !== null && fin.runwayDays < 14;
  const rate = lowRunway ? 0.08 : 0.15;
  const bankrupt = fin.bankrupt || fin.cash < 0 || world.status === 'bankrupt';
  const outage = sim.isAnnouncedOutage(world, world.day);
  const adCap = bankrupt || outage || fin.cash <= 0 ? 0 : round2(Math.max(0, fin.cash - ORG.adReserveDays * payrollToday(world)) * rate);
  return { adCap, survival: fin.cash < SURVIVAL_CASH * start, cash: round2(fin.cash), runwayDays: fin.runwayDays, rate, bankrupt, outage };
}

/** Today's budget as decided by the CFO this morning (falls back to a live computation). */
export function currentBudget(world: WorldState): Budget {
  for (let i = world.company.tasks.length - 1; i >= 0; i--) {
    const t = world.company.tasks[i]!;
    if (t.kind === 'budget_review' && t.status === 'done' && t.dayDone === world.day && t.output && typeof t.output.adCap === 'number') {
      const o = t.output;
      return {
        adCap: o.adCap as number, survival: o.survival === true, cash: Number(o.cash ?? 0),
        runwayDays: typeof o.runwayDays === 'number' ? o.runwayDays : null, rate: Number(o.rate ?? 0.15), bankrupt: o.bankrupt === true, outage: o.outage === true,
      };
    }
  }
  return computeBudget(world);
}

/** Sum of the daily budgets of active campaigns (optionally excluding one). */
export function committedAdBudget(world: WorldState, exceptCampaignId?: string): number {
  return round2(sum(activeCampaigns(world).filter((c) => c.id !== exceptCampaignId).map((c) => c.dailyBudget)));
}
