/** Daily KPI aggregation from the ledger, ad stats, orders, inbox, tasks and lessons. */
import type { DailyKpi, WorldState } from '../shared.js';
import { finite, round, safeDiv } from './text.js';
import { channelDayKpi } from './attribution.js';
import { amountOf, isHoldEntry, isProfitEntry, refundCountOnDay } from './data.js';

/** Scores of the support replies sent on a day (0..100). */
export function replyScoresOfDay(world: WorldState, day: number): number[] {
  const scores: number[] = [];
  // 1. the sim stamps every reply on the message itself (InboxMessage.replyScore / repliedDay)
  for (const m of world.market?.inbox ?? []) {
    if (m.repliedDay !== day || m.replyScore === null || m.replyScore === undefined) continue;
    const v = Number(m.replyScore);
    if (Number.isFinite(v)) scores.push(Math.max(0, Math.min(100, v)));
  }
  if (scores.length) return scores;
  // 2. saves made before those fields existed: the support task's structured output of that day
  for (const t of world.company.tasks ?? []) {
    if (t.kind !== 'reply_inbox' || t.dayDone !== day) continue;
    const replies = (t.output as { replies?: unknown } | null)?.replies;
    if (!Array.isArray(replies)) continue;
    for (const r of replies) {
      const v = Number((r as { score?: unknown } | null)?.score);
      if (Number.isFinite(v)) scores.push(Math.max(0, Math.min(100, v)));
    }
  }
  return scores;
}

/** Average support reply score of a day (0 when nobody was answered that day). */
export function avgReplyScoreOf(world: WorldState, day: number): number {
  const scores = replyScoresOfDay(world, day);
  return scores.length ? round(scores.reduce((x, y) => x + y, 0) / scores.length, 1) : 0;
}

/**
 * KPIs of a day. Money comes from the ledger, summed EXACTLY as recordLedger stored it (signed):
 * cash = Σ entries up to that day (= financeSnapshot(world).cash at that day's close), profit excludes
 * the starting capital and the payment reserves ('hold:' refs move cash, never profit).
 */
export function computeDailyKpi(world: WorldState, day: number): DailyKpi {
  let cash = 0;
  let cumulativeProfit = 0;
  let revenue = 0;
  let adSpend = 0;
  let profit = 0;

  for (const e of world.ledger ?? []) {
    if (e.day > day) continue;
    const a = amountOf(e);
    cash += a;
    const counts = isProfitEntry(e);
    if (counts) cumulativeProfit += a;
    if (e.day !== day) continue;
    if (counts) profit += a;
    if (e.type === 'revenue' && !isHoldEntry(e)) revenue += a;
    else if (e.type === 'ad_spend') adSpend -= a;
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
  const channels = channelDayKpi(world, day);

  return {
    day,
    cash: round(cash),
    revenue: round(revenue),
    adSpend: round(adSpend),
    profit: round(profit),
    cumulativeProfit: round(cumulativeProfit),
    sales: ordersToday.length,
    refunds: refundCountOnDay(world, day),
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
    ...(channels ? { channels } : {}),
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
