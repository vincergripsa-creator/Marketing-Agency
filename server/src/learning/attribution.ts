/**
 * Who really sold what (channels §5.2). Two readings of the same sales: what each platform claims (too high) and the shop's
 * last click. Step 4 switched the third off (D149): with `claimWeight` 0 the reconciled split is the shop's and every credit
 * is exactly 1. Pure: rows and the ledger in, numbers out. Money stays in the ledger, this only says how to read it.
 */
import { CHANNEL_IDS, channelOf } from '../shared.js';
import type { AttributionRow, ChannelDayKpi, ChannelId, DailyAdStats, WorldState } from '../shared.js';
import { REVERSAL_REF } from '../core/index.js';
import { amountOf } from './data.js';
import { finite, round, safeDiv } from './text.js';

export const RECON = { claimWeight: 0, windowDays: 14, minNicheRevenue: 30, staleDays: 4, creditMin: 0.4, creditMax: 2.5 };

const cents = (eur: number | undefined): number => Math.round(Math.max(0, finite(eur)) * 100);
const eur = (c: number): number => round(c / 100);

/** Cuts `total` cents along `weights`, to the cent: the largest remainders get what rounding down left over. */
function splitCents(total: number, weights: readonly number[]): number[] {
  const weight = weights.reduce((s, w) => s + w, 0);
  if (weight <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / weight);
  const parts = exact.map(Math.floor);
  const left = total - parts.reduce((s, c) => s + c, 0);
  const byRemainder = exact.map((x, i) => ({ i, rest: x - parts[i]! })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; k < left; k++) parts[byRemainder[k % byRemainder.length]!.i]! += 1;
  return parts;
}

/**
 * One row per channel present, in CHANNEL_IDS order. A platform's claims above the shop's own count for `claimWeight`, 0 since
 * D149. Σ reconciled = Σ shop, always, and one channel alone has credit 1, exactly.
 */
export function reconcile(rows: readonly Pick<DailyAdStats, 'channel' | 'spend' | 'revenue' | 'claimedRevenue'>[]): AttributionRow[] {
  const totals = new Map<ChannelId, { spend: number; shop: number; claimed: number }>();
  for (const r of rows) {
    const t = totals.get(channelOf(r)) ?? { spend: 0, shop: 0, claimed: 0 };
    t.spend += cents(r.spend);
    t.shop += cents(r.revenue);
    t.claimed += cents(r.claimedRevenue ?? r.revenue);
    totals.set(channelOf(r), t);
  }
  const channels = CHANNEL_IDS.filter((ch) => totals.has(ch));
  const lines = channels.map((ch) => totals.get(ch)!);
  const blended = lines.map((l) => l.shop + RECON.claimWeight * Math.max(0, l.claimed - l.shop));
  const reconciled = splitCents(lines.reduce((s, l) => s + l.shop, 0), blended);
  return channels.map((channel, i) => {
    const { spend, shop, claimed } = lines[i]!;
    const r = reconciled[i]!;
    return {
      channel, spend: eur(spend), shopRevenue: eur(shop), claimedRevenue: eur(claimed), reconciledRevenue: eur(r),
      credit: round(Math.min(RECON.creditMax, Math.max(RECON.creditMin, (r + 100) / (shop + 100))), 4),
      // no shop sale at all has no ratio: the +1 € of `credit` keeps it finite
      inflation: round(shop > 0 ? claimed / shop : (claimed + 100) / (shop + 100), 4),
    };
  });
}

/** The ad invoices of [fromDay, toDay] as the ledger booked them: each line follows its campaign. A ref nobody knows is TikTok's, like every absent channel. */
export function adSpendByChannel(world: WorldState, fromDay: number, toDay: number): Map<ChannelId, number> {
  const campaigns = new Map((world.company.campaigns ?? []).map((c) => [c.id, channelOf(c)]));
  const booked = new Map<ChannelId, number>();
  for (const e of world.ledger ?? []) {
    if (e.type !== 'ad_spend' || e.day < fromDay || e.day > toDay) continue;
    const ch = campaigns.get((e.ref ?? '').replace(REVERSAL_REF, '')) ?? 'tiktok';
    booked.set(ch, (booked.get(ch) ?? 0) - Math.round(amountOf(e) * 100));
  }
  return new Map([...booked].map(([ch, c]) => [ch, eur(c)]));
}

/**
 * A day seen per channel. Absent means TikTok, as everywhere: a day whose rows are all TikTok's writes nothing, a day
 * with any other channel writes every channel of the day. Revenue from the rows, spend from the ledger.
 */
export function channelDayKpi(world: WorldState, day: number): Partial<Record<ChannelId, ChannelDayKpi>> | undefined {
  const rows = (world.market?.adStats ?? []).filter((r) => r.day === day);
  if (rows.every((r) => channelOf(r) === 'tiktok')) return undefined;
  const reconciled = new Map(reconcile(rows).map((a) => [a.channel, a]));
  const spend = adSpendByChannel(world, day, day);
  const out: Partial<Record<ChannelId, ChannelDayKpi>> = {};
  for (const ch of CHANNEL_IDS) {
    const a = reconciled.get(ch);
    if (!a && !spend.has(ch)) continue;
    const own = rows.filter((r) => channelOf(r) === ch);
    const count = (of: (r: DailyAdStats) => number | undefined) => own.reduce((s, r) => s + Math.max(0, finite(of(r))), 0);
    out[ch] = {
      spend: spend.get(ch) ?? 0,
      impressions: count((r) => r.impressions), clicks: count((r) => r.clicks), landingViews: count((r) => r.landingViews),
      shopSales: count((r) => r.purchases), shopRevenue: a?.shopRevenue ?? 0,
      claimedSales: count((r) => r.claimedPurchases ?? r.purchases), claimedRevenue: a?.claimedRevenue ?? 0,
      reconciledRevenue: a?.reconciledRevenue ?? 0,
      roas: round(safeDiv(a?.reconciledRevenue ?? 0, spend.get(ch) ?? 0), 2),
    };
  }
  return out;
}
