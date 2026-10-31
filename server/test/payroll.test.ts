/**
 * Payroll and money (org §5, org tests 6 and 9): one salary line a day that a reload cannot double, founders who give up
 * their pay first, what the books and the CFO read from it, and the benchmark columns that show it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrainVault, ContentEngine, RunPaths } from '../src/contracts.js';
import type { AgentState, OrgConfig, ScenarioConfig, WorldState } from '../src/shared.js';
import { streamRng, summarizeLedger } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { reconcileDay } from '../src/runtime/accounting.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { computeBudget } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { LEAN_ORG, LEGACY_ORG, ORG } from '../src/runtime/org/constants.js';
import { bookPayroll, payOf, payrollToday } from '../src/runtime/org/payroll.js';
import { situationFor } from '../src/runtime/situation.js';
import { STREAM } from '../src/runtime/streams.js';
import { round2 } from '../src/runtime/util.js';
import { aggregate, aggregateLines, resultRow, runOne, tableHeader } from '../scripts/balanceLib.js';
import { LEGACY } from './legacy.js';

const PAID_31: OrgConfig = { team: 'legacy31', autoHire: false, payroll: true };
/** The lean team, hires left out: this file proves the money, hiring.test.ts proves the hires. */
const FROZEN_LEAN: OrgConfig = { ...LEAN_ORG, autoHire: false };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function worldOf(over: Partial<ScenarioConfig> = {}): WorldState {
  return createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, org: FROZEN_LEAN, ...over }), 'test-payroll');
}

/** What bookPayroll and situationFor touch of the context: a market close needs no mind and no brain. */
function ctxOf(world: WorldState): RuntimeCtx {
  return { world, incidents: [], lastMarketNotes: [] } as unknown as RuntimeCtx;
}

function mount(world: WorldState) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-payroll-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const engine: ContentEngine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed });
  const brain: BrainVault = createBrainVault(paths);
  return (w: WorldState) => new Company(w, { paths, engine, brain });
}

const clone = (w: WorldState): WorldState => JSON.parse(JSON.stringify(w)) as WorldState;
const salaries = (w: WorldState) => w.ledger.filter((e) => e.type === 'salary');
const pays = (w: WorldState): number => round2(w.company.agents.reduce((s, a) => s + payOf(a), 0));
const ledgerSum = (w: WorldState, day = Infinity): number => round2(w.ledger.reduce((s, e) => (e.day <= day ? s + e.amount : s), 0));
const payCuts = (w: WorldState) => w.company.org!.decisions.filter((d) => d.kind === 'pay_cut');

/** Takes cash to `cash` as a plain cost, nothing to do with people. */
function setCash(w: WorldState, cash: number): void {
  const gap = round2(cash - sim.financeSnapshot(w).cash);
  sim.recordLedger(w, gap < 0 ? { type: 'ad_spend', amount: gap, memo: 'test', ref: null } : { type: 'revenue', amount: gap, memo: 'test', ref: null });
}

function hire(w: WorldState, id: string, tier: AgentState['tier']): AgentState {
  const a: AgentState = { ...w.company.agents[0]!, id, name: id, tier, founder: false, isChief: false };
  w.company.agents.push(a);
  return a;
}

describe('one salary line per closed day (org test 6)', () => {
  it('books the sum of payOf at each close, and the ledger stays the only source of cash', async () => {
    const world = worldOf({ startingCash: 5000 });
    const company = mount(world)(world);
    const startDay = world.day;
    while (world.day < startDay + 5) {
      await company.step();
      if (world.tick !== 11) continue; // the close of today has just run
      const lines = salaries(world).filter((e) => e.day === world.day);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ amount: -pays(world), ref: `payroll:${world.day}`, type: 'salary' });
      expect(lines[0]!.memo).toBe(`Salaires du jour (${world.company.agents.length} agents)`);
      expect(sim.financeSnapshot(world).cash).toBe(ledgerSum(world));
    }
    expect(salaries(world)).toHaveLength(5);
    expect(-salaries(world)[0]!.amount).toBeGreaterThanOrEqual(7.6); // founders at level 1 are 7,60 €, whoever levels up costs more
    for (const k of world.company.kpis) expect(k.cash, `J${k.day}`).toBe(ledgerSum(world, k.day));
    expect(summarizeLedger(world.ledger, world.day).payroll).toBe(round2(-salaries(world).reduce((s, e) => s + e.amount, 0)));
  }, 60_000);

  it('a close replayed on the same day books nothing', () => {
    const world = worldOf();
    const ctx = ctxOf(world);
    bookPayroll(ctx);
    bookPayroll(ctx);
    expect(salaries(world)).toHaveLength(1);
    expect(ledgerSum(world)).toBe(round2(world.scenario.startingCash - 7.6));
  });

  it('a reload between tick 10 and 11 books nothing twice and ends like the straight run', async () => {
    const days = 4;
    const play = async (reload: boolean) => {
      let world = worldOf({ startingCash: 5000 });
      const open = mount(world);
      let company = open(world);
      const startDay = world.day;
      while (world.day < startDay + days) {
        await company.step();
        if (reload && world.tick === 11) {
          world = clone(world);
          company = open(world);
        }
      }
      return world;
    };
    const straight = await play(false);
    const reloaded = await play(true);
    expect(salaries(reloaded).map((e) => e.ref)).toEqual([1, 2, 3, 4].map((d) => `payroll:${d}`));
    expect(sim.financeSnapshot(reloaded).cash).toBe(ledgerSum(reloaded));
    expect(JSON.stringify(reloaded.ledger) === JSON.stringify(straight.ledger)).toBe(true);
  }, 120_000);

  it('leaves the row of the day with what was booked, for the weekly report', () => {
    const world = worldOf();
    world.company.org!.load.push({ day: world.day, wait: {}, reviewWait: {}, work: {}, busy: {}, headcount: 8, payroll: 0 });
    bookPayroll(ctxOf(world));
    expect(world.company.org!.load.at(-1)!.payroll).toBe(7.6);
  });

  it('books nothing on an unpaid team or an older save, and the legacy 31 cost 23,70 € once paid', () => {
    const unpaid = worldOf({ ...LEGACY });
    bookPayroll(ctxOf(unpaid));
    expect(salaries(unpaid)).toEqual([]);
    expect(payrollToday(unpaid)).toBe(0);
    const old = worldOf({ ...LEGACY });
    delete old.scenario.org;
    expect(payrollToday(old)).toBe(0);
    expect(payrollToday(worldOf({ ...LEGACY, org: PAID_31 }))).toBe(23.7);
  });

  it('raises pay with the level', () => {
    const world = worldOf();
    world.company.agents[0]!.level = 3;
    const expected = round2(ORG.payPerDay[world.company.agents[0]!.tier] * 1.06);
    expect(payOf(world.company.agents[0]!)).toBe(expected);
    expect(payrollToday(world)).toBe(round2(7.6 - ORG.payPerDay[world.company.agents[0]!.tier] + expected));
  });
});

describe('the founders give up their pay first', () => {
  it('founders take half under 30 % of the starting cash, a hire keeps the contract', () => {
    const world = worldOf();
    hire(world, 'recrue', 'sonnet');
    expect(payrollToday(world)).toBe(8.4);
    setCash(world, 150);
    expect(payrollToday(world)).toBe(8.4); // the line itself is not under it
    setCash(world, 149.99);
    expect(payrollToday(world)).toBe(round2(3.8 + 0.8));
    world.status = 'bankrupt';
    expect(payrollToday(world)).toBe(0.8);
  });

  it('logs a pay cut on the transition only, and the way back', () => {
    const world = worldOf();
    const ctx = ctxOf(world);
    bookPayroll(ctx);
    expect(payCuts(world)).toEqual([]);

    world.day += 1;
    setCash(world, 100);
    bookPayroll(ctx);
    expect(payCuts(world)).toHaveLength(1);
    expect(payCuts(world)[0]).toMatchObject({ day: world.day, numbers: { share: 0.5, cash: 100, floor: 150, payroll: 3.8 }, roleId: null });
    expect(world.activity.at(-1)).toMatchObject({ kind: 'org' });
    expect(world.activity.at(-1)!.text).toContain('les fondateurs passent à 50 % de leur salaire');

    for (let i = 0; i < 3; i++) {
      world.day += 1;
      bookPayroll(ctx);
    }
    expect(payCuts(world)).toHaveLength(1);

    world.day += 1;
    world.status = 'bankrupt';
    bookPayroll(ctx);
    expect(payCuts(world)).toHaveLength(2);
    expect(payCuts(world)[1]!.numbers).toMatchObject({ share: 0, payroll: 0 });
    expect(salaries(world).at(-1)).toMatchObject({ amount: 0, ref: `payroll:${world.day}` }); // one line a day, even at zero

    world.day += 1;
    world.status = 'running';
    setCash(world, 400);
    bookPayroll(ctx);
    expect(payCuts(world)).toHaveLength(3);
    expect(payCuts(world)[2]!.numbers.share).toBe(1);
    expect(salaries(world).at(-1)!.amount).toBe(-7.6);
  });

  it('a reload does not read the same transition twice', () => {
    const world = worldOf();
    setCash(world, 100);
    bookPayroll(ctxOf(world));
    const reloaded = clone(world);
    reloaded.day += 1;
    bookPayroll(ctxOf(reloaded));
    expect(payCuts(reloaded)).toHaveLength(1);
  });
});

/** One close with nothing to sell, as Company.marketClose runs it, then the status as Company.checkStatus sets it. */
function closeEmptyDay(world: WorldState, ctx: RuntimeCtx): void {
  sim.tickMarket(world, streamRng(world.scenario.seed, STREAM.market, world.day));
  bookPayroll(ctx);
  world.status = sim.financeSnapshot(world).cash < 0 ? 'bankrupt' : 'running';
  world.day += 1;
}

describe('a market that never buys, 500 €, no ads (org test 9)', () => {
  it('the lean team is still there on day 60, thanks to the founders', () => {
    const world = worldOf({ startingCash: 500 });
    const ctx = ctxOf(world);
    for (let d = 1; d <= 60; d++) closeEmptyDay(world, ctx);
    const { cash, revenue, adSpend, payroll } = summarizeLedger(world.ledger, 60);
    expect({ revenue, adSpend }).toEqual({ revenue: 0, adSpend: 0 });
    expect(cash).toBeGreaterThan(0);
    expect(cash).toBeLessThan(10); // a thin margin: one more founder would not make it
    expect(payCuts(world).map((d) => [d.day, d.numbers.share])).toEqual([[34, 0.5]]);
    expect(payroll).toBeCloseTo(33 * 7.6 + 27 * 3.8, 2);
    expect(cash).toBe(ledgerSum(world));
  });

  it('31 at the same pay are bankrupt before day 20', () => {
    const world = worldOf({ ...LEGACY, org: PAID_31, startingCash: 500 });
    const ctx = ctxOf(world);
    let firstNegative: number | null = null;
    for (let d = 1; d <= 25 && firstNegative === null; d++) {
      closeEmptyDay(world, ctx);
      if (sim.financeSnapshot(world).cash < 0) firstNegative = d;
    }
    expect(firstNegative).not.toBeNull();
    expect(firstNegative!).toBeLessThan(20);
  });
});

describe('what the books read', () => {
  const entry = (day: number, type: WorldState['ledger'][number]['type'], amount: number, ref: string | null = null) => ({ id: `l${day}${type}${ref}`, day, type, amount, memo: '', ref });

  it('a salary is a daily burn, a hire and a departure are not', () => {
    const ledger = [entry(0, 'capital', 1000)];
    for (let d = 1; d <= 8; d++) ledger.push(entry(d, 'salary', -10, `payroll:${d}`));
    const quiet = summarizeLedger(ledger, 8);
    expect(quiet.burn7d).toBe(10);
    expect(quiet.runwayDays).toBe(92);
    const moved = summarizeLedger([...ledger, entry(6, 'recruiting', -35, 'hire:mila'), entry(7, 'recruiting', -35, 'leave:tom')], 8);
    expect(moved.burn7d).toBe(10);
    expect(moved.runwayDays).toBe(85);
    expect(moved.profit7d).toBe(-140); // one-offs are real money
    expect(summarizeLedger([...ledger, entry(6, 'platform_fee', -35)], 8).burn7d).toBe(15); // only those refs
  });

  it('keeps people out of the other costs, and cash whole', () => {
    const s = summarizeLedger([entry(0, 'capital', 500), entry(1, 'salary', -7.6, 'payroll:1'), entry(1, 'recruiting', -35, 'hire:mila'), entry(1, 'tool_subscription', -0.4)], 1);
    expect(s).toMatchObject({ payroll: 42.6, otherCosts: 0.4, cash: 457, profit: -43 });
  });

  it('the accountant counts them in the fixed costs of the day', () => {
    const world = worldOf();
    sim.recordLedger(world, { type: 'salary', amount: -7.6, memo: 'x', ref: `payroll:${world.day}` });
    sim.recordLedger(world, { type: 'recruiting', amount: -35, memo: 'x', ref: 'hire:mila' });
    const r = reconcileDay(world, world.day);
    expect(r.fixed).toBe(42.6);
    expect(r.net).toBe(-42.6);
  });

  it('the chat names them among the costs of a bad day', () => {
    const world = worldOf();
    const ctx = ctxOf(world);
    sim.recordLedger(world, { type: 'salary', amount: -7.6, memo: 'x', ref: `payroll:${world.day}` });
    world.company.kpis.push({ ...emptyKpi(world.day), revenue: 10, adSpend: 5, roas: 2, sales: 1, profit: -7.6 }); // ads paid back: nothing else explains the loss
    expect(situationFor(ctx, world.company.agents[0]!)).toContain("Cause d'hier : 7,60 € de frais fixes pour 10 € de CA");
  });

  it('a hat brings the facts of its department to the chat', () => {
    const world = worldOf();
    const ctx = ctxOf(world);
    const agent = world.company.agents.find((a) => a.dept !== 'support')!;
    agent.hatDepts = [];
    expect(situationFor(ctx, agent)).not.toContain('message(s) client en attente');
    agent.hatDepts = ['support', agent.dept];
    expect(situationFor(ctx, agent)).toContain('Support : 0 message(s) client en attente');
  });
});

function emptyKpi(day: number): WorldState['company']['kpis'][number] {
  return {
    day, cash: 0, revenue: 0, adSpend: 0, profit: 0, cumulativeProfit: 0, sales: 0, refunds: 0, impressions: 0, clicks: 0, ctr: 0, cvr: 0, roas: 0, cac: 0,
    openTickets: 0, avgReplyScore: 0, liveProducts: 1, tasksDone: 0, lessonsLearned: 0,
  };
}

describe('the CFO keeps a week of pay out of the ads (D9)', () => {
  it('takes the rate on what is left', () => {
    const world = worldOf({ startingCash: 1000 });
    expect(computeBudget(world).adCap).toBe(round2((1000 - 7 * 7.6) * 0.15));
  });

  it('gives nothing when a week of pay is more than the cash', () => {
    const world = worldOf({ startingCash: 100 });
    setCash(world, 40);
    expect(computeBudget(world)).toMatchObject({ adCap: 0, survival: false, cash: 40 });
  });

  it('counts the pay the founders really take in survival', () => {
    const world = worldOf({ startingCash: 1000 });
    setCash(world, 200);
    expect(computeBudget(world)).toMatchObject({ survival: true, rate: 0.08, adCap: round2((200 - 7 * 3.8) * 0.08) }); // setCash burned the rest: the runway is short
  });

  it('moves nothing on a team nobody pays', () => {
    const world = worldOf({ ...LEGACY, org: LEGACY_ORG, startingCash: 1000 });
    expect(computeBudget(world).adCap).toBe(150);
  });
});

describe('the benchmark shows the team', () => {
  it('prints headcount, payroll, hires, departures and violations for each run and each difficulty', async () => {
    const r = await runOne({ difficulty: 'normal', seed: 7, days: 2, budget: 500, scenario: { ...LEGACY, org: PAID_31 } });
    expect(r).toMatchObject({ headcount: 31, hires: 0, departures: 0, violations: 0 });
    expect(r.payroll).toBeGreaterThanOrEqual(47.4); // 2 × 23,70 €, a level gained on the way pays a little more
    expect(r.payroll).toBeLessThan(48);
    for (const title of ['Effectif', 'Masse salariale', 'Embauches', 'Départs', 'Violations']) expect(tableHeader()).toContain(title);
    expect(resultRow(r)).toContain('47 €');
    const a = aggregate([{ ...r, payroll: 47.4 }, { ...r, seed: 8, headcount: 33, payroll: 52.6, hires: 2, departures: 1, violations: 1 }], 'normal')!;
    expect(a).toMatchObject({ medianHeadcount: 32, medianPayroll: 50, hires: 2, departures: 1, violations: 1 });
    expect(aggregateLines(a).join('\n')).toContain('effectif médian 32 · masse salariale médiane 50 € · embauches 2 · départs 1 · violations 1');
  }, 60_000);
});
