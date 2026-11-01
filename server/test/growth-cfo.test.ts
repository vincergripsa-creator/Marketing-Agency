/**
 * Stages and the CFO's Monday (scale §4, tests 7, 8, 9, 24): worlds are real, ledgers and ad rows are written by hand, so
 * every number below can be checked with a pencil.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { companyPaidBlock, scalingRoom } from '../src/runtime/acquisition.js';
import { CFO, allocationOf, cfoMonday } from '../src/runtime/cfo.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { growthPillar } from '../src/runtime/growthPillar.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { committedAdBudget, computeBudget } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { LEAN_ORG } from '../src/runtime/org/constants.js';
import { payrollToday } from '../src/runtime/org/payroll.js';
import { LEGACY_POLICY, STAGES, STAGE_GATES, STAGE_POLICY, advanceStage, evaluateStage, growthOn, mainsOver, policyOf } from '../src/runtime/stages.js';
import { buildHeuristicPlan, chainSlots, replyCap } from '../src/runtime/strategy.js';
import { createTask } from '../src/runtime/tasks.js';
import type { AdCreative, AgentState, Allocation, Campaign, DailyAdStats, DecisionRecord, InboxMessage, MessageIntent, Order, Product, ScenarioConfig, StageId, StagePolicy, TaskKind, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';

const log = vi.hoisted(() => ({ decisions: [] as Omit<DecisionRecord, 'id' | 'day'>[] }));

vi.mock('../src/runtime/digest.js', async (original) => {
  const real = await original<typeof import('../src/runtime/digest.js')>();
  return { ...real, logDecision: (w: WorldState, d: Omit<DecisionRecord, 'id' | 'day'>) => { log.decisions.push(d); return real.logDecision(w, d); } };
});

const roots: string[] = [];
const here = dirname(fileURLToPath(import.meta.url));
const brainFile = (name: string) => readFileSync(join(here, '..', '..', 'brain', name), 'utf8');

beforeEach(() => { log.decisions.length = 0; });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

vi.setConfig({ testTimeout: 120_000 });

// ───────────────────────────── fixtures ─────────────────────────────

/** The legacy team with the growth pillar on, so nobody is paid unless a test says so. */
async function lab(over: Partial<ScenarioConfig> = {}) {
  const world = createWorld(defaultScenario({ ...LEGACY, scaling: true, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 200, startingCash: 1000, ...over }), 'test-growth-cfo');
  const root = mkdtempSync(join(tmpdir(), 'pixel-growth-cfo-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w: WorldState) => new Company(w, opts) };
}

interface Day { revenue?: number; ads?: number; refunds?: number; fees?: number; fixed?: number; salary?: number }

/** Closed days of the books, from..to. The last `fixed:` line is what tells a day is closed. */
function book(world: WorldState, from: number, to: number, d: Day): void {
  const today = world.day;
  for (let day = from; day <= to; day++) {
    world.day = day;
    if (d.revenue) sim.recordLedger(world, { type: 'revenue', amount: d.revenue, memo: 'Ventes', ref: 'prd_a' });
    if (d.ads) sim.recordLedger(world, { type: 'ad_spend', amount: d.ads, memo: 'Pub', ref: 'cmp_a' });
    if (d.refunds) sim.recordLedger(world, { type: 'refund', amount: d.refunds, memo: 'Remboursements', ref: 'ord_a' });
    if (d.fees) sim.recordLedger(world, { type: 'payment_fee', amount: d.fees, memo: 'Frais' });
    if (d.salary) sim.recordLedger(world, { type: 'salary', amount: d.salary, memo: 'Salaires', ref: `payroll:${day}` });
    sim.recordLedger(world, { type: 'platform_fee', amount: d.fixed ?? 1.37, memo: 'Frais fixes', ref: `fixed:${day}` });
  }
  world.day = today;
}

/** Whatever the books say, the till holds this. Capital is no profit, so no gate and no window moves. */
function setCash(world: WorldState, cash: number): void {
  world.ledger.unshift({ id: 'led_till', day: 0, type: 'capital', amount: cash - sim.financeSnapshot(world).cash, memo: 'Caisse', ref: null });
}

function adRows(world: WorldState, from: number, to: number, spend: number, revenue: number, productId = 'prd_a', campaignId = 'cmp_a'): void {
  for (let day = from; day <= to; day++) {
    world.market.adStats.push({ day, campaignId, creativeId: 'cre_a', productId, spend, revenue, roas: spend > 0 ? revenue / spend : 0, impressions: spend * 200, clicks: spend * 5, ctr: 0.025, cpc: 0.2, cpm: 5, landingViews: spend * 4, purchases: Math.round(revenue / 20), frequency: 1.2, comments: [] } as DailyAdStats);
  }
}

let orderN = 0;
function orders(world: WorldState, day: number, n: number, price: number, source: Order['source'], productId = 'prd_a', over: Partial<Order> = {}): void {
  for (let i = 0; i < n; i++) world.market.orders.push({ id: `ord_${++orderN}`, day, customerId: 'c', productId, price, source, campaignId: null, creatorId: null, refunded: false, chargeback: false, ...over });
}

function guide(world: WorldState, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId: over.nicheId ?? world.market.niches[0]!.id, title: `Guide ${id}`, subtitle: '', audience: 'parents', problem: 'les nuits', price: 19, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 2, launchedDay: 3, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 3, price: 19 }], ...over,
  };
  world.company.products.push(p);
  return p;
}

function campaign(world: WorldState, id: string, productId: string, dailyBudget: number, over: Partial<Campaign> = {}): Campaign {
  const c: Campaign = { id, productId, name: `Campagne ${id}`, creativeIds: [], dailyBudget, status: 'active', targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay: 1, createdBy: 'test', ...over };
  world.company.campaigns.push(c);
  return c;
}

function creative(world: WorldState, id: string, productId: string): AdCreative {
  const c: AdCreative = {
    id, productId, hook: `Hook ${id}`, hookStyle: 'pov', format: 'faceless_voiceover', scenes: [], caption: '', hashtags: [], cta: '',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
  };
  world.company.creatives.push(c);
  return c;
}

/** A sale from a real main: a line in the books and in the shop. */
function sold(world: WorldState, productId: string, from: number, to: number, perDay: number, price: number, spendPerDay: number, campaignId: string): void {
  const today = world.day;
  for (let day = from; day <= to; day++) {
    world.day = day;
    orders(world, day, perDay, price, 'ads', productId);
    if (perDay) sim.recordLedger(world, { type: 'revenue', amount: perDay * price, memo: 'Ventes', ref: productId });
    if (spendPerDay) sim.recordLedger(world, { type: 'ad_spend', amount: spendPerDay, memo: 'Pub', ref: campaignId });
  }
  world.day = today;
}

function agentOf(ctx: RuntimeCtx) {
  const agent = ctx.world.company.agents[0]!;
  return { agent, mind: { agent, playbook: [], brainNotes: [], lessons: [], day: ctx.world.day, brand: 'x' } as never };
}

async function run(ctx: RuntimeCtx, kind: TaskKind, input: Record<string, unknown> = {}) {
  const { agent, mind } = agentOf(ctx);
  const task = createTask(ctx.world, { kind, title: kind, assignee: agent.id, createdBy: 'system', input });
  return { task, out: await HANDLERS[kind].run(ctx, task, agent, mind) };
}

const stageOf = (world: WorldState): StageId => world.company.growth!.stage;
const setStage = (world: WorldState, stage: StageId) => { world.company.growth!.stage = stage; };

// ───────────────────────────── the table ─────────────────────────────

describe('a stage is a policy', () => {
  it('every split goes all the way to 1, with no payroll line (D7, D8)', () => {
    const shares = STAGES.map((s) => STAGE_POLICY[s].split);
    expect(shares).toEqual([{ scale: 0.7, test: 0.3, reserve: 0 }, { scale: 0.6, test: 0.3, reserve: 0.1 }, { scale: 0.55, test: 0.25, reserve: 0.2 }, { scale: 0.5, test: 0.25, reserve: 0.25 }]);
    for (const s of shares) expect(s.scale + s.test + s.reserve).toBeCloseTo(1, 10);
  });

  it('growthOn is the scenario flag, and the control arm reads the old constants', async () => {
    const on = await lab();
    const off = await lab({ scaling: false });
    expect(growthOn(on.world)).toBe(true);
    expect(growthOn(off.world)).toBe(false);
    expect(policyOf(off.world)).toBe(LEGACY_POLICY);
    expect(LEGACY_POLICY).toMatchObject({ maxMains: 8, testDailyEur: 40, creativesPerCampaign: 3, bumpMinSales: null, magnetMinSales: null });
    expect(policyOf(on.world)).toBe(STAGE_POLICY.survie);
    setStage(on.world, 'acceleration');
    expect(policyOf(on.world)).toBe(STAGE_POLICY.acceleration);
  });

  it('a hand-built world with no growth state reads the first stage instead of throwing', async () => {
    const { world } = await lab();
    delete world.company.growth;
    expect(policyOf(world)).toBe(STAGE_POLICY.survie);
  });
});

// ───────────────────────────── stages ─────────────────────────────

describe('stages (scale 7)', () => {
  /** Monday D29, two mains that clear the gate to `acceleration`: 14 days at 20 €/day of profit each. */
  async function onTheGate() {
    const lb = await lab({ startingCash: 1000 });
    const { world } = lb;
    world.day = 29;
    setStage(world, 'adequation');
    for (const id of ['a', 'b']) {
      guide(world, `prd_${id}`, { nicheId: world.market.niches[id === 'a' ? 0 : 1]!.id });
      campaign(world, `cmp_${id}`, `prd_${id}`, 20);
      sold(world, `prd_${id}`, 15, 28, 2, 20, 20, `cmp_${id}`);
    }
    book(world, 15, 28, {});
    setCash(world, 1600);
    return lb;
  }
  /** One week later, same books: the next Monday's check. */
  function nextMonday(world: WorldState): void {
    const from = world.day;
    world.day += 7;
    for (const id of ['a', 'b']) sold(world, `prd_${id}`, from, world.day - 1, 2, 20, 20, `cmp_${id}`);
    book(world, from, world.day - 1, {});
    setCash(world, 1600);
  }

  it('a gate of 2 checks held once does not promote, held twice does', async () => {
    const { world, ctx } = await onTheGate();
    expect(evaluateStage(ctx).checks.every((c) => c.ok)).toBe(true);
    advanceStage(ctx);
    expect(stageOf(world)).toBe('adequation');
    expect(world.company.growth!.gateWeeks).toBe(1);
    expect(world.company.growth!.gate).toMatchObject({ next: 'acceleration', weeksHeld: 1, weeksNeeded: 2 });
    nextMonday(world);
    advanceStage(ctx);
    expect(stageOf(world)).toBe('acceleration');
    expect(world.company.growth).toMatchObject({ stageSinceDay: 36, gateWeeks: 0, floorWeeks: 0 });
    expect(world.company.growth!.gate!.next).toBe('portefeuille');
  });

  it('checks must follow each other: a Monday under the gate starts the count again', async () => {
    const { world, ctx } = await onTheGate();
    advanceStage(ctx);
    setCash(world, 1000); // under 1,5 × the start
    world.day += 7;
    book(world, world.day - 7, world.day - 1, {});
    setCash(world, 1000);
    advanceStage(ctx);
    expect(world.company.growth!.gateWeeks).toBe(0);
    expect(stageOf(world)).toBe('adequation');
  });

  it('nothing moves between two Mondays', async () => {
    const { world, ctx } = await onTheGate();
    world.day = 30;
    await growthPillar.morning!(ctx);
    expect(world.company.growth!.gateWeeks).toBe(0);
    expect(world.company.growth!.gate).toBeNull();
  });

  it('a Monday that failed and plays again is one check, not two', async () => {
    const { world, ctx } = await onTheGate();
    await growthPillar.morning!(ctx);
    await growthPillar.morning!(ctx);
    expect(world.company.growth!.gateWeeks).toBe(1);
    expect(stageOf(world)).toBe('adequation');
    expect(log.decisions.filter((d) => d.kind === 'budget')).toHaveLength(1);
  });

  it('the first gate needs one check, and a main with a proven ROAS', async () => {
    const { world, ctx } = await lab();
    world.day = 29;
    guide(world, 'prd_a');
    campaign(world, 'cmp_a', 'prd_a', 10);
    sold(world, 'prd_a', 15, 28, 2, 10, 8, 'cmp_a');
    book(world, 15, 28, {});
    advanceStage(ctx);
    expect(stageOf(world)).toBe('adequation'); // 28 sales, 280 € for 112 € of ads, profit over 14 days

    const thin = await lab();
    thin.world.day = 29;
    guide(thin.world, 'prd_a');
    campaign(thin.world, 'cmp_a', 'prd_a', 10);
    sold(thin.world, 'prd_a', 15, 28, 2, 10, 4, 'cmp_a');
    book(thin.world, 15, 28, {});
    advanceStage(thin.ctx);
    expect(stageOf(thin.world)).toBe('survie'); // the same ROAS on 56 € of ads proves nothing
    expect(thin.world.company.growth!.gate!.checks.map((c) => c.ok)).toEqual([true, false]);
  });

  it('survival sends the company back at once, on any morning, and holds it there', async () => {
    const { world, ctx } = await lab({ startingCash: 1000 });
    world.day = 31; // a Wednesday of the books
    setStage(world, 'portefeuille');
    book(world, 1, 30, {});
    setCash(world, 200);
    expect(computeBudget(world).survival).toBe(true);
    await growthPillar.morning!(ctx);
    expect(stageOf(world)).toBe('survie');
    expect(world.company.growth!.stageSinceDay).toBe(31);
    expect(world.company.growth!.gate!.next).toBe('adequation'); // the board does not wait for Monday either
    expect(log.decisions.map((d) => d.kind)).toEqual(['stage']);
  });

  it('a bankruptcy too', async () => {
    const { world, ctx } = await lab({ startingCash: 1000 });
    world.day = 29;
    setStage(world, 'adequation');
    book(world, 15, 28, {});
    setCash(world, -5);
    expect(computeBudget(world).bankrupt).toBe(true);
    advanceStage(ctx);
    expect(stageOf(world)).toBe('survie');
    expect(world.company.growth!.gateWeeks).toBe(0);
  });

  it('a gate cleared in survival does not count: the same books out of it do', async () => {
    const setUp = async (cash: number) => {
      const lb = await lab({ startingCash: 1000 });
      lb.world.day = 29;
      guide(lb.world, 'prd_a');
      campaign(lb.world, 'cmp_a', 'prd_a', 10);
      sold(lb.world, 'prd_a', 15, 28, 2, 10, 8, 'cmp_a');
      book(lb.world, 15, 28, {});
      setCash(lb.world, cash);
      return lb;
    };
    const low = await setUp(200);
    expect(computeBudget(low.world).survival).toBe(true);
    expect(evaluateStage(low.ctx).checks.every((c) => c.ok)).toBe(true);
    advanceStage(low.ctx);
    expect(stageOf(low.world)).toBe('survie');
    expect(low.world.company.growth!.gateWeeks).toBe(0);
    const fine = await setUp(900);
    advanceStage(fine.ctx);
    expect(stageOf(fine.world)).toBe('adequation');
  });

  it('3 Mondays of loss over 28 days take one stage, 2 take none, and a profit starts the count again', async () => {
    const { world, ctx } = await lab({ startingCash: 1000 });
    world.day = 29;
    setStage(world, 'acceleration');
    book(world, 1, 28, { fixed: 5 });
    setCash(world, 5000);
    advanceStage(ctx);
    world.day = 36;
    book(world, 29, 35, { revenue: 200 }); // 28 days in profit
    setCash(world, 5000);
    advanceStage(ctx);
    expect(world.company.growth!.floorWeeks).toBe(0);
    world.day = 43;
    book(world, 36, 42, { fixed: 300 });
    setCash(world, 5000);
    advanceStage(ctx);
    world.day = 50;
    book(world, 43, 49, { fixed: 300 });
    setCash(world, 5000);
    advanceStage(ctx);
    expect(world.company.growth!.floorWeeks).toBe(2);
    expect(stageOf(world)).toBe('acceleration');
    world.day = 57;
    book(world, 50, 56, { fixed: 300 });
    setCash(world, 5000);
    advanceStage(ctx);
    expect(stageOf(world)).toBe('adequation'); // one down, not to the floor
    expect(world.company.growth!.floorWeeks).toBe(0);
  });

  it('every change is a decision with its numbers and a French line from the CEO', async () => {
    const { world, ctx } = await onTheGate();
    advanceStage(ctx);
    expect(log.decisions).toEqual([]);
    nextMonday(world);
    advanceStage(ctx);
    expect(log.decisions).toHaveLength(1);
    expect(log.decisions[0]).toMatchObject({ kind: 'stage', who: 'camille' });
    expect(log.decisions[0]!.text).toContain('Accélération');
    expect(log.decisions[0]!.why).toMatch(/Profit sur 14 jours/);
    expect(world.activity.at(-1)).toMatchObject({ agentId: 'camille', kind: 'meeting' });
    expect(world.activity.at(-1)!.text).toMatch(/^Camille : l'agence quitte l'étape Adéquation pour l'étape Accélération : /);
    expect(log.decisions[0]!.text.endsWith('Accélération')).toBe(true); // what the digest reads the move from
    expect(log.decisions[0]!.text.charAt(0)).toBe('L'); // a line of its own in the digest and in a toast
  });

  it('the last gate reads contribution with follow-ups, niches, concentration and owned revenue', async () => {
    const { world, ctx } = await lab({ startingCash: 1000 });
    world.day = 29;
    setStage(world, 'acceleration');
    const niches = world.market.niches;
    guide(world, 'prd_up', { nicheId: niches[0]!.id });
    guide(world, 'prd_a', { nicheId: niches[0]!.id, upsellProductId: 'prd_up' });
    guide(world, 'prd_b', { nicheId: niches[1]!.id });
    guide(world, 'prd_c', { nicheId: niches[2]!.id });
    guide(world, 'prd_d', { nicheId: niches[2]!.id });
    for (const id of ['prd_a', 'prd_b', 'prd_c', 'prd_d']) sold(world, id, 1, 28, 1, 20, 0, 'none');
    sold(world, 'prd_up', 1, 28, 1, 15, 0, 'none');
    for (const o of world.market.orders.filter((x) => x.productId === 'prd_up')) o.source = 'upsell';
    book(world, 1, 28, {});
    const gate = evaluateStage(ctx);
    expect(gate.next).toBe('portefeuille');
    const [profit, mains, zones, top, owned] = gate.checks;
    expect(profit).toMatchObject({ target: STAGE_GATES.portefeuille.profit28, ok: true });
    expect(mains).toMatchObject({ value: 4, target: 4, ok: true }); // the upsell is no main, its money counts for its parent
    expect(zones).toMatchObject({ value: 3, ok: true });
    expect(top!.value).toBeCloseTo(980 / 2660, 2); // prd_a and its upsell together
    expect(top!.ok).toBe(true);
    expect(gate.checks.filter((c) => c.lower)).toEqual([top]); // the one ceiling: the tabs read it the other way round
    expect(owned!.value).toBeCloseTo(420 / 2660, 2);
    expect(owned!.ok).toBe(true);
    for (const o of world.market.orders.filter((x) => x.productId === 'prd_up')) o.source = 'ads';
    expect(evaluateStage(ctx).checks[4]!.ok).toBe(false);
  });

  it('a kit\'s money counts for its main, and the kit is no main of its own', async () => {
    const { world } = await lab({ startingCash: 1000 });
    world.day = 29;
    guide(world, 'prd_kit', { kind: 'kit' });
    guide(world, 'prd_a', { bumpProductId: 'prd_kit' });
    sold(world, 'prd_a', 15, 28, 1, 20, 0, 'none');
    sold(world, 'prd_kit', 15, 28, 1, 7, 0, 'none');
    book(world, 15, 28, {});
    const { mains } = mainsOver(world, 14);
    expect(mains.map((m) => m.product.id)).toEqual(['prd_a']);
    expect(mains[0]!.contribution).toBe(14 * 20 + 14 * 7);
  });

  it('the top stage has no gate', async () => {
    const { world, ctx } = await lab();
    setStage(world, 'portefeuille');
    expect(evaluateStage(ctx)).toEqual({ next: null, checks: [], weeksHeld: 0, weeksNeeded: 0 });
  });
});

// ───────────────────────────── the CFO ─────────────────────────────

describe('the CFO (scale 8)', () => {
  /** Monday D29, 28 closed days at the same pace, on books wiped clean. */
  function fill(world: WorldState, stage: StageId, d: Day, cash: number): void {
    world.ledger = [];
    world.market.adStats = [];
    world.day = 29;
    setStage(world, stage);
    book(world, 1, 28, d);
    if (d.ads) adRows(world, 1, 28, d.ads, d.revenue ?? 0);
    setCash(world, cash);
  }

  async function steady(stage: StageId, d: Day, cash: number, over: Partial<ScenarioConfig> = {}) {
    const lb = await lab(over);
    fill(lb.world, stage, d, cash);
    return lb;
  }

  it('the worked example of the spec, under the D8 split', async () => {
    const { world } = await steady('acceleration', { revenue: 160.6, ads: 80, refunds: 14.45, fees: 4.82 }, 3800);
    for (let day = 1; day <= 28; day++) { orders(world, day, 2, 25, 'ads'); orders(world, day, 1, 10, 'email'); }
    const a = allocationOf(world);
    expect(a.net).toBeCloseTo(0.88, 2);
    expect(a.ltv).toBeCloseTo(1.2, 2);
    expect(a.beRoas).toBeCloseTo(0.95, 2);
    expect(a.scaleRoas).toBe(1.25);
    expect(a.trimRoas).toBe(0.99);
    expect(a.spend7).toBe(80);
    expect(a.profit7).toBeCloseTo(420, 0);
    expect(a.reserve).toBeCloseTo(579.18, 1);
    expect(a.free).toBeCloseTo(3220.82, 1);
    expect(a.leak).toBe(false);
    expect(a.adTarget).toBeCloseTo(230, 0); // 2,9 × the spend, inside a cap of 570
    expect(a.testWeek).toBeCloseTo(105, 0);
    expect(a.roas14).toBeCloseTo(2, 1);
    expect(a).not.toHaveProperty('payrollCap'); // D7
    // The line reads what is spent first, then the ceiling: 80 €/day against 230 €/day under a 570 € envelope.
    expect(a.note.indexOf('80 €/jour de pub dépensés sur 7 jours')).toBe(0);
    expect(a.note).toContain("jusqu'à 230,05 €/jour cette semaine");
    expect(a.note).toContain('enveloppe du jour 570 €');
    expect(a.note).not.toContain('Cible pub');
  });

  it('adTarget stays under the cap and out of the reserve on every ledger of the grid', async () => {
    let positive = 0;
    const paid = await lab({ org: LEAN_ORG });
    const unpaid = await lab();
    for (const stage of STAGES) {
      for (const { world } of [paid, unpaid]) {
        for (const cash of [0, 90, 350, 1500, 3800, 40_000]) {
          for (const [revenue, ads] of [[0, 0], [10, 40], [160, 80], [900, 300]] as const) {
            fill(world, stage, { revenue, ads, fees: revenue * 0.03, salary: payrollToday(world) }, cash);
            const a = allocationOf(world);
            for (const v of Object.values(a)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
            expect(a.adTarget).toBeGreaterThanOrEqual(0);
            world.company.growth!.allocation = a;
            const { adCap, rate } = computeBudget(world);
            expect(a.adTarget).toBeLessThanOrEqual(adCap + 1e-9); // the cap of D9: pay set aside, reserve left alone
            expect(a.adTarget).toBeLessThanOrEqual(rate * Math.max(0, cash - 7 * payrollToday(world)) + 1e-9);
            if (cash >= a.reserve) expect(cash - a.adTarget).toBeGreaterThanOrEqual(a.reserve - 0.01);
            else expect(a.adTarget).toBe(0);
            if (a.adTarget > 0) positive++;
          }
        }
      }
    }
    expect(positive).toBeGreaterThan(50);
  });

  it('on a short runway the 8 % rate holds it, the one case where the cap binds before free ÷ 7', async () => {
    const { world } = await steady('survie', { revenue: 150, ads: 100, salary: 130 }, 1000);
    const a = allocationOf(world);
    const { rate } = computeBudget(world);
    expect(rate).toBe(0.08);
    expect(a.leak).toBe(false);
    expect(a.free / 7).toBeGreaterThan(80);
    expect(a.spend7).toBeGreaterThan(80);
    expect(a.adTarget).toBe(80);
    const paid = await steady('survie', { revenue: 150, ads: 100, salary: 130 }, 1000, { org: LEAN_ORG });
    expect(allocationOf(paid.world).adTarget).toBeCloseTo(0.08 * (1000 - 7 * payrollToday(paid.world)), 1); // D9: a week of pay comes off first
  });

  it('rounds down to the cent: one cent up would reach into the reserve', async () => {
    const { world } = await steady('survie', { revenue: 100, ads: 50 }, 400);
    const a = allocationOf(world);
    expect(a).toMatchObject({ reserve: 300, free: 100, leak: false });
    expect(a.adTarget).toBe(14.28); // 100 ÷ 7 = 14,2857…
    expect(7 * a.adTarget).toBeLessThanOrEqual(a.free);
  });

  it('a reserve never falls under 30 % of the start, and grows with what the company costs', async () => {
    const quiet = await steady('survie', {}, 2000, { startingCash: 1000 });
    expect(allocationOf(quiet.world).reserve).toBe(300);
    const big = await steady('portefeuille', { ads: 100, revenue: 400, salary: 40 }, 9000, { startingCash: 1000 });
    expect(allocationOf(big.world).reserve).toBeCloseTo(21 * (1.37 + 50), 1); // no payroll on the legacy team, the books say nothing of it
    const payroll = await steady('portefeuille', { ads: 100, revenue: 400 }, 9000, { org: LEAN_ORG, startingCash: 1000 });
    expect(allocationOf(payroll.world).reserve).toBeCloseTo(21 * (1.37 + payrollToday(payroll.world) + 50), 1);
  });

  it('the setup fee is no fixed cost, a hold is no money spent', async () => {
    const { world } = await steady('survie', { revenue: 50, ads: 10 }, 2000);
    const clean = allocationOf(world).reserve;
    world.day = 28;
    sim.recordLedger(world, { type: 'tool_subscription', amount: 60, memo: 'Démarrage', ref: 'setup' });
    sim.recordLedger(world, { type: 'revenue', amount: -500, memo: 'Réserve de paiement', ref: 'hold:1' });
    world.day = 29;
    setCash(world, 2000);
    const a = allocationOf(world);
    expect(a.reserve).toBe(clean);
    expect(a.profit7).toBeCloseTo(7 * (50 - 10 - 1.37) - 60, 1);
  });

  describe('a leak', () => {
    const LEAKING = { revenue: 90, ads: 100, refunds: 9, fees: 3 }; // ROAS 0,9, point mort 1,14

    it('adds nothing to scale, however much cash sleeps', async () => {
      const a = allocationOf((await steady('acceleration', LEAKING, 5000)).world);
      expect(a.leak).toBe(true);
      expect(a.adTarget).toBeLessThanOrEqual(0.8 * a.spend7 + 1e-9);
      expect(a.adTarget).toBe(80);
      const rich = allocationOf((await steady('acceleration', LEAKING, 500_000)).world);
      expect(rich.adTarget).toBe(a.adTarget);
    });

    it('funds exploration instead, and a profitable week still pays its tests', async () => {
      const a = allocationOf((await steady('acceleration', LEAKING, 5000)).world);
      expect(a.testWeek).toBeCloseTo(7 * 0.2 * 100, 6);
      const profitable = { revenue: 300, ads: 200, refunds: 60, fees: 9 }; // ROAS 1,5 under a point mort of 1,3… a leak with a profit
      const { world } = await steady('acceleration', { ...profitable, refunds: 110 }, 5000);
      const b = allocationOf(world);
      expect(b.leak).toBe(true);
      expect(b.profit7).toBeLessThan(0);
      const earning = await steady('acceleration', { revenue: 300, ads: 200, refunds: 45, fees: 9 }, 5000);
      earning.world.market.adStats.forEach((s) => { s.revenue = 200; }); // ads claim ROAS 1, the shop earned more: point mort 1,21
      const c = allocationOf(earning.world);
      expect(c.leak).toBe(true);
      expect(c.profit7).toBeGreaterThan(0);
      const testAdd = (STAGE_POLICY.acceleration.split.test * c.profit7) / 7;
      expect(c.adTarget).toBeCloseTo(0.8 * 200 + testAdd, 1);
      expect(c.testWeek).toBeCloseTo(7 * (testAdd + 0.2 * 200), 1);
    });

    it('needs 100 € of ads over 14 days and a ROAS under break-even', async () => {
      const thin = await steady('survie', { revenue: 6.5, ads: 7 }, 5000); // 98 € over 14 days
      expect(allocationOf(thin.world).leak).toBe(false);
      const fine = await steady('survie', { revenue: 70, ads: 50 }, 5000);
      expect(allocationOf(fine.world).leak).toBe(false);
    });

    it('reads reconciled revenue: what channels claim is not what they brought', async () => {
      const { world } = await steady('survie', { revenue: 60, ads: 50 }, 5000);
      expect(allocationOf(world).leak).toBe(false);
      world.company.channels = { attribution: { day: world.day, fromDay: 1, toDay: world.day, by: 'x', rows: [{ channel: 'tiktok', spend: 0, shopRevenue: 0, claimedRevenue: 0, reconciledRevenue: 0, credit: 0.5, inflation: 2 }], niches: {} } } as never;
      world.scenario.channelControl = 'none';
      const a = allocationOf(world);
      expect(a.roas14).toBeCloseTo(0.6, 2);
      expect(a.leak).toBe(true);
    });
  });

  it('sleeping cash goes to work, at a fourteenth a day', async () => {
    const asleep = await steady('adequation', { revenue: 22, ads: 10 }, 4000, { startingCash: 1000 });
    const a = allocationOf(asleep.world);
    const scale = STAGE_POLICY.adequation.split.scale;
    const perDay = Math.max(0, a.profit7) / 7;
    expect(a.leak).toBe(false);
    const idle = a.free - 14 * (a.spend7 + scale * perDay + 0.3 * perDay);
    expect(a.adTarget).toBeCloseTo(a.spend7 + scale * perDay + 0.3 * perDay + idle / 14, 1);
  });

  it('the Monday writes the allocation and the LTV in the world, one decision, one line from the CFO', async () => {
    const { world, ctx } = await steady('acceleration', { revenue: 160, ads: 80 }, 3800);
    cfoMonday(ctx);
    const g = world.company.growth!;
    expect(g.allocation).toMatchObject({ week: 5, day: 29, leak: false });
    expect(g.ltvFactor).toBe(g.allocation!.ltv);
    expect(log.decisions).toHaveLength(1);
    expect(log.decisions[0]).toMatchObject({ kind: 'budget', who: world.company.agents.find((a) => a.roleId === 'cfo')!.id });
    expect(log.decisions[0]!.why).toMatch(/ROAS 14 j 2,00/);
    expect(world.activity.at(-1)).toMatchObject({ kind: 'finance' });
    expect(world.activity.at(-1)!.text).toContain(g.allocation!.note);
  });
});

describe('the reserve stops at the survival line (D9, scale §4.3)', () => {
  /** D31, last Monday's allocation in the world, one guide on one campaign. 250 € is under 30 % of the start. */
  async function low(roas: number, cash = 250) {
    const lb = await lab({ startingCash: 1000 });
    const { world } = lb;
    world.day = 31;
    guide(world, 'prd_a');
    creative(world, 'cre_a', 'prd_a');
    const c = campaign(world, 'cmp_a', 'prd_a', 12, { creativeIds: ['cre_a'] });
    adRows(world, 27, 30, 12, 12 * roas);
    book(world, 1, 30, {});
    setCash(world, cash);
    world.company.growth!.allocation = allocationOf(world);
    return { ...lb, c };
  }

  it('under the line the envelope is the control\'s, not 0: the floor of the reserve is that same line', async () => {
    const { world } = await low(2);
    expect(world.company.growth!.allocation).toMatchObject({ reserve: 300, free: 0, adTarget: 0 });
    const { adCap, rate, survival } = computeBudget(world);
    expect(survival).toBe(true);
    expect(adCap).toBeGreaterThan(5);
    expect(adCap).toBeCloseTo(rate * 250, 2);
  });

  it('an ad that pays runs on at its budget, with no room to grow', async () => {
    const { world, ctx, c } = await low(2);
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('active');
    expect(c.dailyBudget).toBe(12);
    expect(allocationOf(world).scaleRoas).toBeLessThan(2); // it would scale, anywhere else
  });

  it('the survival rules stand: an ad that loses stops, and nothing new starts', async () => {
    const { world, ctx, c } = await low(0.8);
    expect(companyPaidBlock(world, 'tiktok')).toContain('mode survie');
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('paused');
  });

  it('above the line the reserve binds as before, to the cent', async () => {
    const { world } = await low(2, 305);
    expect(computeBudget(world)).toMatchObject({ survival: false, adCap: 5 });
    world.company.growth!.allocation = { ...world.company.growth!.allocation!, reserve: 400 };
    expect(computeBudget(world).adCap).toBe(0);
  });
});

describe('what a buyer leaves lowers the bar (scale 9)', () => {
  const FIRST = 'prd_a';

  /** A campaign at ROAS 1,35 with real refunds: under 1,8, under this CFO's bar, over its trim line. */
  async function company(followOnPerDay: number) {
    const lb = await lab({ startingCash: 5000 });
    const { world } = lb;
    world.day = 29;
    guide(world, FIRST, { upsellProductId: 'prd_up' });
    campaign(world, 'cmp_a', FIRST, 40, { startDay: 10, creativeIds: ['cre_a'] });
    creative(world, 'cre_a', FIRST);
    adRows(world, 10, 28, 40, 54);
    book(world, 1, 28, { revenue: 54, ads: 40, refunds: 4, fees: 1.4 });
    for (let day = 1; day <= 28; day++) {
      orders(world, day, 2, 27, 'ads');
      if (followOnPerDay) orders(world, day, 1, followOnPerDay, 'upsell', 'prd_up');
    }
    setCash(world, 5000);
    return lb;
  }

  it('higher follow-on revenue, lower break-even, and optimize_ads scales a campaign it refused', async () => {
    const before = await company(0);
    cfoMonday(before.ctx);
    const refused = before.world.company.growth!.allocation!;
    expect(refused.ltv).toBe(1);
    expect(refused.scaleRoas).toBeGreaterThan(1.4);
    await run(before.ctx, 'optimize_ads');
    expect(before.world.company.campaigns[0]!.dailyBudget).toBe(40);

    const after = await company(27);
    cfoMonday(after.ctx);
    const scaled = after.world.company.growth!.allocation!;
    expect(scaled.ltv).toBeCloseTo(1.5, 2);
    expect(scaled.beRoas).toBeLessThan(refused.beRoas);
    expect(scaled.scaleRoas).toBe(1.25);
    await run(after.ctx, 'optimize_ads');
    expect(after.world.company.campaigns[0]!.dailyBudget).toBe(52); // +30 %, never more
  });

  it('caps the factor at 1,8, needs 300 € of first orders, reads 56 days and no refund', async () => {
    const big = await company(500);
    expect(allocationOf(big.world).ltv).toBe(CFO.ltvMax);

    const small = await lab();
    small.world.day = 29;
    book(small.world, 1, 28, {});
    for (let day = 15; day <= 28; day++) { orders(small.world, day, 1, 20, 'ads'); orders(small.world, day, 1, 20, 'bump'); }
    expect(allocationOf(small.world).ltv).toBe(1); // 280 € of first orders

    const old = await lab();
    old.world.day = 80;
    book(old.world, 1, 79, {});
    for (let day = 40; day <= 79; day++) orders(old.world, day, 1, 20, 'ads');
    for (let day = 1; day <= 22; day++) orders(old.world, day, 1, 20, 'email'); // past the window
    orders(old.world, 70, 5, 20, 'email', 'prd_a', { refunded: true });
    orders(old.world, 70, 5, 20, 'email', 'prd_a', { chargeback: true });
    expect(allocationOf(old.world).ltv).toBe(1);
    orders(old.world, 70, 8, 20, 'email');
    expect(allocationOf(old.world).ltv).toBeCloseTo(1.2, 2);
  });

  it('keeps the old bars with no allocation yet', async () => {
    const { world, ctx } = await company(27);
    await run(ctx, 'optimize_ads');
    expect(world.company.campaigns[0]!.dailyBudget).toBe(40); // 1,35 is under 1,8
  });
});

// ───────────────────────────── the Monday in the company ─────────────────────────────

describe('the growth pillar', () => {
  it('on Mondays: CFO, then stage, then the portfolio ritual. Other mornings: only the fall', async () => {
    const { world, ctx } = await lab();
    const rituals: [TaskKind, string, string][] = [];
    ctx.ritual = async (kind, agentId, title) => { rituals.push([kind, agentId, title]); };
    world.day = 8;
    book(world, 1, 7, { revenue: 30, ads: 10 });
    await growthPillar.morning!(ctx);
    expect(world.company.growth!.allocation!.day).toBe(8);
    expect(world.company.growth!.gate!.next).toBe('adequation');
    expect(rituals).toEqual([['portfolio_review', 'camille', 'Revue du portefeuille, semaine 2']]);
    world.day = 9;
    book(world, 8, 8, {});
    await growthPillar.morning!(ctx);
    expect(world.company.growth!.allocation!.day).toBe(8);
    expect(rituals).toHaveLength(1);
  });

  it('with scaling off it decides nothing and writes nothing', async () => {
    const { world, ctx } = await lab({ scaling: false });
    const before = JSON.stringify(world.company.growth);
    const rituals: TaskKind[] = [];
    ctx.ritual = async (kind) => { rituals.push(kind); };
    world.day = 8;
    await growthPillar.morning!(ctx);
    expect(JSON.stringify(world.company.growth)).toBe(before);
    expect(log.decisions).toEqual([]);
    expect(rituals).toEqual([]);
  });

  it('a real run has its first allocation on D1 and its second on D8', async () => {
    const { world, company } = await lab({ org: LEAN_ORG, talent: 'off', startingCash: 500 });
    await company.runDays(9);
    const g = world.company.growth!;
    expect(g.allocation).toMatchObject({ day: 8, week: 2 });
    expect(log.decisions.filter((d) => d.kind === 'budget' && /^Semaine/.test(d.text)).map((d) => d.text.slice(0, 9))).toEqual(['Semaine 1', 'Semaine 2']);
    expect(world.company.tasks.filter((t) => t.status === 'failed' && t.title.includes('Revue du portefeuille'))).toEqual([]);
  });

  it('a reload on the Monday morning ends exactly like a straight run', async () => {
    const straight = await lab({ org: LEAN_ORG, talent: 'off', startingCash: 500 });
    await straight.company.runDays(9);
    const cut = await lab({ org: LEAN_ORG, talent: 'off', startingCash: 500 });
    await cut.company.runDays(7);
    const saved = JSON.parse(JSON.stringify(cut.world)) as WorldState;
    await cut.reopen(saved).runDays(2);
    expect(JSON.stringify(saved.company.growth)).toBe(JSON.stringify(straight.world.company.growth));
    expect(JSON.stringify(saved.ledger)).toBe(JSON.stringify(straight.world.ledger));
  });
});

// ───────────────────────────── what growth changes ─────────────────────────────

describe('launches read the stage', () => {
  async function ready(stage: StageId, n = 6) {
    const lb = await lab({ startingCash: 3000 });
    const { world } = lb;
    world.day = 29;
    setStage(world, stage);
    guide(world, 'prd_a');
    for (let i = 0; i < n; i++) creative(world, `cre_${i}`, 'prd_a');
    book(world, 1, 28, {});
    setCash(world, 3000);
    return lb;
  }

  it('a test takes the budget and the creatives of its stage, not 40 € and 3', async () => {
    const first = await ready('survie');
    const small = await run(first.ctx, 'launch_campaign', { productId: 'prd_a' });
    expect(small.out.output).toMatchObject({ dailyBudget: 20 });
    expect((small.out.output!.creativeIds as string[])).toHaveLength(3);
    const late = await ready('portefeuille');
    const big = await run(late.ctx, 'launch_campaign', { productId: 'prd_a' });
    expect(big.out.output).toMatchObject({ dailyBudget: 60 });
    expect((big.out.output!.creativeIds as string[])).toHaveLength(6);
  });

  it('the control launches as it always did', async () => {
    const lb = await lab({ startingCash: 3000, scaling: false });
    lb.world.day = 29;
    setStage(lb.world, 'portefeuille'); // nothing reads it
    guide(lb.world, 'prd_a');
    for (let i = 0; i < 6; i++) creative(lb.world, `cre_${i}`, 'prd_a');
    book(lb.world, 1, 28, {});
    setCash(lb.world, 3000);
    const { out } = await run(lb.ctx, 'launch_campaign', { productId: 'prd_a' });
    expect(out.output).toMatchObject({ dailyBudget: 40 });
    expect((out.output!.creativeIds as string[])).toHaveLength(3);
  });
});

describe('the room to grow is a target, not an order (scale 8, §4.3)', () => {
  async function room(adTarget: number, committed: number, testWeek = 0) {
    const lb = await lab({ startingCash: 10_000 });
    const { world } = lb;
    world.day = 29;
    const p = guide(world, 'prd_a');
    if (testWeek) guide(world, 'prd_b', { nicheId: world.market.niches[1]!.id, createdDay: 28, launchedDay: 28 });
    campaign(world, 'cmp_a', 'prd_a', committed);
    world.company.growth!.allocation = { adTarget, testWeek, reserve: 0 } as Allocation;
    return { ...lb, p };
  }

  it('a campaign grows up to adTarget, a share for tests out when a guide waits', async () => {
    const free = await room(100, 40);
    expect(scalingRoom(free.world, free.p, 500)).toBe(100);
    const waiting = await room(100, 40, 70);
    expect(scalingRoom(waiting.world, waiting.p, 500)).toBe(90);
  });

  it('never above the cap of the day', async () => {
    const { world, p } = await room(800, 40);
    expect(scalingRoom(world, p, 500)).toBe(500);
  });

  it('a target under what already runs cuts nothing', async () => {
    const { world, p, ctx } = await room(30, 90);
    expect(scalingRoom(world, p, 500)).toBe(committedAdBudget(world));
    expect(scalingRoom(world, p, 60)).toBe(60); // the cap stays a cap
    world.company.growth!.allocation = { adTarget: 30, testWeek: 0, reserve: 0, scaleRoas: 1.25, trimRoas: 0.95 } as Allocation;
    adRows(world, 25, 28, 90, 180);
    const c = world.company.campaigns[0]!;
    c.creativeIds = ['cre_a'];
    creative(world, 'cre_a', 'prd_a');
    book(world, 1, 28, {});
    setCash(world, 10_000);
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('active');
    expect(c.dailyBudget).toBe(90); // ROAS 2 would scale: no room, and it is not punished for it
  });
});

describe('capacity follows the team (D40) and the stage', () => {
  const pipe = (items: { kind: TaskKind; input: Record<string, unknown> }[]) => items.filter((it) => it.kind === 'pick_opportunity' || (it.kind === 'scan_trends' && it.input.chain === 'opportunity'));
  const person = (world: WorldState, id: string, over: Partial<AgentState>): AgentState => {
    const a = { ...world.company.agents[0]!, id, name: id, hatKinds: [], ...over };
    world.company.agents.push(a);
    return a;
  };

  /** A lean, comfortable company on D29 with `live` mains that earn, launched within the week so they all count. */
  async function shop(live: number, over: Partial<ScenarioConfig> = {}) {
    const lb = await lab({ org: LEAN_ORG, talent: 'off', startingCash: 1000, ...over });
    const { world } = lb;
    world.day = 29;
    for (let i = 0; i < live; i++) guide(world, `prd_${i}`, { nicheId: world.market.niches[i]!.id, launchedDay: 26 });
    book(world, 1, 28, {});
    setCash(world, 6000);
    return lb;
  }

  it('the portfolio is the stage\'s maxMains, not the envelope', async () => {
    const full = await shop(2);
    expect(pipe((await buildHeuristicPlan(full.ctx)).items)).toEqual([]); // 2 of 2 in Survie, with 900 € of envelope
    const room = await shop(2);
    setStage(room.world, 'adequation');
    expect(pipe((await buildHeuristicPlan(room.ctx)).items)).toHaveLength(1);
    const control = await shop(2, { scaling: false });
    expect(pipe((await buildHeuristicPlan(control.ctx)).items)).toHaveLength(1); // the envelope reads 8
  });

  it('under growth the envelope no longer sets the portfolio: 0 € of room still reads maxMains', async () => {
    const { world, ctx } = await shop(2);
    setStage(world, 'adequation');
    world.company.growth!.allocation = { reserve: 9000 } as Allocation;
    expect(computeBudget(world).adCap).toBe(0);
    expect(pipe((await buildHeuristicPlan(ctx)).items)).toHaveLength(1); // 2 of 4: the old floor(adCap / 30) reads 1
  });

  it('writers open chains, hats do not, between 2 and 6', async () => {
    const { world } = await shop(0);
    expect(chainSlots(world)).toBe(2);
    person(world, 'plume1', { taskKinds: ['write_pdf'] });
    expect(chainSlots(world)).toBe(3);
    person(world, 'chapeau', { taskKinds: ['write_pdf'], hatKinds: ['write_pdf'] });
    expect(chainSlots(world)).toBe(3);
    for (let i = 2; i < 12; i++) person(world, `plume${i}`, { taskKinds: ['write_pdf'] });
    expect(chainSlots(world)).toBe(6);
  });

  it('a second writer gets a second guide to write; the control and a lone writer wait', async () => {
    const setUp = async (over: Partial<ScenarioConfig>, writers: number) => {
      const lb = await shop(1, over);
      setStage(lb.world, 'adequation');
      guide(lb.world, 'prd_oven', { nicheId: lb.world.market.niches[5]!.id, status: 'writing', launchedDay: null });
      for (let i = 0; i < writers; i++) person(lb.world, `plume${i}`, { taskKinds: ['write_pdf'] });
      return lb;
    };
    const alone = await setUp({}, 0);
    expect(pipe((await buildHeuristicPlan(alone.ctx)).items)).toEqual([]);
    const two = await setUp({}, 1);
    expect(pipe((await buildHeuristicPlan(two.ctx)).items)).toHaveLength(1);
    const control = await setUp({ scaling: false }, 1);
    expect(pipe((await buildHeuristicPlan(control.ctx)).items)).toEqual([]);
  });

  it('a guide waiting for the founder holds a slot: chainSlots of them stop the starts', async () => {
    const lb = await shop(1);
    setStage(lb.world, 'adequation');
    const { world } = lb;
    person(world, 'plume0', { taskKinds: ['write_pdf'] });
    expect(chainSlots(world)).toBe(3);
    for (const id of ['a', 'b']) {
      guide(world, `prd_w${id}`, { nicheId: world.market.niches[id === 'a' ? 6 : 7]!.id, status: 'ready', launchedDay: null });
      const t = createTask(world, { kind: 'publish_product', title: 'Publier', createdBy: 'system', input: { productId: `prd_w${id}` } });
      t.status = 'awaiting_founder';
    }
    expect(pipe((await buildHeuristicPlan(lb.ctx)).items)).toHaveLength(1); // 2 waiting of 3: under the old 2 it would stop
    guide(world, 'prd_wc', { nicheId: world.market.niches[8]!.id, status: 'ready', launchedDay: null });
    createTask(world, { kind: 'publish_product', title: 'Publier', createdBy: 'system', input: { productId: 'prd_wc' } }).status = 'awaiting_founder';
    expect(pipe((await buildHeuristicPlan(lb.ctx)).items)).toEqual([]);
  });

  it('support grows with who answers, the control keeps 24 a day', async () => {
    const inbox = (world: WorldState) => {
      for (let i = 0; i < 60; i++) {
        world.market.inbox.push({ id: `msg_${i}`, day: 28, customerId: 'c', channel: 'email', subject: 'Question', body: 'Bonjour', intent: 'question' as MessageIntent, productId: null, orderId: null, mood: 0, status: 'open', deadlineDay: 30, thread: [], resolution: null } as InboxMessage);
      }
    };
    const replies = async (ctx: RuntimeCtx) => (await buildHeuristicPlan(ctx)).items.filter((it) => it.kind === 'reply_inbox').length;
    const on = await shop(0);
    expect(replyCap(on.world)).toBe(24);
    for (let i = 0; i < 3; i++) person(on.world, `support${i}`, { taskKinds: ['reply_inbox'] });
    expect(replyCap(on.world)).toBe(48);
    inbox(on.world);
    expect(await replies(on.ctx)).toBe(8);
    const off = await shop(0, { scaling: false });
    for (let i = 0; i < 3; i++) person(off.world, `support${i}`, { taskKinds: ['reply_inbox'] });
    inbox(off.world);
    expect(await replies(off.ctx)).toBe(4);
  });
});

// ───────────────────────────── the brain ─────────────────────────────

describe('the brain says what the code does (scale 24)', () => {
  const note = brainFile('business/Croissance.md');

  /** A row of a Markdown table, by its first cell. */
  const row = (label: string): string[] => {
    const line = note.split('\n').find((l) => l.startsWith(`| ${label}`));
    if (!line) throw new Error(`Ligne absente de Croissance.md : ${label}`);
    return line.split('|').slice(2, -1).map((c) => c.trim());
  };
  const num = (cell: string): number | null => (cell === 'aucun' ? null : Number(cell.replace(',', '.')));

  it('every line of the stage table states STAGE_POLICY', () => {
    const fields: [string, (p: StagePolicy) => number | null][] = [
      ['Guides principaux', (p) => p.maxMains], ['Test payant', (p) => p.paidTestEur], ['Budget d\'un test', (p) => p.testDailyEur], ['Créas par campagne', (p) => p.creativesPerCampaign],
      ['Profit réinvesti', (p) => p.split.scale], ['Profit réservé', (p) => p.split.test], ['Profit gardé', (p) => p.split.reserve], ['Jours de réserve', (p) => p.reserveDays],
      ['Ventes avant un kit', (p) => p.bumpMinSales], ['Ventes avant un aimant', (p) => p.magnetMinSales],
    ];
    for (const [label, of] of fields) expect(row(label).map(num), label).toEqual(STAGES.map((s) => of(STAGE_POLICY[s])));
  });

  it('every gate states STAGE_GATES', () => {
    const fr = (n: number) => String(n).replace('.', ',');
    const { adequation: a, acceleration: b, portefeuille: c } = STAGE_GATES;
    const [gateA, heldA] = row('Adéquation').slice(0);
    expect(gateA).toContain(`au moins ${a.mainSales14} ventes en 14 jours`);
    expect(gateA).toContain(`ROAS d'au moins ${fr(a.mainRoas14)} sur au moins ${a.mainSpend14} €`);
    expect(heldA).toBe(`${a.weeks} lundi`);
    const gateB = note.split('\n').find((l) => l.startsWith('| Accélération | profit'))!;
    expect(gateB).toContain(`au moins ${b.profit14} €`);
    expect(gateB).toContain(`au moins ${b.mains} guides`);
    expect(gateB).toContain(`au moins ${fr(b.cashMultiple)} fois le départ`);
    expect(gateB).toContain(`${b.weeks} lundis de suite`);
    const gateC = note.split('\n').find((l) => l.startsWith('| Portefeuille | profit'))!;
    expect(gateC).toContain(`au moins ${c.profit28} €`);
    expect(gateC).toContain(`au moins ${c.mains} guides`);
    expect(gateC).toContain(`au moins ${c.niches} niches`);
    expect(gateC).toContain(`au plus ${c.topShare * 100} %`);
    expect(gateC).toContain(`au moins ${c.ownedShare * 100} %`);
    expect(note).toContain('Trois lundis de suite');
    expect(STAGE_GATES.floorWeeks).toBe(3);
  });

  it('the formulas carry the CFO\'s constants', () => {
    const fr = (n: number) => String(n).replace('.', ',');
    expect(note).toContain(`sur ${CFO.ltvDays} jours, entre 1 et ${fr(CFO.ltvMax)}`);
    expect(note).toContain(`au moins ${CFO.ltvMinFirstOrders} € de premières commandes`);
    expect(note).toContain(`max(${fr(CFO.scaleFloor)} ; ${fr(CFO.scaleMargin)} × point mort)`);
    expect(note).toContain(`max(${fr(CFO.trimFloor)} ; ${fr(CFO.trimMargin)} × point mort)`);
    expect(note).toContain(`max(${CFO.reserveCashShare * 100} % de la trésorerie de départ`);
    expect(note).toContain(`${fr(CFO.reserveSpendShare)} × pub par jour`);
    expect(note).toContain(`au moins ${CFO.leakMinSpend} € de pub sur 14 jours`);
    expect(note).toContain(`${fr(CFO.leakKeep)} × pub par jour + ajout test`);
    expect(note).toContain(`plus ${fr(CFO.leakToTests)} × pub par jour en cas de fuite`);
  });

  it('the rules and the playbook tell the agents, and link the note', () => {
    const rules = brainFile('politiques/Budget et garde-fous.md');
    for (const r of ['10. **Réserve**', '11. **Réinvestissement**', '12. **Récolter avant d\'arrêter**']) expect(rules).toContain(r);
    expect(rules).toContain('[[Croissance]]');
    const playbook = brainFile('playbooks/Playbook Finance.md');
    expect(playbook).toContain('## Chaque lundi');
    expect(playbook).toContain('[[Croissance]]');
  });
});
