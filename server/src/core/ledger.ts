/**
 * Pure summary of the ledger: the one place that says what the entries mean for cash and profit.
 * The sim's financeSnapshot and the API's fallbacks (run list, snapshot) all read it, so they cannot disagree.
 */
import type { DailyKpi, FinanceSnapshot, LedgerEntry } from '../shared.js';
import { round2 } from './ids.js';

/** Refs with these prefixes keep the caller's sign (reversals, payment reserves). */
export const HOLD_REF = 'hold:';
export const REVERSAL_REF = 'reversal:';
/** Ledger ref of the one-off launch costs (FEES.setupCost): a real cost, but not a daily burn. */
export const SETUP_REF = 'setup';

/** One-off costs: the launch, and the 7 days of pay of a hire or a departure (org §5). Real money, not a daily burn. */
function isOneOff(ref: string | null | undefined): boolean {
  return !!ref && (ref === SETUP_REF || ref.startsWith('hire:') || ref.startsWith('leave:'));
}

/** Holds are cash timing only, never profit or loss. */
export function isHold(e: Pick<LedgerEntry, 'ref'>): boolean {
  return !!e.ref && e.ref.startsWith(HOLD_REF);
}

/**
 * Last day whose market close is booked (its 'fixed:<day>' entries). Before that entry the day is still
 * open, with partial numbers. A ledger without any close (hand-kept, tests) counts `day` as closed.
 */
export function lastClosedLedgerDay(ledger: readonly LedgerEntry[], day: number): number {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const m = /^fixed:(\d+)/.exec(ledger[i]!.ref ?? '');
    if (m) return Number(m[1]);
  }
  return day;
}

export interface LedgerSummary extends FinanceSnapshot {
  capital: number;
  payroll: number;
}

/**
 * Cash, totals and 7-day figures from the signed amounts. The 7-day window holds the last 7 CLOSED days, never
 * the open one. Amounts are signed by recordLedger, so a reversal cancels its payout and a hold its release.
 * @param outageDays announced outage days: nothing could sell, so they do not measure the ads (ROAS)
 */
/** A day with nothing to read: no sale, no refund, no ad. No number of that day can confirm anything. */
export const quietDay = (k: Pick<DailyKpi, 'sales' | 'refunds' | 'adSpend'>): boolean => k.sales === 0 && k.refunds === 0 && k.adSpend === 0;

export function summarizeLedger(ledger: readonly LedgerEntry[], day: number, outageDays: Iterable<number> = []): LedgerSummary {
  let cash = 0, capital = 0;
  let revenue = 0, refunds = 0, adSpend = 0, fees = 0, compute = 0, payroll = 0, otherCosts = 0, profit = 0;
  let profit7d = 0, oneOff7d = 0, revenue7d = 0, adSpend7d = 0;
  const closed = lastClosedLedgerDay(ledger, day);
  const outage = new Set(outageDays);
  for (const e of ledger) {
    const amount = Number.isFinite(e.amount) ? e.amount : 0;
    cash += amount;
    if (e.type === 'capital') capital += amount;
    if (e.type === 'capital' || isHold(e)) continue;
    profit += amount;
    const recent = e.day > closed - 7 && e.day <= closed;
    if (recent) profit7d += amount;
    if (recent && isOneOff(e.ref)) oneOff7d += amount;
    const inRoas = recent && !outage.has(e.day);
    switch (e.type) {
      case 'revenue': revenue += amount; if (inRoas) revenue7d += amount; break;
      case 'refund': case 'chargeback': refunds -= amount; break;
      case 'ad_spend': adSpend -= amount; if (inRoas) adSpend7d -= amount; break;
      case 'payment_fee': case 'platform_fee': fees -= amount; break;
      case 'compute': compute -= amount; break;
      case 'salary': case 'recruiting': payroll -= amount; break;
      default: otherCosts -= amount; break;
    }
  }
  const days = Math.max(1, Math.min(7, closed));
  const burn7d = round2(-(profit7d - oneOff7d) / days);
  const runwayDays = cash <= 0 ? 0 : burn7d > 0 ? Math.floor(cash / burn7d) : null;
  return {
    cash: round2(cash),
    revenue: round2(revenue), refunds: round2(refunds), adSpend: round2(adSpend), fees: round2(fees),
    compute: round2(compute), otherCosts: round2(otherCosts), payroll: round2(payroll),
    profit: round2(profit),
    profit7d: round2(profit7d),
    burn7d: Object.is(burn7d, -0) ? 0 : burn7d,
    runwayDays,
    roas7d: adSpend7d > 0 ? round2(revenue7d / adSpend7d) : 0,
    bankrupt: cash < 0,
    capital: round2(capital),
  };
}
