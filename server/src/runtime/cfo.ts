/**
 * The CFO's Monday (scale §4.3): what the week earned decides what the next one may spend. Everything here is observable:
 * ledger, ad stats, orders. The break-even ROAS comes from what buyers really leave, the reserve from what the company
 * really costs, and sleeping cash goes to work as long as ads pay. The guardrails stay: `adTarget` is room under the
 * CFO's cap, never an order, and only a campaign that passes `scaleRoas` grows into it.
 */
import type { Allocation, WorldState } from '../shared.js';
import { channelOf } from '../shared.js';
import { creditOf } from './channels.js';
import type { RuntimeCtx } from './ctx.js';
import { speak } from './ctx.js';
import { logDecision } from './digest.js';
import { adShare, closedWindow, computeBudget, ledgerWindow, orderRevenue } from './metrics.js';
import { sim } from './modules.js';
import { officerId } from './org/officers.js';
import { payrollToday } from './org/payroll.js';
import { policyOf } from './stages.js';
import { clamp, dec, eur, round2 } from './util.js';

export const CFO = {
  ltvDays: 56, ltvMax: 1.8, ltvMinFirstOrders: 300,
  scaleFloor: 1.25, scaleMargin: 1.3,
  trimFloor: 0.9, trimMargin: 1.05,
  reserveCashShare: 0.3, reserveSpendShare: 0.5,
  leakMinSpend: 100, leakKeep: 0.8, leakToTests: 0.2,
  idleDays: 14, targetDays: 7,
} as const;

/** Refunds can outrun a month's revenue: break-even keeps a number to divide by. */
const MIN_NET = 0.1;

/** Reconciled ROAS of the whole company: what ads claimed, each row at its channel's credit (D26). Announced outage days measure nothing. */
function reconciledRoas(w: WorldState, fromDay: number, toDay: number): number | null {
  const outage = sim.announcedOutageDays(w);
  const niches = new Map(w.company.products.map((p) => [p.id, p.nicheId]));
  let spend = 0, revenue = 0;
  for (const s of w.market.adStats) {
    if (s.day < fromDay || s.day > toDay || outage.includes(s.day)) continue;
    spend += s.spend;
    revenue += s.revenue * creditOf(w, channelOf(s), niches.get(s.productId) ?? '');
  }
  return spend > 0 ? revenue / spend : null;
}

/** What a euro of first orders is worth with what the same buyers spend after it. 1 until the sample means something. */
function lifetimeFactor(w: WorldState): number {
  const { fromDay, toDay } = closedWindow(w, CFO.ltvDays);
  const { first, followOn } = orderRevenue(w, fromDay, toDay);
  return first >= CFO.ltvMinFirstOrders ? clamp(1 + followOn / first, 1, CFO.ltvMax) : 1;
}

/** The week's allocation. Reads the world, moves nothing. */
export function allocationOf(w: WorldState): Allocation {
  const policy = policyOf(w);
  const { cash, rate } = computeBudget(w);
  const week = closedWindow(w, 7);
  const fortnight = closedWindow(w, 14);
  const month = closedWindow(w, 28);
  const books7 = ledgerWindow(w, week.fromDay, week.toDay);
  const books14 = ledgerWindow(w, fortnight.fromDay, fortnight.toDay);
  const books28 = ledgerWindow(w, month.fromDay, month.toDay);
  const profit7 = books7.profit;
  const spend7 = books7.adSpend / week.days;
  const roas14 = reconciledRoas(w, fortnight.fromDay, fortnight.toDay);

  const net = Math.max(MIN_NET, books28.revenue > 0 ? 1 - books28.refunds / books28.revenue - books28.fees / books28.revenue : 1);
  const ltv = lifetimeFactor(w);
  const beRoas = 1 / (net * ltv);
  const scaleRoas = Math.max(CFO.scaleFloor, CFO.scaleMargin * beRoas);
  const trimRoas = Math.max(CFO.trimFloor, CFO.trimMargin * beRoas);

  const fixedDaily = books7.fixed / week.days;
  const reserve = Math.max(CFO.reserveCashShare * w.scenario.startingCash, policy.reserveDays * (fixedDaily + payrollToday(w) + CFO.reserveSpendShare * spend7));
  const free = Math.max(0, cash - reserve);
  const leak = books14.adSpend >= CFO.leakMinSpend && roas14 !== null && roas14 < beRoas;

  const perDay = Math.max(0, profit7) / CFO.targetDays;
  let scaleAdd = leak ? 0 : policy.split.scale * perDay;
  const testAdd = policy.split.test * perDay;
  const idle = Math.max(0, free - CFO.idleDays * (spend7 + scaleAdd + testAdd));
  if (!leak) scaleAdd += idle / CFO.idleDays; // sleeping cash goes to work
  let adTarget = Math.min(spend7 + scaleAdd + testAdd, adShare(w, cash, rate), free / CFO.targetDays);
  if (leak) adTarget = Math.min(adTarget, CFO.leakKeep * spend7 + testAdd);
  const testWeek = CFO.targetDays * (testAdd + (leak ? CFO.leakToTests * spend7 : 0)); // a leaking bucket funds exploration, not more of itself
  adTarget = Math.floor(adTarget * 100) / 100; // down, or a cent could reach past the cap or into the reserve

  const note = leak
    ? `Fuite : ROAS ${dec(roas14 ?? 0)} sur 14 jours sous le point mort de ${dec(beRoas)}, rien de plus sur ce qui tourne, ${eur(testWeek)} pour tester du neuf.`
    : `Cible pub ${eur(adTarget)}/jour, réserve ${eur(reserve)}, ${eur(free)} libres : une campagne grandit au-dessus d'un ROAS de ${dec(scaleRoas)}.`;
  return {
    week: Math.ceil(w.day / 7), day: w.day,
    profit7: round2(profit7), profit28: round2(books28.profit), spend7: round2(spend7), roas14: roas14 === null ? null : round2(roas14), net: round2(net), ltv: round2(ltv),
    beRoas: round2(beRoas), scaleRoas: round2(scaleRoas), trimRoas: round2(trimRoas),
    reserve: round2(reserve), free: round2(free), leak,
    adTarget, testWeek: round2(testWeek), note,
  };
}

/** Monday, after the budget review: the week's numbers go in the world, the decision in the log, the line in the feed. */
export function cfoMonday(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const growth = w.company.growth;
  if (!growth) return;
  const a = allocationOf(w);
  growth.allocation = a;
  growth.ltvFactor = a.ltv;
  logDecision(w, {
    kind: 'budget', who: officerId(w, 'cfo'),
    text: `Semaine ${a.week} : ${eur(a.adTarget)}/jour de pub, ${eur(a.testWeek)} de tests`,
    why: `profit 7 j ${eur(a.profit7)}, pub ${eur(a.spend7)}/jour, ROAS 14 j ${a.roas14 === null ? '—' : dec(a.roas14)}, point mort ${dec(a.beRoas)}, réserve ${eur(a.reserve)}`,
    impactEur: round2(CFO.targetDays * (a.adTarget - a.spend7)),
  });
  speak(ctx, 'cfo', a.note, 'finance');
}
