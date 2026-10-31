/**
 * Observable metrics the managers reason with (ads stats, orders, inbox) and the CFO's daily budget.
 * Only reads data the company can legitimately see — never the market's hidden truth.
 */
import { SETUP_REF, isHold } from '../core/index.js';
import { CHANNEL_IDS, channelOf } from '../shared.js';
import type { Campaign, ChannelId, DailyAdStats, Order, Product, Task, WorldState } from '../shared.js';
import { recentReviews } from '../sim/feedback.js';
import { COMPACT } from './compaction.js';
import { sim } from './modules.js';
import { ORG } from './org/constants.js';
import { payrollToday, SURVIVAL_CASH } from './org/payroll.js';
import { growthOn } from './stages.js';
import { median, round2, sum, strArr } from './util.js';

export interface WindowMetrics {
  spend: number; revenue: number; adRevenue: number; impressions: number; clicks: number; landingViews: number;
  sales: number; adPurchases: number; refunds: number; refundRate: number; ctr: number; roas: number; days: number;
}

/**
 * Product metrics from `sinceDay` (inclusive). ROAS = all revenue (net of refunds) / ad spend; Infinity when no spend
 * but sales. Announced outage days are left out of the ad figures: nothing could sell, they measure nothing. A window
 * reaches back as far as the orders the world keeps, compacted or not: the whole life of a guide is on `p.stats`.
 */
export function productMetrics(world: WorldState, productId: string, from = 1): WindowMetrics {
  const sinceDay = Math.max(from, world.day - COMPACT.orderDays + 1);
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

/** An upsell lives off its parent's buyers, so only while the parent is on sale: an orphan is a guide like any other. A kit only ever sells at checkout: no cold ads, never judged alone. */
export function isUpsellProduct(world: WorldState, productId: string): boolean {
  return world.company.products.some((p) => (p.id === productId ? p.kind === 'kit' : p.upsellProductId === productId && p.status === 'live'));
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

/** Most complaints a product remembers. */
const FEEDBACK_KEPT = 30;

type Feedback = NonNullable<Product['feedback']>;

/** What the buyers of a finished reply task said about one product. Whether they bought is read now: their message leaves the inbox. */
function feedbackIn(world: WorldState, t: Task, productId: string): Feedback {
  const replies = Array.isArray(t.output?.replies) ? (t.output.replies as Record<string, unknown>[]) : [];
  return replies.flatMap((r) => {
    const quality = r.detected === 'plainte_qualite';
    const text = typeof r.complaint === 'string' ? r.complaint : '';
    return r.productId === productId && (quality || text) && fromBuyer(world, r.messageId, productId) ? [{ day: t.dayDone ?? 0, text, quality }] : [];
  });
}

/** What support heard about a product: kept on it once a reply closed, or read off the tasks of a world that has none yet. */
export function feedbackOf(world: WorldState, productId: string): Feedback {
  const kept = world.company.products.find((p) => p.id === productId)?.feedback;
  return kept ?? world.company.tasks.filter((t) => t.kind === 'reply_inbox' && t.status === 'done').flatMap((t) => feedbackIn(world, t, productId));
}

/** The moment a reply task closes: its row leaves the world in three weeks, a complaint counts as long as the version it is about. */
export function recordFeedback(world: WorldState, task: Task): void {
  const replies = Array.isArray(task.output?.replies) ? (task.output.replies as Record<string, unknown>[]) : [];
  for (const p of world.company.products) {
    if (!replies.some((r) => r.productId === p.id)) continue;
    const said = p.feedback ? [...p.feedback, ...feedbackIn(world, task, p.id)] : feedbackOf(world, p.id);
    p.feedback = said.slice(-FEEDBACK_KEPT);
  }
}

/** Quality complaints as DETECTED by our support agents, from real buyers (not the hidden ground truth). */
export function detectedComplaints(world: WorldState, productId: string, sinceDay = 1): number {
  return feedbackOf(world, productId).filter((f) => f.quality && f.day >= sinceDay).length;
}

export { recentReviews };

/** Every review a product ever had: its list keeps the latest only. */
export function reviewCount(p: Product): number {
  return Math.max(p.stats.ratingCount ?? 0, p.stats.reviews.length);
}

/** Its true average, unrounded: 0 without a review. */
export function averageRating(p: Product): number {
  const { stats } = p;
  const count = reviewCount(p);
  const total = count > stats.reviews.length ? stats.ratingSum! : stats.reviews.reduce((s, r) => s + r.rating, 0);
  return count ? total / count : 0;
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

/** Days a product's reference channel is read on. */
const REFERENCE_DAYS = 14;

/**
 * The channel a product's price is read on: most landing views in 14 days. Intent differs by channel, so a mix shift
 * would otherwise look like a price effect (channels §5.3). TikTok when nothing ran, and always with TikTok alone.
 */
export function referenceChannel(world: WorldState, productId: string): ChannelId {
  const views = new Map<ChannelId, number>();
  for (const s of world.market.adStats) {
    if (s.productId === productId && s.day > world.day - REFERENCE_DAYS) views.set(channelOf(s), (views.get(channelOf(s)) ?? 0) + s.landingViews);
  }
  return CHANNEL_IDS.reduce<ChannelId>((best, ch) => ((views.get(ch) ?? 0) > (views.get(best) ?? 0) ? ch : best), 'tiktok');
}

/** Landing views and purchases of a product on its reference channel from `sinceDay`, announced outage days out. */
export function paidConversion(world: WorldState, productId: string, sinceDay: number): { landingViews: number; purchases: number } {
  const outage = sim.announcedOutageDays(world);
  const channel = referenceChannel(world, productId);
  const rows = world.market.adStats.filter((s) => s.productId === productId && s.day >= sinceDay && channelOf(s) === channel && !outage.includes(s.day));
  return { landingViews: sum(rows.map((s) => s.landingViews)), purchases: sum(rows.map((s) => s.purchases)) };
}

/** What each price really earned per paid visitor (the price of a day = the last one set on or before it). */
export function priceTiers(world: WorldState, p: Product): PriceTier[] {
  const priceOn = (day: number): number => {
    let price = p.priceHistory[0]?.price ?? p.price;
    for (const h of p.priceHistory) if (h.day <= day) price = h.price;
    return price;
  };
  const tiers = new Map<number, { views: number; revenue: number }>();
  const channel = referenceChannel(world, p.id);
  for (const s of world.market.adStats) {
    if (s.productId !== p.id || channelOf(s) !== channel) continue;
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
  if (p.kind === 'kit') return { ceiling: p.price, why: 'un kit suit le prix de son guide' };
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

/** What the day's rate allows on the cash left once a week of pay is set aside (D9). */
export function adShare(world: WorldState, cash: number, rate: number): number {
  return Math.max(0, cash - ORG.adReserveDays * payrollToday(world)) * rate;
}

/**
 * Daily ad envelope: ≤ 15 % of the cash left once a week of pay is set aside, ≤ 8 % if runway < 14 days, never into the reserve
 * once growth decides (D9), 0 when bankrupt or on an announced outage day; survival below 30 % of start. The reserve's floor is
 * that same line, so under it the reserve would read 0 for good and stop the paying ads that are all that can refill the till:
 * survival keeps its own rules instead, the control's, and nothing launches or grows until the cash is back.
 */
export function computeBudget(world: WorldState): Budget {
  const fin = sim.financeSnapshot(world);
  const start = Math.max(1, world.scenario.startingCash);
  const lowRunway = fin.runwayDays !== null && fin.runwayDays < 14;
  const rate = lowRunway ? 0.08 : 0.15;
  const bankrupt = fin.bankrupt || fin.cash < 0 || world.status === 'bankrupt';
  const outage = sim.isAnnouncedOutage(world, world.day);
  const survival = fin.cash < SURVIVAL_CASH * start;
  const reserve = growthOn(world) && !survival ? world.company.growth?.allocation?.reserve : undefined;
  const share = adShare(world, fin.cash, rate);
  const adCap = bankrupt || outage || fin.cash <= 0 ? 0 : round2(reserve === undefined ? share : Math.min(share, Math.max(0, fin.cash - reserve)));
  return { adCap, survival, cash: round2(fin.cash), runwayDays: fin.runwayDays, rate, bankrupt, outage };
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

// ───────────────────────────── what a Monday reads ─────────────────────────────

export interface ClosedWindow { fromDay: number; toDay: number; days: number }

/** The last `days` closed days: never the partial numbers of a day still open. */
export function closedWindow(world: WorldState, days: number): ClosedWindow {
  const toDay = sim.lastClosedDay(world);
  const fromDay = Math.max(1, toDay - days + 1);
  return { fromDay, toDay, days: Math.max(1, toDay - fromDay + 1) };
}

export interface LedgerWindow { revenue: number; refunds: number; fees: number; adSpend: number; fixed: number; profit: number }

/** The books over [fromDay, toDay]: costs as positive euros, holds and capital out, the one-off setup out of the fixed costs. */
export function ledgerWindow(world: WorldState, fromDay: number, toDay: number): LedgerWindow {
  const w: LedgerWindow = { revenue: 0, refunds: 0, fees: 0, adSpend: 0, fixed: 0, profit: 0 };
  for (const e of world.ledger) {
    if (e.day < fromDay || e.day > toDay || e.type === 'capital' || isHold(e)) continue;
    w.profit += e.amount;
    switch (e.type) {
      case 'revenue': w.revenue += e.amount; break;
      case 'refund': case 'chargeback': case 'discount': case 'scam_loss': w.refunds -= e.amount; break;
      case 'payment_fee': w.fees -= e.amount; break;
      case 'ad_spend': w.adSpend -= e.amount; break;
      case 'platform_fee': case 'tool_subscription': case 'compute': if (e.ref !== SETUP_REF) w.fixed -= e.amount; break;
      default: break;
    }
  }
  return { revenue: round2(w.revenue), refunds: round2(w.refunds), fees: round2(w.fees), adSpend: round2(w.adSpend), fixed: round2(w.fixed), profit: round2(w.profit) };
}

/** What a buyer we already have spends again. Everything else is a first order, the one ads paid for. */
const FOLLOW_ON: readonly Order['source'][] = ['upsell', 'email', 'bump'];

/** What buyers kept paying over [fromDay, toDay], first orders apart from follow-on ones. */
export function orderRevenue(world: WorldState, fromDay: number, toDay: number): { first: number; followOn: number } {
  let first = 0, followOn = 0;
  for (const o of world.market.orders) {
    if (o.day < fromDay || o.day > toDay || o.refunded || o.chargeback) continue;
    if (FOLLOW_ON.includes(o.source)) followOn += o.price; else first += o.price;
  }
  return { first: round2(first), followOn: round2(followOn) };
}
