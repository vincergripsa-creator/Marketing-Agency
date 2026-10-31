/**
 * What the company learns once it buys on several channels (channels §5.3, §6, §7.7): a founder's stop on one channel
 * holds that channel only, a hook is judged where CTRs compare, a price where its visitors are, the retro speaks of
 * channels in rules the runtime reads, and every creative goes through the same review.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrainVault, ContentEngine, LessonDraft, MindContext, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { indexWorld, referenceChannels } from '../src/learning/data.js';
import { computeExperimentResults } from '../src/learning/experiments.js';
import { detectLessons, LESSON_KEYS, type HeuristicDraft } from '../src/learning/heuristics.js';
import { directiveSlot, hasMachineRule } from '../src/learning/playbooks.js';
import { applyDailyRewards, runRetro } from '../src/learning/retro.js';
import { heuristicRanking } from '../src/minds/heuristic/research.js';
import { companyPaidBlock, productPaidBlock } from '../src/runtime/acquisition.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { activeHolds, adsHeldSince, adsHold } from '../src/runtime/holds.js';
import { orderAction } from '../src/runtime/missions.js';
import { directivesOf, parsePlaybook } from '../src/runtime/playbook.js';
import { closeLoop, reviewTask } from '../src/runtime/review.js';
import { createTask } from '../src/runtime/tasks.js';
import type { AdCreative, AgentState, AttributionReport, Campaign, ChannelBook, ChannelId, ChannelNicheState, DailyAdStats, DailyKpi, DeptId, Experiment, Order, Product, TrendSignal, WorldState } from '../src/shared.js';
import { droppedBeforeSubmission } from '../src/shared.js';
import { LEGACY } from './legacy.js';

// ───────────────────────────── a running company ─────────────────────────────

async function setup() {
  const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
  const { sim } = await import('../src/runtime/modules.js');
  const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-channel-learning-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = createWorld(defaultScenario({ ...LEGACY, channelControl: 'none', seed: 5, mindMode: 'heuristic', horizonDays: 90 }), 'test-channel-learning');
  const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 5 });
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine, brain });
  const rng = createRng(world.rngState);
  const ctx = { world, engine, brain, tools: sim.createMarketTools(world, rng), rng, channelRng: rng, ritual: async () => undefined, paths, incidents: [] as string[], lastMarketNotes: [] as string[] };
  world.company.channels!.open = ['tiktok', 'meta'];
  for (const account of ['meta', 'pinterest', 'google'] as const) world.market.channels!.accounts[account].openDay = 1;
  return { world, company, ctx, root };
}

function withCompany(run: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  return async () => {
    const s = await setup();
    try { await run(s); } finally { rmSync(s.root, { recursive: true, force: true }); }
  };
}

function addProduct(world: WorldState, id: string, nicheId: string): Product {
  const p: Product = {
    id, nicheId, title: `Guide ${id}`, subtitle: '', audience: 'Parents', problem: 'Un problème précis', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  world.company.products.push(p);
  return p;
}

function addCampaign(world: WorldState, id: string, productId: string, channel?: ChannelId): Campaign {
  const c: Campaign = { id, productId, name: `Campagne ${id}`, creativeIds: [`cre_${id}`], dailyBudget: 20, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'adam', ...(channel ? { channel } : {}) };
  world.company.campaigns.push(c);
  return c;
}

const missionOf = (world: WorldState, id: string) => world.company.missions.find((m) => m.id === id)!;
const agentOf = (world: WorldState, id: string) => world.company.agents.find((a) => a.id === id)!;
const mindOf = (a: AgentState): MindContext => ({ agent: a, playbook: [], brainNotes: [], lessons: [], day: 1 });

// ───────────────────────────── a hand-built evening ─────────────────────────────

function person(id: string, dept: DeptId, role: string, isChief = false, hatDepts: DeptId[] = []): AgentState {
  return {
    id, name: id[0]!.toUpperCase() + id.slice(1), role, dept, isChief, tier: 'haiku', persona: 'Travaille avec méthode.', skills: [], tools: [], taskKinds: [],
    avatar: { skin: '#f1c27d', hair: '#222', shirt: '#36c', pants: '#333', hairStyle: 0, accessory: 'none' },
    status: 'idle', place: dept, currentTaskId: null, energy: 100, level: 1, xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 }, bubble: null,
    roleId: 'ghostwriter', gender: 'f', founder: false, hatKinds: [], hatDepts, hiredDay: 0, rampUntilDay: 0, notice: null,
  };
}

function creative(id: string, hookStyle: AdCreative['hookStyle'], over: Partial<AdCreative> = {}): AdCreative {
  return {
    id, productId: 'prd_1', hook: `Hook ${id}`, hookStyle, format: 'text_slideshow', scenes: [], caption: '', hashtags: [], cta: '',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'sarah', ...over,
  };
}

function row(day: number, creativeId: string, spend: number, revenue: number, over: Partial<DailyAdStats> = {}): DailyAdStats {
  const impressions = over.impressions ?? 6000;
  const clicks = over.clicks ?? 60;
  return { day, campaignId: 'cmp_1', creativeId, productId: 'prd_1', spend, impressions, clicks, ctr: clicks / impressions, cpc: spend / clicks, cpm: (spend / impressions) * 1000, landingViews: 50, purchases: Math.round(revenue / 19), revenue, roas: revenue / spend, frequency: 1.2, comments: [], ...over };
}

function order(id: string, day: number, over: Partial<Order> = {}): Order {
  return { id, day, customerId: `cus_${id}`, productId: 'prd_1', price: 19, source: 'ads', campaignId: 'cmp_1', creatorId: null, refunded: false, chargeback: false, ...over };
}

const NICHE = 'Sommeil de bébé';

function lessonsWorld(book: Partial<ChannelBook> = { open: ['tiktok', 'meta'] }): WorldState {
  const product: Product = {
    id: 'prd_1', nicheId: 'sommeil', title: 'Faire dormir bébé', subtitle: '', audience: 'Parents', problem: 'Réveils nocturnes', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price: 19 }],
  };
  return {
    version: 2, runId: 'test', createdAt: '2026-10-30T00:00:00.000Z',
    scenario: { name: 'test', companyName: 'Pixel Agency', seed: 1, startingCash: 500, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic', founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 }, channelControl: 'none' },
    day: 10, tick: 11, phase: 'evening', rngState: 1, idCounter: 100,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: 'Pixel Agency',
      agents: [person('nora', 'rh', 'DRH', true), person('leo', 'growth', 'Head of growth', true), person('sarah', 'growth', 'Scénariste de hooks'), person('raphael', 'analyse', 'Data analyst', true), person('gabriel', 'finance', 'CFO', true, ['analyse']), person('camille', 'direction', 'CEO', true)],
      departments: [], tasks: [], missions: [], products: [product], creatives: [creative('crt_1', 'story'), creative('crt_2', 'stat')], campaigns: [], deliverables: [],
      research: { trends: [{ nicheId: 'sommeil', name: NICHE, audience: 'Parents', category: 'parentalité', searchInterest: 80, tiktokBuzz: 70, competitionHint: 'moyenne', sampleTitles: [] }], voc: {}, competitors: {}, shortlist: [] },
      lessons: [], experiments: [], bandits: {}, playbooks: {}, kpis: [], chats: {}, pendingApprovals: [],
      channels: { open: ['tiktok'], requested: {}, lines: [], plan: null, attribution: null, ...book },
    },
    market: {
      niches: [], customers: [], orders: [], inbox: [], adStats: [], organicPosts: [], creators: [], partnerships: [], events: [],
      modifiers: { cpmMultiplier: 1, cpmUntilDay: 0, paymentHoldUntilDay: 0, outageDay: 0 },
      adAccount: { strikes: 0, banned: false, bannedUntilDay: 0 }, creativeImpressions: {},
    },
    ledger: [], activity: [],
  } as unknown as WorldState;
}

const KPI = { day: 10, avgReplyScore: 0, openTickets: 0 } as DailyKpi;
const lessonsOf = (world: WorldState, concluded: Experiment[] = []): HeuristicDraft[] => detectLessons({ world, day: world.day, kpi: KPI, ix: indexWorld(world), notes: [], concluded });

const engineEcho = {
  mode: 'heuristic',
  extractLessons: async (input: { heuristicLessons: LessonDraft[] }) => input.heuristicLessons,
  dailyMemo: async () => 'Mémo du jour.',
} as unknown as ContentEngine;

async function retro(world: WorldState, run: (brain: BrainVault) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-channel-retro-'));
  const brain = createBrainVault({ root, brain: join(root, 'brain'), files: join(root, 'files') });
  await brain.init();
  try { await run(brain); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Ten days of a niche on two channels, Meta ahead. */
function metaAhead(world: WorldState, days = [3, 4, 5, 6, 7, 8]): void {
  for (const day of days) {
    world.market.adStats.push(row(day, 'crt_1', 10, 12), row(day, 'crt_2', 10, 24, { channel: 'meta' }));
  }
}

const report = (rows: AttributionReport['rows'], niches: AttributionReport['niches'] = {}, day = 9): AttributionReport => ({ day, fromDay: 1, toDay: 9, by: 'raphael', rows, niches });

// ───────────────────────────── the tests ─────────────────────────────

describe('« coupe Meta »', () => {
  it('reads a channel in his words, and only as the thing being stopped', () => {
    for (const text of ['coupe Meta', 'coupe Facebook', 'arrête Instagram', 'stoppe tout sur Pinterest', 'arrête les pubs sur YouTube', 'mets Meta en pause', 'mets en pause Pinterest', 'plus de pub sur Google', 'plus de Pinterest', 'ne dépense plus sur Meta', 'coupe TikTok']) {
      expect(orderAction(text), text).toBe('stop_ads');
    }
    for (const text of ['reprends Meta', 'relance les pubs Facebook', 'lève la pause sur Pinterest']) expect(orderAction(text), text).toBe('resume_ads');
    for (const text of ['Écris de nouveaux hooks TikTok', 'coupe les hooks trop longs sur Meta', 'Lance une pub sur Pinterest', 'coupe le prix du guide sur Facebook', 'que donne Meta ?']) expect(orderAction(text), text).toBe(null);
  });

  it('holds Meta only: its campaigns and its work stop, TikTok runs', withCompany(async ({ world, company }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(world, 'cmp_meta', p.id, 'meta');
    const tiktok = addCampaign(world, 'cmp_tk', p.id);
    const adapt = createTask(world, { kind: 'adapt_creative', input: { productId: p.id, channel: 'meta', masterId: 'cre_1', ratio: '4:5' }, createdBy: 'leo' });
    const launch = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, nicheId: p.nicheId }, createdBy: 'leo' });
    const id = await company.giveMission('coupe Meta');
    expect(missionOf(world, id).status).toBe('done');
    expect(missionOf(world, id).outcome).toMatch(/1 campagne\(s\) en pause/);
    expect(missionOf(world, id).outcome).toMatch(/Facebook & Instagram/);
    expect(meta).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(tiktok.status).toBe('active');
    expect(adapt.status).toBe('cancelled');
    expect(launch.status).not.toBe('cancelled');
    expect(activeHolds(world).map((h) => h.channel)).toEqual(['meta']);
    // Meta is shut…
    expect(adsHold(world, p.id, 'meta')).not.toBeNull();
    expect(companyPaidBlock(world, 'meta')).toMatch(/ordre du fondateur/);
    expect(productPaidBlock(world, p, 'meta')).toMatchObject({ hard: true, final: true });
    // …TikTok is not, and neither are the channels he did not name.
    expect(adsHold(world, p.id)).toBeNull();
    expect(adsHold(world, p.id, 'pinterest')).toBeNull();
    expect(companyPaidBlock(world) ?? '').not.toMatch(/ordre du fondateur/);
    expect(productPaidBlock(world, p)).toBeNull();
    expect(adsHeldSince(world, p.id, 1)).toBe(false);
    expect(adsHeldSince(world, p.id, 1, 'meta')).toBe(true);
  }));

  it('a launch on the held channel is told so, a TikTok launch goes through the same gate untouched', withCompany(async ({ world, company, ctx }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    await company.giveMission('coupe Meta');
    const adam = agentOf(world, 'adam');
    const onMeta = createTask(world, { kind: 'launch_campaign', input: { productId: p.id, channel: 'meta' }, createdBy: 'leo' });
    const stopped = await HANDLERS.launch_campaign.run(ctx, onMeta, adam, mindOf(adam));
    expect(stopped.output).toMatchObject({ skipped: true });
    expect(stopped.summary).toMatch(/ordre du fondateur/);
    onMeta.status = 'cancelled';
    const onTiktok = createTask(world, { kind: 'launch_campaign', input: { productId: p.id }, createdBy: 'leo' });
    expect((await HANDLERS.launch_campaign.run(ctx, onTiktok, adam, mindOf(adam))).summary).not.toMatch(/ordre du fondateur/);
  }));

  it('« reprends Meta » lifts it, resumes Meta and leaves the rest alone', withCompany(async ({ world, company }) => {
    world.day = 15;
    world.ledger.push({ id: 'led_cash', day: 1, type: 'revenue', amount: 5000, memo: 'test', ref: null });
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(world, 'cmp_meta', p.id, 'meta');
    const pin = addCampaign(world, 'cmp_pin', p.id, 'pinterest');
    await company.giveMission('coupe Meta et Pinterest');
    expect(activeHolds(world).map((h) => h.channel).sort()).toEqual(['meta', 'pinterest']);
    expect([meta.status, pin.status]).toEqual(['paused', 'paused']);
    const id = await company.giveMission('reprends Meta');
    expect(missionOf(world, id).status).toBe('done');
    expect(meta.status).toBe('active');
    expect(pin).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(activeHolds(world).map((h) => h.channel)).toEqual(['pinterest']);
  }));

  it('« coupe tout sauf TikTok » keeps what he kept', withCompany(async ({ world, company }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(world, 'cmp_meta', p.id, 'meta');
    const tiktok = addCampaign(world, 'cmp_tk', p.id);
    await company.giveMission('coupe tout sauf TikTok');
    expect(meta.status).toBe('paused');
    expect(tiktok.status).toBe('active');
    expect(adsHold(world)).toBeNull();
    expect(adsHold(world, null, 'meta')).not.toBeNull();
  }));

  it('« garde TikTok » next to a stop keeps a channel, it protects nobody', withCompany(async ({ world, company }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(world, 'cmp_meta', p.id, 'meta');
    const tiktok = addCampaign(world, 'cmp_tk', p.id);
    const id = await company.giveMission('coupe Meta mais garde TikTok');
    expect(missionOf(world, id).status).toBe('done');
    expect(meta.status).toBe('paused');
    expect(tiktok.status).toBe('active');
  }));

  it('« reprends Meta » does not undo an order on every channel, and says so', withCompany(async ({ world, company }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const meta = addCampaign(world, 'cmp_meta', p.id, 'meta');
    await company.giveMission('coupe toutes les pubs');
    const id = await company.giveMission('reprends Meta');
    expect(missionOf(world, id).status).toBe('failed');
    expect(missionOf(world, id).outcome).toMatch(/reprends les pubs/);
    expect(meta).toMatchObject({ status: 'paused', pausedFor: 'founder' });
    expect(adsHold(world, p.id, 'meta')).not.toBeNull();
  }));

  it('a global stop still stops every channel', withCompany(async ({ world, company }) => {
    world.day = 15;
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    addCampaign(world, 'cmp_meta', p.id, 'meta');
    await company.giveMission('coupe toutes les pubs');
    for (const ch of ['tiktok', 'meta', 'pinterest'] as const) expect(adsHold(world, p.id, ch), ch).not.toBeNull();
  }));
});

describe('where a number can be read', () => {
  it('the hook bandit reads TikTok rows only: a Meta CTR says nothing of a hook', () => {
    const reward = (withMeta: boolean) => {
      const world = lessonsWorld();
      world.day = 2;
      world.market.adStats.push(row(2, 'crt_1', 10, 19, { impressions: 2000, clicks: 40 }));
      if (withMeta) world.market.adStats.push(row(2, 'crt_1', 10, 19, { impressions: 2000, clicks: 600, channel: 'meta' }), row(2, 'crt_2', 10, 19, { impressions: 2000, clicks: 600, channel: 'meta' }));
      applyDailyRewards(world, 2);
      return world.company.bandits;
    };
    expect(reward(true)['hook_style:sommeil']).toEqual(reward(false)['hook_style:sommeil']);
    expect(reward(true)['ad_format:sommeil']).toEqual(reward(false)['ad_format:sommeil']);
    expect(reward(true)['hook_style:sommeil']!.map((a) => a.key)).toEqual(['story']);
  });

  it('an impression elsewhere does not wear a hook out', () => {
    const arm = (seenOn: ChannelId) => {
      const world = lessonsWorld();
      world.day = 2;
      world.market.adStats.push(row(1, 'crt_1', 10, 19, { impressions: 40_000, clicks: 400, channel: seenOn }), row(2, 'crt_1', 10, 19, { impressions: 2000, clicks: 40 }));
      applyDailyRewards(world, 2);
      return world.company.bandits['hook_style:sommeil']![0]!;
    };
    expect(arm('meta').alpha + arm('meta').beta).toBeGreaterThan(arm('tiktok').alpha + arm('tiktok').beta);
  });

  it('a hook comparison and the low-CTR alarm stay on TikTok rows', () => {
    const world = lessonsWorld();
    world.market.adStats.push(row(10, 'crt_1', 10, 19, { impressions: 3000, clicks: 90 }), row(10, 'crt_2', 10, 19, { impressions: 3000, clicks: 80 }));
    // Search-sized CTRs on Meta would crown « stat » and lift the average, if they were mixed in
    world.market.adStats.push(row(10, 'crt_2', 10, 19, { impressions: 3000, clicks: 900, channel: 'meta' }));
    expect(lessonsOf(world).some((d) => d.insight.startsWith('Privilégier le hook'))).toBe(false);

    const low = lessonsWorld();
    low.market.adStats.push(row(10, 'crt_1', 10, 19, { impressions: 6000, clicks: 12 }), row(10, 'crt_2', 10, 19, { impressions: 6000, clicks: 1800, channel: 'meta' }));
    expect(lessonsOf(low).some((d) => d.key === 'pub-ctr-faible')).toBe(true);
  });

  it('an experiment on a hook counts TikTok impressions only', () => {
    const world = lessonsWorld();
    world.market.adStats.push(row(10, 'crt_1', 10, 19, { impressions: 1000, clicks: 20 }), row(10, 'crt_2', 10, 19, { impressions: 1000, clicks: 10 }), row(10, 'crt_2', 10, 19, { impressions: 9000, clicks: 900, channel: 'meta' }));
    const e = { id: 'exp_1', day: 1, owner: 'leo', hypothesis: 'h', dimension: 'hook_style', variants: ['story', 'stat'], metric: 'ctr', nicheId: 'sommeil', status: 'running', results: {}, winner: null, endDay: null } as unknown as Experiment;
    expect(computeExperimentResults(world, e)).toEqual({ story: { n: 1000, value: 0.02 }, stat: { n: 1000, value: 0.01 } });
  });

  it('a fatigue is read on one channel: the mix moving is not a creative wearing out', () => {
    const world = lessonsWorld();
    for (const day of [7, 8]) world.market.adStats.push(row(day, 'crt_1', 10, 19, { impressions: 2000, clicks: 80 }));
    for (const day of [9, 10]) world.market.adStats.push(row(day, 'crt_1', 10, 19, { impressions: 2000, clicks: 80 }), row(day, 'crt_1', 10, 19, { impressions: 8000, clicks: 40, channel: 'youtube' }));
    expect(lessonsOf(world).some((d) => d.key === 'pub-fatigue')).toBe(false);
  });

  it('a product\'s reference channel is where its visitors were in 14 days', () => {
    const world = lessonsWorld();
    world.day = 30;
    world.market.adStats.push(row(5, 'crt_1', 10, 19, { landingViews: 900 }));                 // too old
    world.market.adStats.push(row(28, 'crt_1', 10, 19, { landingViews: 40 }), row(28, 'crt_2', 10, 19, { landingViews: 60, channel: 'meta' }));
    expect(referenceChannels(world, 30).get('prd_1')).toBe('meta');
    expect(referenceChannels(world, 30).get('prd_other')).toBeUndefined();
    world.market.adStats.push(row(29, 'crt_1', 10, 19, { landingViews: 30 }));
    expect(referenceChannels(world, 30).has('prd_1')).toBe(false); // TikTok, as everywhere: absent
  });

  it('price rewards read the reference channel, so a mix shift is not a price effect', () => {
    const arm = (metaViews: number) => {
      const world = lessonsWorld();
      world.day = 2;
      world.market.adStats.push(row(2, 'crt_1', 10, 57, { landingViews: 100 }), row(2, 'crt_2', 10, 0, { landingViews: metaViews, channel: 'meta' }));
      applyDailyRewards(world, 2);
      return world.company.bandits['price:sommeil']![0]!;
    };
    // TikTok stays the reference: its 0,57 €/visitor is read whatever Meta adds at the bottom of the funnel
    expect(arm(50).alpha).toBeCloseTo(1 + (0.57 / 1.5) * 2, 4);
    expect(arm(90).alpha).toBeCloseTo(arm(50).alpha, 6);
    // Meta becomes the reference: its own rows are the reading
    expect(arm(200).alpha).toBeLessThan(arm(50).alpha);
  });

  it('a refund on another channel is not charged to the reference channel\'s price', () => {
    const arm = (channel?: ChannelId) => {
      const world = lessonsWorld();
      world.day = 2;
      world.market.adStats.push(row(2, 'crt_1', 10, 57, { landingViews: 100 }), row(2, 'crt_2', 10, 0, { landingViews: 10, channel: 'meta' }));
      world.market.orders.push(order('ord_1', 2, { refunded: true, refundedDay: 2, price: 19, ...(channel ? { channel } : {}) }));
      applyDailyRewards(world, 2);
      return world.company.bandits['price:sommeil']![0]!;
    };
    expect(arm('tiktok').alpha).toBeLessThan(arm('meta').alpha);
  });

  it('the niche arm still reads every channel: a niche earns what it earns', () => {
    const world = lessonsWorld();
    world.day = 2;
    world.market.adStats.push(row(2, 'crt_1', 10, 0, { landingViews: 100 }), row(2, 'crt_2', 10, 57, { landingViews: 10, channel: 'meta' }));
    applyDailyRewards(world, 2);
    expect(world.company.bandits.niche![0]!.reward).toBeCloseTo(57 / 20 / 3, 3);
  });

  it('a price experiment follows the reference channel, an order of another channel stays out', () => {
    const world = lessonsWorld();
    world.market.adStats.push(row(10, 'crt_1', 10, 19, { landingViews: 50, channel: 'meta' }), row(10, 'crt_1', 10, 95, { landingViews: 10 }));
    world.market.orders.push(order('ord_1', 10, { refunded: true, channel: 'tiktok' }));
    const e = { id: 'exp_1', day: 1, owner: 'paul', hypothesis: 'h', dimension: 'price', variants: ['19', '29'], metric: 'conversion', nicheId: 'sommeil', status: 'running', results: {}, winner: null, endDay: null } as unknown as Experiment;
    expect(computeExperimentResults(world, e)['19']).toEqual({ n: 50, value: 0.38 });
  });
});

describe('lessons of the channels', () => {
  const canal = (world: WorldState) => lessonsOf(world).find((d) => d.key === LESSON_KEYS.channel('sommeil'));

  it('a lesson « Privilégier le canal » on the reconciled numbers', () => {
    const world = lessonsWorld();
    metaAhead(world);
    expect(canal(world)?.insight).toBe(`Privilégier le canal « meta » sur « ${NICHE} » : ROAS réconcilié 2,40 contre 1,20 sur TikTok.`);
    expect(canal(world)?.topic).toBe('ads');
    expect(canal(world)?.tags).toEqual(['canal', 'meta']);
    expect(canal(world)?.evidence).toMatch(/60,00\s€ dépensés/);
  });

  it('reads the credit: what Meta only claims does not win, a stale report counts as 1', () => {
    const world = lessonsWorld();
    metaAhead(world);
    world.company.channels!.attribution = report([], { sommeil: { meta: 0.5, tiktok: 1 } });
    expect(canal(world)).toBeUndefined();
    world.company.channels!.attribution = report([], { sommeil: { meta: 0.5, tiktok: 1 } }, 2);
    expect(canal(world)?.insight).toMatch(/canal « meta »/);
    // the niche's credit wins over the channel's, which stands in when the niche had too few sales
    world.company.channels!.attribution = report([{ channel: 'meta', spend: 60, shopRevenue: 144, claimedRevenue: 200, reconciledRevenue: 72, credit: 0.5, inflation: 1.4 }]);
    expect(canal(world)).toBeUndefined();
  });

  it('says nothing on one channel, on a thin spend or on a small lead', () => {
    const one = lessonsWorld({ open: ['tiktok'] });
    metaAhead(one);
    expect(canal(one)).toBeUndefined();
    const thin = lessonsWorld();
    metaAhead(thin, [7, 8]);
    expect(canal(thin)).toBeUndefined();
    const close = lessonsWorld();
    for (const day of [3, 4, 5, 6]) close.market.adStats.push(row(day, 'crt_1', 10, 14), row(day, 'crt_2', 10, 15, { channel: 'meta' }));
    expect(canal(close)).toBeUndefined();
    const losing = lessonsWorld();
    for (const day of [3, 4, 5, 6]) losing.market.adStats.push(row(day, 'crt_1', 10, 2), row(day, 'crt_2', 10, 9, { channel: 'meta' }));
    expect(canal(losing)).toBeUndefined();
  });

  it('no lesson puts forward a channel the company has cut there', () => {
    const line: ChannelNicheState = { channel: 'meta', nicheId: 'sommeil', status: 'blocked', since: 1, spend: 0, revenue: 0, reason: 'refusé', retestDay: null };
    const world = lessonsWorld({ open: ['tiktok', 'meta'], lines: [line] });
    metaAhead(world);
    expect(canal(world)).toBeUndefined();
  });

  it('the directive reaches the playbooks and the runtime reads it, for its niche', async () => {
    const world = lessonsWorld();
    metaAhead(world);
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      const rule = world.company.playbooks.leo!.find((r) => r.startsWith('Privilégier le canal'))!;
      expect(rule).toBeDefined();
      expect(hasMachineRule(rule)).toBe(true);
      expect(directivesOf(world, 'leo', NICHE).channel).toBe('meta');
      expect(directivesOf(world, 'leo', 'Propreté du chiot').channel).toBeNull();
    });
  });

  it('one value per niche: a new leader revises the lesson, and the slot holds it', async () => {
    expect(directiveSlot('Privilégier le canal « meta » sur « A » : x')).toBe(directiveSlot('Privilégier le canal « pinterest » sur « a » : y'));
    expect(directiveSlot('Privilégier le canal « meta » sur « A »')).not.toBe(directiveSlot('Privilégier le canal « meta » sur « B »'));
    expect(directiveSlot('Privilégier le canal « meta » sur « A »')).not.toBe(directiveSlot('Privilégier le format « carousel » sur « A »'));
    const world = lessonsWorld({ open: ['tiktok', 'meta', 'pinterest'] });
    metaAhead(world);
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      world.market.adStats.length = 0;
      world.day = 11;
      for (const day of [8, 9, 10, 11]) world.market.adStats.push(row(day, 'crt_1', 10, 12), row(day, 'crt_2', 10, 30, { channel: 'pinterest' }));
      await runRetro(world, engineEcho, brain, []);
      const rules = world.company.playbooks.leo!.filter((r) => r.startsWith('Privilégier le canal'));
      expect(rules).toHaveLength(1);
      expect(parsePlaybook(rules, NICHE).channel).toBe('pinterest');
      expect(world.company.lessons.filter((l) => l.key === LESSON_KEYS.channel('sommeil'))).toHaveLength(1);
    });
  });

  it('a directive that names no channel does not become one', () => {
    expect(parsePlaybook(['Privilégier le canal « fax » sur « A »']).channel).toBeNull();
    expect(parsePlaybook(['Privilégier le canal « google »']).channel).toBe('google');
  });

  it('a line kill says « Couper », and takes the place of the lesson that put that channel forward', async () => {
    const killed: ChannelNicheState = { channel: 'pinterest', nicheId: 'sommeil', status: 'killed', since: 1, spend: 90, revenue: 200, reason: 'ROAS réconcilié 0,50\u00a0pour 90\u00a0€', retestDay: 24 };
    const world = lessonsWorld({ open: ['tiktok', 'pinterest'], lines: [killed] });
    const cut = lessonsOf(world).find((d) => d.key === LESSON_KEYS.channelCut('pinterest', 'sommeil'));
    expect(cut?.insight).toBe(`Couper « pinterest » sur « ${NICHE} » : ROAS réconcilié 0,50 pour 90 €.`); // the verdict as given, whatever the credit did to the line since
    expect(cut?.tags).toContain('pinterest');
    expect(cut?.evidence).toMatch(/jour 24/);
    world.company.lessons.push({ key: LESSON_KEYS.channel('sommeil'), id: 'les_1', day: 5, topic: 'ads', insight: `Privilégier le canal « pinterest » sur « ${NICHE} » : ROAS réconcilié 2,00 contre 1,00 sur TikTok.`, evidence: 'e', confidence: 0.6, source: 'nora', appliesTo: ['leo'], notePath: 'lecons/x.md' });
    world.company.playbooks.leo = [world.company.lessons[0]!.insight];
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      expect(world.company.playbooks.leo!.filter((r) => r.includes('« pinterest »'))).toEqual([cut!.insight]);
    });
  });

  it('what a platform claims is a lesson for the analyst, on a fresh report', async () => {
    const line = { channel: 'meta' as const, spend: 100, shopRevenue: 120, claimedRevenue: 216, reconciledRevenue: 150, credit: 1.25, inflation: 1.8 };
    const world = lessonsWorld();
    world.company.channels!.attribution = report([line]);
    const lesson = lessonsOf(world).find((d) => d.key === LESSON_KEYS.channelClaim('meta'));
    expect(lesson?.insight).toMatch(/^Facebook & Instagram s'attribue 1,80 fois ce que la boutique lui donne/);
    expect(lesson?.topic).toBe('ads');
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      expect(world.company.playbooks.raphael?.some((r) => r.includes('s\'attribue'))).toBe(true);
      expect(world.company.playbooks.gabriel?.some((r) => r.includes('s\'attribue'))).toBe(true); // wears the analyst's kind
      expect((world.company.playbooks.sarah ?? []).some((r) => r.includes('s\'attribue'))).toBe(false);
    });
    const stale = lessonsWorld();
    stale.company.channels!.attribution = report([line], {}, 2);
    expect(lessonsOf(stale).some((d) => d.key === LESSON_KEYS.channelClaim('meta'))).toBe(false);
    const honest = lessonsWorld();
    honest.company.channels!.attribution = report([{ ...line, inflation: 1.1 }]);
    expect(lessonsOf(honest).some((d) => d.key === LESSON_KEYS.channelClaim('meta'))).toBe(false);
  });

  it('a refusal teaches the word, with the channel that refused it, and the banned list carries it', async () => {
    const world = lessonsWorld();
    world.company.creatives[0]!.channelReviews = { meta: { status: 'rejected', reason: 'Refusée par Facebook & Instagram : image du corps (« ventre »).', day: 10, rule: 'meta.image_du_corps' } };
    world.company.creatives[1]!.channelReviews = { pinterest: { status: 'rejected', reason: 'Pinterest refuse ce format : il faut une image 2:3.', day: 10 } };
    const lesson = lessonsOf(world).find((d) => d.tags.includes('conformite'));
    expect(lesson?.insight).toMatch(/^Sur Facebook & Instagram, ne jamais écrire « ventre »/);
    expect(lesson?.tags).toEqual(['conformite', 'meta', 'refus']);
    expect(lessonsOf(world).filter((d) => d.tags.includes('refus'))).toHaveLength(1);
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      expect(directivesOf(world, 'sarah').banned).toContain('ventre');
      expect(world.company.playbooks.sarah!.filter((r) => r.includes('ventre')).every(hasMachineRule)).toBe(true);
    });
  });

  it('a drop by our own review teaches no word: no platform saw that ad, and its note quotes what the ad should have said', async () => {
    const world = lessonsWorld();
    const reason = 'Retirée avant soumission : Pas d\'appel à l\'action dans les descriptions (« télécharge le guide »).';
    world.company.creatives[0]!.channelReviews = { google: { status: 'rejected', reason, day: 10 } };
    world.company.creatives[1]!.review = { status: 'rejected', reason: 'Retirée avant soumission : Pas d\'appel à l\'action à la fin (« lien en bio », « télécharge le guide »).', day: 10 };
    const drafts = lessonsOf(world);
    expect(drafts.filter((d) => /ne jamais écrire/i.test(d.insight))).toEqual([]);
    expect(drafts.filter((d) => d.key.startsWith('pub-mot-interdit'))).toEqual([]);
    expect(drafts.filter((d) => d.key.startsWith('pub-refus-'))).toHaveLength(1); // TikTok's still says to reread before sending, as it always did
    await retro(world, async (brain) => {
      await runRetro(world, engineEcho, brain, []);
      for (const id of ['sarah', 'leo']) expect(directivesOf(world, id).banned).toEqual([]);
    });
  });
});

describe('the review gate', () => {
  const adapted = (world: WorldState, p: Product, over: Partial<AdCreative> = {}): AdCreative => {
    const c: AdCreative = { ...creative('cre_cut', 'story', { productId: p.id, hook: 'Votre bébé se réveille toutes les 2 heures ?', format: 'static_image', review: { status: 'pending', reason: null, day: null } }), ...over };
    world.company.creatives.push(c);
    return c;
  };

  it('an adapted creative goes through the same review, in the words of its channel', withCompany(async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = adapted(world, p);
    const leo = agentOf(world, 'leo');
    leo && (world.company.playbooks.leo = ['Ne jamais écrire « bébé »']);
    const task = createTask(world, { kind: 'adapt_creative', input: { productId: p.id, channel: 'meta', masterId: 'cre_1', ratio: '4:5' }, createdBy: 'leo' });
    task.output = { creativeId: c.id };
    const res = await reviewTask(ctx, task, leo);
    expect(res.verdict).toBe('changes');
    expect(res.noWaiver).toBe(true);
    expect(res.notes[0]).toMatch(/Facebook & Instagram/);
    expect(res.notes[0]).not.toMatch(/TikTok/);
    expect(c.quality).not.toBeNull();
  }));

  it('a search ad is read to its last title', withCompany(async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = adapted(world, p, {
      format: 'search_text', ratio: 'text', hook: 'Guide du sommeil de bébé', caption: 'Des nuits plus calmes.', scenes: [], hashtags: ['sommeil bébé'],
      search: { headlines: ['Guide du sommeil de bébé', 'Le plan des nuits', 'Résultat garanti'], descriptions: ['Des nuits plus calmes.', 'Une méthode douce.'], keywords: ['sommeil bébé'] },
    });
    const task = createTask(world, { kind: 'write_search_ads', input: { productId: p.id, channel: 'google' }, createdBy: 'leo' });
    task.output = { creativeId: c.id };
    world.company.playbooks.leo = ['Ne jamais écrire « garanti »'];
    const res = await reviewTask(ctx, task, agentOf(world, 'leo'));
    expect(res.notes[0]).toMatch(/Google Search/);
    expect(res.notes[0]).toMatch(/garanti/);
    expect(res.noWaiver).toBe(true);
  }));

  it('what cannot ship is dropped before that platform, TikTok\'s verdict untouched', withCompany(async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = adapted(world, p, { review: { status: 'approved', reason: null, day: 1 } });
    const task = createTask(world, { kind: 'adapt_creative', input: { productId: p.id, channel: 'pinterest', masterId: 'cre_1', ratio: '2:3' }, createdBy: 'leo' });
    task.output = { creativeId: c.id };
    const res = await closeLoop(ctx, task, { verdict: 'changes', notes: ['Mots interdits.'], score: 40, noWaiver: true });
    expect(res.verdict).toBe('approve');
    expect(task.output).toMatchObject({ dropped: true });
    expect(c.channelReviews?.pinterest).toMatchObject({ status: 'rejected' });
    expect(droppedBeforeSubmission(c.channelReviews!.pinterest!)).toBe(true);
    expect(c.review.status).toBe('approved');
    expect(ctx.incidents.join(' ')).toMatch(/Pinterest/);
  }));

  it('a TikTok ad keeps its words and its verdict field', withCompany(async ({ world, ctx }) => {
    const p = addProduct(world, 'prd_a', 'sommeil-bebe');
    const c = adapted(world, p, { format: 'text_slideshow' });
    const task = createTask(world, { kind: 'produce_ad', input: { productId: p.id }, createdBy: 'leo' });
    task.output = { creativeId: c.id };
    world.company.playbooks.leo = ['Ne jamais écrire « bébé »'];
    expect((await reviewTask(ctx, task, agentOf(world, 'leo'))).notes[0]).toBe('Mots interdits par TikTok ou par notre playbook : bébé.');
    await closeLoop(ctx, task, { verdict: 'changes', notes: ['x'], score: 40, noWaiver: true });
    expect(c.review.status).toBe('rejected');
    expect(droppedBeforeSubmission(c.review)).toBe(true);
    expect(c.channelReviews).toBeUndefined();
    expect(ctx.incidents.join(' ')).toMatch(/elle n'ira pas chez TikTok/);
  }));
});

describe('the niche choice', () => {
  const signal = (nicheId: string, tiktokBuzz: number, bestChannelBuzz?: number): TrendSignal => ({ nicheId, name: nicheId, audience: 'Parents', category: 'maison', searchInterest: 50, tiktokBuzz, competitionHint: 'moyenne', sampleTitles: [], ...(bestChannelBuzz === undefined ? {} : { bestChannelBuzz }) });
  const rank = (signals: TrendSignal[]) => heuristicRanking({ signals, competitors: {}, voc: {}, excludeNicheIds: [] }, null).ranked;

  it('a niche bad on TikTok and great on Pinterest gets picked once Pinterest is open', () => {
    expect(rank([signal('tiktok-star', 70), signal('pinterest-star', 30)])[0]!.nicheId).toBe('tiktok-star');
    expect(rank([signal('tiktok-star', 70, 70), signal('pinterest-star', 30, 95)])[0]!.nicheId).toBe('pinterest-star');
  });

  it('says what it read: the buzz of TikTok alone, or the best audience', () => {
    expect(rank([signal('a', 70)])[0]!.why).toMatch(/^Buzz TikTok 70\/100/);
    expect(rank([signal('a', 30, 95)])[0]!.why).toMatch(/^Meilleure audience 95\/100/);
  });

  it('the pick reads the best open channel, the book of trends keeps what the scan saw', withCompany(async ({ world, ctx }) => {
    const seen: TrendSignal[][] = [];
    const engine = { rankOpportunities: async (input: { signals: TrendSignal[] }) => { seen.push(input.signals); return { ranked: [] }; } } as unknown as ContentEngine;
    const nicheId = world.market.niches[0]!.id;
    world.company.research.trends = [{ ...signal(nicheId, 10) }];
    const nadia = agentOf(world, 'nadia');
    const pick = createTask(world, { kind: 'pick_opportunity', createdBy: 'nadia' });
    await HANDLERS.pick_opportunity.run({ ...ctx, engine }, pick, nadia, mindOf(nadia));
    const open = ctx.tools.channelSignals(nicheId).filter((s) => s.channel === 'tiktok' || s.channel === 'meta').map((s) => s.audience);
    expect(seen[0]![0]!.bestChannelBuzz).toBe(Math.max(...open));
    expect(world.company.research.trends[0]!.bestChannelBuzz).toBeUndefined();

    world.company.channels!.open = ['tiktok'];
    await HANDLERS.pick_opportunity.run({ ...ctx, engine }, createTask(world, { kind: 'pick_opportunity', createdBy: 'nadia' }), nadia, mindOf(nadia));
    expect(seen[1]![0]!.bestChannelBuzz).toBeUndefined();
  }));
});

describe('TikTok alone', () => {
  it('no channel in the world: rewards and lessons are what they were', () => {
    const run = (book: boolean) => {
      const world = lessonsWorld();
      if (!book) delete world.company.channels;
      world.day = 2;
      world.market.adStats.push(row(2, 'crt_1', 10, 57, { landingViews: 100, impressions: 3000, clicks: 90 }), row(2, 'crt_2', 10, 19, { landingViews: 40, impressions: 3000, clicks: 30 }));
      world.market.orders.push(order('ord_1', 2, { refunded: true, refundedDay: 2 }));
      applyDailyRewards(world, 2);
      return { bandits: world.company.bandits, lessons: lessonsOf(world).map((d) => d.insight) };
    };
    expect(run(true)).toEqual(run(false));
  });
});
