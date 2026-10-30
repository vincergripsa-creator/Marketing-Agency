/** Read-only accessors and aggregations over the world (ledger, ad stats, orders) shared by KPI, experiments and retro. */
import type { BrainNote } from '../contracts.js';
import type { AdCreative, AgentState, DailyAdStats, LedgerEntry, LedgerType, Order, Product, WorldState } from '../shared.js';
import { basenameOf } from './markdown.js';
import { finite, fold, safeDiv, slugify } from './text.js';

const INCOME_TYPES: ReadonlySet<LedgerType> = new Set<LedgerType>(['capital', 'revenue']);

/**
 * Ledger amount with a normalised sign: income (capital, revenue) positive, everything else negative.
 * Robust to either convention in the sim (signed amounts, or positive costs).
 */
export function signedAmount(e: LedgerEntry): number {
  const a = Math.abs(finite(e.amount));
  return INCOME_TYPES.has(e.type) ? a : -a;
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

export function adRows(world: WorldState, fromDay: number, toDay: number): DailyAdStats[] {
  return (world.market?.adStats ?? []).filter((r) => r.day >= fromDay && r.day <= toDay);
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

/** Refunds + chargebacks booked on a day, per product (ledger ref = order id or product id). */
export function refundsOnDay(world: WorldState, ix: WorldIndex, day: number): Map<string, { count: number; amount: number }> {
  const out = new Map<string, { count: number; amount: number; refs: Set<string> }>();
  for (const e of world.ledger ?? []) {
    if (e.day !== day || (e.type !== 'refund' && e.type !== 'chargeback')) continue;
    const ref = e.ref ?? '';
    const productId = ix.orders.get(ref)?.productId ?? (ix.products.has(ref) ? ref : null);
    if (!productId) continue;
    const cur = out.get(productId) ?? { count: 0, amount: 0, refs: new Set<string>() };
    cur.amount += Math.abs(finite(e.amount));
    if (!cur.refs.has(ref) || !ref) cur.count += 1;
    if (ref) cur.refs.add(ref);
    out.set(productId, cur);
  }
  return new Map([...out].map(([k, v]) => [k, { count: v.count, amount: v.amount }]));
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
  for (const e of world.ledger ?? []) {
    if (e.day > day) continue;
    const s = signedAmount(e);
    cash += s;
    if (e.type === 'capital') continue;
    cumulativeProfit += s;
    if (e.day > day - 7) {
      profit7d += s;
      if (e.type === 'ad_spend') adSpend7d += Math.abs(s);
      if (e.type === 'revenue') revenue7d += s;
    }
  }
  const span = Math.min(7, Math.max(1, day));
  const burn7d = -profit7d / span;
  return { cash, cumulativeProfit, profit7d, burn7d, runwayDays: burn7d > 0 ? cash / burn7d : null, adSpend7d, revenue7d };
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

/** Agent that signs retro / HR lines: Nora when she exists, else the RH chief, else anyone in RH. */
export function retroAgent(world: WorldState): AgentState | null {
  const agents = world.company.agents ?? [];
  return (
    agents.find((a) => a.id === 'nora') ??
    agents.find((a) => fold(a.name) === 'nora') ??
    agents.find((a) => a.dept === 'rh' && a.isChief) ??
    agents.find((a) => a.dept === 'rh') ??
    null
  );
}

export function retroAgentId(world: WorldState): string {
  return retroAgent(world)?.id ?? 'nora';
}
