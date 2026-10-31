/**
 * The accountant's books: the daily reconciliation of the ledger against what each system says it did (orders, ad
 * platform, refunds) and the profit and loss per product. Reads the company's own records only.
 */
import { adSpendByChannel, reconcile } from '../learning/attribution.js';
import { CHANNEL_IDS, CHANNELS, channelOf } from '../shared.js';
import type { ChannelId, LedgerEntry, ProductPnl, WeeklyPnl, WorldState } from '../shared.js';
import { eur, round2, sum } from './util.js';

/** Rounding of the daily sums (cents booked per line), not a real gap. */
const GAP_TOLERANCE = 0.05;
const GIVEN_BACK: readonly LedgerEntry['type'][] = ['refund', 'discount', 'scam_loss'];

const isHold = (e: LedgerEntry): boolean => !!e.ref && e.ref.startsWith('hold:');

export interface Reconciliation {
  day: number; entries: number;
  revenue: number; refunds: number; adSpend: number; fees: number; creators: number; fixed: number;
  net: number;     // the day's result
  cash: number;    // Σ of the whole ledger
  held: number;    // still held in payment reserves (≤ 0)
  checks: number;  // comparisons made
  gaps: string[];  // French, one per anomaly
}

/**
 * One closed day, line by line: the sales against the revenue booked, each ad platform against what it was booked, every
 * refund against its entry, and no order given back more than once.
 */
export function reconcileDay(world: WorldState, day: number): Reconciliation {
  const entries = world.ledger.filter((e) => e.day === day);
  const sumOf = (...types: LedgerEntry['type'][]) => round2(sum(entries.filter((e) => types.includes(e.type) && !isHold(e)).map((e) => e.amount)));
  const revenue = sumOf('revenue');
  const refunds = -sumOf('refund', 'chargeback', 'discount', 'scam_loss');
  const adSpend = -sumOf('ad_spend');
  const fees = -sumOf('payment_fee');
  const creators = -sumOf('creator_payout');
  const fixed = -sumOf('platform_fee', 'tool_subscription', 'compute', 'salary', 'recruiting');
  const gaps: string[] = [];
  let checks = 0;
  const compare = (label: string, known: number, booked: number) => {
    checks++;
    if (Math.abs(known - booked) > GAP_TOLERANCE) gaps.push(`${label} : ${eur(known)} contre ${eur(booked)} au grand livre`);
  };
  const orders = world.market.orders;
  const sold = orders.filter((o) => o.day === day);
  compare('ventes du jour', round2(sum(sold.map((o) => o.price))), revenue);
  // one invoice per channel with spend, so a gap names its platform; a day without ads still checks TikTok's, at zero
  const stats = world.market.adStats.filter((s) => s.day === day);
  const invoiced = (ch: ChannelId) => round2(sum(stats.filter((s) => channelOf(s) === ch).map((s) => s.spend)));
  const booked = adSpendByChannel(world, day, day);
  const billing = CHANNEL_IDS.filter((ch) => invoiced(ch) > 0 || booked.has(ch));
  for (const ch of billing.length ? billing : (['tiktok'] as const)) compare(`facture ${CHANNELS[ch].label}`, invoiced(ch), booked.get(ch) ?? 0);
  checks++;
  if (sold.length && !entries.some((e) => e.type === 'payment_fee')) gaps.push(`${sold.length} vente(s) sans frais de paiement enregistrés`);
  for (const o of orders) {
    if (o.refundedDay !== day) continue;
    checks++;
    if ((o.refundedAmount ?? 0) > 0 && !world.ledger.some((e) => e.ref === o.id && e.amount < 0)) gaps.push(`commande ${o.id} remboursée sans écriture`);
  }
  const touched = new Set(entries.filter((e) => GIVEN_BACK.includes(e.type)).map((e) => e.ref));
  for (const o of orders) {
    if (!touched.has(o.id)) continue;
    checks++;
    const back = -sum(world.ledger.filter((e) => e.ref === o.id && GIVEN_BACK.includes(e.type)).map((e) => e.amount));
    if (back > o.price + GAP_TOLERANCE) gaps.push(`commande ${o.id} remboursée ${eur(back)} pour ${eur(o.price)} payés`);
  }
  return {
    day, entries: entries.length, revenue, refunds, adSpend, fees, creators, fixed,
    net: round2(sum(entries.filter((e) => e.type !== 'capital' && !isHold(e)).map((e) => e.amount))),
    cash: round2(sum(world.ledger.map((e) => e.amount))),
    held: round2(sum(world.ledger.filter(isHold).map((e) => e.amount))),
    checks, gaps,
  };
}

/**
 * P&L per product over [fromDay, toDay], from the ledger. Refunds follow their order, ads their campaign, creators
 * their deal, the payment fees of a day are shared by that day's sales. What belongs to no product (subscriptions,
 * compute) is `unallocated`, so products + unallocated = the profit of the window.
 */
export function productPnls(world: WorldState, fromDay: number, toDay: number, skipDays: readonly number[] = []): Pick<WeeklyPnl, 'products' | 'unallocated' | 'total'> {
  const rows = new Map<string, ProductPnl>();
  const row = (id: string): ProductPnl => {
    let r = rows.get(id);
    if (!r) {
      r = { productId: id, title: world.company.products.find((p) => p.id === id)?.title ?? id, sales: 0, revenue: 0, refunds: 0, adSpend: 0, fees: 0, creators: 0, profit: 0, roas: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const p of world.company.products) if (p.status === 'live') row(p.id);
  const known = new Set(world.company.products.map((p) => p.id));
  const orders = new Map(world.market.orders.map((o) => [o.id, o]));
  const campaigns = new Map(world.company.campaigns.map((c) => [c.id, c.productId]));
  const deals = new Map(world.market.partnerships.map((p) => [p.id, p.productId]));
  const salesOfDay = new Map<number, Map<string, number>>();
  for (const o of world.market.orders) {
    if (o.day < fromDay || o.day > toDay || skipDays.includes(o.day)) continue;
    row(o.productId).sales += 1;
    const perProduct = salesOfDay.get(o.day) ?? new Map<string, number>();
    perProduct.set(o.productId, (perProduct.get(o.productId) ?? 0) + 1);
    salesOfDay.set(o.day, perProduct);
  }
  let total = 0;
  for (const e of world.ledger) {
    if (e.day < fromDay || e.day > toDay || skipDays.includes(e.day) || e.type === 'capital' || isHold(e)) continue;
    total += e.amount;
    const ref = (e.ref ?? '').replace(/^reversal:/, '');
    switch (e.type) {
      case 'revenue': if (known.has(ref)) row(ref).revenue += e.amount; break;
      case 'ad_spend': { const id = campaigns.get(ref); if (id) row(id).adSpend -= e.amount; break; }
      case 'creator_payout': { const id = deals.get(ref); if (id) row(id).creators -= e.amount; break; }
      case 'refund': case 'chargeback': case 'discount': case 'scam_loss': {
        const orderProduct = orders.get(ref)?.productId;
        const deal = deals.get(ref);
        if (orderProduct) row(orderProduct).refunds -= e.amount;
        else if (deal) row(deal).creators -= e.amount;
        break;
      }
      case 'payment_fee': {
        const perProduct = salesOfDay.get(e.day);
        const count = perProduct ? sum([...perProduct.values()]) : 0;
        if (perProduct && count > 0) for (const [id, n] of perProduct) row(id).fees -= (e.amount * n) / count;
        break;
      }
      default: break;
    }
  }
  const products = [...rows.values()].map((r) => {
    const refunds = round2(r.refunds);
    const adSpend = round2(r.adSpend);
    const profit = round2(r.revenue - r.refunds - r.adSpend - r.fees - r.creators);
    return { ...r, revenue: round2(r.revenue), refunds, adSpend, fees: round2(r.fees), creators: round2(r.creators), profit, roas: adSpend > 0 ? round2((r.revenue - r.refunds) / adSpend) : null };
  }).sort((a, b) => b.profit - a.profit || a.productId.localeCompare(b.productId));
  const roundedTotal = round2(total);
  return { products, unallocated: round2(roundedTotal - sum(products.map((p) => p.profit))), total: roundedTotal };
}

/** Each channel over [fromDay, toDay]: its spend as the ledger booked it, its revenue reconciled, so Σ revenue = the shop's. */
export function channelPnls(world: WorldState, fromDay: number, toDay: number): NonNullable<WeeklyPnl['channels']> {
  const reconciled = new Map(reconcile(world.market.adStats.filter((s) => s.day >= fromDay && s.day <= toDay)).map((a) => [a.channel, a.reconciledRevenue]));
  const booked = adSpendByChannel(world, fromDay, toDay);
  return CHANNEL_IDS.filter((ch) => reconciled.has(ch) || booked.has(ch)).map((channel) => {
    const spend = booked.get(channel) ?? 0;
    const reconciledRevenue = reconciled.get(channel) ?? 0;
    return { channel, spend, reconciledRevenue, roas: spend > 0 ? round2(reconciledRevenue / spend) : null };
  });
}

export function weeklyPnl(world: WorldState, fromDay: number, toDay: number): WeeklyPnl {
  const channels = channelPnls(world, fromDay, toDay);
  return {
    week: Math.max(1, Math.ceil(toDay / 7)), fromDay, toDay, ...productPnls(world, fromDay, toDay),
    ...(channels.some((c) => c.channel !== 'tiktok') ? { channels } : {}),
  };
}

/** Latest weekly P&L of a product (null before its first report): what the kill decision can read. */
export function latestProductPnl(world: WorldState, productId: string): (ProductPnl & { week: number; toDay: number }) | null {
  const reports = world.company.pnl ?? [];
  for (let i = reports.length - 1; i >= 0; i--) {
    const r = reports[i]!;
    const row = r.products.find((p) => p.productId === productId);
    if (row) return { ...row, week: r.week, toDay: r.toDay };
  }
  return null;
}

/** Keeps one report per week (a report asked mid-week is replaced by the end-of-week one). */
export function recordPnl(world: WorldState, report: WeeklyPnl): void {
  const list = (world.company.pnl ??= []);
  const i = list.findIndex((r) => r.week === report.week);
  if (i >= 0) list[i] = report; else list.push(report);
  if (list.length > 26) list.splice(0, list.length - 26);
}
