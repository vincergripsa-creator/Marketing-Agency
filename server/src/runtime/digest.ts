/** The founder's weekly digest and the decision log (scale §3). Dormant until P10.3. */
import type { DecisionRecord, WeekRollup, WorldState } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';

/** One week of the ledger; null until P10.3 writes it. */
export function weekRollup(_w: WorldState, _fromDay: number, _toDay: number): WeekRollup | null {
  return null;
}

/** Unsaved, and no nextId: a stub must not move the ids of a run (D47). */
export function logDecision(w: WorldState, d: Omit<DecisionRecord, 'id' | 'day'>): DecisionRecord {
  return { id: `dec_${w.day}`, day: w.day, ...d };
}

/** Every Sunday, brain/journal/semaine-NNN.md. */
export async function weeklyNote(_ctx: RuntimeCtx, _week: WeekRollup): Promise<void> {
  /* P10.3 */
}
