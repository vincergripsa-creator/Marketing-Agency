/**
 * The insurance of D117: under the survival line one small paid test at a time. Worlds are real, ad rows are written by hand, so each
 * rule fails on its own; a real run closes the file, money and reloads included.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArchive } from '../src/api/archive.js';
import type { RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { adsHold, addHold } from '../src/runtime/holds.js';
import { launchableCreatives, openTest, SURVIVAL_ROAS, SURVIVAL_SAMPLE, UNDER_LINE, underLineBlock, underLinePick } from '../src/runtime/acquisition.js';
import { buildDigest } from '../src/runtime/digest.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { computeBudget, survivalFloor } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { LEAN_ORG } from '../src/runtime/org/constants.js';
import { stopPaidAds } from '../src/runtime/pipeline.js';
import { buildHeuristicPlan, reactToOutage } from '../src/runtime/strategy.js';
import { createTask } from '../src/runtime/tasks.js';
import type { AdCreative, Campaign, DailyAdStats, Product, ScenarioConfig, TaskKind, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

/** The legacy team with the growth pillar on, so nobody is paid unless a test says so. 300 € is the line of this start. */
async function lab(over: Partial<ScenarioConfig> = {}) {
  const world = createWorld(defaultScenario({ ...LEGACY, scaling: true, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 200, startingCash: 1000, ...over }), 'test-survival');
  const root = mkdtempSync(join(tmpdir(), 'pixel-survival-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx };
}

function setCash(world: WorldState, cash: number): void {
  world.ledger.unshift({ id: 'led_till', day: 0, type: 'capital', amount: cash - sim.financeSnapshot(world).cash, memo: 'Caisse', ref: null });
}

function guide(world: WorldState, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    id, nicheId: world.market.niches[0]!.id, title: `Guide ${id}`, subtitle: '', audience: 'parents', problem: 'les nuits', price: 19, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 2, launchedDay: 3, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 3, price: 19 }], ...over,
  };
  world.company.products.push(p);
  return p;
}

function creative(world: WorldState, id: string, productId: string): AdCreative {
  const c: AdCreative = {
    id, productId, hook: `Hook ${id}`, hookStyle: 'pov', format: 'faceless_voiceover', scenes: [], caption: '', hashtags: [], cta: '',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
  };
  world.company.creatives.push(c);
  return c;
}

function adRows(world: WorldState, campaignId: string, from: number, to: number, spend: number, revenue: number, creativeId = 'cre_a', productId = 'prd_a'): void {
  for (let day = from; day <= to; day++) {
    world.market.adStats.push({ day, campaignId, creativeId, productId, spend, revenue, roas: spend > 0 ? revenue / spend : 0, impressions: spend * 200, clicks: spend * 5, ctr: 0.025, cpc: 0.2, cpm: 5, landingViews: spend * 4, purchases: Math.round(revenue / 19), frequency: 1.2, comments: [] } as DailyAdStats);
  }
}

function plain(world: WorldState, id: string, status: Campaign['status'] = 'active'): Campaign {
  const c: Campaign = { id, productId: 'prd_a', name: `Campagne ${id}`, creativeIds: ['cre_a'], dailyBudget: 12, status, targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay: 20, createdBy: 'test' };
  world.company.campaigns.push(c);
  return c;
}

async function run(ctx: RuntimeCtx, kind: TaskKind, input: Record<string, unknown> = {}) {
  const agent = ctx.world.company.agents[0]!;
  const mind = { agent, playbook: [], brainNotes: [], lessons: [], day: ctx.world.day, brand: 'x' } as never;
  const task = createTask(ctx.world, { kind, title: kind, assignee: agent.id, createdBy: 'system', input });
  const out = await HANDLERS[kind].run(ctx, task, agent, mind);
  if (!out.awaitFounder) Object.assign(task, { status: 'done', dayDone: ctx.world.day }); // a day's work: nothing here stays open
  return { task, out };
}

/** A week at 10 € a day: the runway falls under 14 days, the CFO's rate to 8 %. 60 € then leave 4,80 € of envelope, under the platform's minimum. */
function shortRunway(world: WorldState): void {
  const today = world.day;
  for (let day = 24; day <= 30; day++) {
    world.day = day;
    sim.recordLedger(world, { type: 'platform_fee', amount: -10, memo: 'Frais', ref: `fixed:${day}` });
  }
  world.day = today;
}

/** Day 31, 100 € in the till, no ad running, one guide with a validated creative. */
async function under(over: Partial<ScenarioConfig> = {}, cash = 100) {
  const l = await lab(over);
  l.world.day = 31;
  const p = guide(l.world, 'prd_a');
  creative(l.world, 'cre_a', 'prd_a');
  setCash(l.world, cash);
  return { ...l, p };
}

const planned = async (ctx: RuntimeCtx) => (await buildHeuristicPlan(ctx)).items.find((i) => i.input.underLine === true);
const tests = (w: WorldState): Campaign[] => w.company.campaigns.filter((c) => !!c.underLine);

/** The plan's test, launched: the road every test below starts from. */
async function launched(ctx: RuntimeCtx): Promise<Campaign> {
  const item = await planned(ctx);
  expect(item).toBeDefined();
  await run(ctx, 'launch_campaign', item!.input);
  const c = tests(ctx.world).at(-1);
  expect(c).toBeDefined();
  return c!;
}

describe('the numbers', () => {
  it('5 € a day for 6 days is the 30 € of the brief, and the survival rule keeps its 1,2 on 10 €', () => {
    expect(UNDER_LINE.dailyEur * UNDER_LINE.days).toBe(UNDER_LINE.totalEur);
    expect([UNDER_LINE.dailyEur, UNDER_LINE.days, UNDER_LINE.totalEur, UNDER_LINE.gapDays]).toEqual([5, 6, 30, 14]);
    expect([SURVIVAL_ROAS, SURVIVAL_SAMPLE]).toEqual([1.2, 10]);
  });
});

describe('when a test starts', () => {
  it('in survival, no ad running: the plan asks one, on this guide, and the buyer launches it at 5 € a day', async () => {
    const { world, ctx, p } = await under();
    const c = await launched(ctx);
    expect(c).toMatchObject({ productId: p.id, dailyBudget: 5, status: 'active', creativeIds: ['cre_a'], underLine: { endDay: null, failed: false } });
    expect(openTest(c)).toBe(true);
    expect(c.channel).toBeUndefined(); // TikTok
    expect(world.company.campaigns).toHaveLength(1);
  });

  it('survival has no envelope to fit in: 60 € leave 4,80 € of envelope, under the platform\'s minimum', async () => {
    const { world, ctx } = await under();
    shortRunway(world);
    setCash(world, 60);
    expect(computeBudget(world)).toMatchObject({ survival: true, adCap: 4.8 });
    expect((await launched(ctx)).dailyBudget).toBe(5);
  });

  it('above the line, at the line, nothing: the ordinary plan decides', async () => {
    const { world, ctx } = await under({}, 300);
    expect(computeBudget(world).survival).toBe(false);
    expect(await planned(ctx)).toBeUndefined();
    expect(underLineBlock(world)).toContain('au-dessus de la ligne');
  });

  it('the control and the old company test nothing', async () => {
    for (const over of [{ control: { noSurvivalTest: true } }, { scaling: false }]) {
      const { ctx } = await under(over);
      expect(await planned(ctx)).toBeUndefined();
    }
  });

  it('never while a campaign runs, even a losing one that waits for its stop', async () => {
    const { world, ctx } = await under();
    plain(world, 'cmp_a');
    expect(await planned(ctx)).toBeUndefined();
    expect(underLineBlock(world)).toBe('une campagne tourne déjà');
  });

  it('one at a time: the task of yesterday is enough, a test off for an outage too', async () => {
    const first = await under();
    const item = await planned(first.ctx);
    createTask(first.world, { kind: 'launch_campaign', title: 'test', createdBy: 'system', input: item!.input });
    expect(underLineBlock(first.world)).toBeNull();
    expect(underLinePick(first.world)).toBeNull();
    const second = await under();
    const c = await launched(second.ctx);
    Object.assign(c, { status: 'paused', pausedFor: 'outage' });
    expect(underLinePick(second.world)).toBeNull();
  });

  it('cash must cover the test and a week of costs, to the cent', async () => {
    const { world } = await under({ org: { ...LEAN_ORG, autoHire: false } });
    expect(survivalFloor(world)).toBe(9.59); // 7 × 1,37 €: in survival the founders are owed nothing
    setCash(world, 39.58);
    expect(underLinePick(world)).toBeNull();
    expect(underLineBlock(world)).toContain('39,59');
    setCash(world, 39.59);
    expect(underLinePick(world)).not.toBeNull();
  });

  it('a hire still paid raises the floor', async () => {
    const { world } = await under({ org: { ...LEAN_ORG, autoHire: false } });
    world.company.agents.push({ ...world.company.agents[0]!, id: 'recrue', founder: false, isChief: false, tier: 'sonnet' });
    expect(survivalFloor(world)).toBe(13.79); // 7 × (1,37 + 0,60) €
  });

  it('bankrupt: nothing, the till is negative', async () => {
    const { world, ctx } = await under({}, -5);
    expect(computeBudget(world).bankrupt).toBe(true);
    expect(await planned(ctx)).toBeUndefined();
    const { out } = await run(ctx, 'launch_campaign', { productId: 'prd_a', underLine: true });
    expect(out.output).toMatchObject({ skipped: true, reason: 'company' });
  });

  it('an ad ban stops it, on the plan and on the buyer\'s desk', async () => {
    const { world, ctx } = await under();
    Object.assign(world.market.adAccount, { banned: true, bannedUntilDay: world.day + 5 });
    expect(await planned(ctx)).toBeUndefined();
    const { out } = await run(ctx, 'launch_campaign', { productId: 'prd_a', underLine: true });
    expect(out.output).toMatchObject({ skipped: true, reason: 'company' });
    expect(tests(world)).toEqual([]);
    world.day += 5; // the ban ends on its day
    expect(underLinePick(world)).not.toBeNull();
  });

  it('a ban on any open account is enough, on the words of the brief', async () => {
    const { world } = await under({ channelControl: 'none' });
    world.company.channels = { open: ['tiktok', 'meta'], requested: {}, lines: [], plan: null, attribution: null };
    expect(underLinePick(world)).not.toBeNull();
    Object.assign(world.market.channels!.accounts.meta, { banned: true, bannedUntilDay: world.day + 5 });
    expect(underLinePick(world)).toBeNull();
  });

  it('an outage stops it: nothing can sell today', async () => {
    const { world, ctx } = await under();
    world.market.events.push({ id: 'evt_x', day: world.day, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger', refs: { day: world.day } });
    expect(computeBudget(world).outage).toBe(true);
    expect(await planned(ctx)).toBeUndefined();
  });

  it('the founder\'s stop beats it, on everything or on a guide: the next guide then gets the test', async () => {
    const all = await under();
    addHold(all.world, { kind: 'ads', productId: null, until: null, reason: 'coupe tout' });
    expect(await planned(all.ctx)).toBeUndefined();
    const { out } = await run(all.ctx, 'launch_campaign', { productId: 'prd_a', underLine: true });
    expect(out.output).toMatchObject({ skipped: true, why: 'coupe tout' });

    const one = await under();
    guide(one.world, 'prd_b');
    creative(one.world, 'cre_b', 'prd_b');
    addHold(one.world, { kind: 'ads', productId: 'prd_a', until: null, reason: 'pas ce guide' });
    expect((await planned(one.ctx))?.input.productId).toBe('prd_b');
  });

  it('the best guide first, and the cheapest channel that takes 5 € a day', async () => {
    const { world, ctx, p } = await under({ channelControl: 'none' });
    p.stats.reviews = [];
    const best = guide(world, 'prd_b', { quality: { overall: 100 } as Product['quality'], salesQuality: { overall: 100 } as Product['salesQuality'] });
    creative(world, 'cre_b', 'prd_b');
    Object.assign(creative(world, 'cre_pin', 'prd_b'), { format: 'static_image', ratio: '2:3', channelReviews: { pinterest: { status: 'approved', reason: null, day: 2 } } });
    world.company.channels = { open: ['pinterest', 'meta', 'tiktok'], requested: {}, lines: [], plan: null, attribution: null };
    expect(launchableCreatives(world, 'prd_b', 'pinterest').map((c) => c.id)).toEqual(['cre_pin']);
    expect(underLinePick(world)).toEqual({ product: best, channel: 'tiktok' });
    addHold(world, { kind: 'ads', productId: null, channel: 'tiktok', until: null, reason: 'pas TikTok' });
    expect(adsHold(world, null, 'tiktok')).not.toBeNull();
    expect(underLinePick(world)).toBeNull(); // Pinterest asks 6 € a day: a channel's minimum is not bent for a test
    expect(await planned(ctx)).toBeUndefined();
  });

  it('a guide with no validated creative, a creative judged a failure, a harvest, a follow-up: no test', async () => {
    const none = await under();
    none.world.company.creatives[0]!.review = { status: 'rejected', reason: 'non', day: 2 };
    expect(underLinePick(none.world)).toBeNull();

    const judged = await under();
    adRows(judged.world, 'cmp_old', 5, 6, 8, 4);
    expect(launchableCreatives(judged.world, 'prd_a')).toEqual([]);
    expect(underLinePick(judged.world)).toBeNull();

    const harvest = await under();
    harvest.p.harvest = { day: 20, price: 19, version: 1, retest: null };
    expect(underLinePick(harvest.world)).toBeNull();

    const upsell = await under();
    guide(upsell.world, 'prd_parent', { upsellProductId: 'prd_a' });
    expect(underLinePick(upsell.world)).toBeNull();
  });
});

describe('while it runs', () => {
  it('the buyer leaves it alone: neither the survival rule nor the envelope reads 5 € a day', async () => {
    const { world, ctx } = await under();
    shortRunway(world);
    setCash(world, 60);
    const c = await launched(ctx);
    world.day += 3;
    adRows(world, c.id, 31, 33, 4.8, 0);
    expect(computeBudget(world).adCap).toBeLessThan(5);
    await run(ctx, 'optimize_ads');
    expect(c).toMatchObject({ status: 'active', dailyBudget: 5 });
  });

  it('the same campaign without the flag is cut by both, which is what the flag holds back', async () => {
    const { world, ctx } = await under();
    shortRunway(world);
    setCash(world, 60);
    const c = plain(world, 'cmp_a');
    world.day += 3;
    adRows(world, c.id, 31, 33, 4.8, 0);
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('paused');
  });

  it('the stop-loss still reads it', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += 5;
    adRows(world, c.id, 31, 35, 5, 0);
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('paused');
    await buildHeuristicPlan(ctx);
    expect(c.underLine).toEqual({ endDay: world.day, failed: true });
  });

  it('it judges no guide: the kill rule waits, where the same spend on a campaign kills', async () => {
    const paidTest = async (flag: boolean) => {
      const l = await under();
      adRows(l.world, 'cmp_old', 5, 9, 25, 10); // 125 € of a real paid test, long out of the window, and `cre_a` not judged: see below
      l.world.market.adStats.forEach((s) => { s.creativeId = 'cre_old'; });
      const c = plain(l.world, 'cmp_t', 'paused');
      Object.assign(c, { startDay: 31, dailyBudget: 5, status: 'active', ...(flag ? { underLine: { endDay: null, failed: false } } : {}) });
      l.world.day = 32;
      adRows(l.world, c.id, 31, 31, 5, 0);
      await buildHeuristicPlan(l.ctx);
      return l.p.status;
    };
    expect(await paidTest(false)).toBe('killed');
    expect(await paidTest(true)).toBe('live');
  });

  it('a failed test does not judge it either: the next test may be the same guide', async () => {
    const { world, ctx, p } = await under();
    creative(world, 'cre_b', 'prd_a');
    adRows(world, 'cmp_old', 5, 9, 25, 10, 'cre_old');
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 0);
    await buildHeuristicPlan(ctx);
    expect(c.underLine?.failed).toBe(true);
    world.day += 1;
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
  });

  it('an outage is a day off: the test comes back the next morning, though no envelope would have it', async () => {
    const { world, ctx } = await under();
    shortRunway(world);
    setCash(world, 60);
    const c = await launched(ctx);
    world.day = 32;
    world.market.events.push({ id: 'evt_x', day: 31, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger', refs: { day: 32 } });
    expect(reactToOutage(ctx)).toBe(true);
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'outage' });
    await buildHeuristicPlan(ctx);
    expect(openTest(c)).toBe(true);
    world.day = 33;
    expect(reactToOutage(ctx)).toBe(false);
    expect(c.status).toBe('active');
    await buildHeuristicPlan(ctx);
    expect(openTest(c)).toBe(true);
  });

  it('the founder stops the ads: the test ends there and it counts as failed, their hold keeps the next one out', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    adRows(world, c.id, 31, 32, 6, 30); // it was paying: a stop is no verdict, and no winner either
    stopPaidAds(ctx, null, 'ordre du fondateur');
    addHold(world, { kind: 'ads', productId: null, until: null, reason: 'les pubs sont coupées' });
    world.day += 2;
    expect(await planned(ctx)).toBeUndefined();
    expect(c).toMatchObject({ status: 'paused', pausedFor: 'founder', underLine: { endDay: 33, failed: true } });
  });

  it('one morning over the line spares it nothing: it runs to its verdict, a loser stops and the next one waits', async () => {
    const { world, ctx } = await under();
    creative(world, 'cre_b', 'prd_a');
    const c = await launched(ctx);
    setCash(world, 400);
    world.day += 2;
    adRows(world, c.id, 31, 32, 4.8, 0);
    await buildHeuristicPlan(ctx);
    expect(openTest(c)).toBe(true);
    await run(ctx, 'optimize_ads');
    expect(c).toMatchObject({ status: 'active', dailyBudget: 5 });
    world.day = 37;
    adRows(world, c.id, 33, 36, 4.8, 0);
    await buildHeuristicPlan(ctx);
    expect(c).toMatchObject({ status: 'paused', underLine: { endDay: 37, failed: true } });
    setCash(world, 100);
    world.day += 1;
    expect(underLineBlock(world)).toContain('test raté le jour 37');
  });
});

describe('its verdict', () => {
  it('6 days at most: still running on day 5, judged on the morning of day 6', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day = c.startDay + UNDER_LINE.days - 1;
    adRows(world, c.id, 31, 35, 4.75, 0);
    await buildHeuristicPlan(ctx);
    expect(openTest(c)).toBe(true);
    world.day += 1;
    adRows(world, c.id, 36, 36, 4.75, 0);
    await buildHeuristicPlan(ctx);
    expect(openTest(c)).toBe(false);
  });

  it('ROAS 1,2 or more on a real sample: it goes on, and lives by the rule that keeps paying ads in survival', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 6);
    await buildHeuristicPlan(ctx);
    expect(c).toMatchObject({ status: 'active', dailyBudget: 5, underLine: { endDay: 37, failed: false } });
    expect(underLineBlock(world)).toBe('une campagne tourne déjà');
    adRows(world, c.id, 37, 39, 5, 0);
    world.day = 40;
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('paused'); // the survival rule reads it now, and no gap: it did not fail
    expect(underLineBlock(world)).toBeNull();
  });

  it('ROAS 1,19 stops it, whatever a rule of thumb would round it to', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 5.71);
    await buildHeuristicPlan(ctx);
    expect(c).toMatchObject({ status: 'paused', underLine: { endDay: 37, failed: true } });
  });

  it('ROAS 2 on 9 € is no sample', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 33, 3, 6);
    await buildHeuristicPlan(ctx);
    expect(c.underLine?.failed).toBe(true);
  });

  it('14 days between a failure and the next test, on a creative that was not judged', async () => {
    const { world, ctx } = await under();
    creative(world, 'cre_b', 'prd_a');
    const c = await launched(ctx);
    expect(c.creativeIds).toEqual(['cre_a', 'cre_b']);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 0);
    creative(world, 'cre_c', 'prd_a');
    await buildHeuristicPlan(ctx);
    world.day = 37 + UNDER_LINE.gapDays - 1;
    expect(underLinePick(world)).toBeNull();
    expect(underLineBlock(world)).toContain(`jour ${37 + UNDER_LINE.gapDays}`);
    world.day += 1;
    expect(underLinePick(world)?.product.id).toBe('prd_a');
    expect((await launched(ctx)).creativeIds).toEqual(['cre_b', 'cre_c']); // `cre_a` spent 28,80 € for nothing: judged
  });

  it('runs once: a morning played again writes nothing twice', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 0);
    await buildHeuristicPlan(ctx);
    const lines = world.company.growth!.decisions.length;
    await buildHeuristicPlan(ctx);
    expect(world.company.growth!.decisions).toHaveLength(lines);
  });
});

describe('approval mode', () => {
  it('nothing goes out before their yes, and their yes is the test\'s budget', async () => {
    const { world, ctx } = await under({ founderApproval: true });
    const item = await planned(ctx);
    const { task, out } = await run(ctx, 'launch_campaign', item!.input);
    expect(out.awaitFounder).toBe('Lancer un petit test sous la ligne sur TikTok, 5 €/jour pendant 6 jours au plus, 30 € en tout, pour « Guide prd_a »');
    expect(tests(world)).toEqual([]);
    expect(task.input.askedBudget).toBe(5);
    task.status = 'awaiting_founder';
    expect(underLinePick(world)).toBeNull(); // the question stands, no second one
    task.input.founderApproved = true;
    await HANDLERS.launch_campaign.run(ctx, task, world.company.agents[0]!, { agent: world.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'x' } as never);
    expect(tests(world)[0]).toMatchObject({ dailyBudget: 5, founderCap: 5 });
  });

  it('their no holds the guide for a week, no question on it until then', async () => {
    const { world, company, ctx, p } = await under({ founderApproval: true });
    const item = await planned(ctx);
    const { task } = await run(ctx, 'launch_campaign', item!.input);
    task.status = 'awaiting_founder';
    world.company.pendingApprovals.push(task.id);
    company.approve(task.id, false);
    expect(task.status).toBe('cancelled');
    expect(underLinePick(world)).toBeNull();
    expect(adsHold(world, p.id)?.reason).toContain('refusé');
  });

  it('a yes that comes too late launches nothing: the cash came back, or another ad runs', async () => {
    const back = await under({ founderApproval: true });
    const { task } = await run(back.ctx, 'launch_campaign', { productId: 'prd_a', underLine: true });
    task.input.founderApproved = true;
    setCash(back.world, 400);
    const agent = back.world.company.agents[0]!;
    const out = await HANDLERS.launch_campaign.run(back.ctx, task, agent, { agent, playbook: [], brainNotes: [], lessons: [], day: back.world.day, brand: 'x' } as never);
    expect(out.output).toMatchObject({ skipped: true, reason: 'company' });
    expect(out.summary).toContain('au-dessus de la ligne');
    expect(back.world.company.campaigns).toEqual([]);
  });
});

describe('what the founder reads', () => {
  it('the CFO says what survival does now, and the control keeps its own sentence', async () => {
    for (const [control, line] of [[{}, 'organique, commission et un seul petit test quand aucune pub ne tourne, plus de salaire pour les fondateurs'], [{ noSurvivalTest: true }, 'organique et commission uniquement']] as const) {
      const { world, ctx } = await under({ control });
      await run(ctx, 'budget_review');
      expect(world.activity.filter((a) => a.text.includes('MODE SURVIE')).at(-1)!.text).toContain(line);
    }
  });

  it('a verdict and a launch keep a title whole: no word cut, no quote left open', async () => {
    const { world, ctx, p } = await under();
    p.title = 'Les couples fiancés : en finir avec « on ne se parle plus » avant le mariage, pour de bon cette fois';
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 0);
    await buildHeuristicPlan(ctx);
    const lines = world.activity.filter((a) => /test sous la ligne sur|petit test sur/.test(a.text)).map((a) => a.text);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.split('«').length, line).toBe(line.split('»').length);
      expect(line, line).toContain('« Les couples fiancés : en finir avec « on ne se parle… » »');
    }
  });

  it('a winner is told what it lives by now, and that is the survival rule read on its last 4 days', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 32, 5, 30);
    adRows(world, c.id, 33, 36, 5, 0);
    await buildHeuristicPlan(ctx);
    expect(c.underLine).toEqual({ endDay: 37, failed: false });
    const said = world.activity.filter((a) => a.text.includes('test sous la ligne sur')).at(-1)!.text;
    expect(said).toContain('réussi : ROAS 2,00 pour 30 €, la campagne continue tant que ses 4 derniers jours tiennent un ROAS de 1,20.');
    await run(ctx, 'optimize_ads');
    expect(c.status).toBe('paused');
  });

  it('the journal and the digest say what happened, a loss as a loss', async () => {
    const { world, ctx } = await under();
    const c = await launched(ctx);
    expect(world.activity.at(-1)!.text).toContain('petit test sur « Guide prd_a », 5 €/jour sur TikTok pendant 6 jours au plus, 30 € en tout.');
    world.day += UNDER_LINE.days;
    adRows(world, c.id, 31, 36, 4.8, 0);
    await buildHeuristicPlan(ctx);
    const said = world.activity.filter((a) => a.text.includes('test sous la ligne sur')).at(-1)!.text;
    expect(said).toContain('test sous la ligne sur « Guide prd_a » raté : ROAS 0,00 pour 28,80 €, pas de nouveau test avant le jour 51.');
    const decisions = buildDigest(world, 31, 37).decisions;
    expect(decisions.map((d) => d.text)).toEqual(['Test sous la ligne raté sur « Guide prd_a »', 'Petit test sous la ligne sur « Guide prd_a »']);
    expect(decisions[1]!.why).toBe('Trésorerie 100 €, aucune pub en cours : 5 €/jour sur TikTok pendant 6 jours au plus, 30 € en tout.');
  });

  it('the plan says it too, and the focus of the day stops saying no ad runs', async () => {
    const { ctx } = await under();
    const plan = await buildHeuristicPlan(ctx);
    expect(plan.memo).toContain('petit test sous la ligne sur « Guide prd_a »');
    expect(plan.focus).toContain('un petit test sous la ligne');
    expect(plan.memo).not.toContain('Acquisition payante bloquée');
  });
});

// ───────────────────────────── a real company ─────────────────────────────

const TICKS_A_DAY = 12;
const LONG_TIMEOUT = 300_000;

/** Everything a run decided: only the wall clock, and what it stamps in a PDF, may differ. */
const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

/**
 * A company that was going fine, stripped on the evening of `drainDay`: no ad running, 100 € in the till. The market's roads move with every
 * change of a guide's text, so the survival is forced and not found on a seed, and a start of 2 000 € keeps its line far above what a good
 * week brings back. A reload is a restart, as in replay.test.ts.
 */
async function drained(seed: number, days: number, drainDay: number, reloadEvery: number, scenario: Partial<ScenarioConfig> = {}): Promise<WorldState> {
  const root = mkdtempSync(join(tmpdir(), 'pixel-survival-road-'));
  try {
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const open = async (w: WorldState): Promise<Company> => {
      const brain = createBrainVault(paths);
      await brain.init();
      return new Company(w, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed }), brain, archive: runArchive(root) });
    };
    let world = createWorld(defaultScenario({ seed, mindMode: 'heuristic', horizonDays: 90, openEnded: true, startingCash: 2000, ...scenario }), 'test-survival-road');
    let company = await open(world);
    for (let i = 1; i <= days * TICKS_A_DAY; i++) {
      await company.step();
      if (i === drainDay * TICKS_A_DAY) {
        for (const c of world.company.campaigns) if (c.status === 'active') c.status = 'paused';
        sim.recordLedger(world, { type: 'platform_fee', amount: 100 - sim.financeSnapshot(world).cash, memo: 'test', ref: null });
      }
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = await open(world);
      }
    }
    return world;
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

describe('a real company under the line', () => {
  const SEED = 7, DRAIN = 16, DAYS = 26;

  it('a reload at any tick ends like an uninterrupted run, a test and its verdict in the world', async () => {
    const straight = await drained(SEED, DAYS, DRAIN, 0);
    const [c] = tests(straight);
    expect(c).toBeDefined();
    expect(c!.underLine!.endDay).not.toBeNull();
    const reloaded = await drained(SEED, DAYS, DRAIN, 7); // 7 and 12 share no divisor: reloads fall on every tick of the day
    expect(decisions(reloaded) === decisions(straight)).toBe(true);
  }, LONG_TIMEOUT);

  it('spends 30 € at most in 6 days at most, every euro on the ledger, and the founders take nothing', async () => {
    const w = await drained(SEED, DAYS, DRAIN, 0);
    const c = tests(w)[0]!;
    const rows = w.market.adStats.filter((s) => s.campaignId === c.id && s.spend > 0 && s.day < c.underLine!.endDay!); // past its verdict a winner is a campaign
    const days = [...new Set(rows.map((s) => s.day))];
    const spent = rows.reduce((n, s) => n + s.spend, 0);
    expect(days.length).toBeLessThanOrEqual(UNDER_LINE.days);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(UNDER_LINE.totalEur);
    for (const day of days) {
      const stats = w.market.adStats.filter((s) => s.day === day).reduce((n, s) => n + s.spend, 0);
      const ledger = w.ledger.filter((e) => e.day === day && e.type === 'ad_spend').reduce((n, e) => n - e.amount, 0);
      expect(ledger).toBeCloseTo(stats, 2);
    }
    expect(w.company.org!.decisions.filter((d) => d.kind === 'pay_cut').at(-1)?.numbers.share).toBe(0);
  }, LONG_TIMEOUT);

  it('before its first survival day a run is the same with or without the insurance, to the cent', async () => {
    const days = DRAIN - 1;
    const on = await drained(SEED, days, days + 1, 0);
    const off = await drained(SEED, days, days + 1, 0, { control: { noSurvivalTest: true } });
    expect(JSON.stringify(on.ledger) === JSON.stringify(off.ledger)).toBe(true);
    expect(tests(on)).toEqual([]);
  }, LONG_TIMEOUT);
});
