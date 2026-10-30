/** The ledger is the single source of truth for money: cash = sum of all entries. */
import { HOLD_REF, REVERSAL_REF, SETUP_REF, isHold, lastClosedLedgerDay, nextId, round2, summarizeLedger } from '../core/index.js';
import type { FinanceSnapshot, LedgerEntry, LedgerType, WorldState } from '../shared.js';
import { announcedOutageDays } from './outage.js';

export { HOLD_REF, REVERSAL_REF, SETUP_REF };

const INCOME: ReadonlySet<LedgerType> = new Set<LedgerType>(['revenue', 'capital']);

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

/**
 * Last day whose market close is booked. Before that entry the day is still open, with partial numbers.
 * A ledger without any close (hand-kept, tests) counts world.day as closed.
 */
export function lastClosedDay(world: WorldState): number {
  return lastClosedLedgerDay(world.ledger, world.day);
}

/** Cash, totals and the 7-day figures, from the shared ledger summary (outage days out of the ROAS). */
export function financeSnapshot(world: WorldState): FinanceSnapshot {
  const { capital: _capital, ...finance } = summarizeLedger(world.ledger, world.day, announcedOutageDays(world));
  return finance;
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
