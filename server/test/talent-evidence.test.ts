/**
 * Evidence, rating, routing (talent §5, §6.2, §6.4). The rating is arithmetic and the market rows read planted ad stats,
 * so most tests are exact. Two short runs prove the wiring: what a real company feeds the league, and the routing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, AgentState, Campaign, DailyAdStats, Duel, LeagueState, Product, ScenarioConfig, SkillRating, Task, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { sim } from '../src/runtime/modules.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { applyDailyEvidence, naturalResult, onDone, onReviewed, onStrike, phi, ratingOf, recordEvidence, recordScore, routeBonus } from '../src/runtime/talent/evidence.js';
import { talentPillar } from '../src/runtime/talent/index.js';
import { assignReady, capableAgents, createTask } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ ...LEGACY, talent: 'league', seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-evidence');
  const root = mkdtempSync(join(tmpdir(), 'pixel-evidence-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w) => new Company(w, opts) };
}

const league = (w: WorldState): LeagueState => w.company.league!;
const events = (w: WorldState, source?: string) => league(w).events.filter((e) => !source || e.source === source);
const naturals = (w: WorldState): Duel[] => league(w).duels.filter((d) => d.kind === 'natural');
const writers = (w: WorldState): AgentState[] => capableAgents(w, 'produce_ad', 'growth');

function product(w: WorldState, id: string, launchedDay: number | null = 1): Product {
  const p = { id, nicheId: 'niche', title: `Guide ${id}`, status: 'live', launchedDay, version: 1, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 } } as unknown as Product;
  w.company.products.push(p);
  return p;
}

function creative(w: WorldState, id: string, productId: string, createdBy: string, over: Partial<AdCreative> = {}): AdCreative {
  const c = { id, productId, createdBy, hook: `Hook ${id}`, hookStyle: 'question', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '', review: { status: 'approved', reason: null, day: 1 }, ...over } as unknown as AdCreative;
  w.company.creatives.push(c);
  return c;
}

function campaign(w: WorldState, id: string, productId: string, createdBy: string, creativeIds: string[]): Campaign {
  const c = { id, productId, name: `Campagne ${id}`, creativeIds, dailyBudget: 20, status: 'active', startDay: 1, createdBy } as unknown as Campaign;
  w.company.campaigns.push(c);
  return c;
}

function row(day: number, campaignId: string, creativeId: string, productId: string, over: Partial<DailyAdStats> = {}): DailyAdStats {
  const r: DailyAdStats = { day, campaignId, creativeId, productId, spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [], ...over };
  return r;
}

function outage(w: WorldState, day: number): void {
  w.market.events.push({ id: `evt-${day}`, day: day - 1, kind: 'platform_outage', title: 'Panne', description: 'Panne annoncée', severity: 'danger', refs: { day } });
}

/** Two writers, one campaign, one creative each. */
function pair(w: WorldState): { a: AgentState; b: AgentState } {
  const [a, b] = writers(w);
  product(w, 'prd-1');
  creative(w, 'cre-a', 'prd-1', a!.id);
  creative(w, 'cre-b', 'prd-1', b!.id);
  campaign(w, 'cmp-1', 'prd-1', a!.id, ['cre-a', 'cre-b']);
  return { a: a!, b: b! };
}

function plant(w: WorldState, day: number, impressions: number, clicksA: number, clicksB: number): void {
  w.market.adStats.push(row(day, 'cmp-1', 'cre-a', 'prd-1', { impressions, clicks: clicksA }), row(day, 'cmp-1', 'cre-b', 'prd-1', { impressions, clicks: clicksB }));
}

describe('the rating (§5.1)', () => {
  it('moves on evidence, and settles where the results stand: 0,5 sd above par is about 1640', async () => {
    const { world } = await lab();
    const [a] = writers(world);
    const before = ratingOf(world, a!.id, 'copy').rating;
    recordScore(world, a!.id, 'copy', 'qa', TALENT.par['copy:qa']! + 2 * TALENT.sd['copy:qa']!, 'bonne pub');
    const r = ratingOf(world, a!.id, 'copy');
    expect(before).toBe(1500);
    expect(r.rating).toBeGreaterThan(1520); // K 50 on a game won at .98
    expect(r.rd).toBe(194);
    expect(r).toMatchObject({ n: 1, seasonN: 1 });
    for (let i = 0; i < 400; i++) recordScore(world, a!.id, 'copy', 'qa', TALENT.par['copy:qa']! + 0.5 * TALENT.sd['copy:qa']!, 'pub');
    expect(ratingOf(world, a!.id, 'copy').rating).toBeGreaterThan(1625);
    expect(ratingOf(world, a!.id, 'copy').rating).toBeLessThan(1655);
    expect(ratingOf(world, a!.id, 'copy').rd).toBe(TALENT.rating.rdMin);
  });

  it('a result the noise can eat moves almost nothing: s is worth what it says, and w weighs it', async () => {
    const { world } = await lab();
    const [a, b, c] = writers(world);
    recordEvidence(world, c!.id, 'copy', 'natural', 0.5, 1, 'nul');
    expect(ratingOf(world, c!.id, 'copy').rating).toBe(1500);
    recordEvidence(world, a!.id, 'copy', 'natural', 1, 1, 'gagné');
    recordEvidence(world, b!.id, 'copy', 'natural', 1, 0.25, 'gagné, moins de poids');
    expect(ratingOf(world, a!.id, 'copy').rating - 1500).toBeCloseTo(4 * (ratingOf(world, b!.id, 'copy').rating - 1500), 0);
  });

  it('`phi` is the normal cdf', () => {
    expect(phi(0)).toBeCloseTo(0.5, 4);
    expect(phi(1.96)).toBeCloseTo(0.975, 3);
    expect(phi(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('parStats sum the raw x, in `flat` too, and the ring keeps 300 events (D58)', async () => {
    const { world } = await lab({ talent: 'flat' });
    const [a] = writers(world);
    expect(world.company.league).toBeDefined();
    recordScore(world, a!.id, 'copy', 'qa', 90, 'une');
    recordScore(world, a!.id, 'copy', 'qa', 80, 'deux');
    recordEvidence(world, a!.id, 'copy', 'rejected', 0, 1, 'sans x');
    expect(league(world).parStats['copy:qa']).toEqual({ n: 2, sum: 170, sq: 8100 + 6400 });
    expect(league(world).parStats['copy:rejected']).toBeUndefined();
    for (let i = 0; i < 400; i++) recordScore(world, a!.id, 'support', 'reply', 85, `réponse ${i}`, 0.25);
    expect(events(world)).toHaveLength(TALENT.evidence.eventsMax);
    expect(events(world).at(-1)!.label).toBe('réponse 399');
    expect(league(world).parStats['support:reply']!.n).toBe(400);
  });

  it('`off` has no league: evidence records nothing and breaks nothing', async () => {
    const { world, ctx } = await lab({ talent: 'off' });
    const a = world.company.agents[0]!;
    recordEvidence(world, a.id, 'copy', 'qa', 1, 1, 'rien', undefined, 90);
    applyDailyEvidence(world, 7);
    onReviewed(ctx, { kind: 'produce_ad', attempts: 0, assignee: a.id, title: 't' } as Task, { verdict: 'approve', score: 90 });
    expect(world.company.league).toBeUndefined();
  });

  it('a leaver plays no more, and their work still measures the par', async () => {
    const { world } = await lab();
    const [a] = writers(world);
    const entry = ratingOf(world, a!.id, 'copy');
    world.company.agents = world.company.agents.filter((x) => x.id !== a!.id);
    league(world).entries[a!.id]!.status = 'gone';
    recordScore(world, a!.id, 'copy', 'qa', 99, 'trop tard');
    expect(entry.n).toBe(0);
    expect(events(world)).toEqual([]);
    expect(league(world).parStats['copy:qa']!.n).toBe(1);
    recordEvidence(world, 'personne', 'copy', 'qa', 1, 1, 'inconnu');
    expect(league(world).entries.personne).toBeUndefined();
  });

  it('a hat moves a rating and opens no primary: Zoé on `produce_ad` is not judged on copy (D14)', async () => {
    const { world } = await lab({ org: defaultScenario().org });
    const hat = world.company.agents.find((a) => a.hatKinds.includes('produce_ad'))!;
    delete league(world).entries[hat.id];
    recordScore(world, hat.id, 'copy', 'qa', 95, 'une pub sous casquette');
    const entry = league(world).entries[hat.id]!;
    expect(entry.ratings.copy).toMatchObject({ n: 1, seasonN: 1 });
    expect(entry.ratings.copy!.rating).toBeGreaterThan(1500);
    expect(entry.primary).not.toBe('copy');
  });

  it('`metric` is the season\'s weighted mean, in the words of the role', async () => {
    const { world } = await lab();
    const [a] = writers(world);
    recordScore(world, a!.id, 'copy', 'qa', 80, 'une');
    recordScore(world, a!.id, 'copy', 'qa', 90, 'deux');
    recordEvidence(world, a!.id, 'copy', 'natural', 1, 0.4, 'sans chiffre lisible');
    expect(ratingOf(world, a!.id, 'copy').metric).toBe(85);
    recordScore(world, a!.id, 'buying', 'market', Math.log(3 / 1.5), 'ROAS 3', 1);
    recordScore(world, a!.id, 'buying', 'market', Math.log(1 / 1.5), 'ROAS 1', 0.5);
    expect(ratingOf(world, a!.id, 'buying').metric).toBeCloseTo((3 + 0.5) / 1.5, 2);
    league(world).season += 1;
    recordScore(world, a!.id, 'copy', 'qa', 70, 'saison suivante');
    expect(ratingOf(world, a!.id, 'copy').metric).toBe(70);
  });
});

describe('what the work says (§5.2)', () => {
  it('`qa` is the first review, once, with a rework after it (test 13)', async () => {
    const { world, ctx } = await lab();
    const [a] = writers(world);
    const task = createTask(world, { kind: 'produce_ad', assignee: a!.id, title: 'Une pub' });
    onReviewed(ctx, task, { verdict: 'changes', score: 70 });
    task.attempts = 1; // company.ts after a rework verdict
    onReviewed(ctx, task, { verdict: 'approve', score: 92 });
    expect(events(world, 'qa')).toHaveLength(1);
    expect(events(world, 'qa')[0]).toMatchObject({ agentId: a!.id, skill: 'copy', w: 1 });
    expect(events(world, 'qa')[0]!.s).toBeCloseTo(phi((70 - 88) / 5), 3);
    expect(league(world).parStats['copy:qa']).toEqual({ n: 1, sum: 70, sq: 4900 });
  });

  it('`qa` covers the guide and the page at their weight, and nothing else or a review without a score', async () => {
    const { world, ctx } = await lab();
    const [a] = writers(world);
    onReviewed(ctx, createTask(world, { kind: 'write_pdf', assignee: a!.id }), { verdict: 'approve', score: 86 });
    onReviewed(ctx, createTask(world, { kind: 'write_sales_page', assignee: a!.id }), { verdict: 'approve', score: 74 });
    onReviewed(ctx, createTask(world, { kind: 'render_pdf', assignee: a!.id }), { verdict: 'approve', score: 90 });
    onReviewed(ctx, createTask(world, { kind: 'write_pdf', assignee: a!.id }), { verdict: 'approve', score: null });
    expect(events(world, 'qa').map((e) => [e.skill, e.w])).toEqual([['longform', 1.5], ['page', 1.5]]);
  });

  it('a polish is what it gained less what it left, and a clean text says nothing', async () => {
    const { world, ctx } = await lab();
    const [a] = writers(world);
    const done = (output: Task['output']): Task => ({ ...createTask(world, { kind: 'humanize_pdf', assignee: a!.id }), output });
    onDone(ctx, done({ flagged: 4, before: 82, after: 87, kept: true }));
    onDone(ctx, done({ flagged: 4, before: 82, after: 87, kept: true, left: 0.5 }));
    onDone(ctx, done({ flagged: 4, before: 82, after: 82, kept: false }));
    onDone(ctx, done({ flagged: 0, before: 90, after: 90, kept: true }));
    onDone(ctx, createTask(world, { kind: 'write_pdf', assignee: a!.id }));
    expect(events(world, 'qa').map((e) => e.skill)).toEqual(['polish', 'polish', 'polish']);
    expect(league(world).parStats['polish:qa']).toMatchObject({ n: 3, sum: 5 + 4 - 2 });
  });

  it('a strike falls on the author, a false positive does not (`produce_ad.onDone`)', async () => {
    const { world, ctx } = await lab();
    const [a, b] = writers(world);
    product(world, 'prd-1');
    creative(world, 'cre-a', 'prd-1', a!.id);
    creative(world, 'cre-b', 'prd-1', b!.id);
    const run = (creativeId: string, strike: boolean) => HANDLERS.produce_ad.onDone!(
      { ...ctx, tools: { ...ctx.tools, submitCreative: () => ({ status: 'rejected', reason: 'Refusée', strike }) } },
      { ...createTask(world, { kind: 'produce_ad', input: { productId: 'prd-1' } }), output: { creativeId } },
    );
    await run('cre-a', true);
    await run('cre-b', false);
    expect(events(world, 'rejected')).toHaveLength(1);
    expect(events(world, 'rejected')[0]).toMatchObject({ agentId: a!.id, skill: 'copy', s: 0, w: 1 });
    expect(ratingOf(world, a!.id, 'copy').rating).toBeLessThan(1500);
    expect(ratingOf(world, b!.id, 'copy').rating).toBe(1500);
  });

  it('reviews count once per version, the day it crosses six, for the writer and the editor', async () => {
    const { world } = await lab();
    const [writer, editor] = writers(world);
    const p = product(world, 'prd-1');
    world.company.tasks.push(
      { ...createTask(world, { kind: 'write_pdf', assignee: writer!.id, input: { productId: 'prd-1' } }), status: 'done', dayDone: 1 },
      { ...createTask(world, { kind: 'humanize_pdf', assignee: editor!.id, input: { productId: 'prd-1' } }), status: 'done', dayDone: 1 },
    );
    for (let i = 0; i < 5; i++) p.stats.reviews.push({ id: `r${i}`, day: 3, customerId: 'c', rating: 4, text: '' });
    applyDailyEvidence(world, 3);
    expect(events(world, 'market')).toEqual([]);
    p.stats.reviews.push({ id: 'r5', day: 4, customerId: 'c', rating: 5, text: '' });
    p.stats.reviews.push({ id: 'r6', day: 4, customerId: 'c', rating: 5, text: '' });
    applyDailyEvidence(world, 4);
    expect(events(world, 'market').map((e) => [e.skill, e.agentId, e.w])).toEqual([['longform', writer!.id, 1], ['polish', editor!.id, 0.5]]);
    expect(league(world).parStats['longform:market']!.sum).toBeCloseTo(((5 * 4) + 10) / 7, 6);
    p.stats.reviews.push({ id: 'r7', day: 5, customerId: 'c', rating: 5, text: '' });
    applyDailyEvidence(world, 5);
    expect(events(world, 'market')).toHaveLength(2);
  });

  it('a page is read once, at 150 paid views, against the other products on the same days', async () => {
    const { world } = await lab();
    const [writer] = writers(world);
    product(world, 'prd-1');
    product(world, 'prd-2');
    world.company.tasks.push({ ...createTask(world, { kind: 'write_sales_page', assignee: writer!.id, input: { productId: 'prd-1' } }), status: 'done', dayDone: 1 });
    world.market.adStats.push(row(2, 'x', 'y', 'prd-1', { landingViews: 100, purchases: 4 }), row(2, 'z', 'y', 'prd-2', { landingViews: 300, purchases: 3 }));
    applyDailyEvidence(world, 2);
    expect(events(world, 'market')).toEqual([]);
    world.market.adStats.push(row(3, 'x', 'y', 'prd-1', { landingViews: 60, purchases: 4 }));
    applyDailyEvidence(world, 3);
    const expected = Math.log((8.5 / 161) / (3.5 / 301));
    expect(league(world).parStats['page:market']!.sum).toBeCloseTo(expected, 6);
    expect(events(world, 'market')).toHaveLength(1);
    expect(events(world, 'market')[0]).toMatchObject({ skill: 'page', agentId: writer!.id, w: 0.7 });
    world.market.adStats.push(row(4, 'x', 'y', 'prd-1', { landingViews: 60, purchases: 4 }));
    applyDailyEvidence(world, 4);
    expect(events(world, 'market')).toHaveLength(1);
  });

  it('a buyer is read each week on what really ran, at the credit\'s ROAS (D21), weighed by spend', async () => {
    const { world } = await lab();
    const [buyer] = writers(world);
    product(world, 'prd-1');
    campaign(world, 'cmp-long', 'prd-1', buyer!.id, ['a', 'b']);
    campaign(world, 'cmp-solo', 'prd-1', buyer!.id, ['c']);
    campaign(world, 'cmp-brief', 'prd-1', buyer!.id, ['d']);
    for (const day of [2, 3, 4]) {
      world.market.adStats.push(
        row(day, 'cmp-long', 'a', 'prd-1', { spend: 15, impressions: 1000, clicks: 30, revenue: 30 }),
        row(day, 'cmp-long', 'b', 'prd-1', { spend: 5, impressions: 1000, clicks: 10 }),
        row(day, 'cmp-solo', 'c', 'prd-1', { spend: 4, impressions: 1000, clicks: 10 }),
      );
    }
    world.market.adStats.push(row(2, 'cmp-brief', 'd', 'prd-1', { spend: 10, impressions: 1000, clicks: 10 }), row(3, 'cmp-brief', 'd', 'prd-1', { spend: 10, impressions: 1000, clicks: 10 }));
    world.company.channels = {
      open: ['tiktok'], requested: {}, lines: [], plan: null,
      attribution: { day: world.day, fromDay: 1, toDay: 6, by: buyer!.id, niches: {}, rows: [{ channel: 'tiktok', spend: 0, shopRevenue: 0, claimedRevenue: 0, reconciledRevenue: 0, credit: 0.5, inflation: 1 }] },
    };
    applyDailyEvidence(world, 6);
    expect(events(world).filter((e) => e.skill === 'buying')).toEqual([]);
    applyDailyEvidence(world, 7);
    const market = events(world, 'market').filter((e) => e.skill === 'buying');
    expect(market.map((e) => e.w)).toEqual([1, 0.2]); // 60 € spent, then 12 €: the brief campaign ran 2 days
    expect(market[0]!.label).toContain('ROAS 0,75');
    expect(market[1]!.s).toBeLessThan(0.05); // no revenue: the floor keeps it finite
    expect(league(world).parStats['buying:market']!.sum).toBeCloseTo(Math.log(0.5) + Math.log(0.05 / 1.5), 6);
    const focus = events(world, 'focus');
    expect(focus).toHaveLength(1); // one creative leaves no choice to read
    expect(focus[0]).toMatchObject({ agentId: buyer!.id, skill: 'buying', w: 0.5 });
    expect(league(world).parStats['buying:focus']!.sum).toBeCloseTo(0.75, 6);
    applyDailyEvidence(world, 8);
    expect(events(world, 'focus')).toHaveLength(1);
  });

  it('a pick is a rank among the catalogue 14 days after launch; a niche the founder named is not the researcher\'s', async () => {
    const { world, ctx } = await lab();
    const [researcher] = writers(world);
    world.day = 15;
    for (const [id, gain] of [['prd-a', 50], ['prd-b', 100], ['prd-c', 200], ['prd-d', 20]] as const) {
      product(world, id, id === 'prd-b' || id === 'prd-d' ? 1 : 0);
      sim.recordLedger(world, { type: 'revenue', amount: gain, memo: 'vente', ref: id });
    }
    world.company.products.find((p) => p.id === 'prd-a')!.launchedDay = 20;
    world.company.products.find((p) => p.id === 'prd-c')!.launchedDay = 20;
    const picked = (productId: string, input = {}) => world.company.tasks.push({ ...createTask(world, { kind: 'pick_opportunity', assignee: researcher!.id, input }), status: 'done', output: { productId } });
    picked('prd-b');
    picked('prd-d', { nicheId: 'choisie-par-le-fondateur' });
    applyDailyEvidence(ctx.world, 15);
    const picks = events(world, 'pick');
    expect(picks).toHaveLength(1); // prd-d is the founder's
    expect(picks[0]).toMatchObject({ agentId: researcher!.id, skill: 'research', s: 0.625, w: 1 }); // above 2 of 3 others, mid-rank
    expect(ratingOf(world, researcher!.id, 'research').metric).toBe(62.5);
    applyDailyEvidence(ctx.world, 16);
    expect(events(world, 'pick')).toHaveLength(1);
  });

  it('a product alone in the catalogue ranks nothing', async () => {
    const { world } = await lab();
    const [researcher] = writers(world);
    world.day = 15;
    product(world, 'prd-1', 1);
    sim.recordLedger(world, { type: 'revenue', amount: 90, memo: 'vente', ref: 'prd-1' });
    world.company.tasks.push({ ...createTask(world, { kind: 'pick_opportunity', assignee: researcher!.id }), status: 'done', output: { productId: 'prd-1' } });
    applyDailyEvidence(world, 15);
    expect(events(world, 'pick')).toEqual([]);
  });

  it('ratings keep one point a week and 40 at most, and the pass counts a day once', async () => {
    const { world } = await lab();
    const [a] = writers(world);
    const r: SkillRating = ratingOf(world, a!.id, 'copy');
    r.rating = 1555;
    for (let week = 1; week <= 45; week++) {
      applyDailyEvidence(world, week * 7);
      applyDailyEvidence(world, week * 7);
    }
    expect(r.history).toHaveLength(TALENT.rating.historyMax);
    expect(r.history.at(-1)).toEqual({ day: 45 * 7, rating: 1555 });
    expect(league(world).lastEvidenceDay).toBe(45 * 7);
  });
});

describe('an announced outage day (test 13)', () => {
  it('gives no natural and no market event, and its rows never come back', async () => {
    const { world } = await lab();
    const { a } = pair(world);
    plant(world, 7, 3000, 90, 30);
    outage(world, 7);
    world.market.adStats.push(row(7, 'cmp-1', 'cre-a', 'prd-1', { spend: 100, revenue: 300 }), row(6, 'cmp-1', 'cre-a', 'prd-1', { spend: 1 }), row(5, 'cmp-1', 'cre-a', 'prd-1', { spend: 1 }));
    applyDailyEvidence(world, 7);
    expect(events(world)).toEqual([]);
    expect(league(world).lastEvidenceDay).toBe(0);
    applyDailyEvidence(world, 8);
    expect(naturals(world)).toEqual([]);
    expect(events(world).filter((e) => e.source === 'natural')).toEqual([]);
    expect(ratingOf(world, a.id, 'copy').rating).toBe(1500);
  });

  it('what fell due that day waits for the next one: the week of the buyer is not lost', async () => {
    const { world } = await lab();
    const { a } = pair(world);
    outage(world, 7);
    for (const day of [4, 5, 6]) world.market.adStats.push(row(day, 'cmp-1', 'cre-a', 'prd-1', { spend: 20, impressions: 900, clicks: 9, revenue: 60 }));
    applyDailyEvidence(world, 6);
    applyDailyEvidence(world, 7);
    expect(events(world, 'market')).toEqual([]);
    applyDailyEvidence(world, 8);
    expect(events(world, 'market').map((e) => e.agentId)).toEqual([a.id]);
    expect(events(world, 'market')[0]!.label).toContain('ROAS 3,00'); // day 8's window, without the outage
  });
});

describe('natural duels (§6.2)', () => {
  it('a clear gap on the same days moves both ways at weight .4, and is settled once', async () => {
    const { world } = await lab();
    const { a, b } = pair(world);
    plant(world, 4, 2000, 60, 20);
    plant(world, 5, 2000, 60, 20);
    applyDailyEvidence(world, 5);
    const [duel] = naturals(world);
    expect(duel).toMatchObject({ agents: [a.id, b.id], campaignId: 'cmp-1', creativeIds: ['cre-a', 'cre-b'], status: 'settled', startDay: 4, endDay: 5, skill: 'copy' });
    expect(duel!.result!.n).toEqual([4000, 4000]);
    expect(duel!.result!.s).toBeGreaterThan(0.95);
    const up = ratingOf(world, a.id, 'copy').rating, down = ratingOf(world, b.id, 'copy').rating;
    expect(up).toBeGreaterThan(1500);
    expect(down).toBeLessThan(1500);
    expect(up - 1500).toBeCloseTo(1500 - down, 0);
    expect(duel!.result!.delta).toBeCloseTo(up - 1500, 1);
    expect(events(world, 'natural').map((e) => [e.agentId, e.w])).toEqual([[a.id, 0.4], [b.id, 0.4]]);
    applyDailyEvidence(world, 6);
    expect(naturals(world)).toHaveLength(1);
    plant(world, 7, 2000, 20, 60);
    applyDailyEvidence(world, 7);
    expect(naturals(world)).toHaveLength(2);
    expect(naturals(world)[1]).toMatchObject({ startDay: 7, endDay: 7 });
  });

  it('two creatives at 200 impressions: no duel, and the numbers could not tell them apart anyway', async () => {
    const { world } = await lab();
    pair(world);
    plant(world, 4, 200, 4, 4);
    applyDailyEvidence(world, 4);
    expect(naturals(world)).toEqual([]);
    expect(naturalResult({ impressions: 200, clicks: 4 }, { impressions: 200, clicks: 4 }, 1, 1).s).toBeCloseTo(0.5, 3);
    const oneClick = naturalResult({ impressions: 200, clicks: 5 }, { impressions: 200, clicks: 4 }, 1, 1).s;
    expect(Math.abs(oneClick - 0.5)).toBeLessThan(0.13); // a click either way is worth 3 points at weight .4: the 1 500 bar is what keeps it out
  });

  it('only shared days count: a creative that ran alone earlier proves nothing', async () => {
    const { world } = await lab();
    pair(world);
    world.market.adStats.push(row(3, 'cmp-1', 'cre-a', 'prd-1', { impressions: 5000, clicks: 200 }));
    plant(world, 4, 1000, 30, 30);
    applyDailyEvidence(world, 4);
    expect(naturals(world)).toEqual([]);
  });

  it('half of the angle is the bandit\'s, and an arm under 3 pulls has no opinion', async () => {
    const { world } = await lab();
    const { a, b } = pair(world);
    world.company.creatives.find((c) => c.id === 'cre-a')!.hookStyle = 'stat';
    world.company.bandits = {
      'hook_style:niche': [{ key: 'stat', alpha: 8, beta: 2, pulls: 8, reward: 6 }, { key: 'question', alpha: 2, beta: 8, pulls: 8, reward: 2 }],
      'ad_format:niche': [{ key: 'carousel', alpha: 9, beta: 1, pulls: 2, reward: 2 }],
    };
    plant(world, 4, 2000, 60, 40);
    applyDailyEvidence(world, 4);
    const [duel] = naturals(world);
    const { s } = naturalResult({ impressions: 2000, clicks: 60 }, { impressions: 2000, clicks: 40 }, 0.8 / 0.2, 1);
    expect(duel!.result!.s).toBeCloseTo(s, 3);
    expect(s).toBeLessThan(naturalResult({ impressions: 2000, clicks: 60 }, { impressions: 2000, clicks: 40 }, 1, 1).s);
    expect(a.id).not.toBe(b.id);
  });

  it('nobody duels themselves, nor a leaver', async () => {
    const { world } = await lab();
    const { a } = pair(world);
    world.company.creatives.find((c) => c.id === 'cre-b')!.createdBy = a.id;
    plant(world, 4, 2000, 60, 20);
    applyDailyEvidence(world, 4);
    expect(naturals(world)).toEqual([]);
    world.company.creatives.find((c) => c.id === 'cre-b')!.createdBy = 'parti';
    applyDailyEvidence(world, 5);
    expect(naturals(world)).toEqual([]);
  });

  it('natural duels stop at 200, and a formal one is never the one dropped', async () => {
    const { world } = await lab();
    pair(world);
    league(world).duels.push({ id: 'formal', kind: 'formal', status: 'running', creativeIds: [] } as unknown as Duel);
    for (let day = 1; day <= TALENT.natural.kept + 5; day++) {
      plant(world, day, 2000, 60, 20);
      applyDailyEvidence(world, day);
    }
    expect(naturals(world)).toHaveLength(TALENT.natural.kept);
    expect(league(world).duels.some((d) => d.id === 'formal')).toBe(true);
  });
});

describe('routing (§6.4, test 20)', () => {
  /** A new task of one kind and who gets it, the world otherwise untouched. */
  const taskGoesTo = (w: WorldState): string => {
    const task = createTask(w, { kind: 'produce_ad', title: 'Une pub de plus', priority: 1 });
    assignReady(w);
    return task.assignee!;
  };
  const rate = (w: WorldState, id: string, rating: number) => { ratingOf(w, id, 'copy').rating = rating; };

  it('same load, the higher observed rating gets the task in `league`; in `flat` the order is the old one', async () => {
    const off = (await lab({ talent: 'off' })).world;
    const flat = (await lab({ talent: 'flat' })).world;
    const ranked = (await lab({ talent: 'league' })).world;
    const old = taskGoesTo(off);
    const other = writers(ranked).find((a) => a.id !== old)!;
    for (const w of [flat, ranked]) { rate(w, other.id, 1650); rate(w, old, 1400); }
    expect(taskGoesTo(flat)).toBe(old);
    expect(taskGoesTo(ranked)).toBe(other.id);
  });

  it('the bonus reads the rating against the family, clamped, a perk on top, 0 on a kind with no skill', async () => {
    const { world } = await lab();
    const [a, b] = writers(world);
    expect(routeBonus(world, a!, 'produce_ad')).toBe(0);
    rate(world, a!.id, 1900);
    const high = routeBonus(world, a!, 'produce_ad');
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(routeBonus(world, b!, 'produce_ad')).toBeLessThan(0);
    rate(world, a!.id, 9000);
    expect(routeBonus(world, a!, 'produce_ad')).toBe(1);
    expect(routeBonus(world, a!, 'budget_review')).toBe(0);
    league(world).perks.push({ agentId: a!.id, season: league(world).season });
    expect(routeBonus(world, a!, 'produce_ad')).toBe(2);
    expect(routeBonus(world, a!, 'budget_review')).toBe(0);
    league(world).perks[0]!.season = league(world).season - 1;
    expect(routeBonus(world, a!, 'produce_ad')).toBe(1);
  });

  it('it weighs a task or two, never more: a loaded star does not take everything', async () => {
    const { world } = await lab();
    const [star] = writers(world);
    rate(world, star!.id, 2400);
    for (let i = 0; i < 3; i++) createTask(world, { kind: 'produce_ad', assignee: star!.id, title: `Charge ${i}` });
    expect(taskGoesTo(world)).not.toBe(star!.id);
  });

  it('`assignReady` reads no rating outside a league: `off` and `flat` give the same hands, task by task', async () => {
    const hands = async (mode: 'off' | 'flat') => {
      const { world } = await lab({ talent: mode });
      if (mode === 'flat') for (const a of writers(world)) ratingOf(world, a.id, 'copy').rating = 1300 + 40 * a.name.length;
      const tasks = (['produce_ad', 'write_ad_hooks', 'post_organic', 'optimize_ads', 'write_pdf', 'scan_trends'] as const).flatMap((kind) => [createTask(world, { kind }), createTask(world, { kind })]);
      assignReady(world);
      return tasks.map((t) => t.assignee);
    };
    expect(await hands('flat')).toEqual(await hands('off'));
  });
});

describe('a real run feeds the league', () => {
  it('`flat`: ratings move on what reviews said, parStats fill, nobody is routed, and the same seed gives the same league', async () => {
    const run = async () => {
      const { world, company } = await lab({ ...LEGACY, talent: 'flat', seed: 7, horizonDays: 90, startingCash: 500 });
      while (world.day < 10) await company.step();
      return world;
    };
    const w = await run();
    const l = league(w);
    expect(l.lastEvidenceDay).toBe(9);
    const firstReviews = w.company.tasks.filter((t) => t.kind === 'produce_ad' && t.reviews.length > 0);
    expect(firstReviews.length).toBeGreaterThan(0);
    expect(l.parStats['copy:qa']!.n).toBe(firstReviews.length); // a rework adds nothing
    expect(events(w, 'qa').length).toBeGreaterThan(0);
    const moved = Object.values(l.entries).flatMap((e) => Object.values(e.ratings)).filter((r) => r.n > 0);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((r) => r.rating !== 1500)).toBe(true);
    for (const r of moved) {
      expect(Number.isFinite(r.rating)).toBe(true);
      expect(r.rd).toBeLessThan(200);
    }
    expect(JSON.stringify((await run()).company.league)).toBe(JSON.stringify(l));
  }, 120000);

  it('a reload at any tick ends on the same league', async () => {
    const play = async (reloadEvery: number) => {
      const m = await lab({ seed: 11 });
      let { world, company } = m;
      for (let i = 1; i <= 12 * 12; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = m.reopen(world);
        }
      }
      return JSON.stringify(world.company.league);
    };
    const straight = await play(0);
    expect(straight).toContain('copy:qa');
    expect(await play(7) === straight).toBe(true); // 7 and 12 share no divisor: reloads fall on every tick of the day
  }, 120000);

  it('the pillar sends a review through `reviewed`, in `league`', async () => {
    const { world, ctx } = await lab();
    const [a] = writers(world);
    const task = createTask(world, { kind: 'write_pdf', assignee: a!.id });
    talentPillar.reviewed!(ctx, task, { verdict: 'approve', score: 86 });
    talentPillar.taskDone!(ctx, { ...task, kind: 'humanize_pdf', output: { flagged: 2, before: 80, after: 84, kept: true } });
    expect(events(world, 'qa').map((e) => e.skill)).toEqual(['longform', 'polish']);
  });

  it('a strike helper reads the creative\'s author', async () => {
    const { world } = await lab();
    const [a] = writers(world);
    onStrike(world, creative(world, 'cre-1', 'prd-1', a!.id));
    expect(events(world, 'rejected')[0]!.agentId).toBe(a!.id);
  });
});
