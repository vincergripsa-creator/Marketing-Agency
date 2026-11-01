/**
 * The calibration's rules, on hand-made runs: every check at both sides of its number, the decision rule, the readers of scale §9.1
 * and talent §10.2, the rule of D122. And what the tool stands on: an override that really reaches its reader, one object at a time.
 * One smoke of Step 1, at the end, is the only simulation here: it holds the tool to what the rules assume of its seeds.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/index.js';
import { reconcile, RECON } from '../src/learning/attribution.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { elasticity } from '../src/runtime/allocator.js';
import { allocationOf, CFO } from '../src/runtime/cfo.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { compactWorld, COMPACT } from '../src/runtime/compaction.js';
import { payOf } from '../src/runtime/org/payroll.js';
import { PORTFOLIO, retestDue } from '../src/runtime/portfolio.js';
import { evaluateStage, policyOf } from '../src/runtime/stages.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { craftOf } from '../src/runtime/talent/craft.js';
import { drawPerson } from '../src/runtime/talent/truth.js';
import { ADS, CONVERSION } from '../src/sim/balance.js';
import { nichePool } from '../src/sim/capacity.js';
import { FAMILY_FATIGUE, TIKTOK_OVERLAP } from '../src/sim/channelBalance.js';
import {
  channelSignals, deliverSearch, deliverySpec, ensureChannelMarket, familyPrior, learningAfterUpdate, overlapOf, reachOf, rollChannelEvents, runPaidTails, warmth,
} from '../src/sim/channels.js';
import { runClaims } from '../src/sim/claims.js';
import { kitPrice } from '../src/sim/growth.js';
import { tempoFit } from '../src/sim/videoCraft.js';
import { visualCvr } from '../src/sim/visual.js';
import type { AdCreative, Campaign, DailyAdStats, MarketState, NicheTruth, Product, Skill, Task, VisualReport, WeekRollup, WorldState } from '../src/shared.js';
import { adWindow, applyOverrides, bankruptBy, closeOn, constantAt, deadAtEnd, survivalOn, type DayRow, type RatedPair, type RunResult, type RunSpec } from '../scripts/balanceLib.js';
import {
  armScenario, assertCandidates, assertWinnerWritten, averageRoasRow, bootstrapMedian, CANDIDATES, candidateEdits, checksOf, codeStamp, decide, DECISION_ORDER, designRow, FULL_READS, identicalSeeds,
  insuranceDue, k1, k2, k3, k4, k5, k6, k7, k8, lastClickRow, leagueRead, leagueSwitch, legacyRow, leverOutcome, MAX_IDENTICAL, netWeeks, noHireRow, noiseFloor, noiseRead, noLearningRow, pairedRatio, PAR_MARKER,
  PLACEBO_CTR, pooledPars, ratio, ratingValidity, ratios, Refused, retestRead, retestRow, rewritePars, scaleRead, seedCounts, spearman, table, TARGET_MEDIAN, tempoRow, theilSen, threshold, tiktokRow, videoSkillRow,
  weekTrend, type Check, type Run,
} from '../scripts/calibrateLib.js';

const READS = FULL_READS;

const row = (day: number, over: Partial<DayRow> = {}): DayRow => ({
  day, cash: 400, ledgerCash: 400, revenue: 0, adRevenue: 0, adSpend: 0, cumulativeProfit: 0, sales: 0, refunds: 0, impressions: 0, clicks: 0,
  freshImpressions: 0, freshClicks: 0, fitSum: 0, fitImpressions: 0, sellable: true, banned: false, survival: false, nan: [], ...over,
});

function run(seed: number, over: Partial<Run> = {}): Run {
  return {
    difficulty: 'normal', seed, days: 182, budget: 500, mindMode: 'heuristic', finalCash: 500, profit: 0, peakProfit: 0, firstProfitDay: null, goalDay: null,
    bankrupt: false, bankruptDay: null, finalStatus: 'finished', products: 0, live: 0, killed: 0, paused: 0, sales: 0, revenue: 0, adSpend: 0,
    roas1: null, roas2: null, ctr1: null, ctr2: null, fresh1: null, fresh2: null, fit1: null, fit2: null, refundPct: 0, lessons: 0, headcount: 8, payroll: 0,
    hires: 0, departures: 0, replacements: 0, violations: 0, survivalDays: 0, cliffs: [], stalls: [], kpiMismatchDays: [], nanDays: [], awaitingFounder: 0, seconds: 0, dir: null,
    rows: [], cashOn: { d60: null, d90: null, d120: null, d180: null, last: null }, league: null, talentTruth: null, growth: { weeks: [] }, work: { tasks: 0, talent: 0 }, ratings: [],
    ...over,
  };
}

/** `n` seeds, the first `yes` of them built one way, the others another. */
function arm(n: number, yes: number, a: Partial<Run>, b: Partial<Run> = {}): Run[] {
  return Array.from({ length: n }, (_, i) => run(i + 1, i < yes ? a : b));
}

const profitAt = (points: Record<number, number>): DayRow[] => Object.entries(points).map(([d, cumulativeProfit]) => row(Number(d), { cumulativeProfit }));
const negativeOn = (day: number): DayRow[] => [row(day - 1), row(day, { cash: -5 }), row(day + 1)];
const weeksOf = (net: Record<number, number>): WeekRollup[] => Object.entries(net).map(([week, revenue]) => ({ week: Number(week), revenue, refunds: 0 } as WeekRollup));
/** A straight line of weekly net revenue from `start` at week 9 to `end` at week 26. */
const rising = (start: number, end: number): WeekRollup[] => weeksOf(Object.fromEntries(Array.from({ length: 18 }, (_, i) => [9 + i, start + ((end - start) * i) / 17])));

// ───────────────────────────── K1-K8 ─────────────────────────────

describe('the checks, at both sides of their number', () => {
  const goal = { rows: profitAt({ 40: 1000 }) };
  const late = { rows: profitAt({ 61: 1000 }) };

  it('K1: the goal by D60 on 15 to 27 of 30, and a goal on D61 does not count', () => {
    expect(k1(arm(30, 14, goal, late), READS).pass).toBe(false);
    expect(k1(arm(30, 15, goal, late), READS).pass).toBe(true);
    expect(k1(arm(30, 27, goal, late), READS).pass).toBe(true);
    expect(k1(arm(30, 28, goal, late), READS).pass).toBe(false);
  });

  it('K2: the median at D60 between 1 000 € and 4 000 €, on runs that went on to D182', () => {
    const at = (x: number) => [run(1, { profit: 90_000, rows: profitAt({ 60: x, 182: 90_000 }) })];
    expect(k2(at(999), READS).pass).toBe(false);
    expect(k2(at(1000), READS).pass).toBe(true);
    expect(k2(at(4000), READS).pass).toBe(true);
    expect(k2(at(4001), READS).pass).toBe(false);
  });

  it('K3: at most 2 at D60 and at most 2 at D180, a close below zero that came back counted', () => {
    const early = { rows: negativeOn(50) };
    const later = { rows: negativeOn(100) };
    const after = { rows: negativeOn(181) };
    expect(k3(arm(30, 2, early), READS).pass).toBe(true);
    expect(k3(arm(30, 3, early), READS).pass).toBe(false);
    expect(k3(arm(30, 2, later), READS).pass).toBe(true);
    expect(k3(arm(30, 3, later), READS).pass).toBe(false);
    expect(k3(arm(30, 9, after), READS).pass).toBe(true);
  });

  it('K4: `facile`, the goal on at least 24 of 30 and no bankruptcy', () => {
    expect(k4(arm(30, 24, goal), READS).pass).toBe(true);
    expect(k4(arm(30, 23, goal), READS).pass).toBe(false);
    expect(k4([...arm(30, 29, goal), run(30, { rows: [...profitAt({ 40: 1000 }), row(41, { cash: -1 })] })], READS).pass).toBe(false);
    expect(k4([...arm(30, 29, goal), run(30, { rows: [...profitAt({ 40: 1000 }), row(100, { cash: -1 })] })], READS).pass).toBe(true); // past its 60 days, nothing reads it
  });

  it('K5: `cauchemar`, at most 8 bankruptcies and a median final cash of 250 €', () => {
    const dip = { rows: negativeOn(30), finalCash: 250 };
    const fine = { finalCash: 250 };
    expect(k5(arm(30, 8, dip, fine), READS).pass).toBe(true);
    expect(k5(arm(30, 9, dip, fine), READS).pass).toBe(false);
    expect(k5(arm(30, 0, fine, { finalCash: 249 }), READS).pass).toBe(false);
  });

  it('K6: no violation, Σ ledger = cash on every evening and at the end, no NaN', () => {
    const clean = run(1, { finalCash: 400, rows: [row(1)] });
    expect(k6([clean, clean]).pass).toBe(true);
    expect(k6([clean, { ...clean, violations: 1 }]).pass).toBe(false);
    expect(k6([clean, { ...clean, kpiMismatchDays: [3] }]).pass).toBe(false);
    expect(k6([clean, { ...clean, nanDays: [3] }]).pass).toBe(false);
    expect(k6([{ ...clean, finalCash: 401 }]).pass).toBe(false);
  });

  it('K7: a median of at least 1 replacement per seed', () => {
    const swap = { day: 100, skill: 'copy' as Skill, replaced: 'a', hired: 'b', tReplaced: 0.4, tHired: 0.6, familyMean: 0.5 };
    const swapped = { talentTruth: { samples: [], swaps: [swap] } };
    expect(k7(arm(30, 16, swapped)).pass).toBe(true);
    expect(k7(arm(30, 15, swapped)).pass).toBe(false); // 15 at 1 and 15 at 0: the median of the seeds reads .5
    expect(k7(arm(30, 14, swapped)).pass).toBe(false);
  });

  it('K8: the slope of weeks 9-26 above 0 on at least 24 of 30, and a median of week 26 / week 9 of at least 2,0', () => {
    const up = { growth: { weeks: rising(1000, 2000) } };
    const flat = { growth: { weeks: rising(1000, 1000) } };
    expect(k8(arm(30, 24, up, flat), READS).pass).toBe(true);
    expect(k8(arm(30, 23, up, flat), READS).pass).toBe(false);
    expect(k8(arm(30, 30, { growth: { weeks: rising(1000, 1900) } }), READS).pass).toBe(false);
    expect(k8(arm(30, 30, { growth: { weeks: [] } }), READS).pass).toBe(false);
  });

  it('runs the eight, and K6 on every run of the candidate, the three difficulties together', () => {
    const c = { normal: [run(1)], facile: [run(2, { violations: 1 })], cauchemar: [run(3)] };
    const checks = checksOf(c, READS);
    expect(checks.map((k) => k.id)).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']);
    expect(checks.find((k) => k.id === 'K6')).toMatchObject({ pass: false, value: expect.stringContaining('3 runs') });
  });

  it('the insurance waits for K3 or K5 under the winner, nothing else', () => {
    const check = (id: string, pass: boolean): Check => ({ id, pass, value: '', target: '' });
    expect(insuranceDue([check('K3', true), check('K5', true), check('K1', false)])).toBe(false);
    expect(insuranceDue([check('K3', false), check('K5', true)])).toBe(true);
    expect(insuranceDue([check('K3', true), check('K5', false)])).toBe(true);
  });
});

// ───────────────────────────── the decision ─────────────────────────────

describe('the decision rule of D121', () => {
  const N = 300;

  it('among those that pass all eight, the closest to 1 800 €', () => {
    const r = decide([{ id: 'A', failed: 1, median: 1800 }, { id: 'C', failed: 0, median: 3000 }, { id: 'B', failed: 0, median: 2200 }], N);
    expect(r.winner).toBe('B');
    expect(r.reason).toContain('2 passe(nt) les huit contrôles');
  });

  it('none passes: the fewest failed, then the closest', () => {
    expect(decide([{ id: 'A', failed: 3, median: 1800 }, { id: 'G', failed: 1, median: 1000 }, { id: 'C', failed: 1, median: 3400 }], N).winner).toBe('G');
  });

  it('a tie goes to the first in the order A, D, F, B, G, E, C', () => {
    expect(DECISION_ORDER).toEqual(['A', 'D', 'F', 'B', 'G', 'E', 'C']);
    expect(decide([{ id: 'E', failed: 0, median: 2000 }, { id: 'F', failed: 0, median: 1600 }, { id: 'G', failed: 0, median: 2000 }], 0).winner).toBe('F');
  });

  it('a gap under the noise goes to the first in the order, a gap of the noise or more to the closest', () => {
    expect(decide([{ id: 'C', failed: 0, median: 1800 }, { id: 'A', failed: 0, median: 2499 }], 700).winner).toBe('A');
    expect(decide([{ id: 'C', failed: 0, median: 1800 }, { id: 'A', failed: 0, median: 2500 }], 700).winner).toBe('C');
  });

  it('the noise never reads under 420 €: an N of 0 cannot hand the winner to a median that landed nearest by chance (D124)', () => {
    expect(decide([{ id: 'C', failed: 0, median: 1800 }, { id: 'A', failed: 0, median: 2219 }], 0).winner).toBe('A');
    expect(decide([{ id: 'C', failed: 0, median: 1800 }, { id: 'A', failed: 0, median: 2220 }], 0).winner).toBe('C');
  });

  it('aims for 1 800 €, on both sides of it', () => {
    expect(TARGET_MEDIAN).toBe(1800);
    expect(decide([{ id: 'B', failed: 0, median: 1000 }, { id: 'C', failed: 0, median: 2100 }], N).winner).toBe('C');
    expect(decide([{ id: 'C', failed: 0, median: 1500 }, { id: 'D', failed: 0, median: 2100 }], N).winner).toBe('D');
  });

  it('a candidate without a median is the farthest, and no candidate is an error', () => {
    expect(decide([{ id: 'A', failed: 0, median: null }, { id: 'C', failed: 0, median: 9000 }], N).winner).toBe('C');
    expect(() => decide([], N)).toThrow();
  });

  it('every paired threshold is the larger of 420 € and N', () => {
    expect(threshold(100)).toBe(420);
    expect(threshold(700)).toBe(700);
  });
});

describe('one list of candidates', () => {
  it('holds the seven of D120, with their values', () => {
    const of = (id: string) => CANDIDATES.find((c) => c.id === id)!.overrides;
    const pay = { 'ORG.payPerDay.haiku': 0.375, 'ORG.payPerDay.sonnet': 0.6, 'ORG.payPerDay.opus': 0.9 };
    expect(CANDIDATES.map((c) => c.id).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(of('A')).toEqual({});
    expect(of('B')).toEqual({ 'CONVERSION.base': 0.0195 });
    expect(of('C')).toEqual({ 'CONVERSION.base': 0.0165 });
    expect(of('D')).toEqual({ ...pay, 'TALENT.founderMean': 0.62 });
    expect(of('E')).toEqual({ 'CONVERSION.base': 0.0195, ...pay, 'TALENT.founderMean': 0.62 });
    expect(of('F')).toEqual({ ...pay, 'TALENT.marketMean': 0.6 });
    expect(of('G')).toEqual({ ...pay, 'TALENT.marketMean': 0.6, 'CONVERSION.poolBase': 240, 'CONVERSION.poolDemand': 900 });
    expect(of('G')).toMatchObject({ 'CONVERSION.poolBase': CONVERSION.poolBase * 2, 'CONVERSION.poolDemand': CONVERSION.poolDemand * 2 });
  });

  it('refuses any other: one short, one more, one moved value', () => {
    expect(() => assertCandidates([...CANDIDATES].reverse())).not.toThrow();
    expect(() => assertCandidates(CANDIDATES.slice(1))).toThrow(Refused);
    expect(() => assertCandidates([...CANDIDATES, { id: 'H', label: 'x', overrides: { 'CONVERSION.base': 0.02 } }])).toThrow(Refused);
    expect(() => assertCandidates(CANDIDATES.map((c) => (c.id === 'B' ? { ...c, overrides: { 'CONVERSION.base': 0.02 } } : c)))).toThrow(/pas de seconde liste/);
  });

  it('names the exact edits of a winner, file by file', () => {
    // On the constants as they stood before E was written: a value already in the code has no edit to name.
    const was = applyOverrides({ 'CONVERSION.base': 0.018, 'ORG.payPerDay.haiku': 0.5, 'ORG.payPerDay.sonnet': 0.8, 'ORG.payPerDay.opus': 1.2, 'TALENT.founderMean': 0.56 });
    try {
      expect(candidateEdits(CANDIDATES.find((c) => c.id === 'G')!, constantAt)).toEqual([
        'server/src/runtime/org/constants.ts : ORG.payPerDay.haiku 0.5 → 0.375',
        'server/src/runtime/org/constants.ts : ORG.payPerDay.sonnet 0.8 → 0.6',
        'server/src/runtime/org/constants.ts : ORG.payPerDay.opus 1.2 → 0.9',
        `server/src/runtime/talent/constants.ts : TALENT.marketMean ${TALENT.marketMean} → 0.6`,
        'server/src/sim/balance.ts : CONVERSION.poolBase 120 → 240',
        'server/src/sim/balance.ts : CONVERSION.poolDemand 450 → 900',
      ]);
      expect(candidateEdits(CANDIDATES.find((c) => c.id === 'E')!, constantAt)).toEqual([
        'server/src/sim/balance.ts : CONVERSION.base 0.018 → 0.0195',
        'server/src/runtime/org/constants.ts : ORG.payPerDay.haiku 0.5 → 0.375',
        'server/src/runtime/org/constants.ts : ORG.payPerDay.sonnet 0.8 → 0.6',
        'server/src/runtime/org/constants.ts : ORG.payPerDay.opus 1.2 → 0.9',
        'server/src/runtime/talent/constants.ts : TALENT.founderMean 0.56 → 0.62',
      ]);
    } finally {
      applyOverrides(was);
    }
  });
});

// ───────────────────────────── readers ─────────────────────────────

describe('reading a run', () => {
  it('Theil-Sen is the median of the slopes, and one mad week does not move it', () => {
    expect(theilSen([[1, 10], [2, 20], [3, 30]])).toBe(10);
    expect(theilSen([[1, 10], [2, 20], [3, 30], [4, 40], [5, 5000]])).toBe(10);
    expect(theilSen([[1, 10], [2, 0], [3, -10]])).toBe(-10);
    expect(theilSen([[1, 10]])).toBeNull();
  });

  it('the window of the slope holds its first week and its last', () => {
    const r = run(1, { growth: { weeks: weeksOf({ 8: 9000, 9: 100, 10: 100, 26: 5000, 27: 9000 }) } });
    const { slope, growth } = weekTrend(r, [9, 26]);
    expect(slope).toBeCloseTo(4900 / 17, 9);
    expect(growth).toBe(50);
    expect(weekTrend(run(1, { growth: { weeks: weeksOf({ 9: -50, 26: -10 }) } }), [9, 26]).growth).toBe(0); // a run's own end over its start: a dead seed counts against
  });

  it('a weekly net is revenue minus refunds, and a week rolled twice counts once', () => {
    const weeks = [{ week: 3, revenue: 100, refunds: 20 }, { week: 3, revenue: 100, refunds: 20 }] as WeekRollup[];
    expect([...netWeeks(run(1, { growth: { weeks } }))]).toEqual([[3, 80]]);
  });

  it('a ratio over nothing never divides: what grew reads Infinity, what did not reads 0', () => {
    expect(ratio(10, 4)).toBe(2.5);
    expect(ratio(10, 0)).toBe(Infinity);
    expect(ratio(-5, -20)).toBe(0);
  });

  it('two arms of one market keep their order whatever the sign (D126)', () => {
    expect(pairedRatio(10, 4)).toBe(2.5);
    expect(pairedRatio(-5, 20)).toBe(-0.25);
    expect(pairedRatio(-100, -500)).toBe(5);
    expect(pairedRatio(-500, -100)).toBe(0.2);
    expect(pairedRatio(-100, -100)).toBe(1);
    expect(pairedRatio(0, 0)).toBe(1);
    expect(pairedRatio(10, 0)).toBe(Infinity);
    expect(pairedRatio(0, -10)).toBe(Infinity);
    expect(pairedRatio(-10, 0)).toBe(0);
    const profit = (r: Run) => r.profit;
    expect(ratios([run(1, { profit: -100 })], [run(1, { profit: -500 })], profit)).toEqual([5]);
  });

  it('Spearman ranks with ties, and says nothing when one side does not move', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 9);
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.949, 3);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('the bootstrap interval of the median is the same each time, and holds the median', () => {
    const xs = Array.from({ length: 30 }, (_, i) => i - 5);
    const ci = bootstrapMedian(xs)!;
    expect(bootstrapMedian(xs)).toEqual(ci);
    expect(ci[0]).toBeLessThan(9.5);
    expect(ci[1]).toBeGreaterThan(9.5);
    expect(bootstrapMedian([])).toBeNull();
  });

  it('N is the median absolute paired difference, by seed', () => {
    const a = [run(1, { profit: 100 }), run(2, { profit: 100 }), run(3, { profit: 100 })];
    const b = [run(3, { profit: 700 }), run(2, { profit: 300 }), run(1, { profit: 0 })];
    expect(noiseFloor(a, b)).toBe(200);
  });

  it('the placebo is fixed, and a seed it did not touch leaves N', () => {
    expect(PLACEBO_CTR).toBe(1.01);
    expect(MAX_IDENTICAL).toBe(3);
    const rows = [row(1, { clicks: 7 })];
    const a = [run(1, { rows, profit: 100 }), run(2, { rows, profit: 100 }), run(3, { rows: [row(1)], profit: 100 }), run(4, { rows: [row(2)], profit: 100 })];
    const b = [run(1, { rows, profit: 100 }), run(2, { rows: [row(1)], profit: 100 }), run(3, { rows: [row(2)], profit: 300 }), run(4, { rows: [row(3)], profit: 700 })];
    expect(identicalSeeds(a, b)).toEqual([1]);
    expect(noiseRead(a, b)).toEqual({ N: 200, identical: [1], pairs: 4 }); // 0, 200, 600 with seed 1 read as a measure would give 100
  });

  it('past the limit of untouched seeds there is no N, and a limit can be lifted for a smoke', () => {
    const same = (n: number) => Array.from({ length: n }, (_, i) => run(i + 1));
    const moved = (seed: number) => run(seed, { rows: [row(seed)], profit: 500 });
    expect(noiseRead(same(6), [...same(3), moved(4), moved(5), moved(6)]).N).toBe(500);
    expect(noiseRead(same(6), [...same(4), moved(5), moved(6)])).toEqual({ N: null, identical: [1, 2, 3, 4], pairs: 6 });
    expect(noiseRead(same(2), same(2), Infinity)).toEqual({ N: null, identical: [1, 2], pairs: 2 }); // nothing to read: the caller says 0
  });

  it('a half reads the daily rows: past D90 the market has lost the rows of a first half', () => {
    const rows = [row(10, { adSpend: 50, adRevenue: 100, impressions: 3000, clicks: 90, freshImpressions: 3000, freshClicks: 120, fitSum: 2400, fitImpressions: 3000 }), row(120, { adSpend: 50, adRevenue: 60, impressions: 3000, clicks: 30 })];
    expect(adWindow(rows, 1, 91)).toMatchObject({ roas: 2, ctr: 0.03, freshCtr: 0.04, fit: 0.8 });
    expect(adWindow(rows, 92, 182)).toMatchObject({ roas: 1.2, ctr: 0.01, freshCtr: null, fit: null });
    expect(adWindow(rows, 11, 20)).toMatchObject({ roas: null, ctr: null });
  });

  it('survival reads the day of the evening, not the morning the clock has moved to', () => {
    const company = { budget: { day: 12, adCap: 0, survival: true, note: '' } } as WorldState['company'];
    expect(survivalOn({ company }, 12)).toBe(true);
    expect(survivalOn({ company }, 13)).toBe(false);
  });

  it('a bankruptcy is a negative close up to that day, recovered or not; dead is the last close', () => {
    const rows = [row(10), row(50, { cash: -3 }), row(60), row(182, { cash: 9000 })];
    expect(bankruptBy(rows, 49)).toBe(false);
    expect(bankruptBy(rows, 50)).toBe(true);
    expect(deadAtEnd(rows)).toBe(false);
    expect(deadAtEnd([...rows, row(183, { cash: -1 })])).toBe(true);
    expect(closeOn(rows, 60)?.cash).toBe(400);
    expect(closeOn(rows, 61)).toBeNull();
  });
});

describe('A1 to A5, scale §9.1', () => {
  const tail = (each: number) => weeksOf(Object.fromEntries([21, 22, 23, 24, 25, 26].map((w) => [w, each])));
  const days = (d60: number, d180: number) => profitAt({ 60: d60, 180: d180 });
  const good = { growth: { weeks: [...rising(1000, 1000).slice(0, 12), ...tail(2000)] }, rows: days(100, 300) };
  const base = { growth: { weeks: tail(1000) }, rows: days(100, 200) };
  const read = (full: Run[], control: Run[]) => scaleRead(full, control, control, READS).checks;
  const pass = (checks: Check[], id: string) => checks.find((c) => c.id === id)!.pass;

  it('A1: weeks 21-26 at least twice the control, above it on at least 24 of 30', () => {
    expect(pass(read(arm(30, 30, good), arm(30, 30, base)), 'A1')).toBe(true);
    expect(pass(read(arm(30, 30, { growth: { weeks: tail(1990) } }), arm(30, 30, base)), 'A1')).toBe(false);
    expect(pass(read(arm(30, 23, good, { growth: { weeks: tail(1000) } }), arm(30, 30, base)), 'A1')).toBe(false);
  });

  it('A1 needs all six weeks: a run that stopped at week 25 reads nothing', () => {
    const short = { growth: { weeks: weeksOf({ 21: 9000, 22: 9000, 23: 9000, 24: 9000, 25: 9000 }) } };
    expect(pass(read(arm(30, 30, short), arm(30, 30, base)), 'A1')).toBe(false);
  });

  it('A2: profit at D180 at least 1,5 times the control', () => {
    expect(pass(read(arm(30, 30, { rows: days(0, 300) }), arm(30, 30, base)), 'A2')).toBe(true);
    expect(pass(read(arm(30, 30, { rows: days(0, 299) }), arm(30, 30, base)), 'A2')).toBe(false);
  });

  it('A3: the slope and the end over the start, on the full arm', () => {
    expect(pass(read(arm(30, 24, { growth: { weeks: rising(1000, 2000) } }, { growth: { weeks: rising(1000, 1000) } }), arm(30, 30, base)), 'A3')).toBe(true);
    expect(pass(read(arm(30, 23, { growth: { weeks: rising(1000, 2000) } }, { growth: { weeks: rising(1000, 1000) } }), arm(30, 30, base)), 'A3')).toBe(false);
  });

  it('A4: profit at D60 at least 0,8 of the control', () => {
    expect(pass(read(arm(30, 30, { rows: days(80, 0) }), arm(30, 30, base)), 'A4')).toBe(true);
    expect(pass(read(arm(30, 30, { rows: days(79, 0) }), arm(30, 30, base)), 'A4')).toBe(false);
  });

  it('A4 on seeds lost in both arms: losing less reads above 1, a quarter more reads .8', () => {
    const loss = (x: number) => ({ rows: days(x, 0) });
    expect(pass(read(arm(30, 30, loss(-100)), arm(30, 30, loss(-500))), 'A4')).toBe(true);
    expect(pass(read(arm(30, 30, loss(-500)), arm(30, 30, loss(-500))), 'A4')).toBe(true);
    expect(pass(read(arm(30, 30, loss(-125)), arm(30, 30, loss(-100))), 'A4')).toBe(true);
    expect(pass(read(arm(30, 30, loss(-126)), arm(30, 30, loss(-100))), 'A4')).toBe(false);
  });

  it('A5: bankruptcies at most the control plus one', () => {
    const dip = { rows: negativeOn(100) };
    expect(pass(read(arm(30, 4, dip), arm(30, 3, dip)), 'A5')).toBe(true);
    expect(pass(read(arm(30, 5, dip), arm(30, 3, dip)), 'A5')).toBe(false);
  });

  it('the noise run reads the same numbers for nothing', () => {
    const noise = arm(30, 30, { growth: { weeks: tail(1100) }, rows: days(0, 250) });
    const { noise: n } = scaleRead(arm(30, 30, base), arm(30, 30, base), noise, READS);
    expect(n).toEqual({ floor: 50, a1: 1.1, a2: 1.25, identical: 0 });
    expect(scaleRead(arm(30, 30, base), arm(30, 30, base), arm(30, 30, base), READS).noise.identical).toBe(30);
  });
});

describe('M1 to M7, talent §10.2', () => {
  const swap = (tReplaced: number, tHired: number, familyMean = 0.5, day = 100) => ({ day, skill: 'copy' as Skill, replaced: 'a', hired: 'b', tReplaced, tHired, familyMean });
  const truth = (meanLeague: number, swaps: ReturnType<typeof swap>[] = []) => ({ talentTruth: { samples: [{ day: 60, meanLeague, workWeighted: 0 }], swaps } });
  const worked = (t: number) => ({ work: { tasks: 10, talent: 10 * t } });
  const read = (short: Run[], flat: Run[], long: Run[] = []) => leagueRead(short, flat, long, READS);
  const pass = (r: { checks: Check[] }, id: string) => r.checks.find((c) => c.id === id)!.pass;
  const flatArm = arm(30, 30, { ...truth(0.5), ...worked(0.5) });

  it('M1: mean talent at D60 at least +.03, positive on at least 22 of 30', () => {
    expect(pass(read(arm(30, 30, truth(0.53)), flatArm), 'M1')).toBe(true);
    expect(pass(read(arm(30, 30, truth(0.529)), flatArm), 'M1')).toBe(false);
    expect(pass(read(arm(30, 21, truth(0.7), truth(0.5)), flatArm), 'M1')).toBe(false);
  });

  it('M2: work-weighted talent at least +.06, positive on at least 24 of 30', () => {
    expect(pass(read(arm(30, 30, worked(0.56)), flatArm), 'M2')).toBe(true);
    expect(pass(read(arm(30, 30, worked(0.559)), flatArm), 'M2')).toBe(false);
    expect(pass(read(arm(30, 23, worked(0.9), worked(0.5)), flatArm), 'M2')).toBe(false);
  });

  it('M3: profit up on at least 20 of 30, a median above 0, a bootstrap interval without 0', () => {
    const profits = (up: number) => Array.from({ length: 30 }, (_, i) => run(i + 1, { profit: i < up ? 100 + i : -100 - i }));
    const none = arm(30, 0, {});
    expect(pass(read(profits(29), none), 'M3')).toBe(true);
    expect(pass(read(profits(19), none), 'M3')).toBe(false);
    expect(pass(read(arm(30, 20, { profit: 100 }, { profit: -100 }), none), 'M3')).toBe(true); // the sign test's own edge: the 90 % interval just clears 0
    expect(pass(read(arm(30, 20, { profit: 0 }, { profit: -100 }), none), 'M3')).toBe(false); // nothing above 0
    expect(pass(read(arm(36, 20, { profit: 100 }, { profit: -100 }), arm(36, 0, {})), 'M3')).toBe(false); // 20 up and a median above 0, an interval that holds 0
  });

  it('M4 to M6 read the long arm, where replacements exist', () => {
    const swaps = (...s: ReturnType<typeof swap>[]) => [run(1, truth(0, s))];
    expect(pass(read([], [], swaps(swap(0.4, 0.6), swap(0.4, 0.6), swap(0.4, 0.6), swap(0.4, 0.6), swap(0.4, 0.6), swap(0.4, 0.6), swap(0.4, 0.6), swap(0.6, 0.7), swap(0.6, 0.7), swap(0.6, 0.7))), 'M4')).toBe(true);
    expect(pass(read([], [], swaps(swap(0.4, 0.6), swap(0.4, 0.6), swap(0.6, 0.7))), 'M4')).toBe(false);
    expect(pass(read([], [], swaps(swap(0.5, 0.6))), 'M4')).toBe(false); // at the mean of the family is not under it
    expect(pass(read([], [], swaps(swap(0.4, 0.51))), 'M5')).toBe(true);
    expect(pass(read([], [], swaps(swap(0.4, 0.499))), 'M5')).toBe(false);
    const churn = (n: number) => truth(0, Array.from({ length: n }, () => swap(0.4, 0.6)));
    expect(pass(read([], [], arm(3, 3, churn(4))), 'M6')).toBe(true);
    expect(pass(read([], [], arm(3, 3, churn(5))), 'M6')).toBe(false);
    expect(pass(read([], [], [run(1, churn(1)), run(2, churn(1)), run(3, churn(7))]), 'M6')).toBe(false);
  });

  it('M7: per skill with at least 3 rated persons, every seed together, then pooled by persons', () => {
    const pair = (skill: Skill, rating: number, t: number): RatedPair => ({ skill, rating, truth: t });
    const honest = [pair('copy', 1400, 0.3), pair('copy', 1500, 0.5), pair('copy', 1600, 0.7)];
    const wrong = [pair('page', 1400, 0.7), pair('page', 1500, 0.5), pair('page', 1600, 0.3)];
    const thin = [pair('video', 1400, 0.7), pair('video', 1600, 0.3)];
    expect(ratingValidity([{ ratings: [...honest, ...thin] }])).toEqual({ rho: 1, skills: 1, persons: 3 });
    expect(ratingValidity([{ ratings: thin }]).rho).toBeNull();
    expect(ratingValidity([{ ratings: thin }, { ratings: thin }])).toEqual({ rho: -1, skills: 1, persons: 4 });
    expect(ratingValidity([{ ratings: honest }, { ratings: [...honest, ...wrong] }]).rho).toBeCloseTo(1 / 3, 9);
    expect(pass(read([run(1, { ratings: honest })], []), 'M7')).toBe(true);
    expect(pass(read([run(1, { ratings: wrong })], []), 'M7')).toBe(false);
    const ranked = (truths: number[]) => [run(1, { ratings: truths.map((t, i) => pair('copy', 1400 + i, t)) })];
    expect(pass(read(ranked([4, 1, 2, 7, 3, 6, 5]), []), 'M7')).toBe(true); // ρ = ,5
    expect(pass(read(ranked([4, 1, 2, 6, 3, 5]), []), 'M7')).toBe(false); // ρ = ,43
  });

  it('the counts of replacements by D60 and D180 are printed apart', () => {
    const r = read([], [], [run(1, truth(0, [swap(0.4, 0.6, 0.5, 56), swap(0.4, 0.6, 0.5, 170)])), run(2, truth(0, [swap(0.4, 0.6, 0.5, 181)]))]);
    expect(r.replacements).toEqual({ early: 1, late: 2, medianLate: 1 });
  });

  it('what fires: M4 under 50 % stops firing, M1 and M2 without M3 keep the league', () => {
    const c = (m1: boolean, m2: boolean, m3: boolean): Check[] => [['M1', m1], ['M2', m2], ['M3', m3]].map(([id, pass]) => ({ id: id as string, pass: pass as boolean, value: '', target: '' }));
    expect(leagueSwitch({ checks: c(true, true, true) }, 0.8)).toBeNull();
    expect(leagueSwitch({ checks: c(true, true, false) }, 0.8)).toContain('la ligue reste');
    expect(leagueSwitch({ checks: c(true, true, true) }, 0.49)).toContain('licenciements coupés');
    expect(leagueSwitch({ checks: c(true, true, true) }, 0.5)).toBeNull();
  });
});

describe('the retest rule of D122', () => {
  const revenue = (x: number) => ({ rows: [row(182, { revenue: 99_999 }), row(183, { revenue: x / 2 }), row(266, { revenue: x / 2 }), row(267, { revenue: 99_999 })] });
  const winner = arm(30, 30, revenue(1000));
  const placebo = arm(30, 30, revenue(1000));
  const any = (yes: number, x = 1200) => arm(30, yes, revenue(x), revenue(900));

  it('reads weeks 27-38 on the daily rows and adopts on all four conditions', () => {
    expect(retestRead(winner, any(30), placebo, READS)).toMatchObject({ adopted: true, medianRatio: 1.2, above: 30, placebo: 1 });
  });

  it('counts the placebo seeds it did not touch', () => {
    expect(retestRead(winner, any(30), placebo, READS).identical).toBe(30);
    expect(retestRead(winner, any(30), arm(30, 12, revenue(1000), revenue(1010)), READS).identical).toBe(12);
  });

  it('says it in its row, and what a no does', () => {
    const r = retestRow(retestRead(winner, any(30), placebo, READS));
    expect(r).toMatchObject({ pass: true, fired: null, value: expect.stringContaining('30 graines intactes') });
    expect(retestRow(retestRead(winner, winner, placebo, READS)).fired).toContain('refusée pour de bon');
  });

  it('refuses a median ratio under 1,15', () => {
    expect(retestRead(winner, any(30, 1149), placebo, READS).adopted).toBe(false);
    expect(retestRead(winner, any(30, 1150), placebo, READS).adopted).toBe(true);
  });

  it('refuses when R is above the winner on fewer than 19 of 30', () => {
    expect(retestRead(winner, any(19), placebo, READS).adopted).toBe(true);
    const fewer = [...arm(18, 18, revenue(1300)), ...Array.from({ length: 12 }, (_, i) => run(19 + i, revenue(1000)))];
    expect(retestRead(winner, fewer, placebo, READS).adopted).toBe(false);
  });

  it('refuses a median ratio not above the placebo', () => {
    expect(retestRead(winner, any(30), arm(30, 30, revenue(1200)), READS).adopted).toBe(false);
  });

  it('refuses when bankruptcies rise', () => {
    const dipped = any(30).map((r, i) => (i ? r : { ...r, rows: [...r.rows, row(200, { cash: -1 })] }));
    expect(retestRead(winner, dipped, placebo, READS).adopted).toBe(false);
  });
});

describe('the rows of Step 4, at both sides of their number', () => {
  const none = arm(30, 0, {});
  const t = 420;
  const negative = { profit: 1, rows: [row(30, { cash: -1 })] };

  it('No learning: a median of at least the threshold, positive on at least 19 of 30', () => {
    expect(noLearningRow(arm(30, 30, { profit: 420 }), none, t).pass).toBe(true);
    expect(noLearningRow(arm(30, 30, { profit: 419 }), none, t).pass).toBe(false);
    expect(noLearningRow(arm(30, 19, { profit: 420 }, { profit: -1 }), none, t).pass).toBe(true);
    expect(noLearningRow(arm(30, 18, { profit: 420 }, { profit: -1 }), none, t)).toMatchObject({ pass: false, fired: expect.stringContaining('S15') });
    expect(noLearningRow(arm(30, 30, { profit: 420 }), none, 700).pass).toBe(false);
  });

  it('No hire: a median of at least 0, bankruptcies at most the control, read at D60', () => {
    expect(noHireRow(none, none, FULL_READS).pass).toBe(true);
    expect(noHireRow(arm(30, 30, { profit: -1 }), none, FULL_READS).pass).toBe(false);
    expect(noHireRow(arm(30, 1, negative, { profit: 1 }), arm(30, 0, {}), FULL_READS).pass).toBe(false);
    expect(noHireRow(arm(30, 1, negative, { profit: 1 }), arm(30, 1, { rows: [row(30, { cash: -1 })] }), FULL_READS).pass).toBe(true);
    expect(noHireRow(arm(30, 1, { profit: 1, rows: [row(100, { cash: -1 })] }, { profit: 1 }), none, FULL_READS).pass).toBe(true);
  });

  it('Legacy 31 paid: a median above 0', () => {
    expect(legacyRow(arm(30, 30, { profit: 1 }), none).pass).toBe(true);
    expect(legacyRow(none, none).pass).toBe(false);
  });

  it('TikTok only: × 1,25 to × 2,5, bankruptcies at most the control', () => {
    const base = arm(30, 30, { profit: 100 });
    expect(tiktokRow(arm(30, 30, { profit: 125 }), base, FULL_READS).pass).toBe(true);
    expect(tiktokRow(arm(30, 30, { profit: 124 }), base, FULL_READS).pass).toBe(false);
    expect(tiktokRow(arm(30, 30, { profit: 250 }), base, FULL_READS).pass).toBe(true);
    expect(tiktokRow(arm(30, 30, { profit: 251 }), base, FULL_READS).pass).toBe(false);
    expect(tiktokRow(arm(30, 30, { profit: 200, rows: [row(30, { cash: -1 })] }), base, FULL_READS).pass).toBe(false);
  });

  it.each([['ROAS moyen', averageRoasRow, 'ROAS moyen'], ['Dernier clic', lastClickRow, 'RECON.claimWeight']] as const)('%s: wins on at least 19 of 30 and by more than the threshold', (_, read, fired) => {
    expect(read(arm(30, 19, { profit: 500 }, { profit: -1 }), none, t).pass).toBe(true);
    expect(read(arm(30, 18, { profit: 500 }, { profit: -1 }), none, t)).toMatchObject({ pass: false, fired: expect.stringContaining(fired) });
    expect(read(arm(30, 30, { profit: 420 }), none, t).pass).toBe(false);
    expect(read(arm(30, 30, { profit: 500 }), none, 700).pass).toBe(false);
  });

  it('Video skill: CTR × 1,12 on at least 24 of 30, a gain above 0', () => {
    const ctr = (clicks: number, profit = 0) => ({ profit, rows: [row(5, { impressions: 10_000, clicks })] });
    const low = arm(30, 30, ctr(1000));
    expect(videoSkillRow(low, arm(30, 30, ctr(1121, 1)), 60).pass).toBe(true);
    expect(videoSkillRow(low, arm(30, 30, ctr(1119, 1)), 60).pass).toBe(false);
    expect(videoSkillRow(low, arm(30, 24, ctr(1121, 1), ctr(1000, 1)), 60).pass).toBe(true);
    expect(videoSkillRow(low, arm(30, 23, ctr(1121, 1), ctr(1000, 1)), 60).pass).toBe(false);
    expect(videoSkillRow(low, arm(30, 30, ctr(1121, 0)), 60).pass).toBe(false);
  });

  it('Tempo: above the fixed arm on D31-60 on at least 18 of 30, the first month unread', () => {
    const rows = (early: number, late: number) => ({ rows: [row(10, { impressions: 10_000, clicks: early }), row(40, { impressions: 10_000, clicks: late })] });
    const fixed = arm(30, 30, rows(900, 200));
    expect(tempoRow(arm(30, 18, rows(100, 300), rows(100, 100)), fixed, FULL_READS).pass).toBe(true);
    expect(tempoRow(arm(30, 17, rows(100, 300), rows(100, 100)), fixed, FULL_READS)).toMatchObject({ pass: false, fired: expect.stringContaining('tempoFit') });
  });
});

describe('the control of the look', () => {
  const up = arm(30, 19, { profit: 100 }, { profit: -100 });
  const none = arm(30, 0, {});

  it('passes alone, and fails to its one retry', () => {
    expect(designRow(none, up)).toMatchObject({ pass: true, fired: null });
    expect(designRow(none, none).fired).toContain('VISUAL.cvr.slope');
  });

  it('then the retry says it', () => {
    expect(designRow(none, none, { low: none, high: up })).toMatchObject({ pass: true, fired: '`VISUAL.cvr.slope` passe à 0,25' });
    expect(designRow(none, none, { low: none, high: none })).toMatchObject({ pass: false, fired: 'le look reste, noté « non prouvé »' });
  });
});

// ───────────────────────────── step 2 ─────────────────────────────

describe('pars and levers', () => {
  const source = `head
  par: {
    'copy:qa': 80, 'video:cut': 70,
  } as Record<string, number>,
  sd: {
    'copy:qa': 5, 'video:cut': 7,
  } as Record<string, number>,
tail
`;
  const was = { par: { 'copy:qa': 80, 'video:cut': 70 }, sd: { 'copy:qa': 5, 'video:cut': 7 } };

  it('pools the raw x of every seed before it takes a mean and a spread', () => {
    const stats = (n: number, sum: number, sq: number) => ({ league: { parStats: { 'copy:qa': { n, sum, sq } } } });
    expect(pooledPars([run(1, stats(2, 180, 16_300)), run(2, stats(2, 180, 16_200))])).toEqual({ 'copy:qa': { n: 4, par: 90, sd: 5 } });
  });

  it('overwrites par and sd, a key without a sample keeping its value', () => {
    const out = rewritePars(source, was, { 'copy:qa': { n: 40, par: 88.5, sd: 4.2 }, 'video:cut': { n: 2, par: 1, sd: 1 } });
    expect(out).toContain(PAR_MARKER);
    expect(out).toContain(`'copy:qa': 88.5, 'video:cut': 70,`);
    expect(out).toContain(`'copy:qa': 4.2, 'video:cut': 7,`);
    expect(out.startsWith('head\n')).toBe(true);
    expect(out.endsWith('tail\n')).toBe(true);
  });

  it('a spread of 0 divides nothing: the key stays', () => {
    expect(rewritePars(source, was, { 'copy:qa': { n: 40, par: 88.5, sd: 0 } })).toContain(`'copy:qa': 80, 'video:cut': 70,`);
  });

  it('refuses a second write, and a file it cannot read', () => {
    const once = rewritePars(source, was, {});
    expect(() => rewritePars(once, was, {})).toThrow(Refused);
    expect(() => rewritePars('nothing', was, {})).toThrow(Refused);
  });

  it('holds the real file: the block it rewrites exists in constants.ts', async () => {
    const { readFile } = await import('node:fs/promises');
    const real = (await readFile(new URL('../src/runtime/talent/constants.ts', import.meta.url), 'utf8')).replace(PAR_MARKER, ''); // written once, by S14
    const out = rewritePars(real, TALENT, { 'copy:qa': { n: 40, par: 88.5, sd: 4.2 } });
    expect(out).toContain(`'copy:qa': 88.5`);
    expect(out.length).toBeGreaterThan(real.length * 0.9);
  });

  it('the rule of the levers: 100 € keeps, 0 keeps and reports, under 0 sends the flaws to 0', () => {
    expect(leverOutcome(100)).toBe('keep');
    expect(leverOutcome(99)).toBe('keep_report');
    expect(leverOutcome(0)).toBe('keep_report');
    expect(leverOutcome(-1)).toBe('flaws_zero');
    expect(leverOutcome(null)).toBeNull();
  });
});

describe('a plain table', () => {
  it('lines up on the widest cell', () => {
    expect(table(['A', 'Bb'], [['1', '2'], ['333', '4']]).split('\n')).toEqual(['A   │ Bb', '────┼───', '1   │  2', '333 │  4']);
  });
});

// ───────────────────────────── what a seed is made of ─────────────────────────────

describe('two calibrations never mix (D127)', () => {
  const one = { spec: { seed: 1 }, code: 'aaaa' };

  it('a seed of the same setting and the same code counts', () => {
    expect(seedCounts('f', one, one)).toBe(true);
  });

  it('another setting stops the step, escape or not', () => {
    for (const escape of ['none', 'keep', 'rerun'] as const) expect(() => seedCounts('f', one, { ...one, spec: { seed: 2 } }, escape)).toThrow(/autre réglage/);
  });

  it('another code stops the step', () => {
    expect(() => seedCounts('f', one, { ...one, code: 'bbbb' })).toThrow(Refused);
    expect(() => seedCounts('f', one, { ...one, code: 'bbbb' })).toThrow(/autre code/);
  });

  it('D123 is the one escape: the others are kept, the winner runs again', () => {
    expect(seedCounts('f', one, { ...one, code: 'bbbb' }, 'keep')).toBe(true);
    expect(seedCounts('f', one, { ...one, code: 'bbbb' }, 'rerun')).toBe(false);
    expect(seedCounts('f', one, one, 'rerun')).toBe(true); // a killed re-run resumes
  });

  it('the stamp reads the code of a run, by content, and nothing else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'calibrate-stamp-'));
    const put = async (path: string, text: string) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    };
    try {
      for (const path of ['server/src/sim/balance.ts', 'shared/types.ts', 'server/assets/font.ttf', 'server/scripts/balanceLib.ts']) await put(path, 'a');
      const first = await codeStamp(root);
      expect(first).toMatch(/^[0-9a-f]{16}$/);
      expect(await codeStamp(root)).toBe(first);
      await put('server/scripts/calibrate.ts', 'un outil');
      await put('docs/note.md', 'un texte');
      expect(await codeStamp(root)).toBe(first);
      for (const path of ['server/src/sim/balance.ts', 'shared/types.ts', 'server/assets/font.ttf', 'server/scripts/balanceLib.ts']) {
        await put(path, 'b');
        expect(await codeStamp(root), path).not.toBe(first);
        await put(path, 'a');
      }
      await put('server/src/sim/new.ts', '');
      expect(await codeStamp(root)).not.toBe(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads the real tree', async () => {
    expect(await codeStamp(fileURLToPath(new URL('../..', import.meta.url)))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('--winner-written is checked against the code, not trusted', () => {
    const read = (path: string) => ({ 'ORG.payPerDay.haiku': 0.5, 'TALENT.founderMean': 0.62 })[path]!;
    expect(() => assertWinnerWritten('A', {}, read)).not.toThrow();
    expect(() => assertWinnerWritten('D', { 'TALENT.founderMean': 0.62 }, read)).not.toThrow();
    expect(() => assertWinnerWritten('D', { 'ORG.payPerDay.haiku': 0.375, 'TALENT.founderMean': 0.62 }, read)).toThrow(/D n'est pas dans le code \(ORG\.payPerDay\.haiku vaut 0\.5, pas 0\.375\)/);
  });

  it('the code holds E, the winner of S14, and refuses a candidate that holds another value', () => {
    const check = (id: string) => () => assertWinnerWritten(id, CANDIDATES.find((c) => c.id === id)!.overrides, constantAt);
    expect(check('E')).not.toThrow();
    expect(check('C')).toThrow(/C n'est pas dans le code \(CONVERSION\.base vaut 0\.0195, pas 0\.0165\)/);
    expect(check('F')).toThrow(/TALENT\.marketMean vaut/);
    expect(check('G')).toThrow(Refused);
  });

  it('every arm runs with no end, and keeps its own scenario', () => {
    expect(armScenario()).toEqual({ openEnded: true });
    expect(armScenario({ talent: 'flat' })).toEqual({ openEnded: true, talent: 'flat' });
  });
});

// ───────────────────────────── overrides ─────────────────────────────

const freshWorld = (): WorldState => {
  const w = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-calibrate');
  ensureChannelMarket(w);
  return w;
};

const LIVE = 'p1';
const withProduct = (w: WorldState): WorldState => {
  w.company.products.push({ id: LIVE, nicheId: w.market.niches[0]!.id, status: 'live', price: 20, version: 1, title: 'Guide', stats: { reviews: [], ratingCount: 0 } } as unknown as Product);
  return w;
};
const adRow = (over: Partial<DailyAdStats>): DailyAdStats => ({ day: 5, campaignId: 'c1', creativeId: 'k1', productId: LIVE, spend: 10, impressions: 1000, clicks: 100, ctr: 0.1, cpc: 0.1, cpm: 10, landingViews: 80, purchases: 2, revenue: 40, roas: 4, frequency: 1, comments: [], ...over });
const niche = (w: WorldState): NicheTruth => w.market.niches[0]!;

function searchImpressions(): number {
  const w = freshWorld();
  const n = niche(w);
  return deliverSearch(w, n, deliverySpec(n, 'google'), 70, 1000, 1, createRng(1)).impressions;
}

function claimed(): number {
  const w = withProduct(freshWorld());
  w.day = 5;
  w.market.adStats = [adRow({ channel: 'meta', revenue: 40 }), adRow({ channel: 'tiktok', creativeId: 'k2', campaignId: 'c2', revenue: 200 })];
  runClaims(w, createRng(3));
  return w.market.adStats[0]!.claimedRevenue ?? 0;
}

function driftedFit(): number {
  const w = withProduct(freshWorld());
  w.day = 5;
  w.market.adStats = [adRow({ channel: 'meta' })];
  const before = niche(w).channels!.meta!.fit;
  rollChannelEvents(w, createRng(5));
  return niche(w).channels!.meta!.fit - before;
}

function tailClicks(): number {
  const w = withProduct(freshWorld());
  w.day = 5;
  w.market.adStats = [adRow({ day: 4, channel: 'pinterest', clicks: 1000 })];
  return runPaidTails(w, createRng(2))[0]?.clicks ?? 0;
}

function afterRaise(): boolean {
  const camp = { channel: 'meta', dailyBudget: 12, creativeIds: ['k'], learning: { events: 40, exitedDay: 3 } } as Campaign;
  learningAfterUpdate(camp, { dailyBudget: 10, creativeIds: ['k'] });
  return camp.learning?.exitedDay === null;
}

function compacted(): number {
  const w = freshWorld();
  w.day = 28;
  w.company.tasks = [{ id: 'tsk_1', kind: 'write_ad', status: 'done', dayDone: 10, dayCreated: 10, dept: 'growth', input: {}, assignee: null } as unknown as Task];
  compactWorld(w);
  return w.company.tasks.length;
}

function retestOf(): boolean {
  const w = withProduct(freshWorld());
  w.day = 100;
  const p = w.company.products[0]!;
  p.harvest = { day: 10, price: p.price, version: p.version, retest: null };
  return retestDue(w, p);
}

const report = { overall: 85, interior: 85 } as VisualReport;
const master = { id: 'm', masterId: null } as unknown as AdCreative;
const fatigueMarket = { creativeImpressions: { m: 44_000 }, channels: { impressions: { meta: { m: 10_000 } } } } as unknown as MarketState;
const ctxOf = (w: WorldState) => ({ world: w }) as RuntimeCtx;

/**
 * One override per object, read where the company or the market reads it: a copy made at import would leave the reader where it was.
 * Each value sits off the written constant, or nothing moves: the pay and the founders, which E wrote, try the values E replaced.
 */
const REACHES: [string, number, () => unknown][] = [
  ['ADS.reachBase', 90_000, () => reachOf(niche(freshWorld()))],
  ['CONVERSION.poolBase', 240, () => nichePool(freshWorld(), niche(freshWorld()))],
  ['ORG.payPerDay.sonnet', 0.8, () => { const a = freshWorld().company.agents.find((x) => x.tier === 'sonnet')!; return payOf(a); }],
  ['TALENT.founderMean', 0.56, () => { const w = freshWorld(); const a = w.company.agents.find((x) => x.founder)!; return drawPerson(w, a).talent; }],
  ['TALENT.marketMean', 0.6, () => { const w = freshWorld(); return drawPerson(w, { id: 'nouveau', roleId: w.company.agents[0]!.roleId, founder: false }).talent; }],
  ['TALENT.flawBase', 0.9, () => craftOf('copy', 0.5, 'sonnet').flaw],
  ['TALENT.passes.three', 0.9, () => craftOf('copy', 0.85, 'sonnet').passes],
  ['TALENT.par.copy:qa', 70, () => TALENT.par['copy:qa']],
  ['CHANNEL_SIM.meta.overlap', 0.9, () => overlapOf('meta')],
  ['TIKTOK_OVERLAP', 0.9, () => overlapOf('tiktok')],
  ['FAMILY_FATIGUE', 0.9, () => familyPrior(fatigueMarket, master, 'meta')],
  ['SEARCH.baseCtr', 0.09, searchImpressions],
  ['ASSIST.halfStock', 5, () => { const w = freshWorld(); w.market.channels!.warm[niche(w).id] = 1000; return warmth(w.market, niche(w)); }],
  ['CLAIMS.greed.meta', 0.95, claimed],
  ['CHANNEL_EVENTS.drift.chance', 1, driftedFit],
  ['CHANNEL_POLICY.alloc.kappa', 1000, () => elasticity([{ s: 10, r: 30 }, { s: 20, r: 40 }, { s: 40, r: 50 }], 0.75).b],
  ['RECON.claimWeight', 0, () => reconcile([{ channel: 'meta', spend: 10, revenue: 100, claimedRevenue: 300 }, { channel: 'tiktok', spend: 10, revenue: 100, claimedRevenue: 100 }])[0]!.credit],
  ['VIDEO_MARKET.tempoMatch', 1.5, () => tempoFit({ videoTempo: 'fast' } as NicheTruth, { cut: { tempo: 'fast' } } as AdCreative)],
  ['VISUAL.cvr.slope', 0.25, () => visualCvr(report)],
  ['GROWTH.bump.maxPrice', 25, () => kitPrice(100)],
  ['STAGE_POLICY.survie.maxMains', 5, () => policyOf({ ...freshWorld(), scenario: { ...freshWorld().scenario, scaling: true } }).maxMains],
  ['COMPACT.taskDays', 5, compacted],
  ['CFO.scaleFloor', 9, () => allocationOf({ ...freshWorld(), scenario: { ...freshWorld().scenario, scaling: true } }).scaleRoas],
  ['STAGE_GATES.adequation.weeks', 4, () => evaluateStage(ctxOf(freshWorld())).weeksNeeded],
  ['LEARNING.raise', 0.1, afterRaise],
  ['PAID_TAIL.shares.0', 0.5, tailClicks],
  ['COST_HINT.cpm.0', 1e6, () => channelSignals(freshWorld(), niche(freshWorld()).id).filter((s) => s.costHint === 'bas').length],
  ['PORTFOLIO.retestAny', 1, retestOf],
];

describe('an override reaches its reader', () => {
  it.each(REACHES)('%s', (path, value, read) => {
    const before = read();
    const was = applyOverrides({ [path]: value });
    try {
      expect(constantAt(path)).toBe(value);
      expect(read()).not.toEqual(before);
    } finally {
      applyOverrides(was);
    }
    expect(read()).toEqual(before);
  });

  it('the object of every path of §2.9 is in the table', () => {
    const named = new Set(REACHES.map(([path]) => path.split('.')[0]));
    for (const name of ['ORG', 'TALENT', 'CHANNEL_SIM', 'SEARCH', 'ASSIST', 'CLAIMS', 'CHANNEL_EVENTS', 'CHANNEL_POLICY', 'RECON', 'VIDEO_MARKET', 'VISUAL', 'GROWTH', 'STAGE_POLICY', 'COMPACT', 'CFO', 'STAGE_GATES', 'LEARNING', 'PAID_TAIL', 'TIKTOK_OVERLAP', 'FAMILY_FATIGUE', 'COST_HINT', 'PORTFOLIO']) expect(named, name).toContain(name);
  });

  it('an unknown path throws, and so does a path that is not a number', () => {
    for (const path of ['NOPE.x', 'ORG.nope', 'ORG.layoff', 'TALENT.challenge.nope', 'STAGE_GATES.adequation.nope', 'TALENT.constructor.name', 'CFO', 'NICHE_VARIATION', 'PAID_TAIL.channel']) {
      expect(() => applyOverrides({ [path]: 1 }), path).toThrow(/Constante inconnue/);
    }
    expect(() => applyOverrides({ 'ADS.baseCtr': Number.NaN })).toThrow(/non numérique/);
  });

  it('every candidate path exists, and the default of the retest flag is off', () => {
    for (const c of CANDIDATES) for (const path of Object.keys(c.overrides)) expect(constantAt(path), path).toBeTypeOf('number');
    expect(PORTFOLIO.retestAny).toBe(0);
  });

  it('names what the two bare numbers are today', () => {
    expect(constantAt('TIKTOK_OVERLAP')).toBe(TIKTOK_OVERLAP);
    expect(constantAt('FAMILY_FATIGUE')).toBe(FAMILY_FATIGUE);
    expect(constantAt('ADS.baseCtr')).toBe(ADS.baseCtr);
    expect(RECON.claimWeight).toBe(0.5);
    expect(CFO.scaleFloor).toBe(1.25);
    expect(COMPACT.taskDays).toBe(21);
  });
});

// ───────────────────────────── the tool itself ─────────────────────────────

describe('the tool, on a smoke of Step 1', () => {
  const server = fileURLToPath(new URL('..', import.meta.url));
  const tool = (out: string, ...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/calibrate.ts', ...args, '--smoke', '--out', out], { cwd: server, encoding: 'utf8', windowsHide: true });

  it('refuses out of order, saves arms with no end, the placebo and the stamp, resumes, and stops on another code', async () => {
    const out = await mkdtemp(join(tmpdir(), 'calibrate-smoke-'));
    const file = join(out, 'step1', 'perturbed', 'normal-1.json');
    try {
      await writeFile(join(out, 'constants.ts'), (await readFile(join(server, 'src', 'runtime', 'talent', 'constants.ts'), 'utf8')).replace(PAR_MARKER, '')); // a smoke's own copy, as before S14 wrote the real one
      expect(tool(out, '--step', '3')).toMatchObject({ status: 1, stderr: expect.stringContaining('--step 2 --write') });
      expect(tool(out, '--step', '2', '--write')).toMatchObject({ status: 1, stderr: expect.stringContaining('step1.json') });
      expect(tool(out, '--step', '1').status).toBe(0);
      const raw = await readFile(file, 'utf8');
      const saved = JSON.parse(raw) as { spec: RunSpec; code: string };
      expect(saved.spec.scenario).toEqual({ openEnded: true });
      expect(saved.spec.overrides).toEqual({ 'ADS.baseCtr': ADS.baseCtr * PLACEBO_CTR });
      expect(saved.code).toBe(await codeStamp(join(server, '..')));
      expect(tool(out, '--step', '1').stdout).toContain('4 déjà finis, 0 à lancer');
      await writeFile(file, raw.replace(saved.code, 'autre'));
      expect(tool(out, '--step', '1')).toMatchObject({ status: 1, stderr: expect.stringContaining('vient d\'un autre code') });
    } finally {
      await rm(out, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 120_000);
});
