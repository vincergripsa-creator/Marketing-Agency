// Which activities are new for the world (speech bubbles, flow lines, walks)? Pure, unit-tested.
import type { Activity } from '../../../shared/types';

export interface FreshItem { a: Activity; born: number }

/** Activities older than this (seconds) are only marked as seen, never animated. */
export const FRESH_MAX_AGE = 8;

export interface FreshState {
  /** activity id → world time (s) it was born at */
  seen: Map<string, number>;
  /** newest `at` (server clock, ms) ingested so far: ages are measured against it, so client/server skew never matters */
  newestAt: number;
}

export function freshState(): FreshState {
  return { seen: new Map(), newestAt: 0 };
}

/**
 * Marks unseen activities as seen and returns the ones young enough to animate.
 * - catchUp (first snapshot of a run): age = wall clock − at, so a page reload does not replay old bubbles;
 * - otherwise: age relative to the newest activity known, so the same line arriving twice (SSE batch, then
 *   the next snapshot) animates once, and a late batch of old lines is ignored.
 */
export function takeFresh(st: FreshState, acts: readonly Activity[] | undefined, now: number, wallMs: number, catchUp: boolean): FreshItem[] {
  const out: FreshItem[] = [];
  if (!acts?.length) return out;
  let newest = st.newestAt;
  for (const a of acts) if (a && typeof a.at === 'number' && a.at > newest) newest = a.at;
  for (const a of acts) {
    if (!a || typeof a.id !== 'string' || st.seen.has(a.id)) continue;
    const at = typeof a.at === 'number' ? a.at : 0;
    const age = catchUp ? Math.max(0, (wallMs - at) / 1000) : at > 0 && newest > 0 ? Math.max(0, (newest - at) / 1000) : 0;
    const born = catchUp ? now - age : now;
    st.seen.set(a.id, born);
    if (age < FRESH_MAX_AGE) out.push({ a, born });
  }
  st.newestAt = newest;
  return out;
}

/** Bounded memory: forget ids that are in none of the lists still on screen. */
export function pruneSeen(st: FreshState, keepLists: readonly (readonly Activity[] | undefined)[], max = 3000): void {
  if (st.seen.size <= max) return;
  const keep = new Set<string>();
  for (const list of keepLists) for (const a of list ?? []) if (a?.id) keep.add(a.id);
  for (const id of [...st.seen.keys()]) if (!keep.has(id)) st.seen.delete(id);
}

/**
 * Should the camera (re)frame the whole map when a new layout arrives? Yes the first time, and when the
 * previous fit only framed the placeholder drawn before the first snapshot — unless the user moved the camera.
 */
export function needsOverviewFit(fitted: boolean, fittedPlaceholder: boolean, userMoved: boolean): boolean {
  return !fitted || (fittedPlaceholder && !userMoved);
}
