import { financeSnapshot } from '../sim/index.js';
import type { CompanySnapshot, FinanceSnapshot, WorldState } from '../shared.js';
import { estimateFinance, serializeLiveSnapshot, serializeSnapshot } from './trim.js';

/** Sim finance, or a ledger-only estimate if the sim throws (the UI must always get a snapshot). */
export function safeFinance(world: WorldState): FinanceSnapshot {
  try {
    return financeSnapshot(world);
  } catch {
    return estimateFinance(world);
  }
}

/** UI-safe view of the world (no hidden market truth unless `god`), bounded to ~700 KB. */
export function toSnapshot(world: WorldState, god = false): CompanySnapshot {
  return JSON.parse(snapshotJson(world, god)) as CompanySnapshot;
}

/** Same as toSnapshot but already serialised (avoids stringifying twice on hot paths like SSE). */
export function snapshotJson(world: WorldState, god = false, extra: Record<string, unknown> = {}): string {
  return serializeSnapshot(world, safeFinance(world), god, extra);
}

/** The light snapshot pushed on the live stream (see LIVE_LIMITS). */
export function liveSnapshotJson(world: WorldState, god = false, extra: Record<string, unknown> = {}): string {
  return serializeLiveSnapshot(world, safeFinance(world), god, extra);
}
