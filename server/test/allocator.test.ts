/**
 * The CFO's split between channels (channels §7.4, D9, D26): the curve, the fill, the guardrails, what the buyer does with the
 * plan, and a run reloaded at every tick with 3 channels open. Worlds are real, rows and campaigns are written by hand unless
 * a test says the market runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamRng } from '../src/core/index.js';
import type { DayPlanItem, MindContext, RunPaths } from '../src/contracts.js';
import type {
  AdCreative, AdFormat, AdRatio, AgentState, Allocation, Campaign, ChannelId, ChannelPlan, DailyAdStats, PdfContent, Product, SalesPage, ScenarioConfig, TaskKind, WorldState,
} from '../src/shared.js';
import { CHANNELS, channelOf } from '../src/shared.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { productPaidBlock } from '../src/runtime/acquisition.js';
import { allocateChannels, allocationMorning, elasticity, marginalAt, planNote, planTarget, waterFill } from '../src/runtime/allocator.js';
import { CHANNEL_POLICY } from '../src/runtime/channelPolicy.js';
import { planChannels } from '../src/runtime/channels.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { stopLossReason } from '../src/runtime/handlers/growth.js';
import { experimentCandidate, orderVariantCreatives } from '../src/runtime/handlers/ops.js';
import { campaignMetrics, committedAdBudget, computeBudget, currentBudget, paidConversion, priceTiers, referenceChannel } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { officerId } from '../src/runtime/org/officers.js';
import { payrollToday } from '../src/runtime/org/payroll.js';
import { createTask } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const spy = vi.hoisted(() => ({ growth: false }));

vi.mock('../src/runtime/stages.js', async (original) => {
  const real = await original<typeof import('../src/runtime/stages.js')>();
  return { ...real, growthOn: (w: WorldState) => spy.growth || real.growthOn(w) };
});

const { alloc } = CHANNEL_POLICY;
const roots: string[] = [];

beforeEach(() => { spy.growth = false; });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

vi.setConfig({ testTimeout: 120_000 });

// ───────────────────────────── fixtures ─────────────────────────────

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, startingCash: 50_000, ...over }), 'test-allocator');
  for (const a of Object.values(world.market.channels?.accounts ?? {})) a.openDay = 0;
  const root = mkdtempSync(join(tmpdir(), 'pixel-allocator-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w) => new Company(w, opts) };
}

const at = <T,>(xs: readonly T[], i: number): T => xs[i % xs.length]!;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A guide the market can sell. The market reads every field. */
function guide(world: WorldState, id: string, nicheIndex = 0): Product {
  const n = world.market.niches[nicheIndex]!;
  const k = n.voc.knowledge;
  const content: PdfContent = {
    title: `${n.name} : la méthode en 6 étapes`, subtitle: lower(n.problem), audience: n.audience, promise: `En 14 jours, ${lower(at(n.voc.desiredOutcomes, 0))}.`,
    introduction: [`Vous êtes ${lower(n.audience)} : « ${at(n.voc.phrases, 0)} ».`],
    chapters: Array.from({ length: 6 }, (_, i) => ({
      title: `Étape ${i + 1} : ${at(k.steps, i).replace(/\.$/, '')}`, intro: lower(at(n.voc.pains, i)),
      paragraphs: [at(k.tips, i * 2), at(k.tips, i * 2 + 1), at(k.facts, i), `Prévoyez 15 minutes par jour pendant 7 jours. ${at(k.mistakes, i)}`],
      steps: [at(k.steps, i), at(k.steps, i + 1), at(k.tips, i + 3)], example: at(k.examples, i), checklist: [`J'ai appliqué l'étape ${i + 1}`, 'J\'ai noté mes observations'], visual: null,
    })),
    bonus: { title: 'Bonus', intro: 'Un récapitulatif.', paragraphs: [k.tips.slice(0, 3).join(' ')], steps: k.steps.slice(0, 4), example: null, checklist: k.tips.slice(3, 7), visual: null },
    nextStep: { title: 'La suite', text: 'Le guide suivant vous accompagne.', upsellProductId: null }, wordCount: 0,
  };
  const salesPage: SalesPage = {
    headline: `${n.name} : la méthode en 6 étapes pour ${lower(n.audience)}`, subheadline: `Des étapes concrètes pour en finir avec ce problème : ${lower(n.problem)}.`,
    painBullets: n.voc.phrases.slice(0, 5).map((p) => `« ${p} »`), solution: 'Un guide en 6 étapes numérotées, construit à partir de centaines de témoignages.',
    chapterBlurbs: content.chapters.map((c) => ({ title: c.title, blurb: 'Ce que vous allez appliquer concrètement, avec un exemple réel.' })),
    bonusBlurb: 'Cadeau inclus : la checklist imprimable.', objections: n.voc.objections.slice(0, 4).map((q) => ({ q, a: 'Ce guide part de vrais témoignages.' })),
    guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.', cta: 'Je télécharge le guide', hypeLevel: 0.4,
  };
  const p: Product = {
    id, nicheId: n.id, title: `Guide ${id}`, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price: n.wtp.sweet, status: 'live', version: 1,
    content, design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    salesPage, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price: n.wtp.sweet }],
  };
  world.company.products.push(p);
  return p;
}

function creative(world: WorldState, id: string, p: Product, format: AdFormat, ratio: AdRatio | undefined, on: ChannelId[] = []): AdCreative {
  const n = world.market.niches.find((x) => x.id === p.nicheId)!;
  const hook = `POV : « ${at(n.voc.phrases, world.company.creatives.length).slice(0, 50)} »`;
  const c: AdCreative = {
    id, productId: p.id, hook, hookStyle: 'pov', format,
    scenes: format === 'search_text' ? [] : [
      { visual: 'Gros plan', onScreenText: hook.slice(0, 60), voiceover: hook, durationSec: 4 },
      { visual: 'Pages du guide', onScreenText: 'Le guide : 6 étapes concrètes', voiceover: `Une méthode en 6 étapes pour ${lower(n.audience)}.`, durationSec: 6 },
      { visual: 'Couverture', onScreenText: 'Lien en bio : télécharge le guide', voiceover: 'Le lien est en bio.', durationSec: 5 },
    ],
    caption: `${at(n.voc.pains, 0)} Le guide est en bio.`, hashtags: n.keywords.slice(0, 4).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, '')}`), cta: 'Lien en bio : télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
    ...(ratio ? { ratio } : {}),
  };
  if (format === 'search_text') c.search = { headlines: [n.name.slice(0, 30), 'Méthode en 6 étapes'], descriptions: [at(n.voc.pains, 0).slice(0, 90), 'Guide PDF, satisfait ou remboursé.'], keywords: n.keywords.slice(0, 4) };
  for (const ch of on) (c.channelReviews ??= {})[ch] = { status: 'approved', reason: null, day: 1 };
  world.company.creatives.push(c);
  return c;
}

const CREATIVE_OF: Record<ChannelId, [AdFormat, AdRatio | undefined]> = {
  tiktok: ['faceless_voiceover', undefined], meta: ['carousel', '4:5'], youtube: ['faceless_voiceover', undefined], pinterest: ['static_image', '2:3'], google: ['search_text', 'text'],
};

function campaign(world: WorldState, id: string, p: Product, channel: ChannelId, dailyBudget: number, over: Partial<Campaign> = {}): Campaign {
  const [format, ratio] = CREATIVE_OF[channel];
  const c = creative(world, `cre_${id}`, p, format, ratio, channel === 'tiktok' ? [] : [channel]);
  const camp: Campaign = {
    id, productId: p.id, name: `Campagne ${id}`, creativeIds: [c.id], dailyBudget, status: 'active', targeting: { interests: [], ageMin: 18, ageMax: 55 }, startDay: 1, createdBy: 'test',
    ...(channel === 'tiktok' ? {} : { channel }), ...over,
  };
  world.company.campaigns.push(camp);
  return camp;
}

function row(c: Campaign, day: number, spend: number, revenue: number, over: Partial<DailyAdStats> = {}): DailyAdStats {
  return {
    day, campaignId: c.id, creativeId: c.creativeIds[0]!, productId: c.productId, spend, impressions: Math.round(spend * 200), clicks: Math.round(spend * 5), ctr: 0.025, cpc: 0.2, cpm: 5,
    landingViews: Math.round(spend * 4), purchases: Math.round(revenue / 20), revenue, roas: spend > 0 ? revenue / spend : 0, frequency: 1.2, comments: [],
    ...(channelOf(c) === 'tiktok' ? {} : { channel: channelOf(c) }), ...over,
  };
}

/** A fresh report of the analyst: what each channel's revenue is really worth. */
function setCredit(world: WorldState, credits: Partial<Record<ChannelId, number>>): void {
  const rows = Object.entries(credits).map(([channel, credit]) => ({ channel: channel as ChannelId, spend: 0, shopRevenue: 0, claimedRevenue: 0, reconciledRevenue: 0, credit, inflation: 1 }));
  world.company.channels!.attribution = { day: world.day, fromDay: 1, toDay: world.day, by: world.company.agents[0]!.id, rows, niches: {} };
}

/** The envelope the CFO set this morning, on a day whose yesterday is closed. */
function setCap(world: WorldState, adCap: number, over: Record<string, unknown> = {}): void {
  sim.recordLedger(world, { type: 'tool_subscription', amount: 0, memo: 'Clôture', ref: `fixed:${world.day - 1}` });
  const t = createTask(world, { kind: 'budget_review', title: 'Revue', assignee: world.company.agents[0]!.id, createdBy: 'system' });
  t.status = 'done';
  t.dayDone = world.day;
  t.output = { adCap, survival: false, cash: 50_000, runwayDays: null, rate: 0.15, bankrupt: false, outage: false, ...over };
}

const SPENDS = [10, 14, 20, 28, 40, 56, 80, 28, 20, 14];

/** Rows of R = a·s^b, the last 10 closed days, its average over them scaled to `average`. */
function history(world: WorldState, c: Campaign, b: number, average: number, spends: readonly number[] = SPENDS): void {
  const raw = spends.map((s) => s ** b);
  const a = (average * spends.reduce((x, y) => x + y, 0)) / raw.reduce((x, y) => x + y, 0);
  spends.forEach((s, i) => world.market.adStats.push(row(c, world.day - spends.length + i, s, a * s ** b)));
  world.market.adStats.sort((x, y) => x.day - y.day);
}

const lineOf = (plan: ChannelPlan, c: Campaign) => plan.lines.find((l) => l.campaignIds.includes(c.id))!;
const sumTargets = (plan: ChannelPlan) => plan.lines.reduce((s, l) => s + l.target, 0);

function mindOf(ctx: RuntimeCtx, t?: number): { agent: AgentState; mind: MindContext } {
  const agent = ctx.world.company.agents[0]!;
  const mind = { agent, playbook: [], brainNotes: [], lessons: [], day: ctx.world.day, brand: 'x', ...(t === undefined ? {} : { craft: { skill: 'buying', t, flaw: 0, draws: 1, eye: 0, sharp: 1, passes: 1, reach: 1 } }) } as MindContext;
  return { agent, mind };
}

async function run(ctx: RuntimeCtx, kind: TaskKind, input: Record<string, unknown> = {}, t?: number) {
  const { agent, mind } = mindOf(ctx, t);
  const task = createTask(ctx.world, { kind, title: kind, assignee: agent.id, createdBy: 'system', input });
  return { task, out: await HANDLERS[kind].run(ctx, task, agent, mind) };
}

// ───────────────────────────── the curve ─────────────────────────────

describe('the curve of a line', () => {
  it('budgets that never moved give the prior, which is honest', () => {
    const fit = elasticity(Array.from({ length: 6 }, (_, i) => ({ s: 20, r: 30 + i })), 0.75);
    expect(fit.b).toBeCloseTo(0.75, 10);
    expect(fit.a * 20 ** fit.b).toBeCloseTo((30 + 31 + 32 + 33 + 34 + 35) / 6, 6);
  });

  it('budgets that moved pull the slope away from the prior, shrunk by κ', () => {
    const points = SPENDS.map((s) => ({ s, r: 3 * s ** 0.3 }));
    const fit = elasticity(points, 0.75);
    expect(fit.b).toBeGreaterThan(0.3);
    expect(fit.b).toBeLessThan(0.75);
    expect(elasticity(SPENDS.map((s) => ({ s, r: 3 * s ** 0.9 })), 0.75).b).toBeGreaterThan(0.75);
  });

  it('a day with no sale does not break the fit, and b stays in its bounds', () => {
    const fit = elasticity([{ s: 10, r: 0 }, { s: 20, r: 0 }, { s: 40, r: 60 }, { s: 80, r: 0 }], 0.4);
    expect(Number.isFinite(fit.a)).toBe(true);
    expect(fit.a).toBeGreaterThan(0);
    expect(elasticity([{ s: 5, r: 90 }, { s: 50, r: 1 }, { s: 500, r: 0 }, { s: 5000, r: 0 }], 0.4).b).toBe(0.15);
    expect(elasticity([{ s: 5, r: 0 }, { s: 50, r: 10 }, { s: 500, r: 1e6 }, { s: 5000, r: 1e9 }], 0.4).b).toBe(0.95);
  });
});

describe('water-filling', () => {
  const worked = [{ a: 3.7, b: 0.75 }, { a: 4.4, b: 0.8 }, { a: 3.4, b: 0.7 }, { a: 9.9, b: 0.4 }]; // TikTok, Meta, Pinterest, Search
  const revenue = (spend: readonly number[]) => spend.reduce((s, x, i) => s + worked[i]!.a * x ** worked[i]!.b, 0);

  it('reproduces the worked example of §7.4', () => {
    const { lambda, spend, unspent } = waterFill(worked, 150);
    expect(lambda!).toBeCloseTo(1.35, 1);
    expect(spend.reduce((s, x) => s + x, 0)).toBeCloseTo(150, 6);
    expect(unspent).toBe(0);
    expect(spend[0]!).toBeCloseTo(18, -0.5);
    expect(spend[1]!).toBeCloseTo(120, -0.5);
    expect(spend[2]!).toBeCloseTo(7, -0.5);
    expect(spend[3]!).toBeCloseTo(6, -0.5);
    expect(revenue(spend)).toBeGreaterThan(265);
    expect(revenue(spend)).toBeLessThan(270);
    expect(revenue(spend)).toBeGreaterThan(1.13 * revenue([38, 50, 31, 31]));
    expect(revenue(spend)).toBeGreaterThan(1.2 * revenue([37.5, 37.5, 37.5, 37.5]));
  });

  it('brings every line to the same marginal', () => {
    const { lambda, spend } = waterFill(worked, 150);
    worked.forEach((c, i) => expect(marginalAt(c, spend[i]!)).toBeCloseTo(lambda!, 6));
  });

  it('the best average gets the least: Search', () => {
    const { spend } = waterFill(worked, 150);
    const average = worked.map((c, i) => c.a * spend[i]! ** (c.b - 1));
    expect(Math.max(...average)).toBe(average[3]);
    expect(Math.min(...spend)).toBe(spend[3]);
  });

  it('stops at the floor: what nobody earns stays unspent', () => {
    const { lambda, spend, unspent } = waterFill(worked, 5000);
    expect(lambda).toBe(alloc.floorRoas);
    expect(unspent).toBeCloseTo(5000 - spend.reduce((s, x) => s + x, 0), 6);
    expect(unspent).toBeGreaterThan(0);
  });

  it('the share cap sends the excess back into the fill', () => {
    const { spend, lambda, unspent } = waterFill(worked, 150, alloc.floorRoas, alloc.maxLineShare * 150);
    const free = waterFill(worked, 150);
    expect(spend[1]).toBe(90);
    expect(spend[0]!).toBeGreaterThan(free.spend[0]!);
    expect(spend[3]!).toBeGreaterThan(free.spend[3]!);
    expect(lambda).toBe(alloc.floorRoas); // Meta held back, the others reach the floor before the money runs out…
    expect(unspent).toBeCloseTo(150 - spend.reduce((s, x) => s + x, 0), 6); // …and what is left stays unspent
    expect(unspent).toBeGreaterThan(0);
  });

  it('nothing to fill answers without a λ', () => {
    expect(waterFill([], 100)).toEqual({ lambda: null, spend: [], unspent: 100 });
    expect(waterFill(worked, 0).lambda).toBeNull();
  });
});

// ───────────────────────────── the plan ─────────────────────────────

describe('the plan of the day', () => {
  async function twoLines(over: Partial<ScenarioConfig> = {}) {
    const l = await lab(over);
    l.world.day = 20;
    const p = guide(l.world, 'prd_a');
    return { ...l, p, a: campaign(l.world, 'cmp_a', p, 'tiktok', 40), b: campaign(l.world, 'cmp_b', p, 'meta', 40) };
  }

  it('allocator is marginal, not average: line A avg 2,0 b .3 against line B avg 1,4 b .9, the budget flows to B', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.3, 2);
    history(world, b, 0.9, 1.4);
    setCap(world, 100);
    const plan = allocateChannels(ctx);
    const [la, lb] = [lineOf(plan, a), lineOf(plan, b)];
    expect(la.average!).toBeCloseTo(2, 6);
    expect(lb.average!).toBeCloseTo(1.4, 6);
    expect(la.average!).toBeGreaterThan(lb.average!);
    expect(lb.marginal!).toBeGreaterThan(la.marginal!);
    expect(lb.target).toBeGreaterThan(lb.budget);
    expect(la.target).toBeLessThan(la.budget);
    expect(lb.note).toContain('ROAS marginal');
    expect(lb.note).toContain(CHANNELS.meta.label);
    expect(lb.note).toContain(`sur ${CHANNELS.tiktok.label}`);
  });

  it('allocator keeps money unspent when no line earns 1,15', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.75, 1.05);
    history(world, b, 0.75, 1.1);
    setCap(world, 300);
    const plan = allocateChannels(ctx);
    expect(plan.lambda).toBe(alloc.floorRoas);
    expect(plan.unspent).toBeGreaterThan(200);
    expect(sumTargets(plan)).toBeLessThan(80);
    for (const l of plan.lines) expect(l.target).toBeLessThan(l.budget);
  });

  it('Σ budgets ≤ adCap and no line moves above +30 %, whatever the lines earn', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6);
    setCap(world, 500);
    let plan = allocateChannels(ctx);
    expect(lineOf(plan, a).target).toBe(52);
    expect(lineOf(plan, b).target).toBe(52);
    // the envelope fell under what runs: down pro rata, past the -30 %
    world.day += 1;
    setCap(world, 30);
    plan = allocateChannels(ctx);
    expect(sumTargets(plan)).toBeLessThanOrEqual(30);
    expect(lineOf(plan, a).target).toBeGreaterThanOrEqual(CHANNELS.tiktok.minDailyBudget);
    expect(lineOf(plan, b).target).toBeGreaterThanOrEqual(CHANNELS.meta.minDailyBudget);
  });

  it('when the minimums themselves do not fit, the line whose next euro earns the least stops', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.75, 3);
    history(world, b, 0.75, 1.3);
    setCap(world, 12);
    const plan = allocateChannels(ctx);
    expect(lineOf(plan, b).target).toBe(0);
    expect(lineOf(plan, a).target).toBeGreaterThan(0);
    expect(sumTargets(plan)).toBeLessThanOrEqual(12);
  });

  it('no line above 60 % of the envelope', async () => {
    const { world, ctx, p, a, b } = await twoLines();
    const c = campaign(world, 'cmp_c', p, 'google', 18);
    a.dailyBudget = 18;
    b.dailyBudget = 58;
    history(world, a, 0.75, 1.3);
    history(world, b, 0.9, 20);
    history(world, c, 0.4, 1.3);
    setCap(world, 100);
    expect(lineOf(allocateChannels(ctx), b).target).toBeLessThanOrEqual(60);
  });

  it('a campaign on test stays out of the plan and its budget comes off the envelope', async () => {
    const { world, ctx, p, a, b } = await twoLines();
    const test = campaign(world, 'cmp_t', p, 'pinterest', 8, { test: true });
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6);
    history(world, test, 0.75, 9);
    setCap(world, 60);
    const plan = allocateChannels(ctx);
    expect(plan.lines.flatMap((l) => l.campaignIds)).not.toContain(test.id);
    expect(planTarget(world, test)).toBeNull();
    expect(sumTargets(plan)).toBeLessThanOrEqual(52);
    expect(plan.envelope).toBe(60);
    expect(plan.testEnvelope).toBe(12);
  });

  it('a guide waiting for its first test keeps its share of the envelope, and no line pauses for it', async () => {
    const { world, ctx, a, b } = await twoLines();
    guide(world, 'prd_waits', 1);
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6);
    setCap(world, 100);
    const plan = allocateChannels(ctx);
    expect(sumTargets(plan)).toBeLessThanOrEqual(75);
    await run(ctx, 'optimize_ads');
    expect(a.status).toBe('active');
    expect(b.status).toBe('active');
    expect(a.dailyBudget + b.dailyBudget).toBeLessThanOrEqual(75);
  });

  it('under 4 days of measure the line stays as it is, and what it holds is not for the others', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6, [20, 20, 20]);
    setCap(world, 72);
    const plan = allocateChannels(ctx);
    expect(lineOf(plan, b).target).toBe(40);
    expect(lineOf(plan, b).days).toBe(3);
    expect(lineOf(plan, b).marginal).toBeNull();
    expect(lineOf(plan, b).note).toContain('budget inchangé');
    expect(lineOf(plan, a).target).toBeLessThanOrEqual(32);
  });

  it('a day under 3 € of spend or an outage is no measure', async () => {
    const { world, ctx, a } = await twoLines();
    history(world, a, 0.75, 6, [20, 20, 20, 2, 2, 2]);
    setCap(world, 500);
    expect(lineOf(allocateChannels(ctx), a).days).toBe(3);
    world.market.adStats.push(row(a, 19, 20, 900));
    world.market.events.push({ id: 'evt_x', day: 18, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger', refs: { day: 19 } });
    expect(lineOf(allocateChannels(ctx), a).days).toBe(3);
  });

  it('the tail of a pin counts as revenue of the day, and the reconciled credit weighs on every point', async () => {
    const { world, ctx, p, a } = await twoLines();
    const pin = campaign(world, 'cmp_p', p, 'pinterest', 30);
    history(world, a, 0.75, 2);
    history(world, pin, 0.75, 2, [20, 20, 20, 20, 20]);
    setCap(world, 500);
    const before = lineOf(allocateChannels(ctx), pin);
    expect(before.average!).toBeCloseTo(2, 6);
    world.market.adStats.push(row(pin, world.day - 1, 0, 100, { tail: true }));
    world.market.adStats.push(row(pin, world.day - 7, 0, 500, { tail: true })); // no day of its own: nothing paid for it
    world.market.adStats.sort((x, y) => x.day - y.day);
    const tailed = lineOf(allocateChannels(ctx), pin);
    expect(tailed.average!).toBeCloseTo(3, 6);
    expect(tailed.days).toBe(5);
    setCredit(world, { pinterest: 0.5 });
    expect(lineOf(allocateChannels(ctx), pin).average!).toBeCloseTo(1.5, 6);
  });

  it('a line under what the platform accepts waits there, and stops after 3 days in a row', async () => {
    const { world, ctx, a, b } = await twoLines();
    b.dailyBudget = 12;
    history(world, a, 0.75, 3);
    history(world, b, 0.75, 1, Array.from({ length: 10 }, () => 12));
    for (const [i, underMin] of [1, 2].entries()) {
      world.day = 20 + i;
      setCap(world, 200);
      const line = lineOf(allocateChannels(ctx), b);
      expect(line.target).toBe(12);
      expect(line.underMin).toBe(underMin);
    }
    world.day = 22;
    setCap(world, 200);
    const plan = allocateChannels(ctx);
    expect(lineOf(plan, b).target).toBe(0);
    expect(planTarget(world, b)).toBe(0);
    expect(planNote(world, b)).toContain('arrêtée');
    await run(ctx, 'optimize_ads');
    expect(b.status).toBe('paused');
    expect(a.status).toBe('active');
  });

  it('a line the plan stopped stays stopped while the days that stopped it are in the window, however fine its average', async () => {
    const { world, ctx, p, a, b } = await twoLines();
    world.company.channels!.open = ['tiktok', 'meta'];
    world.company.channels!.requested = { meta: 1 };
    world.company.channels!.lines.push({ channel: 'meta', nicheId: p.nicheId, status: 'proven', since: 1, spend: 0, revenue: 0, reason: null, retestDay: null });
    b.dailyBudget = 12;
    history(world, a, 0.75, 3);
    history(world, b, 0.75, 1.2, Array.from({ length: 10 }, () => 12)); // the average still pays: the next euro does not
    world.day = 22;
    setCap(world, 200);
    world.company.channels!.plan = { day: 21, envelope: 200, testEnvelope: 40, lambda: 1.15, unspent: 0, lines: [{ channel: 'meta', productId: p.id, campaignIds: [b.id], budget: 12, target: 12, average: 1.2, marginal: 0.9, elasticity: 0.75, days: 10, note: '', underMin: 2 }] };
    expect(lineOf(allocateChannels(ctx), b).target).toBe(0);
    await run(ctx, 'optimize_ads');
    expect(b.status).toBe('paused');
    expect(b.planStopped).toBe(22);

    creative(world, 'cre_fresh', p, 'carousel', '4:5', ['meta']);
    const relaunches = () => {
      setCap(world, 500);
      const items: DayPlanItem[] = [];
      planChannels(ctx, items, []);
      return items.filter((i) => i.kind === 'launch_campaign' && i.input.channel === 'meta').length;
    };
    world.day = 23;
    expect(relaunches()).toBe(0);
    expect(productPaidBlock(world, p, 'meta')).toMatchObject({ hard: false, reason: expect.stringContaining('plan du CFO') });
    const { task, out } = await run(ctx, 'launch_campaign', { productId: p.id, channel: 'meta' });
    expect(out.output).toMatchObject({ skipped: true, reason: 'cooldown' });
    task.status = 'done';
    expect(productPaidBlock(world, p, 'tiktok')).toBeNull(); // the line is a channel's

    world.day = 22 + alloc.windowDays - 1;
    expect(relaunches()).toBe(0);
    world.day = 22 + alloc.windowDays;
    expect(relaunches()).toBe(1);
  });

  it('a new version of the guide does not wait for the old one\'s stop', async () => {
    const { world, p, b } = await twoLines();
    world.day = 30;
    b.planStopped = 25;
    b.status = 'paused';
    expect(productPaidBlock(world, p, 'meta')?.reason).toMatch(/plan du CFO/);
    p.launchedDay = 26;
    expect(productPaidBlock(world, p, 'meta')).toBeNull();
  });

  it('a day above the minimum clears the count: only days in a row stop a line', async () => {
    const { world, ctx, a, b } = await twoLines();
    b.dailyBudget = 12;
    history(world, a, 0.75, 3);
    history(world, b, 0.75, 1, Array.from({ length: 10 }, () => 12));
    setCap(world, 200);
    allocateChannels(ctx);
    world.day = 22; // no plan yesterday
    setCap(world, 200);
    expect(lineOf(allocateChannels(ctx), b).underMin).toBe(1);
  });

  it('several campaigns on a line share its target pro rata, each above what its platform accepts', async () => {
    const { world, ctx, p, a, b } = await twoLines();
    const second = campaign(world, 'cmp_b2', p, 'meta', 12);
    b.dailyBudget = 48;
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6);
    setCap(world, 500);
    const line = lineOf(allocateChannels(ctx), b);
    expect(line.campaignIds).toEqual([b.id, second.id]);
    expect(line.target).toBeCloseTo(78, 1);
    expect(planTarget(world, b)).toBeCloseTo(62.4, 1);
    expect(planTarget(world, second)).toBeCloseTo(15.6, 1);
    a.dailyBudget = 60;
    second.dailyBudget = 12;
    setCap(world, 30);
    allocateChannels(ctx);
    expect(planTarget(world, second)).toBeGreaterThanOrEqual(CHANNELS.meta.minDailyBudget);
  });

  it('the control arm splits on the average, keeps spending and ignores the floor', async () => {
    const run = async (channelControl: ScenarioConfig['channelControl']) => {
      const { world, ctx, a, b } = await twoLines({ channelControl });
      history(world, a, 0.3, 2);
      history(world, b, 0.9, 1.4);
      setCap(world, 100);
      const plan = allocateChannels(ctx);
      return { plan, ta: lineOf(plan, a).target, tb: lineOf(plan, b).target };
    };
    const average = await run('average_roas');
    expect(average.plan.lambda).toBeNull();
    expect(average.plan.unspent).toBe(0);
    expect(average.ta).toBeGreaterThan(40);
    expect(average.ta).toBeGreaterThan(average.tb);
    const marginal = await run('none');
    expect(marginal.ta).toBeLessThan(40);
  });

  it('yesterday\'s plan decides nothing today', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.75, 6);
    history(world, b, 0.75, 6);
    setCap(world, 500);
    allocateChannels(ctx);
    expect(planTarget(world, a)).toBe(52);
    world.day += 1;
    expect(planTarget(world, a)).toBeNull();
    expect(planNote(world, a)).toBeNull();
  });

  it('draws nothing: same world, same plan, and the rng does not move', async () => {
    const { world, ctx, a, b } = await twoLines();
    history(world, a, 0.3, 2);
    history(world, b, 0.9, 1.4);
    setCap(world, 100);
    const next = { rng: ctx.rng.next, channel: ctx.channelRng.next };
    const first = vi.spyOn(ctx.rng, 'next');
    const second = vi.spyOn(ctx.channelRng, 'next');
    const plan = JSON.stringify(allocateChannels(ctx));
    expect(JSON.stringify(allocateChannels(ctx))).toBe(plan);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(next.rng).toBeTypeOf('function');
  });
});

// ───────────────────────────── the silent drift ─────────────────────────────

describe('the silent drift', () => {
  const FIT = 0.8;
  /** What a drift of the fit costs in runAds: CTR ∝ 0,6 + 0,8 × fit. Fatigue and the rest of the market are left out, they would hide it. */
  const LOSS = (0.6 + 0.8 * 0.6 * FIT) / (0.6 + 0.8 * FIT);

  /** Two lines that hold still, a little noise on top, until Meta drifts: each morning a plan, the buyer follows it. */
  async function market(seed: number, driftDay: number | null) {
    const { world, ctx } = await lab({ seed });
    const p = guide(world, 'prd_d');
    const tiktok = campaign(world, 'cmp_t', p, 'tiktok', 40);
    const meta = campaign(world, 'cmp_m', p, 'meta', 40);
    const budgets: number[] = [];
    for (let day = 1; day <= 30; day++) {
      world.day = day;
      setCap(world, 200);
      allocateChannels(ctx);
      for (const c of [tiktok, meta]) c.dailyBudget = planTarget(world, c) ?? c.dailyBudget;
      budgets[day] = meta.dailyBudget;
      const rng = streamRng(seed, 77, day);
      for (const [c, a] of [[tiktok, 3.4], [meta, 4.6 * (driftDay !== null && day >= driftDay ? LOSS : 1)]] as const) {
        world.market.adStats.push(row(c, day, c.dailyBudget, a * c.dailyBudget ** 0.7 * Math.exp(rng.normal(0, 0.1))));
      }
    }
    return budgets;
  }

  it('silent fit ×0,6: the line loses budget within 7 days', async () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const drifted = await market(seed, 21);
      const twin = await market(seed, null);
      expect(drifted[20]).toBe(twin[20]); // same world up to the drift
      expect(drifted[28]!).toBeLessThan(twin[28]!);
      expect(drifted[28]!).toBeLessThan(drifted[20]!);
    }
  });
});

// ───────────────────────────── the buyer ─────────────────────────────

describe('optimize_ads reads the plan (D26)', () => {
  async function line(budget = 40) {
    const l = await lab();
    l.world.day = 20;
    const p = guide(l.world, 'prd_a');
    const a = campaign(l.world, 'cmp_a', p, 'tiktok', budget);
    const b = campaign(l.world, 'cmp_b', p, 'meta', budget);
    return { ...l, p, a, b };
  }

  it('moves each campaign to its target and says why, cuts first or raises first alike', async () => {
    const { world, ctx, a, b } = await line();
    history(world, a, 0.3, 2);
    history(world, b, 0.9, 1.4);
    setCap(world, 80);
    const plan = allocateChannels(ctx);
    const { out } = await run(ctx, 'optimize_ads');
    expect(a.dailyBudget).toBe(lineOf(plan, a).target);
    expect(b.dailyBudget).toBe(lineOf(plan, b).target);
    expect(b.dailyBudget).toBeGreaterThan(40);
    expect(a.dailyBudget + b.dailyBudget).toBeLessThanOrEqual(80);
    expect(JSON.stringify(out.output)).toContain('ROAS marginal');
  });

  it('a task that names a channel moves that channel alone', async () => {
    const { world, ctx, a, b } = await line();
    history(world, a, 0.3, 2);
    history(world, b, 0.9, 1.4);
    setCap(world, 80);
    allocateChannels(ctx);
    await run(ctx, 'optimize_ads', { channel: 'meta' });
    expect(b.dailyBudget).toBeGreaterThan(40);
    expect(a.dailyBudget).toBe(40);
  });

  it('approval mode: above what he agreed to is his to say, and the rest of the plan runs', async () => {
    const { world, ctx, a, b } = await line();
    world.scenario.founderApproval = true;
    b.founderCap = 40;
    history(world, a, 0.3, 2);
    history(world, b, 0.9, 1.4);
    setCap(world, 80);
    const plan = allocateChannels(ctx);
    expect(lineOf(plan, b).target).toBeGreaterThan(40);
    await run(ctx, 'optimize_ads');
    expect(b.dailyBudget).toBe(40);
    expect(a.dailyBudget).toBe(lineOf(plan, a).target);
    const raise = world.company.tasks.find((t) => t.kind === 'optimize_ads' && t.input.raiseTo !== undefined);
    expect(raise?.input).toMatchObject({ campaignId: b.id, raiseTo: lineOf(plan, b).target });
  });

  it('the stop-loss goes first: a raise in the plan does not save a line that loses money', async () => {
    const { world, ctx, a, b } = await line();
    history(world, a, 0.75, 3);
    for (let d = 14; d < 20; d++) world.market.adStats.push(row(b, d, 20, 10));
    world.market.adStats.sort((x, y) => x.day - y.day);
    const wide = waterFill([{ a: 3, b: 0.75 }], 100);
    expect(wide.lambda).not.toBeNull();
    world.company.channels!.plan = { day: 20, envelope: 100, testEnvelope: 20, lambda: 1.2, unspent: 0, lines: [
      { channel: 'meta', productId: b.productId, campaignIds: [b.id], budget: 40, target: 52, campaignTargets: { [b.id]: 52 }, average: 0.5, marginal: 1.3, elasticity: 0.7, days: 6, note: 'x' },
    ] };
    setCap(world, 100);
    await run(ctx, 'optimize_ads');
    expect(b.status).toBe('paused');
    expect(b.dailyBudget).toBe(40);
  });

  it('the stop-loss reads the credit, never the shrunk number', async () => {
    const stopped = async (credit: number, t?: number) => {
      const { world, ctx, b } = await line();
      for (let d = 14; d < 20; d++) world.market.adStats.push(row(b, d, 20, 20));
      world.market.adStats.sort((x, y) => x.day - y.day);
      setCap(world, 100);
      setCredit(world, { meta: credit });
      await run(ctx, 'optimize_ads', { channel: 'meta' }, t);
      return b.status;
    };
    expect(await stopped(1)).toBe('active');
    expect(await stopped(0.5)).toBe('paused');
    expect(await stopped(0.5, 0.9)).toBe('paused'); // a shrunk read is pulled up towards 1,3: the money does not listen to it
  });

  it('stop-loss: Meta at 45 €, TikTok at 25 €', () => {
    const metrics = (spend: number) => {
      const c = { id: 'c', productId: 'p', creativeIds: ['x'] } as Campaign;
      return campaignMetrics([row(c, 1, spend / 2, 0), row(c, 2, spend / 2, 0)], 'c');
    };
    expect(stopLossReason(metrics(30), metrics(30), 'meta')).toBeNull();
    expect(stopLossReason(metrics(45), metrics(45), 'meta')).toContain('stop-loss');
    expect(stopLossReason(metrics(25), metrics(25), 'tiktok')).toContain('stop-loss');
    expect(stopLossReason(metrics(25), metrics(25))).toContain('stop-loss');
    expect(stopLossReason(metrics(24), metrics(24), 'google')).toBeNull();
  });

  it('a campaign on test waits for its verdict at its budget, however well it reads', async () => {
    const { world, ctx, p, a } = await line();
    const test = campaign(world, 'cmp_t', p, 'pinterest', 8, { test: true });
    history(world, a, 0.75, 2);
    for (let d = 16; d < 20; d++) world.market.adStats.push(row(test, d, 8, 40));
    world.market.adStats.sort((x, y) => x.day - y.day);
    setCap(world, 500);
    allocateChannels(ctx);
    await run(ctx, 'optimize_ads');
    expect(test.dailyBudget).toBe(8);
    expect(test.status).toBe('active');
  });

  describe('a campaign in no plan line', () => {
    async function alone(roasRecent: number) {
      const { world, ctx, a, b } = await line();
      b.status = 'paused';
      for (let d = 16; d < 20; d++) world.market.adStats.push(row(a, d, 40, 40 * roasRecent));
      world.market.adStats.sort((x, y) => x.day - y.day);
      setCap(world, 500);
      return { world, ctx, a };
    }
    const allocation = (over: Partial<Allocation>) => ({ scaleRoas: 1.25, trimRoas: 0.95, reserve: 0, ...over }) as Allocation;

    it('keeps today\'s rule', async () => {
      const scaled = await alone(1.9);
      await run(scaled.ctx, 'optimize_ads');
      expect(scaled.a.dailyBudget).toBe(52);
      const held = await alone(1.5);
      await run(held.ctx, 'optimize_ads');
      expect(held.a.dailyBudget).toBe(40);
      const trimmed = await alone(1.2);
      await run(trimmed.ctx, 'optimize_ads');
      expect(trimmed.a.dailyBudget).toBe(28);
    });

    it('under growth, scaleRoas and trimRoas take over from 1,8 and 1,3', async () => {
      spy.growth = true;
      const scaled = await alone(1.5);
      scaled.world.company.growth!.allocation = allocation({});
      await run(scaled.ctx, 'optimize_ads');
      expect(scaled.a.dailyBudget).toBe(52);
      const kept = await alone(1.2);
      kept.world.company.growth!.allocation = allocation({ scaleRoas: 1.9 });
      await run(kept.ctx, 'optimize_ads');
      expect(kept.a.dailyBudget).toBe(40); // 1,2 is under 1,3, over this CFO's trimRoas
    });

    it('reads the credit-adjusted number, shrunk by a buyer who has talent', async () => {
      const raw = await alone(2.2);
      setCredit(raw.world, { tiktok: 0.5 });
      await run(raw.ctx, 'optimize_ads');
      expect(raw.a.dailyBudget).toBe(28); // 2,2 on the dashboard, 1,1 once reconciled: lukewarm at best
      const thin = await alone(1.9);
      await run(thin.ctx, 'optimize_ads', {}, 1);
      expect(thin.a.dailyBudget).toBe(40); // 1,9 on 120 € reads 1,8 minus a hair: not a winner yet
    });
  });
});

describe('launch_campaign on a channel', () => {
  it('opens a test on the channel, at its minimum, flagged for the allocator', async () => {
    const { world, ctx } = await lab();
    world.day = 20;
    const p = guide(world, 'prd_a');
    creative(world, 'cre_m', p, 'carousel', '4:5', ['meta']);
    setCap(world, 100, { cash: 2000 });
    const { out } = await run(ctx, 'launch_campaign', { productId: p.id, channel: 'meta', test: true });
    const c = world.company.campaigns.find((x) => x.id === out.output?.campaignId)!;
    expect(c).toMatchObject({ channel: 'meta', test: true, dailyBudget: CHANNELS.meta.minDailyBudget, creativeIds: ['cre_m'] });
    expect(c.name).toContain(CHANNELS.meta.label);
    expect(c.learning).toEqual({ events: 0, exitedDay: null });
  });

  it('skips without a creative that channel took, and the plain TikTok test keeps no flag', async () => {
    const { world, ctx } = await lab();
    world.day = 20;
    const p = guide(world, 'prd_a');
    creative(world, 'cre_t', p, 'faceless_voiceover', undefined);
    setCap(world, 100, { cash: 2000 });
    const skipped = await run(ctx, 'launch_campaign', { productId: p.id, channel: 'meta', test: true });
    expect(skipped.out.output).toMatchObject({ skipped: true, reason: 'no_creative' });
    const { out } = await run(ctx, 'launch_campaign', { productId: p.id, test: true });
    const c = world.company.campaigns.find((x) => x.id === out.output?.campaignId)!;
    expect(c.dailyBudget).toBe(8);
    expect(c.test).toBeUndefined();
    expect(c.channel).toBeUndefined();
  });
});

// ───────────────────────────── the company ─────────────────────────────

describe('the CFO\'s envelope (D9)', () => {
  it('under growth, the envelope never reaches into the reserve: stricter, never looser', async () => {
    const { world } = await lab({ startingCash: 1000 });
    const free = computeBudget(world).adCap;
    expect(free).toBeCloseTo((1000 - 7 * payrollToday(world)) * computeBudget(world).rate, 1);
    world.company.growth!.allocation = { reserve: 980 } as Allocation;
    expect(computeBudget(world).adCap).toBe(free); // no decision of the growth pillar while it is off
    spy.growth = true;
    expect(computeBudget(world).adCap).toBe(20);
    world.company.growth!.allocation = { reserve: 1500 } as Allocation;
    expect(computeBudget(world).adCap).toBe(0);
    world.company.growth!.allocation = { reserve: 10 } as Allocation;
    expect(computeBudget(world).adCap).toBe(free);
    world.company.growth!.allocation = null;
    expect(computeBudget(world).adCap).toBe(free);
  });
});

describe('the ritual', () => {
  const rituals = (world: WorldState) => world.company.tasks.filter((t) => t.kind === 'allocate_channels');

  it('waits for 2 channels with active campaigns, then runs each morning right after the budget review', async () => {
    const { world, company, ctx } = await lab({ startingCash: 3000 });
    const p = guide(world, 'prd_a');
    campaign(world, 'cmp_a', p, 'tiktok', 30);
    await company.step();
    expect(rituals(world)).toHaveLength(0);
    expect(world.company.channels!.plan).toBeNull();
    const b = campaign(world, 'cmp_b', p, 'meta', 20);
    b.startDay = 2;
    await allocationMorning(ctx);
    expect(rituals(world)).toHaveLength(1);
    expect(rituals(world)[0]).toMatchObject({ status: 'done', assignee: officerId(world, 'cfo'), reviewer: null });
    expect(world.company.channels!.plan?.day).toBe(world.day);
    const kinds = world.company.tasks.map((t) => t.kind);
    expect(kinds.lastIndexOf('budget_review')).toBeLessThan(kinds.lastIndexOf('allocate_channels'));
  });

  it.each([['survival', { survival: true }], ['outage', { outage: true, adCap: 0 }], ['bankrupt', { bankrupt: true }]] as const)('stands aside in %s: those rules come first', async (_, state) => {
    const { world, ctx } = await lab();
    const p = guide(world, 'prd_a');
    campaign(world, 'cmp_a', p, 'tiktok', 30);
    campaign(world, 'cmp_b', p, 'meta', 20);
    setCap(world, 100, state);
    await allocationMorning(ctx);
    expect(rituals(world)).toHaveLength(0);
  });

  it('a world with no book is TikTok alone: nothing happens', async () => {
    const { world, ctx } = await lab({ ...LEGACY });
    expect(world.company.channels).toBeUndefined();
    await allocationMorning(ctx);
    expect(rituals(world)).toHaveLength(0);
  });
});

describe('what stays TikTok, what reads the reference channel (channels §5.3)', () => {
  it('a price is read on the channel that brought the most visitors, TikTok alone reads all its rows', async () => {
    const { world } = await lab();
    world.day = 20;
    const p = guide(world, 'prd_a');
    const a = campaign(world, 'cmp_a', p, 'tiktok', 40);
    const b = campaign(world, 'cmp_b', p, 'meta', 40);
    world.market.adStats.push(row(a, 18, 50, 50, { landingViews: 300, purchases: 3 }));
    expect(referenceChannel(world, p.id)).toBe('tiktok');
    expect(priceTiers(world, p).map((t) => t.views)).toEqual([300]);
    world.market.adStats.push(row(b, 19, 50, 500, { landingViews: 400, purchases: 30 }));
    expect(referenceChannel(world, p.id)).toBe('meta');
    expect(priceTiers(world, p).map((t) => [t.views, t.revenue])).toEqual([[400, 500]]);
    expect(paidConversion(world, p.id, 1)).toEqual({ landingViews: 400, purchases: 30 });
    world.market.events.push({ id: 'evt_x', day: 18, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger', refs: { day: 19 } });
    expect(paidConversion(world, p.id, 1).landingViews).toBe(0);
    world.market.adStats.length = 0;
    expect(referenceChannel(world, p.id)).toBe('tiktok');
  });

  it('a hook test needs a TikTok campaign: another channel teaches nothing about hooks', async () => {
    const { world, ctx } = await lab();
    const p = guide(world, 'prd_a');
    world.company.bandits[`hook_style:${p.nicheId}`] = [{ key: 'pov', alpha: 2, beta: 1, pulls: 3, reward: 2 }, { key: 'question', alpha: 1, beta: 2, pulls: 3, reward: 1 }];
    const meta = campaign(world, 'cmp_b', p, 'meta', 20);
    expect(experimentCandidate(ctx)).toBeNull();
    campaign(world, 'cmp_a', p, 'tiktok', 20);
    expect(experimentCandidate(ctx)?.dimension).toBe('hook_style');
    // the creatives of the test go on the TikTok campaign, whichever runs first
    const ordered = orderVariantCreatives(ctx, { id: 'exp_1', day: 1, owner: 'x', hypothesis: 'h', dimension: 'hook_style', variants: ['question'], metric: 'ctr', status: 'running', results: {}, winner: null, endDay: null, nicheId: p.nicheId, productId: p.id });
    expect(ordered).toBe(1);
    const task = world.company.tasks.find((t) => t.kind === 'write_ad_hooks');
    expect(task?.input.attachTo).toBe('cmp_a');
    expect(task?.input.attachTo).not.toBe(meta.id);
  });

  it('the daily report gives the three readings per channel, only on a day with 2 channels', async () => {
    const { world, ctx } = await lab();
    world.day = 5;
    const read = async () => {
      await run(ctx, 'daily_report', { day: 4 });
      return (await ctx.brain.read('journal/jour-004.md'))?.body ?? '';
    };
    const kpi = { day: 4, sales: 2, revenue: 40, adSpend: 20, roas: 2, ctr: 0.02, cvr: 0.02, cac: 10, cumulativeProfit: 0, cash: 100, openTickets: 0 };
    world.company.kpis.push(kpi as never);
    expect(await read()).not.toContain('Par canal');
    Object.assign(kpi, { channels: { meta: { spend: 10, impressions: 1, clicks: 1, landingViews: 1, shopSales: 1, shopRevenue: 13, claimedSales: 2, claimedRevenue: 24, reconciledRevenue: 16, roas: 1.6 } } });
    const body = await read();
    expect(body).toContain('Par canal');
    expect(body).toContain(`| ${CHANNELS.meta.label} | 10 € | 2,40 | 1,30 | 1,60 |`);
  });
});

describe('a run reloaded at every tick', () => {
  async function arm(reloadEvery: number, ticks: number) {
    const l = await lab({ startingCash: 3000 });
    const p = guide(l.world, 'prd_a');
    const book = l.world.company.channels!;
    book.open = ['tiktok', 'meta', 'google'];
    campaign(l.world, 'cmp_t', p, 'tiktok', 30);
    campaign(l.world, 'cmp_m', p, 'meta', 25);
    campaign(l.world, 'cmp_g', p, 'google', 15);
    let { world, company } = l;
    const overspent: string[] = []; // the buyers have moved by the time the market opens
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (world.tick === 10) {
        const committed = committedAdBudget(world);
        const { adCap } = currentBudget(world);
        if (committed > adCap + 0.01) overspent.push(`jour ${world.day} : ${committed} pour ${adCap}`);
      }
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = l.reopen(world);
      }
    }
    return { world, overspent };
  }

  /** Everything the run decided: only the wall clock, and what it stamps in a PDF, may differ. */
  const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  it('with 3 channels open ends like an uninterrupted run', async () => {
    const ticks = 30 * 12;
    const { world: straight, overspent } = await arm(0, ticks);
    const { world: reloaded } = await arm(7, ticks); // 7 and 12 share no divisor: reloads fall on every tick of the day
    expect(overspent).toEqual([]);
    const channels = new Set(straight.market.adStats.map((s) => channelOf(s)));
    expect(channels.size).toBeGreaterThanOrEqual(3);
    const rituals = straight.company.tasks.filter((t) => t.kind === 'allocate_channels' && t.status === 'done');
    expect(rituals.length).toBeGreaterThanOrEqual(5);
    expect(rituals.some((t) => (t.output?.moved as number) > 0)).toBe(true);
    expect(straight.company.channels!.plan?.lines.length).toBeGreaterThanOrEqual(2);
    expect(decisions(reloaded) === decisions(straight)).toBe(true);
  });
});
