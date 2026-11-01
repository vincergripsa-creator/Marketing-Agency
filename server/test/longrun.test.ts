/**
 * What must hold over months, at each stage gate from S10 on (`npm run test:long -w server`). The default run of `npm test`
 * skips it: `vitest --mode long` opens it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorldState } from '../src/shared.js';
import { buildSnapshot, serializeLiveSnapshot, SNAPSHOT_BUDGET_BYTES, TIGHT_LIMITS } from '../src/api/trim.js';
import { financeSnapshot } from '../src/sim/finance.js';
import { playLong, sizeKb, STATE_EXTRA, survivalFaults } from '../scripts/longrun.js';
import { LEGACY } from './legacy.js';

const compaction = vi.hoisted(() => ({ on: true, ran: 0 }));

vi.mock('../src/runtime/compaction.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/runtime/compaction.js')>();
  return {
    ...real,
    compactWorld: (w: WorldState) => {
      if (!compaction.on) return { day: w.day, rows: {}, dropFiles: [] };
      compaction.ran += 1;
      return real.compactWorld(w);
    },
  };
});

/** Every number the run decided on, day by day, and what it left behind. */
const series = (w: WorldState): Record<string, unknown> => ({
  kpis: w.company.kpis,
  ids: w.idCounter,
  cash: w.ledger.reduce((s, e) => s + e.amount, 0).toFixed(2),
  products: w.company.products.map((p) => [p.id, p.status, p.version, p.price, p.stats.sales, p.stats.revenue, p.stats.rating, p.stats.ratingCount]),
  lessons: w.company.lessons.map((l) => [l.key, l.insight, l.changedDay ?? l.day]),
  bandits: w.company.bandits,
  agents: w.company.agents.map((a) => [a.id, a.perf, a.xp, a.level]),
});

/** What differs between two runs, by name: empty, or the first thing to read. */
function gaps(a: WorldState, b: WorldState): string[] {
  const x = series(a);
  const y = series(b);
  return Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}

/** What each evening holds that KPIs can miss: who stands where, what ids were spent, what the feed said. */
const evening = (day: number, w: WorldState): string => JSON.stringify([day, w.idCounter, w.company.agents.map((a) => [a.id, a.perf, a.level]), w.activity.slice(-30).map((x) => x.text)]);

/** What the stream and GET /api/state weigh on a real world: scale §7.1. TIGHT's own size, with its session and films (D155): a fallback to LIVE must not read as a pass. */
function snapshotSizes(w: WorldState): { day: number; live: number; state: number } {
  const finance = financeSnapshot(w);
  return { day: w.day, live: Buffer.byteLength(serializeLiveSnapshot(w, finance)), state: Buffer.byteLength(JSON.stringify({ ...buildSnapshot(w, finance, false, TIGHT_LIMITS), ...STATE_EXTRA })) };
}

async function both(run: Parameters<typeof playLong>[0]): Promise<{ on: WorldState; off: WorldState; onDays: string[]; offDays: string[]; sizes: ReturnType<typeof snapshotSizes>[] }> {
  const onDays: string[] = [];
  const offDays: string[] = [];
  const sizes: ReturnType<typeof snapshotSizes>[] = [];
  compaction.on = true;
  const on = await playLong(run, (k, w) => {
    onDays.push(evening(k.day, w));
    if (k.day % 30 === 0) sizes.push(snapshotSizes(w));
  });
  compaction.on = false;
  const off = await playLong(run, (k, w) => offDays.push(evening(k.day, w)));
  return { on, off, onDays, offDays, sizes };
}

function firstGap(a: WorldState, b: WorldState): string {
  const gap = a.company.kpis.find((k, i) => JSON.stringify(k) !== JSON.stringify(b.company.kpis[i]));
  if (!gap) return 'aucun écart de KPI';
  return `jour ${gap.day} : ${JSON.stringify(gap)} contre ${JSON.stringify(b.company.kpis.find((k) => k.day === gap.day))}`;
}

const mode = (import.meta as ImportMeta & { env: { MODE: string } }).env.MODE;

describe.runIf(mode === 'long')('over months', () => {
  it.each([
    ['the default company', Number(process.env.LONG_SEED ?? 7), {}],
    ['the legacy company', 42, LEGACY],
  ])('compaction changes no decision: %s, 150 days, on and off, byte for byte', async (_name, seed, scenario) => {
    compaction.ran = 0;
    const { on, off, onDays, offDays, sizes } = await both({ days: 150, seed, scenario });
    expect(compaction.ran).toBe(21);
    expect(on.company.tasks.length).toBeLessThan(off.company.tasks.length);
    expect(on.company.archive!.tasks).toBeGreaterThan(0);
    expect(firstGap(on, off)).toBe('aucun écart de KPI');
    expect(gaps(on, off)).toEqual([]);
    expect(onDays.findIndex((d, i) => d !== offDays[i])).toBe(-1);
    expect(sizes).toHaveLength(5);
    expect(sizes.filter((s) => s.live > 400_000 || s.state > SNAPSHOT_BUDGET_BYTES)).toEqual([]);
  }, 900_000);

  it.each([1])('a year on seed %i: no crash, the ledger is the cash', async (seed) => {
    const world = await playLong({ days: 365, seed });
    expect(world.day).toBeGreaterThan(365);
    expect(survivalFaults(world, seed)).toEqual([]);
  }, 900_000);
});

/** A check of this script is only worth what it can fail on: A6, A7 and A8 read these. */
describe('what a long run can fail on', () => {
  it('at the end of a run, when the clock has moved on: a ledger that is not the cash, a broken org rule', async () => {
    const w = await playLong({ days: 3, seed: 7 });
    expect(w.day).toBeGreaterThan(w.company.kpis.at(-1)!.day);
    expect(survivalFaults(w, 7)).toEqual([]);
    w.company.org!.stats.violations = 2;
    expect(survivalFaults(w, 7)).toEqual([expect.stringContaining('2 règle(s)')]);
    w.company.org!.stats.violations = 0;
    w.ledger.push({ ...w.ledger.at(-1)!, day: w.company.kpis.at(-1)!.day, amount: 1000 });
    expect(survivalFaults(w, 7)).toEqual([expect.stringContaining('au grand livre')]);
  }, 300_000);

  it('a payload weighs what the server budgets: bytes, in thousands', () => {
    expect(sizeKb('é'.repeat(1000))).toBe(2);
  });
});
