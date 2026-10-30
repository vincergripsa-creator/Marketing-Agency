// Live activity ingestion of the world (bubbles/flows between snapshots). Run: cd server && npx vitest run --root ../web/src
import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../shared/types';
import { freshState, needsOverviewFit, pruneSeen, takeFresh } from './fresh';

const act = (id: string, at: number, o: Partial<Activity> = {}): Activity => ({ id, day: 3, tick: 4, at, agentId: 'camille', kind: 'thought', text: id, ...o });

describe('takeFresh', () => {
  it('an SSE batch animates once, the next snapshot carrying the same lines does not replay them', () => {
    const st = freshState();
    const batch = [act('a1', 10_000), act('a2', 10_200)];
    expect(takeFresh(st, batch, 50, 10_300, false).map((f) => f.a.id)).toEqual(['a1', 'a2']);
    const snapshot = [act('a0', 9_000), ...batch, act('a3', 10_400)];
    expect(takeFresh(st, snapshot, 51, 10_500, false).map((f) => f.a.id)).toEqual(['a0', 'a3']);
    expect(takeFresh(st, snapshot, 52, 10_600, false)).toEqual([]);
  });

  it('first snapshot of a run: lines older than 8 s (wall clock) are only marked as seen', () => {
    const st = freshState();
    const fresh = takeFresh(st, [act('old', 0), act('new', 99_000)], 100, 100_000, true);
    expect(fresh.map((f) => f.a.id)).toEqual(['new']);
    expect(fresh[0]!.born).toBeCloseTo(99, 5); // aged by 1 s
    expect(st.seen.has('old')).toBe(true);
  });

  it('a late batch of old lines (relative to the newest known) is ignored — immune to clock skew', () => {
    const st = freshState();
    takeFresh(st, [act('recent', 1_000_000)], 10, 0, false); // client clock far behind the server
    expect(takeFresh(st, [act('stale', 1_000_000 - 30_000)], 11, 0, false)).toEqual([]);
    expect(takeFresh(st, [act('live', 1_000_500)], 12, 0, false).map((f) => f.a.id)).toEqual(['live']);
  });

  it('skips malformed entries', () => {
    const st = freshState();
    expect(takeFresh(st, [null as unknown as Activity, { ...act('x', 1), id: 3 as unknown as string }], 1, 1, false)).toEqual([]);
    expect(takeFresh(st, undefined, 1, 1, false)).toEqual([]);
  });
});

describe('pruneSeen', () => {
  it('keeps every id still on screen (snapshot AND live list) so nothing gets replayed', () => {
    const st = freshState();
    const snapshot = [act('s1', 1), act('s2', 2)];
    const live = [...snapshot, act('l1', 3)];
    takeFresh(st, [act('gone', 0), ...live], 1, 3, false);
    pruneSeen(st, [snapshot, live], 2);
    expect([...st.seen.keys()].sort()).toEqual(['l1', 's1', 's2']);
    expect(takeFresh(st, live, 2, 4, false)).toEqual([]);
  });
});

describe('needsOverviewFit — camera framing on load', () => {
  it('re-frames the real map when the previous fit only framed the pre-snapshot placeholder', () => {
    expect(needsOverviewFit(false, false, false)).toBe(true); // never fitted
    expect(needsOverviewFit(true, true, false)).toBe(true); // fitted the plaza-only placeholder (zoom ×2.2)
    expect(needsOverviewFit(true, true, true)).toBe(false); // the user already took the camera
    expect(needsOverviewFit(true, false, false)).toBe(false); // roster change later: keep the framing
  });
});
