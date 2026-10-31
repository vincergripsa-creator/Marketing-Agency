/** Read-only accessors and aggregations over the world (ledger, ad stats, orders) shared by KPI, experiments and retro. */
import type { BrainNote } from '../contracts.js';
import type { AdCreative, AgentState, DailyAdStats, LedgerEntry, Order, Product, WorldState } from '../shared.js';
import { SETUP_REF } from '../sim/finance.js';
import { announcedOutageDays } from '../sim/outage.js';
import { basenameOf } from './markdown.js';
import { finite, fold, safeDiv, slugify } from './text.js';

/**
 * Ledger amount exactly as recordLedger STORED it (already signed: income +, costs −, and the caller's
 * sign kept for 'hold:' / 'reversal:' refs). Never re-sign it: Σ amount = cash (see contracts.ts).
 */
export function amountOf(e: LedgerEntry): number {
  return finite(e.amount);
}

/** Payment reserve ('hold:<id>' / 'hold:release:<day>'): moves cash, never profit. */
export function isHoldEntry(e: Pick<LedgerEntry, 'ref'>): boolean {
  return typeof e.ref === 'string' && e.ref.startsWith('hold:');
}

/** Counts in profit: everything except starting capital and payment reserves. */
export function isProfitEntry(e: Pick<LedgerEntry, 'type' | 'ref'>): boolean {
  return e.type !== 'capital' && !isHoldEntry(e);
}

export interface FunnelAgg {
  spend: number; impressions: number; clicks: number; landingViews: number; purchases: number; revenue: number;
  rows: number; days: Set<number>; maxFrequency: number;
}

export function emptyAgg(): FunnelAgg {
  return { spend: 0, impressions: 0, clicks: 0, landingViews: 0, purchases: 0, revenue: 0, rows: 0, days: new Set(), maxFrequency: 0 };
}

export function addRow(agg: FunnelAgg, r: DailyAdStats): FunnelAgg {
  agg.spend += Math.abs(finite(r.spend));
  agg.impressions += Math.max(0, finite(r.impressions));
  agg.clicks += Math.max(0, finite(r.clicks));
  agg.landingViews += Math.max(0, finite(r.landingViews));
  agg.purchases += Math.max(0, finite(r.purchases));
  agg.revenue += Math.max(0, finite(r.revenue));
  agg.maxFrequency = Math.max(agg.maxFrequency, finite(r.frequency));
  agg.rows += 1;
  agg.days.add(r.day);
  return agg;
}

export const ctrOf = (a: FunnelAgg): number => safeDiv(a.clicks, a.impressions);
export const cvrOf = (a: FunnelAgg): number => safeDiv(a.purchases, a.landingViews);
export const roasOf = (a: FunnelAgg): number => safeDiv(a.revenue, a.spend);

export interface WorldIndex {
  products: Map<string, Product>;
  creatives: Map<string, AdCreative>;
  orders: Map<string, Order>;
}

export function indexWorld(world: WorldState): WorldIndex {
  return {
    products: new Map((world.company.products ?? []).map((p) => [p.id, p])),
    creatives: new Map((world.company.creatives ?? []).map((c) => [c.id, c])),
    orders: new Map((world.market?.orders ?? []).map((o) => [o.id, o])),
  };
}

/**
 * Ad rows of a window, without the announced outage days: nothing could sell on those days, so they measure
 * neither the page, the price, the niche nor the creative. Every performance window of the retro goes through here.
 */
export function adRows(world: WorldState, fromDay: number, toDay: number): DailyAdStats[] {
  const outage = announcedOutageDays(world);
  return (world.market?.adStats ?? []).filter((r) => r.day >= fromDay && r.day <= toDay && !outage.includes(r.day));
}

/** « jours 28 à 30 », saying so when announced outage days were left out of the window. */
export function windowLabel(world: WorldState, fromDay: number, toDay: number): string {
  const out = announcedOutageDays(world).filter((d) => d >= fromDay && d <= toDay);
  const excluded = out.length ? ` (hors panne${out.length > 1 ? 's' : ''} du jour ${out.join(', ')})` : '';
  return `jours ${fromDay} à ${toDay}${excluded}`;
}

export function productOfRow(ix: WorldIndex, r: DailyAdStats): Product | undefined {
  return ix.products.get(r.productId) ?? ix.products.get(ix.creatives.get(r.creativeId)?.productId ?? '');
}

/** Price that was live on a given day (priceHistory), falling back to the current price. */
export function priceOnDay(p: Product, day: number): number {
  let price = finite(p.price);
  let bestDay = -Infinity;
  for (const h of p.priceHistory ?? []) {
    if (h.day <= day && h.day >= bestDay) {
      bestDay = h.day;
      price = finite(h.price, price);
    }
  }
  return price;
}

/** Public niche name (research first; the hidden truth is only used for its name). */
export function nicheName(world: WorldState, nicheId: string): string {
  return (
    world.company.research?.trends?.find((t) => t.nicheId === nicheId)?.name ||
    world.market?.niches?.find((n) => n.id === nicheId)?.name ||
    world.company.products?.find((p) => p.nicheId === nicheId)?.audience ||
    nicheId
  );
}

/** Money lost per order on a day (refund + chargeback entries, ledger ref = order id). */
function refundMoneyByRef(world: WorldState, day: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of world.ledger ?? []) {
    if (e.day !== day || (e.type !== 'refund' && e.type !== 'chargeback') || !e.ref) continue;
    out.set(e.ref, (out.get(e.ref) ?? 0) - amountOf(e));
  }
  return out;
}

/**
 * Refunds + chargebacks closed on a day, per product. Primary source: Order.refundedDay (exact daily
 * attribution); ledger entries of that day complete it for orders saved before the field existed.
 * An order refunded then disputed the same day counts once.
 */
export function refundsOnDay(world: WorldState, ix: WorldIndex, day: number): Map<string, { count: number; amount: number }> {
  const money = refundMoneyByRef(world, day);
  const out = new Map<string, { count: number; amount: number }>();
  const seen = new Set<string>();
  const add = (productId: string, amount: number) => {
    const cur = out.get(productId) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Math.max(0, amount);
    out.set(productId, cur);
  };
  for (const o of world.market?.orders ?? []) {
    if (o.refundedDay !== day || !(o.refunded || o.chargeback)) continue;
    seen.add(o.id);
    add(o.productId, money.get(o.id) ?? Math.abs(finite(o.price)));
  }
  for (const [ref, amount] of money) {
    if (seen.has(ref)) continue;
    const productId = ix.orders.get(ref)?.productId ?? (ix.products.has(ref) ? ref : null);
    if (!productId) continue;
    seen.add(ref);
    add(productId, amount);
  }
  return out;
}

/** Number of distinct orders refunded / disputed on a day (all products, including unknown ones). */
export function refundCountOnDay(world: WorldState, day: number): number {
  const ids = new Set<string>();
  let noRef = 0;
  for (const o of world.market?.orders ?? []) if (o.refundedDay === day && (o.refunded || o.chargeback)) ids.add(o.id);
  for (const e of world.ledger ?? []) {
    if (e.day !== day || (e.type !== 'refund' && e.type !== 'chargeback')) continue;
    if (e.ref) ids.add(e.ref);
    else noRef += 1;
  }
  return ids.size + noRef;
}

export interface FinanceView {
  cash: number; cumulativeProfit: number; profit7d: number; burn7d: number; runwayDays: number | null; adSpend7d: number; revenue7d: number;
}

export function financeView(world: WorldState, day: number): FinanceView {
  let cash = 0;
  let cumulativeProfit = 0;
  let profit7d = 0;
  let adSpend7d = 0;
  let revenue7d = 0;
  let oneOff7d = 0;
  for (const e of world.ledger ?? []) {
    if (e.day > day) continue;
    const s = amountOf(e);
    cash += s;
    if (!isProfitEntry(e)) continue;
    cumulativeProfit += s;
    if (e.day > day - 7) {
      profit7d += s;
      if (e.type === 'ad_spend') adSpend7d -= s;
      if (e.type === 'revenue') revenue7d += s;
      if (e.ref === SETUP_REF) oneOff7d += s;
    }
  }
  const span = Math.min(7, Math.max(1, day));
  const burn7d = -(profit7d - oneOff7d) / span; // the launch costs are paid once: they say nothing of the daily burn
  const runwayDays = cash <= 0 ? 0 : burn7d > 0 ? Math.floor(cash / burn7d) : null;
  return { cash, cumulativeProfit, profit7d, burn7d, runwayDays, adSpend7d, revenue7d };
}

/** Finds a note in a folder whose basename/title matches one of the candidates (for wikilinks). */
export function findNoteLink(notes: readonly BrainNote[], folder: string, candidates: readonly (string | null | undefined)[]): string | null {
  const keys = new Set<string>();
  for (const c of candidates) {
    if (!c) continue;
    keys.add(fold(c));
    keys.add(slugify(c));
  }
  for (const n of notes) {
    if (!n.path.startsWith(`${folder}/`)) continue;
    const base = basenameOf(n.path);
    if (keys.has(fold(base)) || keys.has(slugify(base)) || keys.has(fold(n.title)) || keys.has(slugify(n.title))) return base;
  }
  return null;
}

/** Agent that signs retro / HR lines: the holder of the HR office, else the RH chief, else anyone in RH. */
export function retroAgent(world: WorldState): AgentState | null {
  const agents = world.company.agents ?? [];
  const hr = world.company.org?.offices.hr;
  return (
    agents.find((a) => a.id === hr) ??
    agents.find((a) => a.dept === 'rh' && a.isChief) ??
    agents.find((a) => a.dept === 'rh') ??
    null
  );
}
