/** Daily KPI aggregation from the ledger, ad stats, orders, inbox, tasks and lessons. */
import type { DailyKpi, WorldState } from '../shared.js';
import { finite, round, safeDiv } from './text.js';
import { signedAmount } from './data.js';

/** "score 82/100", "82 / 100", "score : 82" inside an activity line → 82. */
export function parseReplyScore(text: string): number | null {
  const s = String(text ?? '');
  const m = s.match(/(\d{1,3}(?:[.,]\d+)?)\s*\/\s*100\b/) ?? s.match(/\bscore\s*(?:de\s*|:\s*)?(\d{1,3}(?:[.,]\d+)?)/i);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

/**
 * Average support reply score of a day. The shared types have no per-reply score record, so:
 *  1. scores carried by that day's 'message' activity lines ("… (score 82/100)") are averaged;
 *  2. otherwise, if agents replied in inbox threads that day, the empirical mean of the
 *     'support_tone' bandit (rewarded with ReplyOutcome.score / 100 after every reply) is used;
 *  3. otherwise 0 (no reply that day).
 */
export function avgReplyScoreOf(world: WorldState, day: number): number {
  const scores: number[] = [];
  for (const a of world.activity ?? []) {
    if (a.day !== day || a.kind !== 'message') continue;
    const s = parseReplyScore(a.text);
    if (s !== null) scores.push(s);
  }
  if (scores.length) return round(scores.reduce((x, y) => x + y, 0) / scores.length, 1);
  const replied = (world.market?.inbox ?? []).some((m) => (m.thread ?? []).some((t) => t.from !== 'customer' && t.day === day));
  if (!replied) return 0;
  const arms = world.company.bandits?.support_tone ?? [];
  const pulls = arms.reduce((s, a) => s + a.pulls, 0);
  const reward = arms.reduce((s, a) => s + a.reward, 0);
  return pulls > 0 ? round((100 * reward) / pulls, 1) : 0;
}

export function computeDailyKpi(world: WorldState, day: number): DailyKpi {
  let cash = 0;
  let cumulativeProfit = 0;
  let revenue = 0;
  let adSpend = 0;
  let profit = 0;
  let refundsNoRef = 0;
  const refundRefs = new Set<string>();

  for (const e of world.ledger ?? []) {
    if (e.day > day) continue;
    const s = signedAmount(e);
    cash += s;
    if (e.type !== 'capital') cumulativeProfit += s;
    if (e.day !== day) continue;
    if (e.type === 'revenue') revenue += s;
    else if (e.type === 'ad_spend') adSpend += -s;
    if (e.type !== 'capital') profit += s;
    if (e.type === 'refund' || e.type === 'chargeback') {
      if (e.ref) refundRefs.add(e.ref);
      else refundsNoRef += 1;
    }
  }

  let impressions = 0;
  let clicks = 0;
  let landingViews = 0;
  let purchases = 0;
  let adRevenue = 0;
  let statsSpend = 0;
  for (const r of world.market?.adStats ?? []) {
    if (r.day !== day) continue;
    impressions += Math.max(0, finite(r.impressions));
    clicks += Math.max(0, finite(r.clicks));
    landingViews += Math.max(0, finite(r.landingViews));
    purchases += Math.max(0, finite(r.purchases));
    adRevenue += Math.max(0, finite(r.revenue));
    statsSpend += Math.abs(finite(r.spend));
  }

  const ordersToday = (world.market?.orders ?? []).filter((o) => o.day === day);
  const adOrders = ordersToday.filter((o) => o.source === 'ads').length;
  const adPurchases = purchases > 0 ? purchases : adOrders;
  const spendBase = statsSpend > 0 ? statsSpend : adSpend;

  return {
    day,
    cash: round(cash),
    revenue: round(revenue),
    adSpend: round(adSpend),
    profit: round(profit),
    cumulativeProfit: round(cumulativeProfit),
    sales: ordersToday.length,
    refunds: refundRefs.size + refundsNoRef,
    impressions: Math.round(impressions),
    clicks: Math.round(clicks),
    ctr: round(safeDiv(clicks, impressions), 4),
    cvr: round(safeDiv(purchases, landingViews), 4),
    roas: round(safeDiv(adRevenue, spendBase), 2),
    cac: round(adSpend > 0 ? adSpend / Math.max(1, adPurchases) : 0, 2),
    openTickets: (world.market?.inbox ?? []).filter((m) => m.status === 'open' && m.day <= day).length,
    avgReplyScore: avgReplyScoreOf(world, day),
    liveProducts: (world.company.products ?? []).filter((p) => p.status === 'live').length,
    tasksDone: (world.company.tasks ?? []).filter((t) => t.dayDone === day && t.status === 'done').length,
    lessonsLearned: (world.company.lessons ?? []).filter((l) => l.day === day).length,
  };
}

/** Inserts or replaces the KPI of the same day, keeping the list sorted. */
export function upsertKpi(world: WorldState, kpi: DailyKpi): void {
  const list = (world.company.kpis ??= []);
  const i = list.findIndex((k) => k.day === kpi.day);
  if (i >= 0) list[i] = kpi;
  else {
    list.push(kpi);
    list.sort((a, b) => a.day - b.day);
  }
}
