/** The ledger is the single source of truth for money: cash = sum of all entries. */
import { nextId, round2 } from '../core/index.js';
import type { FinanceSnapshot, LedgerEntry, LedgerType, WorldState } from '../shared.js';

const INCOME: ReadonlySet<LedgerType> = new Set<LedgerType>(['revenue', 'capital']);

/** Refs with these prefixes keep the caller's sign (reversals, payment reserves). */
export const HOLD_REF = 'hold:';
export const REVERSAL_REF = 'reversal:';

function keepsSign(ref: string | null | undefined): boolean {
  return !!ref && (ref.startsWith(HOLD_REF) || ref.startsWith(REVERSAL_REF));
}

/**
 * Books a money move. Signs are normalised by type (revenue/capital +, every cost −) so a caller
 * passing a positive cost can't create money; reversal/hold refs keep the given sign.
 */
export function recordLedger(world: WorldState, e: { type: LedgerType; amount: number; memo: string; ref?: string | null }): LedgerEntry {
  const raw = Number.isFinite(e.amount) ? e.amount : 0;
  let amount = round2(raw);
  if (!keepsSign(e.ref)) amount = INCOME.has(e.type) ? Math.abs(amount) : -Math.abs(amount);
  if (Object.is(amount, -0)) amount = 0;
  const entry: LedgerEntry = { id: nextId(world, 'led'), day: world.day, type: e.type, amount, memo: e.memo, ref: e.ref ?? null };
  world.ledger.push(entry);
  return entry;
}

export function cashOf(world: WorldState): number {
  let c = 0;
  for (const e of world.ledger) c += e.amount;
  return round2(c);
}

/** Holds are cash timing only, never profit or loss. */
function isHold(e: LedgerEntry): boolean {
  return !!e.ref && e.ref.startsWith(HOLD_REF);
}

export function financeSnapshot(world: WorldState): FinanceSnapshot {
  let cash = 0;
  let revenue = 0, refunds = 0, adSpend = 0, fees = 0, compute = 0, otherCosts = 0, profit = 0;
  let profit7d = 0, revenue7d = 0, adSpend7d = 0;
  const since = world.day - 7; // last 7 days = (day-6 .. day)
  for (const e of world.ledger) {
    cash += e.amount;
    if (e.type === 'capital' || isHold(e)) continue;
    profit += e.amount;
    const recent = e.day > since;
    if (recent) profit7d += e.amount;
    switch (e.type) {
      case 'revenue': revenue += e.amount; if (recent) revenue7d += e.amount; break;
      case 'refund': case 'chargeback': refunds -= e.amount; break;
      case 'ad_spend': adSpend -= e.amount; if (recent) adSpend7d -= e.amount; break;
      case 'payment_fee': case 'platform_fee': fees -= e.amount; break;
      case 'compute': compute -= e.amount; break;
      default: otherCosts -= e.amount; break;
    }
  }
  const days = Math.max(1, Math.min(7, world.day));
  const burn7d = round2(-profit7d / days);
  const runwayDays = profit7d >= 0 ? null : cash <= 0 ? 0 : burn7d > 0 ? Math.floor(cash / burn7d) : null;
  return {
    cash: round2(cash),
    revenue: round2(revenue), refunds: round2(refunds), adSpend: round2(adSpend), fees: round2(fees),
    compute: round2(compute), otherCosts: round2(otherCosts),
    profit: round2(profit),
    profit7d: round2(profit7d),
    burn7d: Object.is(burn7d, -0) ? 0 : burn7d,
    runwayDays,
    roas7d: adSpend7d > 0 ? round2(revenue7d / adSpend7d) : 0,
    bankrupt: cash < 0,
  };
}

/** Revenue of the last `days` days (holds excluded). */
export function revenueSince(world: WorldState, days: number): number {
  const since = world.day - days;
  let r = 0;
  for (const e of world.ledger) if (e.type === 'revenue' && e.day > since && !isHold(e)) r += e.amount;
  return round2(r);
}

/** Net amount still held in payment reserves (≤ 0). */
export function heldAmount(world: WorldState): number {
  let h = 0;
  for (const e of world.ledger) if (isHold(e)) h += e.amount;
  return round2(h);
}
