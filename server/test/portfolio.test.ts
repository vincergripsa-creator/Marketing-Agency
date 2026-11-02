/**
 * The Monday portfolio review, the harvest and niches that reopen (scale §5, tests 10, 11, 12). Worlds are real, ledgers and ad rows are
 * written by hand, so every verdict below can be checked with a pencil.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DayPlanItem, RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { acquisitionCandidates, productPaidBlock, promotionBlock, recentLoss } from '../src/runtime/acquisition.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { growthPillar } from '../src/runtime/growthPillar.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import type { FounderOrder } from '../src/runtime/missions.js';
import { sim } from '../src/runtime/modules.js';
import { executeOrders } from '../src/runtime/orders.js';
import { closedNiches, createProductPipeline, excludedNiches, killProduct, NICHE_LAST_DAYS, NICHE_REOPEN_DAYS } from '../src/runtime/pipeline.js';
import { budgetQueue, cvrDrop, PORTFOLIO, reviewPortfolio } from '../src/runtime/portfolio.js';
import { STAGE_POLICY } from '../src/runtime/stages.js';
import { buildHeuristicPlan, HARVEST_POST_DAYS } from '../src/runtime/strategy.js';
import { createTask } from '../src/runtime/tasks.js';
import type { Allocation, Campaign, DailyAdStats, NicheCloseReason, PortfolioLine, PortfolioReview, PortfolioVerdict, Product, Review, ScenarioConfig, StageId, TaskKind, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

vi.setConfig({ testTimeout: 120_000 });

// ───────────────────────────── fixtures ─────────────────────────────

/** A Monday: every Monday reads the days closed before it. */
const MONDAY = 29;

async function lab(over: Partial<ScenarioConfig> = {}) {
  const world = createWorld(defaultScenario({ ...LEGACY, scaling: true, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 400, startingCash: 1000, ...over }), 'test-portfolio');
  const root = mkdtempSync(join(tmpdir(), 'pixel-portfolio-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
  const ctx = (company as unknown as { ctx: RuntimeCtx }).ctx;
  closeTo(world, MONDAY);
  world.company.growth!.allocation = { scaleRoas: 1.5, trimRoas: 1 } as Allocation;
  return { world, ctx };
}

/** The clock moves on, the days behind it closed, with nothing else on their lines. */
function closeTo(world: WorldState, day: number): void {
  for (let d = world.day; d < day; d++) {
    world.day = d;
    sim.recordLedger(world, { type: 'platform_fee', amount: 1, memo: 'Frais fixes', ref: `fixed:${d}` });
  }
  world.day = day;
}

function on(world: WorldState, day: number, book: () => void): void {
  const today = world.day;
  world.day = day;
  book();
  world.day = today;
}

function reviewsOf(ratings: number[], day: number): Review[] {
  return ratings.map((rating, i) => ({ id: `rev_${day}_${i}`, day, customerId: `c${i}`, rating: rating as Review['rating'], text: 'Bien.' }));
}

let orderN = 0;

interface Main {
  niche?: number; from?: number; to?: number;
  spend?: number;          // € a day, from..to
  revenue?: number;        // € a day of ad revenue, and as much in the books
  views?: number; buys?: number; // landing views and purchases a day
  sales?: number;          // orders, spread over from..to
  ratings?: number[];
  over?: Partial<Product>;
}

/** A main with its ad rows, its books and its reviews: only what the review reads. */
function main(world: WorldState, id: string, m: Main = {}): Product {
  const { niche = 0, from = 12, to = MONDAY - 1, spend = 0, revenue = 0, views = spend * 4, buys = Math.round(revenue / 19), sales = 0, ratings = [], over = {} } = m;
  const p: Product = {
    id, nicheId: world.market.niches[niche]!.id, title: `Guide ${id}`, subtitle: '', audience: 'parents', problem: 'les nuits', price: 19, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 2, launchedDay: 3,
    stats: { views: 0, sales, revenue: 0, refunds: 0, refundAmount: 0, rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0, reviews: reviewsOf(ratings, Math.max(from, over.versionDay ?? 0)), upsellSales: 0 },
    priceHistory: [{ day: 3, price: 19 }], ...over,
  };
  world.company.products.push(p);
  if (spend) campaign(world, `cmp_${id}`, id, spend, from);
  for (let day = from; day <= to; day++) rows(world, id, `cmp_${id}`, day, { spend, revenue, views, buys });
  for (let i = 0; i < sales; i++) world.market.orders.push({ id: `ord_${++orderN}`, day: from + (i % (to - from + 1)), customerId: `c${i}`, productId: id, price: p.price, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false });
  return p;
}

function campaign(world: WorldState, id: string, productId: string, dailyBudget: number, startDay: number): Campaign {
  const c: Campaign = { id, productId, name: `Campagne ${id}`, creativeIds: [], dailyBudget, status: 'active', targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay, createdBy: 'test' };
  world.company.campaigns.push(c);
  return c;
}

function creative(world: WorldState, id: string, productId: string): void {
  world.company.creatives.push({ id, productId, hook: `Hook ${id}`, hookStyle: 'pov', format: 'faceless_voiceover', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test' });
}

function rows(world: WorldState, productId: string, campaignId: string, day: number, d: { spend: number; revenue: number; views: number; buys: number }): void {
  if (d.spend) world.market.adStats.push({ day, campaignId, creativeId: `cre_${productId}`, productId, spend: d.spend, revenue: d.revenue, roas: d.revenue / d.spend, impressions: d.spend * 200, clicks: d.spend * 5, ctr: 0.025, cpc: 0.2, cpm: 5, landingViews: d.views, purchases: d.buys, frequency: 1.2, comments: [] } as DailyAdStats);
  on(world, day, () => {
    if (d.spend) sim.recordLedger(world, { type: 'ad_spend', amount: d.spend, memo: 'Pub', ref: campaignId });
    if (d.revenue) sim.recordLedger(world, { type: 'revenue', amount: d.revenue, memo: 'Ventes', ref: productId });
  });
}

const review = async (ctx: RuntimeCtx): Promise<PortfolioReview> => (await reviewPortfolio(ctx))!;
const lineOf = (r: PortfolioReview, id: string): PortfolioLine => r.lines.find((l) => l.productId === id)!;
const verdictOf = async (ctx: RuntimeCtx, id: string): Promise<PortfolioVerdict> => lineOf(await review(ctx), id).verdict;
const decisions = (world: WorldState, kind: string) => world.company.growth!.decisions.filter((d) => d.kind === kind);
const setStage = (world: WorldState, stage: StageId) => { world.company.growth!.stage = stage; };
const nicheOf = (world: WorldState, i = 0) => world.market.niches[i]!.id;
const itemsOf = (items: DayPlanItem[], id: string) => items.filter((i) => i.input.productId === id);
const paidKinds: TaskKind[] = ['write_ad_hooks', 'produce_ad', 'launch_campaign'];

/** Spent 150 € over 15 days, sold 57 €: lost money whatever its buyers think. */
const LOSER = { spend: 10, revenue: 3.8, from: 14 };
const HAPPY = [5, 4, 5, 4];

// ───────────────────────────── scale 10 ─────────────────────────────

describe('a main with no paid test is not judged', () => {
  /** Online for 26 days, posted on, 2 sales, not a euro of ads: the case the old rule killed. */
  async function unpaid(over: Partial<ScenarioConfig> = {}) {
    const lb = await lab(over);
    const p = main(lb.world, 'prd_a', { sales: 2 });
    for (let day = 18; day < 24; day++) lb.world.market.organicPosts.push({ id: `pst_${day}`, day, productId: 'prd_a', hook: 'h', hookStyle: 'pov', format: 'carousel', views: 10, likes: 0, clicks: 0, sales: 0, viral: false } as WorldState['market']['organicPosts'][number]);
    return { ...lb, p };
  }

  it('0 € of ads and few sales for 14 days: alive, in the test queue', async () => {
    const { world, ctx, p } = await unpaid();
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
    const line = lineOf(await review(ctx), p.id);
    expect(line).toMatchObject({ verdict: 'test', paidTested: 0 });
    expect(line.reason).toContain('de pub sur');
    expect(p.status).toBe('live');
    expect(decisions(world, 'kill')).toEqual([]);
  });

  it('the control kills that same guide, which is what the rule replaces', async () => {
    const { ctx, p } = await unpaid({ scaling: false });
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('killed');
  });

  it('under its paid test, however much it lost, it stays', async () => {
    const { ctx } = await lab();
    const p = main(ctx.world, 'prd_a', { spend: 10, from: 20, to: 28, ratings: [1, 1, 1] }); // 90 € for nothing
    expect(await verdictOf(ctx, p.id)).toBe('test');
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
  });

  it('a stage that wants more proof waits for more', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    setStage(world, 'portefeuille');
    expect(STAGE_POLICY.portefeuille.paidTestEur).toBeGreaterThan(150);
    expect(await verdictOf(ctx, p.id)).toBe('test');
  });

  it('past its test, a guide nobody buys can still fail between two Mondays', async () => {
    const { ctx } = await lab();
    const p = main(ctx.world, 'prd_a', { spend: 15, views: 40, buys: 0, from: 14 });
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('killed');
  });

  it('but one its buyers like waits for Monday, and Monday harvests it', async () => {
    const { ctx } = await lab();
    const p = main(ctx.world, 'prd_a', { spend: 15, views: 40, buys: 0, from: 14, ratings: HAPPY });
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
    await review(ctx);
    expect(p.harvest).toBeDefined();
  });

  it('this morning\'s verdict stands: a rewrite ordered at the review is not killed before the plan orders it', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { spend: 15, views: 40, buys: 0, from: 14, ratings: [4, 3, 4, 3] });
    expect(await verdictOf(ctx, p.id)).toBe('rework');
    const { items } = await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
    expect(items.some((i) => i.input.pipeline === 'v2' && i.input.productId === p.id)).toBe(true);
  });
});

// ───────────────────────────── the ladder ─────────────────────────────

describe('the ladder of verdicts', () => {
  it('double down: ROAS over the bar and money on the table', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { spend: 10, revenue: 20, from: 14 });
    const line = lineOf(await review(ctx), p.id);
    expect(line).toMatchObject({ verdict: 'double_down', roas14: 2, paidTested: 150, contribution28: 150, share: 1 });
    expect(line.reason).toContain('ROAS 14 j');
    expect(decisions(world, 'double_down')).toHaveLength(1);
  });

  it('one log line while the verdict stands, not one a week', async () => {
    const { world, ctx } = await lab();
    main(world, 'prd_a', { spend: 10, revenue: 20, from: 14 });
    await review(ctx);
    await review(ctx);
    expect(decisions(world, 'double_down')).toHaveLength(1);
  });

  it('keep: it earns, under the bar', async () => {
    const { ctx } = await lab();
    const p = main(ctx.world, 'prd_a', { spend: 10, revenue: 12, from: 14 });
    expect(await verdictOf(ctx, p.id)).toBe('keep');
  });

  it('a credit below 1 reads the ROAS the buyer really earned', async () => {
    const { world, ctx } = await lab({ channelControl: 'none' });
    const p = main(world, 'prd_a', { spend: 10, revenue: 20, from: 14 });
    world.company.channels!.attribution = { day: 28, fromDay: 1, toDay: 28, by: 'nora', rows: [], niches: { [p.nicheId]: { tiktok: 0.5 } } };
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'keep', roas14: 1 });
  });

  it('rework: a loser whose buyers complain, before a second version', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: [4, 3, 4, 3] });
    const line = lineOf(await review(ctx), p.id);
    expect(line.verdict).toBe('rework');
    expect(line.reason).toContain('acheteurs');
    expect(decisions(world, 'rework')).toHaveLength(1);
    const v2 = (await buildHeuristicPlan(ctx)).items.filter((i) => i.kind === 'write_pdf' && i.input.pipeline === 'v2');
    expect(v2).toHaveLength(1);
    expect(v2[0]!.input.productId).toBe(p.id);
  });

  it('rework: a happy loser whose conversion fell 30 %, which is how a rival shows', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { spend: 10, revenue: 8, from: 1, to: 14, views: 40, buys: 2, ratings: HAPPY, over: { launchedDay: 1 } });
    for (let day = 15; day < MONDAY; day++) rows(world, p.id, 'cmp_prd_a', day, { spend: 10, revenue: 2, views: 40, buys: 1 });
    expect(cvrDrop(world, p, 1)).toBeCloseTo(0.5, 5);
    const line = lineOf(await review(ctx), p.id);
    expect(line.verdict).toBe('rework');
    expect(line.reason).toContain('50 %');
  });

  it('the fall is read on 200 views at least, on each side', async () => {
    const { world } = await lab();
    const p = main(world, 'prd_a', { spend: 10, from: 1, to: 14, views: 40, buys: 2 });
    for (let day = 15; day < MONDAY; day++) rows(world, p.id, 'cmp_prd_a', day, { spend: 10, revenue: 0, views: 14, buys: 0 });
    expect(cvrDrop(world, p, 1)).toBeNull(); // 196 views in the last 14 days
    rows(world, p.id, 'cmp_prd_a', 27, { spend: 10, revenue: 0, views: 14, buys: 0 });
    expect(cvrDrop(world, p, 1)).toBe(1);
  });

  it('a window from before this version says nothing of it', async () => {
    const { world } = await lab();
    const p = main(world, 'prd_a', { spend: 10, from: 1, to: 14, views: 40, buys: 2 });
    for (let day = 15; day < MONDAY; day++) rows(world, p.id, 'cmp_prd_a', day, { spend: 10, revenue: 0, views: 40, buys: 1 });
    expect(cvrDrop(world, p, 15)).toBe(0);
  });

  it('a v3 is not rewritten again: its buyers settle it', async () => {
    const { ctx } = await lab();
    const p = main(ctx.world, 'prd_a', { ...LOSER, ratings: [4, 3, 4, 3], over: { version: 3, versionDay: 5 } });
    expect(await verdictOf(ctx, p.id)).toBe('harvest');
  });

  it('a guide being rewritten waits for its new version', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER });
    createTask(world, { kind: 'write_pdf', title: 'v2', input: { productId: p.id }, createdBy: 'system' });
    const line = lineOf(await review(ctx), p.id);
    expect(line.verdict).toBe('rework');
    expect(p.status).toBe('live');
    expect(decisions(world, 'rework')).toEqual([]);
  });

  it('severe stays with the existing path: the review changes nothing', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: [2, 2, 2, 2, 2] });
    expect(await verdictOf(ctx, p.id)).toBe('rework');
    expect(p.status).toBe('live');
    expect(decisions(world, 'rework')).toEqual([]);
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('paused');
  });

  it('follow-ups and kits are not mains: they have no line', async () => {
    const { world, ctx } = await lab();
    const up = main(world, 'prd_up', { niche: 0 });
    const kit = main(world, 'prd_kit', { niche: 0, over: { kind: 'kit' } });
    main(world, 'prd_a', { niche: 0, spend: 10, revenue: 20, from: 14, over: { upsellProductId: up.id, bumpProductId: kit.id } });
    const r = await review(ctx);
    expect(r.lines.map((l) => l.productId)).toEqual(['prd_a']);
  });

  it('the review sits in the world, sorted by money, with its slots', async () => {
    const { world, ctx } = await lab();
    main(world, 'prd_low', { niche: 0, spend: 10, revenue: 12, from: 14 });
    main(world, 'prd_top', { niche: 1, spend: 10, revenue: 20, from: 14 });
    main(world, 'prd_new', { niche: 2, spend: 5, from: 25 });
    const r = await review(ctx);
    expect(world.company.growth!.portfolio).toBe(r);
    expect(r).toMatchObject({ day: MONDAY, week: 5, slots: { used: 3, max: 2 } });
    expect(r.lines.map((l) => l.productId)).toEqual(['prd_top', 'prd_low', 'prd_new']);
    expect(lineOf(r, 'prd_top').share).toBeCloseTo(150 / 180, 1);
  });
});

// ───────────────────────────── scale 11 ─────────────────────────────

describe('a paid loser', () => {
  it('with happy buyers is harvested: on sale, no ads, no creatives', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    const hooks = createTask(world, { kind: 'write_ad_hooks', title: 'Créas', input: { productId: p.id }, createdBy: 'system' });
    const line = lineOf(await review(ctx), p.id);
    expect(line).toMatchObject({ verdict: 'harvest', paidTested: 150, contribution28: -93 });
    expect(line.reason).toContain('4,5/5');
    expect(p.status).toBe('live');
    expect(p.harvest).toEqual({ day: MONDAY, price: 19, version: 1, retest: null });
    expect(world.company.campaigns[0]!.status).toBe('paused');
    expect(hooks.status).toBe('cancelled');
    expect(productPaidBlock(world, p)).toMatchObject({ hard: true, final: true });
    expect(productPaidBlock(world, p, 'meta')).toMatchObject({ hard: true, final: true });
    expect(decisions(world, 'harvest')).toEqual([expect.objectContaining({ productId: p.id, impactEur: -93 })]);
    const { items } = await buildHeuristicPlan(ctx);
    expect(itemsOf(items, p.id).filter((i) => paidKinds.includes(i.kind))).toEqual([]);
    expect(p.status).toBe('live');
  });

  it('with low marks is killed: rating 2,5', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: [2, 3, 2, 3], over: { version: 3, versionDay: 5 } });
    const line = lineOf(await review(ctx), p.id);
    expect(line.verdict).toBe('kill');
    expect(line.reason).toContain('2,5/5');
    expect(p.status).toBe('killed');
    expect(p.harvest).toBeUndefined();
    expect(world.company.campaigns[0]!.status).not.toBe('active');
    expect(decisions(world, 'kill')).toEqual([expect.objectContaining({ productId: p.id, impactEur: -93 })]);
    expect(world.company.growth!.niches[p.nicheId]).toMatchObject({ lastReason: 'quality', attempts: 1, paidEur: 150 });
  });

  it('refunded past 20 % is killed too, however good the marks', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    for (let i = 0; i < 3; i++) world.market.orders.push({ id: `ord_r${i}`, day: 20, customerId: 'c', productId: p.id, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: i === 0, chargeback: false });
    expect(await verdictOf(ctx, p.id)).toBe('kill');
  });

  it('with no review at all has nothing to keep it: killed on the money', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER });
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'kill' });
    expect(world.company.growth!.niches[p.nicheId]).toMatchObject({ lastReason: 'market', strikes: 1 });
  });

  it('frees a main\'s slot, keeps its niche', async () => {
    const { world, ctx } = await lab();
    world.company.research.trends = ctx.tools.searchTrends();
    const p = main(world, 'prd_a', { niche: 0, ...LOSER, ratings: HAPPY });
    main(world, 'prd_b', { niche: 1, spend: 10, revenue: 20, from: 14 });
    world.company.growth!.allocation = { scaleRoas: 1.5, trimRoas: 1 } as Allocation;
    setStage(world, 'survie'); // 2 mains at most
    const before = lineOf(await review(ctx), 'prd_b');
    expect(before.verdict).toBe('double_down');
    expect(world.company.growth!.portfolio!.slots).toEqual({ used: 1, max: 2 });
    expect(closedNiches(ctx, { includeActive: true })).toContain(p.nicheId);
  });

  it('a harvest posts once a week, whatever it lost', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    world.company.campaigns.push({ ...world.company.campaigns[0]!, id: 'cmp_two', startDay: 20 });
    for (let day = 15; day < MONDAY; day++) rows(world, p.id, 'cmp_two', day, { spend: 5, revenue: 1, views: 20, buys: 0 });
    await review(ctx);
    expect(promotionBlock(world, p)).toBeNull();
    const posts = (items: DayPlanItem[]) => itemsOf(items, p.id).filter((i) => i.kind === 'post_organic');
    expect(posts((await buildHeuristicPlan(ctx)).items)).toHaveLength(1);
    world.market.organicPosts.push({ id: 'pst_1', day: MONDAY, productId: p.id, hook: 'h', hookStyle: 'pov', format: 'carousel', views: 1, likes: 0, clicks: 0, sales: 0, viral: false } as WorldState['market']['organicPosts'][number]);
    world.day = MONDAY + HARVEST_POST_DAYS - 1;
    expect(posts((await buildHeuristicPlan(ctx)).items)).toEqual([]);
    world.day = MONDAY + HARVEST_POST_DAYS;
    expect(posts((await buildHeuristicPlan(ctx)).items)).toHaveLength(1);
  });

  it('its weekly post comes first: on profit alone it would never reach one of the 4 slots', async () => {
    const { world, ctx } = await lab();
    setStage(world, 'portefeuille');
    world.company.growth!.allocation = { scaleRoas: 1.5, trimRoas: 1 } as Allocation;
    const p = main(world, 'prd_z', { niche: 7, ...LOSER, spend: 15, ratings: HAPPY });
    for (let i = 0; i < 6; i++) main(world, `prd_${i}`, { niche: i, spend: 20, revenue: 40, from: 14, sales: 28 });
    await review(ctx);
    expect(p.harvest).toBeDefined();
    const { items } = await buildHeuristicPlan(ctx);
    const posts = items.filter((i) => i.kind === 'post_organic');
    expect(posts).toHaveLength(4);
    expect(posts[0]!.input.productId).toBe(p.id);
  });

  it('a harvest is never read as a recent loss, and the ads stay off while the rest of the week goes by', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    await review(ctx);
    expect(recentLoss(world, p)).toBeNull();
    world.company.campaigns[0]!.status = 'active'; // a campaign that came back through a side door
    const agent = world.company.agents[0]!;
    const task = createTask(world, { kind: 'optimize_ads', title: 'Optimiser', assignee: agent.id, createdBy: 'system' });
    await HANDLERS.optimize_ads.run(ctx, task, agent, { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'x' } as never);
    expect(world.company.campaigns[0]!.status).toBe('paused');
  });

  it('a founder\'s forced campaign stays on: their word beats the plan', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    world.company.campaigns[0]!.founderForced = true;
    await review(ctx);
    expect(p.harvest).toBeDefined();
    expect(world.company.campaigns[0]!.status).toBe('active');
  });
});

describe('between two Mondays, a recent loss', () => {
  /** A guide with two campaigns over the last 14 days, ROAS 0,5, liked by its buyers. */
  async function losing(over: Partial<ScenarioConfig> = {}) {
    const lb = await lab(over);
    const p = main(lb.world, 'prd_a', { from: 15, spend: 10, revenue: 5, views: 200, buys: 1, ratings: HAPPY, sales: 14 });
    campaign(lb.world, 'cmp_two', p.id, 6, 15);
    for (let day = 15; day < MONDAY; day++) rows(lb.world, p.id, 'cmp_two', day, { spend: 6, revenue: 3, views: 100, buys: 0 });
    lb.world.day = MONDAY + 1;
    on(lb.world, MONDAY, () => sim.recordLedger(lb.world, { type: 'platform_fee', amount: 1, memo: 'Frais fixes', ref: `fixed:${MONDAY}` }));
    return { ...lb, p };
  }

  it('stops the ads and leaves the guide for Monday', async () => {
    const { world, ctx, p } = await losing();
    expect(recentLoss(world, p)).not.toBeNull();
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('live');
    expect(world.company.campaigns.filter((c) => c.status === 'active')).toEqual([]);
  });

  it('the control still kills it', async () => {
    const { ctx, p } = await losing({ scaling: false });
    await buildHeuristicPlan(ctx);
    expect(p.status).toBe('killed');
  });
});

describe('the harvest\'s one paid test', () => {
  /** Harvested on the Monday, the books closed to `day`. */
  async function harvested(day: number) {
    const lb = await lab();
    const p = main(lb.world, 'prd_a', { ...LOSER, ratings: HAPPY });
    await review(lb.ctx);
    closeTo(lb.world, day);
    return { ...lb, p };
  }
  const MIN_DAYS = PORTFOLIO.retestDays;

  it('waits 45 days, and a price or a version that moved', async () => {
    const early = await harvested(MONDAY + MIN_DAYS - 3);
    early.p.price = 24;
    expect(await verdictOf(early.ctx, early.p.id)).toBe('harvest');
    const same = await harvested(MONDAY + 49);
    expect(await verdictOf(same.ctx, same.p.id)).toBe('harvest');
    expect(productPaidBlock(same.world, same.p)?.final).toBe(true);
    const moved = await harvested(MONDAY + 49);
    moved.p.price = 24;
    expect(await verdictOf(moved.ctx, moved.p.id)).toBe('test');
    expect(moved.p.harvest!.retest).toEqual({ day: MONDAY + 49, open: true });
    expect(productPaidBlock(moved.world, moved.p)).toBeNull();
    const rewritten = await harvested(MONDAY + 49);
    rewritten.p.version = 2;
    expect(await verdictOf(rewritten.ctx, rewritten.p.id)).toBe('test');
  });

  it('counts only what the test itself spent', async () => {
    const { world, ctx, p } = await harvested(MONDAY + 49);
    p.price = 24;
    await review(ctx);
    expect(lineOf(world.company.growth!.portfolio!, p.id).paidTested).toBe(0);
    closeTo(world, MONDAY + 56);
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'test', paidTested: 0 });
  });

  it('a test that pays makes it a main again', async () => {
    const { world, ctx, p } = await harvested(MONDAY + 49);
    p.price = 24;
    await review(ctx);
    const testDay = world.day;
    closeTo(world, testDay + 7);
    for (let day = testDay; day < testDay + 7; day++) rows(world, p.id, 'cmp_prd_a', day, { spend: 25, revenue: 60, views: 100, buys: 3 });
    expect(await verdictOf(ctx, p.id)).toBe('double_down');
    expect(p.harvest).toBeUndefined();
  });

  it('a test that loses goes back to the harvest, and there is no second one', async () => {
    const { world, ctx, p } = await harvested(MONDAY + 49);
    p.price = 24;
    await review(ctx);
    const testDay = world.day;
    closeTo(world, testDay + 7);
    for (let day = testDay; day < testDay + 7; day++) rows(world, p.id, 'cmp_prd_a', day, { spend: 25, revenue: 5, views: 100, buys: 0 });
    expect(await verdictOf(ctx, p.id)).toBe('harvest');
    expect(p.harvest).toMatchObject({ day: testDay + 7, price: 24, retest: { day: testDay, open: false } });
    expect(productPaidBlock(world, p)?.final).toBe(true);
    p.price = 29;
    closeTo(world, testDay + 7 + 56);
    expect(await verdictOf(ctx, p.id)).toBe('harvest');
  });
});

// ───────────────────────────── the budget queue ─────────────────────────────

describe('the budget queue', () => {
  it('double down first, tests next, a guide launched since Monday with them, then the rest. Stable inside a rank', async () => {
    const { world, ctx } = await lab();
    main(world, 'prd_keep', { niche: 0, spend: 10, revenue: 12, from: 14 });
    main(world, 'prd_keep2', { niche: 1, spend: 10, revenue: 12, from: 14 });
    main(world, 'prd_test', { niche: 2, spend: 5, from: 25 });
    main(world, 'prd_top', { niche: 3, spend: 10, revenue: 20, from: 14 });
    await review(ctx);
    expect(budgetQueue(world, ['prd_keep', 'prd_new', 'prd_keep2', 'prd_test', 'prd_top'], (id) => id)).toEqual(['prd_top', 'prd_new', 'prd_test', 'prd_keep', 'prd_keep2']);
  });

  it('no review, or the control: the old order', async () => {
    const { world } = await lab();
    expect(budgetQueue(world, ['b', 'a'], (id) => id)).toEqual(['b', 'a']);
    const control = await lab({ scaling: false });
    control.world.company.growth!.portfolio = { day: 1, week: 1, lines: [], slots: { used: 0, max: 8 }, notes: [] };
    expect(budgetQueue(control.world, ['b', 'a'], (id) => id)).toEqual(['b', 'a']);
  });

  it('the raise goes to what the review doubled down on, wherever its campaign sits', async () => {
    const { world, ctx } = await lab();
    const keep = main(world, 'prd_keep', { niche: 0, spend: 10, revenue: 12, from: 14, sales: 28 });
    const top = main(world, 'prd_top', { niche: 1, spend: 10, revenue: 20, from: 14, sales: 28 });
    await review(ctx);
    for (const p of [keep, top]) for (let day = 26; day < MONDAY; day++) rows(world, p.id, `cmp_${p.id}`, day, { spend: 10, revenue: 20, views: 40, buys: 1 }); // both read as winners now
    world.company.growth!.allocation = { scaleRoas: 1.5, trimRoas: 1, adTarget: 23, testWeek: 0 } as Allocation; // room for one raise
    const agent = world.company.agents[0]!;
    const task = createTask(world, { kind: 'optimize_ads', title: 'Optimiser', assignee: agent.id, createdBy: 'system' });
    await HANDLERS.optimize_ads.run(ctx, task, agent, { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'x' } as never);
    const budgetOf = (id: string) => world.company.campaigns.find((c) => c.id === id)!.dailyBudget;
    expect(budgetOf('cmp_prd_top')).toBe(13);
    expect(budgetOf('cmp_prd_keep')).toBe(10);
  });

  it('a test that ended long ago still counts: its rows leave after 90 days, its verdict stays, a new version starts over', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { spend: 10, revenue: 12, from: 14, sales: 28 });
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'keep', paidTested: 150 });
    world.market.adStats = [];
    closeTo(world, MONDAY + 7);
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'keep', paidTested: 150 });
    p.versionDay = world.day;
    expect(lineOf(await review(ctx), p.id)).toMatchObject({ verdict: 'test', paidTested: 0 });
  });

  it('and a niche closes on what that test really cost', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { spend: 10, revenue: 12, from: 14, sales: 28 });
    await review(ctx);
    world.market.adStats = [];
    await killProduct(ctx, p, 'fin de l’essai');
    expect(world.company.growth!.niches[p.nicheId]).toMatchObject({ lastReason: 'market', paidEur: 150, strikes: 1 });
  });

  it('the paid plan serves a guide waiting for its test before one that only keeps, whatever their scores say', async () => {
    const { world, ctx } = await lab();
    const keep = main(world, 'prd_keep', { niche: 0, spend: 10, revenue: 18, from: 14, sales: 28 });
    const wait = main(world, 'prd_wait', { niche: 1, spend: 2, from: 26, sales: 3 });
    world.company.growth!.allocation = { scaleRoas: 2.5, trimRoas: 1 } as Allocation;
    await review(ctx);
    expect(lineOf(world.company.growth!.portfolio!, keep.id).verdict).toBe('keep');
    for (const c of world.company.campaigns) c.status = 'paused';
    closeTo(world, MONDAY + 1);
    expect(acquisitionCandidates(world).map((c) => c.product.id)).toEqual([keep.id, wait.id]); // the score alone
    const { items } = await buildHeuristicPlan(ctx);
    expect(items.filter((i) => i.kind === 'write_ad_hooks').map((i) => i.input.productId)).toEqual([wait.id, keep.id]);
  });
});

describe('what a winner still lacks', () => {
  /** On the Monday it is doubled down on, 6 sales in: too few for the plan's own follow-up rule, only the review asks. */
  async function winner(over: Partial<Product> = {}) {
    const lb = await lab();
    const p = main(lb.world, 'prd_a', { spend: 10, revenue: 20, from: 14, sales: 6, over });
    await review(lb.ctx);
    return { ...lb, p };
  }
  const planned = async (ctx: RuntimeCtx, id: string) => itemsOf((await buildHeuristicPlan(ctx)).items, id);

  it('creatives in reserve, attached to what runs, and a follow-up', async () => {
    const { world, ctx, p } = await winner();
    const items = await planned(ctx, p.id);
    expect(items.find((i) => i.kind === 'write_ad_hooks')!.input).toMatchObject({ produce: 2, attachTo: world.company.campaigns[0]!.id });
    expect(items.map((i) => i.kind)).toContain('design_upsell');
  });

  it('what it already has is not made twice, and a founder\'s launch hold stops new products', async () => {
    const { world, ctx, p } = await winner({ upsellProductId: 'prd_up' });
    creative(world, 'cre_spare', p.id);
    const kinds = (await planned(ctx, p.id)).map((i) => i.kind);
    expect(kinds).not.toContain('design_upsell');
    expect(kinds).not.toContain('write_ad_hooks');
    const held = await winner();
    held.world.company.holds = [{ id: 'hld_1', day: 20, kind: 'launches', productId: null, until: null, reason: 'pas de nouveauté' }];
    expect((await planned(held.ctx, held.p.id)).map((i) => i.kind)).not.toContain('design_upsell');
  });

  it('only on the day of the review', async () => {
    const { world, ctx, p } = await winner();
    closeTo(world, MONDAY + 1);
    expect((await planned(ctx, p.id)).map((i) => i.kind)).not.toContain('design_upsell');
  });
});

// ───────────────────────────── scale 12 ─────────────────────────────

describe('niches reopen', () => {
  async function ended(reason: NicheCloseReason, world: WorldState, ctx: RuntimeCtx, id: string): Promise<Product> {
    const p = main(world, id, reason === 'market' ? { ...LOSER } : reason === 'quality' ? { ...LOSER, ratings: [2, 2, 2, 2, 2] } : {});
    if (reason === 'redteam') Object.assign(createTask(world, { kind: 'red_team', title: 'Red Team', input: { productId: id }, createdBy: 'system' }), { status: 'done', output: { finalVerdict: 'kill' } });
    await killProduct(ctx, p, 'fin de l’essai');
    return p;
  }
  const closed = (ctx: RuntimeCtx, nicheId: string) => closedNiches(ctx, { includeActive: true }).includes(nicheId);
  const recordOf = (world: WorldState, i = 0) => world.company.growth!.niches[nicheOf(world, i)]!;

  it.each([['no_test', 14, 0], ['quality', 30, 0], ['market', 60, 1], ['redteam', 90, 1]] as const)('%s: pickable after %i days, %i strike', async (reason, days, strikes) => {
    const { world, ctx } = await lab();
    const p = await ended(reason, world, ctx, 'prd_a');
    expect(NICHE_REOPEN_DAYS[reason]).toBe(days);
    expect(recordOf(world)).toMatchObject({ attempts: 1, strikes, lastEndDay: MONDAY, lastReason: reason, reopenDay: MONDAY + days });
    expect(closed(ctx, p.nicheId)).toBe(true);
    world.day = MONDAY + days - 1;
    expect(closed(ctx, p.nicheId)).toBe(true);
    world.day = MONDAY + days;
    expect(closed(ctx, p.nicheId)).toBe(false);
  });

  it('2 strikes: not before 180 days, and that attempt is the last', async () => {
    const { world, ctx } = await lab();
    await ended('market', world, ctx, 'prd_a');
    await ended('redteam', world, ctx, 'prd_b');
    expect(recordOf(world)).toMatchObject({ attempts: 2, strikes: 2, reopenDay: MONDAY + NICHE_LAST_DAYS });
    world.day = MONDAY + NICHE_LAST_DAYS - 1;
    expect(closed(ctx, nicheOf(world))).toBe(true);
    world.day = MONDAY + NICHE_LAST_DAYS;
    expect(closed(ctx, nicheOf(world))).toBe(false);
    await ended('no_test', world, ctx, 'prd_c');
    expect(recordOf(world)).toMatchObject({ attempts: 3, reopenDay: null });
    world.day += 1000;
    expect(closed(ctx, nicheOf(world))).toBe(true);
  });

  it('what is on sale in a niche keeps it taken, reopened or not', async () => {
    const { world, ctx } = await lab();
    await ended('no_test', world, ctx, 'prd_a');
    world.day = MONDAY + 14;
    main(world, 'prd_b');
    expect(closed(ctx, nicheOf(world))).toBe(true);
    expect(closedNiches(ctx, { includeActive: false })).toEqual([]);
  });

  it('the control never reopens anything, and every old reader goes through the same list', async () => {
    const { world, ctx } = await lab({ scaling: false });
    const p = main(world, 'prd_a');
    await killProduct(ctx, p, 'fin de l’essai');
    expect(world.company.growth!.niches).toEqual({});
    expect(world.company.growth!.decisions).toEqual([]);
    world.day += 500;
    expect(closed(ctx, p.nicheId)).toBe(true);
    expect(excludedNiches).toBe(closedNiches);
  });

  const founderKill = (world: WorldState, ctx: RuntimeCtx, p: Product) =>
    executeOrders(ctx, { id: 'mis_kill', day: world.day, from: 'founder', text: 'Arrête ce guide', ownerId: world.company.agents[0]!.id, taskIds: [], status: 'open' }, [{ action: 'kill_product', product: p } as FounderOrder]);

  it('the founder\'s kill has no timer: what they stopped never comes back by itself', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a');
    await founderKill(world, ctx, p);
    expect(p.status).toBe('killed');
    expect(recordOf(world)).toMatchObject({ lastEndDay: MONDAY, lastReason: 'no_test', reopenDay: null });
    world.day = MONDAY + NICHE_REOPEN_DAYS.no_test;
    expect(closed(ctx, p.nicheId)).toBe(true);
    world.day += 1000;
    expect(closed(ctx, p.nicheId)).toBe(true);
  });

  it('their kill of a follow-up leaves the niche where it was: it was not the niche they stopped', async () => {
    const { world, ctx } = await lab();
    await ended('no_test', world, ctx, 'prd_a');
    world.day = MONDAY + 14;
    const up = main(world, 'prd_up');
    main(world, 'prd_b', { over: { upsellProductId: up.id } });
    await founderKill(world, ctx, up);
    expect(recordOf(world)).toMatchObject({ attempts: 1, reopenDay: MONDAY + 14 });
  });

  it('a kill that left no record stays closed: an old save does not reopen by accident', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { over: { status: 'killed' } });
    expect(closed(ctx, p.nicheId)).toBe(true);
  });

  it('a follow-up that stops closes nothing: the niche is its parent\'s', async () => {
    const { world, ctx } = await lab();
    const up = main(world, 'prd_up');
    main(world, 'prd_a', { over: { upsellProductId: up.id } });
    await killProduct(ctx, up, 'fin de la suite');
    expect(world.company.growth!.niches).toEqual({});
  });

  it('a reopened niche starts from what it learned: the log says so, and its best price is the first one', async () => {
    const { world, ctx } = await lab();
    const first = main(world, 'prd_a', { niche: 0, spend: 10, revenue: 40, views: 40, buys: 2, from: 14, over: { price: 24 } });
    first.priceHistory = [{ day: 3, price: 24 }];
    world.market.adStats.forEach((s) => { s.spend = 10; });
    await killProduct(ctx, first, 'fin de l’essai');
    expect(recordOf(world)).toMatchObject({ bestPrice: 24, bestRoas14: 4, paidEur: 150 });
    world.day = MONDAY + 60;
    const next = main(world, 'prd_b', { niche: 0, over: { status: 'research', launchedDay: null, price: 0, priceHistory: [] } as Partial<Product> });
    const tasks = createProductPipeline(ctx, next, { createdBy: 'camille', missionId: null });
    const price = tasks.find((t) => t.kind === 'set_price')!;
    expect(price.input).toMatchObject({ reason: 'memoire', price: 24 });
    expect(decisions(world, 'reopen')).toEqual([expect.objectContaining({ productId: next.id })]);
    expect(decisions(world, 'reopen')[0]!.why).toContain('jour 29');
    const agent = world.company.agents[0]!;
    await HANDLERS.set_price.run(ctx, price, agent, { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'x' } as never);
    expect(next.price).toBe(24);
    createProductPipeline(ctx, next, { createdBy: 'camille', missionId: null }); // a stuck chain restarts: not a second reopening
    expect(decisions(world, 'reopen')).toHaveLength(1);
  });

  it('a first attempt prices as before and logs nothing', async () => {
    const { world, ctx } = await lab();
    const p = main(world, 'prd_a', { over: { status: 'research', launchedDay: null } as Partial<Product> });
    const tasks = createProductPipeline(ctx, p, { createdBy: 'camille', missionId: null });
    expect(tasks.find((t) => t.kind === 'set_price')!.input.reason).toBe('initial');
    expect(decisions(world, 'reopen')).toEqual([]);
  });

  it('the team really picks a reopened niche', async () => {
    const { world, ctx } = await lab();
    world.company.research.trends = ctx.tools.searchTrends();
    await ended('no_test', world, ctx, 'prd_a');
    const target = nicheOf(world);
    const others = world.market.niches.map((n) => n.id).filter((id) => id !== target);
    const agent = world.company.agents[0]!;
    const mind = { agent, playbook: [], brainNotes: [], lessons: [], day: world.day, brand: 'x' } as never;
    const pick = () => HANDLERS.pick_opportunity.run(ctx, createTask(world, { kind: 'pick_opportunity', title: 'Choisir', input: { excludeNicheIds: others }, createdBy: 'system' }), agent, mind);
    expect((await pick()).output).toMatchObject({ rescan: true });
    world.day = MONDAY + 14;
    expect((await pick()).output).toMatchObject({ nicheId: target });
  });
});

// ───────────────────────────── the Monday in the company ─────────────────────────────

describe('the ritual', () => {
  it('runs on Monday after the CFO: the real morning harvests, kills and leaves a done task', async () => {
    const { world, ctx } = await lab();
    world.company.growth!.allocation = null;
    const happy = main(world, 'prd_a', { niche: 0, ...LOSER, ratings: HAPPY });
    const dead = main(world, 'prd_b', { niche: 1, ...LOSER, ratings: [2, 3, 2, 3], over: { version: 3, versionDay: 5 } });
    const unpaid = main(world, 'prd_c', { niche: 2 });
    await growthPillar.morning!(ctx);
    const r = world.company.growth!.portfolio!;
    expect(r.day).toBe(MONDAY);
    expect(r.lines.map((l) => [l.productId, l.verdict]).sort()).toEqual([['prd_a', 'harvest'], ['prd_b', 'kill'], ['prd_c', 'test']]);
    expect([happy.status, dead.status, unpaid.status]).toEqual(['live', 'killed', 'live']);
    const task = world.company.tasks.find((t) => t.kind === 'portfolio_review')!;
    expect(task).toMatchObject({ status: 'done', assignee: 'camille', dayDone: MONDAY });
    expect(task.output).toMatchObject({ lines: 3 });
    await growthPillar.morning!(ctx);
    expect(world.company.tasks.filter((t) => t.kind === 'portfolio_review')).toHaveLength(1);
  });

  it('the control has no review: nothing changes', async () => {
    const { world, ctx } = await lab({ scaling: false });
    const p = main(world, 'prd_a', { ...LOSER, ratings: HAPPY });
    await growthPillar.morning!(ctx);
    expect(world.company.growth!.portfolio).toBeNull();
    expect(p.harvest).toBeUndefined();
    expect(world.company.tasks.some((t) => t.kind === 'portfolio_review')).toBe(false);
  });

  it('a review draws nothing: the same world reads the same verdicts and the rng does not move', async () => {
    const { world, ctx } = await lab();
    main(world, 'prd_a', { niche: 0, ...LOSER, ratings: HAPPY });
    main(world, 'prd_b', { niche: 1, spend: 10, revenue: 20, from: 14 });
    const state = JSON.stringify(world.rngState);
    await review(ctx);
    expect(JSON.stringify(world.rngState)).toBe(state);
  });
});
