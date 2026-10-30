/**
 * Market balance & benchmark (docs/BALANCE.md): benchmark helpers, 5-day smoke runs (founder approval, Claude
 * without key), and regressions for the calibration fixes — price decisions, kill rule, refund gate, price-test
 * significance, fatigue-aware bandit rewards, hook choice that exploits the bandit.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, DailyAdStats, Experiment, Product, WorldState } from '../src/shared.js';
import type { BrainVault, ContentEngine, MindContext, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { sim } from '../src/runtime/modules.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { createTask } from '../src/runtime/tasks.js';
import { priceMove, buildHeuristicPlan, KILL_MIN_VIEWS } from '../src/runtime/strategy.js';
import { experimentCandidate, PRICE_TEST_LOW_CVR } from '../src/runtime/handlers/ops.js';
import { productHealth } from '../src/runtime/acquisition.js';
import { growthHandlers } from '../src/runtime/handlers/growth.js';
import { pickWinner } from '../src/learning/experiments.js';
import { applyDailyRewards, CTR_REWARD_SCALE, FRESH_CREATIVE_IMPRESSIONS, WORN_CREATIVE_WEIGHT } from '../src/learning/retro.js';
import { createContentEngine } from '../src/minds/index.js';
import { createBrainVault } from '../src/learning/index.js';
import * as BALANCE from '../src/sim/balance.js';
import {
  aggregate, applyOverrides, findCliffs, findStalls, improved, median, runOne, type DayRow, type RunResult,
} from '../scripts/balanceLib.js';

// ───────────────────────────── fixtures ─────────────────────────────

async function setup(seed = 21) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-balance-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = createWorld(defaultScenario({ seed, mindMode: 'heuristic' }), 'test-balance');
  const engine: ContentEngine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const brain: BrainVault = createBrainVault(paths);
  await brain.init();
  const rng = createRng(world.rngState);
  const ctx: RuntimeCtx = { world, engine, brain, tools: sim.createMarketTools(world, rng), rng, paths, incidents: [], lastMarketNotes: [] };
  return { world, ctx, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function addProduct(world: WorldState, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId: world.market.niches[0]!.id, title: `Guide ${id} : la méthode simple en 14 jours`, subtitle: '', audience: 'Parents de bébés de 6 à 12 mois',
    problem: 'Bébé se réveille toutes les 2 h', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 2, price: 19 }],
    ...over,
  };
  world.company.products.push(p);
  return p;
}

function addOrders(world: WorldState, p: Product, day: number, n: number, refunded = 0, price = p.price) {
  for (let i = 0; i < n; i++) {
    world.market.orders.push({ id: `ord_${p.id}_${day}_${i}`, day, customerId: `cus_${day}_${i}`, productId: p.id, price, source: 'ads', campaignId: null, creatorId: null, refunded: i < refunded, chargeback: false });
  }
}

/** One paid-ads row for a product: `views` landing views, `purchases` sales at `price`. */
function adRow(day: number, productId: string, views: number, purchases: number, price: number, spend = 20, creativeId = 'cre_x'): DailyAdStats {
  return {
    day, campaignId: 'cpg_x', creativeId, productId, spend, impressions: views * 50, clicks: Math.round(views * 1.15), ctr: 0.023, cpc: 0.3, cpm: 6,
    landingViews: views, purchases, revenue: purchases * price, roas: (purchases * price) / spend, frequency: 1.2, comments: [],
  };
}

function concludedPriceTest(p: Product, day: number, endDay: number, variants: [string, string], winner: string | null): Experiment {
  return {
    id: `exp_${day}`, day, owner: 'emma', hypothesis: `« ${p.title} » rapporte plus par visiteur à ${variants[1]} € qu'à ${variants[0]} €`,
    dimension: 'price', variants, metric: 'roas', status: 'concluded', results: {}, winner, endDay, nicheId: p.nicheId,
  };
}

const row = (day: number, over: Partial<DayRow> = {}): DayRow => ({
  day, cash: 400, ledgerCash: 400, revenue: 0, adSpend: 10, cumulativeProfit: 0, sales: 0, impressions: 0, clicks: 0,
  sellable: true, banned: false, survival: false, nan: [], ...over,
});

// ───────────────────────────── benchmark helpers ─────────────────────────────

describe('benchmark helpers (scripts/balanceLib)', () => {
  it('detects ad stalls: more than 2 idle days with cash, a sellable product and no ad ban', () => {
    const rows = [row(1), row(2, { adSpend: 0 }), row(3, { adSpend: 0 }), row(4), row(5, { adSpend: 0 }), row(6, { adSpend: 0 }), row(7, { adSpend: 0 }), row(8)];
    expect(findStalls(rows, 500)).toEqual([{ fromDay: 5, toDay: 7, days: 3 }]);
    // banned account, no sellable product or cash < 30 % of the start: not a stall
    const excused = [row(1, { adSpend: 0, banned: true }), row(2, { adSpend: 0, sellable: false }), row(3, { adSpend: 0, cash: 100 }), row(4, { adSpend: 0 })];
    expect(findStalls(excused, 500)).toEqual([]);
  });

  it('detects profit cliffs (> 40 % of a ≥ 100 € peak lost in < 7 days) and lists the events that explain them', () => {
    const world = { ledger: [], market: { events: [{ id: 'evt_1', day: 12, kind: 'scam_attempt', title: '', description: '', severity: 'danger' }] } } as unknown as WorldState;
    const profits = [0, 50, 120, 300, 310, 305, 290, 150, 140, 200];
    const rows = profits.map((cumulativeProfit, i) => row(i + 6, { cumulativeProfit }));
    const cliffs = findCliffs(world, rows);
    expect(cliffs).toHaveLength(1);
    expect(cliffs[0]).toMatchObject({ fromDay: 10, toDay: 14, peak: 310, low: 140 });
    expect(cliffs[0]!.events).toEqual(['J12 scam_attempt']);
    // a slow decline or a small peak is not a cliff
    expect(findCliffs(world, [80, 90, 20, 10].map((c, i) => row(i + 1, { cumulativeProfit: c })))).toEqual([]);
    // without an event, paid days without a single sale and refund waves are the logged explanation
    const quiet = { ledger: [{ id: 'l1', day: 4, type: 'refund', amount: -45, memo: '', ref: null }], market: { events: [] } } as unknown as WorldState;
    const drop = [200, 260, 230, 150].map((c, i) => row(i + 1, { cumulativeProfit: c, adSpend: i === 2 ? 35 : 10, sales: i === 2 ? 0 : 3 }));
    expect(findCliffs(quiet, drop)[0]!.events).toEqual(['J3 0 vente pour 35 € de pub', 'J4 45 € remboursés']);
    expect(findCliffs(quiet, drop.map((r) => ({ ...r, adSpend: 10, sales: 2 }))).map((c) => c.events.length)).toEqual([1]);
  });

  it('aggregates runs per difficulty (median, profitable, goal, bankrupt, learning)', () => {
    const base = { difficulty: 'normal', cliffs: [], stalls: [], kpiMismatchDays: [], nanDays: [], firstProfitDay: 10 } as unknown as RunResult;
    const rs = [
      { ...base, profit: 1200, goalDay: 40, bankrupt: false, ctr1: 0.02, ctr2: 0.025, roas1: 1.1, roas2: 1.4 },
      { ...base, profit: -100, goalDay: null, bankrupt: true, ctr1: 0.02, ctr2: 0.019, roas1: 1.1, roas2: 1.2 },
      { ...base, profit: 2500, goalDay: 30, bankrupt: false, ctr1: null, ctr2: 0.03, roas1: 1.5, roas2: 1.4 },
    ] as RunResult[];
    expect(aggregate(rs, 'normal')).toMatchObject({ runs: 3, medianProfit: 1200, profitable: 2, goal: 2, bankrupt: 1, ctrImproved: 1, roasImproved: 2, bothImproved: 1 });
    expect(aggregate(rs, 'facile')).toBeNull();
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(improved(null, 2)).toBe(false);
  });

  it('applies calibration overrides to the live constants and refuses unknown paths', () => {
    const before = BALANCE.ADS.baseCtr;
    try {
      applyOverrides({ 'ADS.baseCtr': 0.0123 });
      expect(BALANCE.ADS.baseCtr).toBe(0.0123);
      expect(() => applyOverrides({ 'ADS.nope': 1 })).toThrow(/Constante inconnue/);
      expect(() => applyOverrides({ 'DIFFICULTY.normal': 1 })).toThrow(/non numérique/);
    } finally {
      BALANCE.ADS.baseCtr = before;
    }
  });
});

// ───────────────────────────── smoke runs ─────────────────────────────

describe('5-day smoke runs (founder approval, Claude without key)', () => {
  it('founderApproval: the run goes on, publication waits for the founder, and approving lets the guide go live', async () => {
    const waiting = await runOne({ difficulty: 'normal', seed: 7, days: 5, budget: 500, founderApproval: true });
    expect(waiting.rows).toHaveLength(5);
    expect(waiting.awaitingFounder).toBeGreaterThan(0);
    expect(waiting.adSpend).toBe(0); // nothing is sold or advertised without the founder's click
    expect(waiting.kpiMismatchDays).toEqual([]);
    expect(waiting.nanDays).toEqual([]);
    const approved = await runOne({ difficulty: 'normal', seed: 7, days: 5, budget: 500, founderApproval: true, autoApprove: true });
    expect(approved.awaitingFounder).toBe(0);
    expect(approved.live).toBeGreaterThan(0);
    expect(approved.kpiMismatchDays).toEqual([]);
  }, 60_000);

  it("mindMode 'claude' without an API key falls back to the heuristic engine and plays exactly the same run", async () => {
    const claude = await runOne({ difficulty: 'normal', seed: 7, days: 5, budget: 500, mindMode: 'claude' });
    const heuristic = await runOne({ difficulty: 'normal', seed: 7, days: 5, budget: 500, mindMode: 'heuristic' });
    expect(claude.mindMode).toBe('heuristic');
    expect(claude.rows).toHaveLength(5);
    expect(claude.nanDays).toEqual([]);
    expect(claude.kpiMismatchDays).toEqual([]);
    expect(claude.profit).toBe(heuristic.profit);
    expect(claude.live).toBeGreaterThan(0);
  }, 60_000);
});

// ───────────────────────────── learning ─────────────────────────────

describe('learning calibration', () => {
  it('a price test names no winner on one lucky sale, nor on a lift under 10 %', () => {
    const e = (results: Experiment['results']) => ({ dimension: 'price' as const, metric: 'roas' as const, variants: ['14', '19'], results });
    // bal-normal-1 day 31: 46 visitors / 0 sale at 14 € vs 34 visitors / 1 sale at 19 € → "19 € wins" was noise
    expect(pickWinner(e({ 14: { n: 46, value: 0 }, 19: { n: 34, value: 0.5588 } }))).toBeNull();
    expect(pickWinner(e({ 14: { n: 200, value: 0.7 }, 19: { n: 200, value: 0.38 } }))).toBe('14'); // 10 vs 4 sales
    expect(pickWinner(e({ 14: { n: 300, value: 0.7 }, 19: { n: 300, value: 0.66 } }))).toBeNull(); // +6 %: inconclusive
    // other dimensions are unchanged
    expect(pickWinner({ dimension: 'hook_style', metric: 'ctr', variants: ['story', 'stat'], results: { story: { n: 3000, value: 0.04 }, stat: { n: 3000, value: 0.039 } } })).toBe('story');
  });

  it('hook/format rewards: scale 5 % CTR, and a worn-out creative barely moves the bandit', () => {
    const world = createWorld(defaultScenario({ seed: 3, mindMode: 'heuristic' }), 'test-rewards');
    const p = addProduct(world, 'prd_r');
    const creative = (id: string, hookStyle: 'story' | 'pov', format: 'carousel' | 'ugc_avatar') => ({
      id, productId: p.id, hook: id, hookStyle, format, scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null },
      quality: null, review: { status: 'approved' as const, reason: null, day: 1 }, createdDay: 1, createdBy: 'chloe',
    });
    world.company.creatives.push(creative('cre_fresh', 'story', 'carousel'), creative('cre_worn', 'pov', 'ugc_avatar'));
    world.market.adStats.push({ ...adRow(9, p.id, 10, 0, 19, 100, 'cre_worn'), impressions: FRESH_CREATIVE_IMPRESSIONS + 10_000 });
    world.market.adStats.push({ ...adRow(10, p.id, 60, 1, 19, 20, 'cre_fresh'), impressions: 3000, clicks: 120 }); // CTR 4 %
    world.market.adStats.push({ ...adRow(10, p.id, 60, 1, 19, 20, 'cre_worn'), impressions: 3000, clicks: 120 });
    world.company.lastRetroDay = 9;
    applyDailyRewards(world, 10);
    const arm = (dim: string, key: string) => world.company.bandits[`${dim}:${p.nicheId}`]!.find((a) => a.key === key)!;
    const reward = 0.04 / CTR_REWARD_SCALE;
    expect(arm('hook_style', 'story').alpha).toBeCloseTo(1 + reward * 3, 4);
    expect(arm('hook_style', 'pov').alpha).toBeCloseTo(1 + reward * 3 * WORN_CREATIVE_WEIGHT, 4);
    expect(arm('ad_format', 'carousel').beta).toBeCloseTo(1 + (1 - reward) * 3, 4);
  });
});

// ───────────────────────────── pricing ─────────────────────────────

describe('CEO price decisions (strategy.priceMove)', () => {
  it('applies the winner of a concluded price test, and goes back to the control when it was inconclusive', () => {
    const world = createWorld(defaultScenario({ seed: 3, mindMode: 'heuristic' }), 'test-price');
    const ctx = { world } as unknown as RuntimeCtx;
    world.day = 18;
    const p = addProduct(world, 'prd_win', { price: 29, priceHistory: [{ day: 2, price: 24 }, { day: 10, price: 24 }, { day: 11, price: 29 }, { day: 17, price: 29 }] });
    world.company.experiments.push(concludedPriceTest(p, 10, 17, ['24', '29'], '24'));
    expect(priceMove(ctx, p)).toMatchObject({ input: { productId: p.id, reason: 'winner', price: 24 } });
    world.company.experiments[0]!.winner = null;
    expect(priceMove(ctx, p)).toMatchObject({ input: { reason: 'winner', price: 24 } }); // control = price before the test
    // once applied (a change after the test), the test no longer drives the price
    p.price = 24;
    p.priceHistory.push({ day: 18, price: 24 });
    world.day = 19;
    expect(priceMove(ctx, p)?.input.reason).not.toBe('winner');
  });

  it('rolls a raise back when it lowers the revenue per paid visitor, and never retries the abandoned tier', () => {
    const world = createWorld(defaultScenario({ seed: 3, mindMode: 'heuristic' }), 'test-price');
    const ctx = { world } as unknown as RuntimeCtx;
    world.day = 16;
    const p = addProduct(world, 'prd_raise', { price: 24, priceHistory: [{ day: 2, price: 19 }, { day: 10, price: 24 }] });
    for (let d = 4; d <= 9; d++) world.market.adStats.push(adRow(d, p.id, 40, 2, 19)); // 0,95 €/visitor at 19 €
    for (let d = 10; d <= 15; d++) world.market.adStats.push(adRow(d, p.id, 40, d % 2, 24)); // 0,30 €/visitor at 24 €
    const back = priceMove(ctx, p);
    expect(back).toMatchObject({ input: { reason: 'baisse', price: 19 } });
    expect(back!.why).toMatch(/revenu par visiteur/);
    // back at 19 € with plenty of sales: 24 € was already tried and abandoned → no new raise to 24 €
    p.price = 19;
    p.priceHistory.push({ day: 16, price: 19 });
    world.market.adStats = [];
    world.day = 25;
    addOrders(world, p, 18, 12);
    expect(priceMove(ctx, p)).toBeNull();
    // the same sales without that history do earn a raise
    p.priceHistory = [{ day: 16, price: 19 }];
    expect(priceMove(ctx, p)).toMatchObject({ input: { reason: 'hausse' } });
  });

  it('steps one tier down when hundreds of paid visitors do not buy at this price', () => {
    const world = createWorld(defaultScenario({ seed: 3, mindMode: 'heuristic' }), 'test-price');
    const ctx = { world } as unknown as RuntimeCtx;
    world.day = 11;
    const p = addProduct(world, 'prd_dear', { price: 24, priceHistory: [{ day: 2, price: 24 }] });
    for (let d = 2; d <= 9; d++) world.market.adStats.push(adRow(d, p.id, 45, d === 5 ? 1 : 0, 24)); // 360 visitors, 1 sale
    expect(priceMove(ctx, p)).toMatchObject({ input: { reason: 'baisse', price: 19 } });
    world.market.adStats = world.market.adStats.slice(0, 4); // 180 visitors: not enough to judge
    expect(priceMove(ctx, p)).toBeNull();
  });

  it('a price test goes one tier down when paid conversion is low, one tier up otherwise', async () => {
    const { world, ctx, cleanup } = await setup(5);
    try {
      world.day = 20;
      const p = addProduct(world, 'prd_test', { price: 24, priceHistory: [{ day: 2, price: 24 }] });
      p.stats.sales = 12;
      for (let d = 14; d <= 19; d++) world.market.adStats.push(adRow(d, p.id, 40, d === 15 ? 1 : 0, 24)); // CVR 0,4 %
      expect(PRICE_TEST_LOW_CVR).toBeGreaterThan(1 / 240);
      expect(experimentCandidate(ctx)).toMatchObject({ dimension: 'price', variants: ['24', '19'] });
      for (const s of world.market.adStats) s.purchases = 2; // CVR 5 %
      expect(experimentCandidate(ctx)).toMatchObject({ dimension: 'price', variants: ['24', '29'] });
    } finally {
      cleanup();
    }
  });
});

// ───────────────────────────── kill rule & quality gate ─────────────────────────────

describe('CEO kill rule and refund gate', () => {
  it('does not kill a product after 7 days on a sample too small to judge, kills it on a real one', async () => {
    const { world, ctx, cleanup } = await setup(9);
    try {
      world.day = 10;
      const p = addProduct(world, 'prd_young', { launchedDay: 2 });
      addOrders(world, p, 5, 2);
      for (let d = 3; d <= 9; d++) world.market.adStats.push(adRow(d, p.id, 30, 0, 19, 15)); // 210 visitors, ~100 € of ads
      await buildHeuristicPlan(ctx);
      expect(p.status).toBe('live');
      for (let d = 3; d <= 9; d++) world.market.adStats.push(adRow(d, p.id, Math.ceil(KILL_MIN_VIEWS / 7), 0, 19, 15));
      await buildHeuristicPlan(ctx);
      expect(p.status).toBe('killed');
    } finally {
      cleanup();
    }
  });

  it('16 % refunds do not stop a guide that pays back its ads net of refunds; they do when it loses money', async () => {
    const world = createWorld(defaultScenario({ seed: 3, mindMode: 'heuristic' }), 'test-refunds');
    world.day = 30;
    const p = addProduct(world, 'prd_refunds');
    addOrders(world, p, 10, 50, 8); // 16 %: significant (Wilson lower bound > 10 %)
    for (let d = 5; d <= 24; d++) world.market.adStats.push(adRow(d, p.id, 40, 2, 19, 15)); // 300 € of ads, 798 € net
    expect(productHealth(world, p).severe).toBeNull();
    for (const s of world.market.adStats) s.spend = 45; // 900 € of ads: ROAS 0,89 net of refunds
    expect(productHealth(world, p).severe).toMatch(/16 % de remboursements sur 50 ventes/);
    const extreme = addProduct(world, 'prd_extreme');
    addOrders(world, extreme, 10, 20, 6); // 30 % refunds: severe whatever the ROAS
    expect(productHealth(world, extreme).severe).toMatch(/30 % de remboursements/);
  });
});

// ───────────────────────────── creative production ─────────────────────────────

describe('creative production exploits the hook bandit', () => {
  it('outside an A/B slot, new creatives take the style the bandit is sure about (fresh hook or new execution of a used one)', async () => {
    const { world, ctx, cleanup } = await setup(42);
    try {
      const { Company } = await import('../src/runtime/index.js');
      const company = new Company(world, { paths: ctx.paths, engine: ctx.engine, brain: ctx.brain });
      await company.runDays(5);
      const p = world.company.products.find((x) => x.status === 'live' && x.content);
      expect(p, 'a live guide by day 5').toBeDefined();
      for (const e of world.company.experiments) if (e.status === 'running') { e.status = 'concluded'; e.endDay = world.day; }
      const styles = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] as const;
      world.company.bandits[`hook_style:${p!.nicheId}`] = styles.map((key) => (key === 'stat'
        ? { key, alpha: 200, beta: 5, pulls: 60, reward: 58 }
        : { key, alpha: 5, beta: 200, pulls: 60, reward: 2 }));
      const hooks = createTask(world, { kind: 'write_ad_hooks', input: { productId: p!.id } });
      hooks.status = 'done';
      hooks.dayDone = world.day;
      hooks.output = { hooks: styles.map((s) => ({ hook: `Hook ${s} pour ce guide`, hookStyle: s })) };
      const agent = world.company.agents.find((a) => a.taskKinds.includes('produce_ad')) as AgentState;
      const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: world.day };
      const made: string[] = [];
      for (let i = 0; i < 8; i++) {
        const task = createTask(world, { kind: 'produce_ad', input: { productId: p!.id, variant: 100 + i } });
        const out = await growthHandlers.produce_ad!.run(ctx, task, agent, mind);
        made.push(String(out.output?.hookStyle));
      }
      // before: the n-th creative took the n-th unused hook of the pool (1 in 8 here); now the learned style wins
      expect(made.filter((s) => s === 'stat').length).toBeGreaterThanOrEqual(7);
    } finally {
      cleanup();
    }
  }, 60_000);
});

