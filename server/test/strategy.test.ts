/** The CEO's capital allocation, the quality gates and the learning loop, on observable data only. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatorProfile, InboxMessage, Lesson, Order, Product, Task } from '../src/shared.js';
import type { BrainVault, ContentEngine, MindContext, RedTeamVerdict, RunPaths } from '../src/contracts.js';
import { LEGACY } from './legacy.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

async function modules() {
  const runtime = await import('../src/runtime/index.js');
  const { sim, learning } = await import('../src/runtime/modules.js');
  const { createRng } = await import('../src/core/index.js');
  const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
  const vault = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
  return { ...runtime, sim, learning, createRng, minds, vault };
}

async function setup(seed = 21) {
  const m = await modules();
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-strategy-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = m.createWorld(m.defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic' }), 'test-strategy');
  const engine = m.minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const brain = m.vault.createBrainVault(paths);
  await brain.init();
  const rng = m.createRng(world.rngState);
  const ctx = { world, engine, brain, tools: m.sim.createMarketTools(world, rng), rng, channelRng: rng, ritual: async () => undefined, paths, incidents: [] as string[], lastMarketNotes: [] as string[] };
  return { ...m, world, engine, brain, ctx, root, paths, rng };
}

type Env = Awaited<ReturnType<typeof setup>>;
type World = Env['world'];

const clean = (root: string) => rmSync(root, { recursive: true, force: true });

function mind(world: World, agentId: string): MindContext {
  return { agent: world.company.agents.find((a) => a.id === agentId)!, playbook: [...(world.company.playbooks[agentId] ?? [])], brainNotes: [], lessons: [], day: world.day, brand: 'Pixel' };
}

function addProduct(world: World, id: string, over: Partial<Product> = {}): Product {
  const nicheId = over.nicheId ?? world.market.niches[0]!.id;
  const p: Product = {
    id, nicheId, title: `Guide ${id}`, subtitle: '', audience: 'parents de bébés', problem: 'les nuits hachées', price: 19, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 2, launchedDay: 3, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 3, price: 19 }], ...over,
  };
  world.company.products.push(p);
  return p;
}

/** Books an entry on a past day: recordLedger stamps the current day. */
function bookOn(world: World, day: number, book: () => void): void {
  const today = world.day;
  world.day = day;
  book();
  world.day = today;
}

function addOrders(world: World, sim: Env['sim'], p: Product, day: number, n: number, refunded = 0): void {
  for (let i = 0; i < n; i++) {
    world.market.orders.push({ id: `ord_${p.id}_${day}_${i}`, day, customerId: `cus_${i}`, productId: p.id, price: p.price, source: 'ads', campaignId: null, creatorId: null, refunded: i < refunded, chargeback: false, charges: 1, downloads: 1 });
  }
  bookOn(world, day, () => sim.recordLedger(world, { type: 'revenue', amount: n * p.price, memo: 'Ventes (fixture)', ref: p.id }));
}

/** A campaign with its stats AND its ledger: the accountant reads the books. */
function addCampaign(world: World, sim: Env['sim'], p: Product, id: string, from: number, to: number, spendPerDay: number, roas: number, status: 'paused' | 'active' = 'paused'): void {
  world.company.campaigns.push({ id, productId: p.id, name: `Campagne ${id}`, creativeIds: [`cre_${id}`], dailyBudget: spendPerDay, status, targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: from, createdBy: 'adam' });
  for (let d = from; d <= to; d++) {
    world.market.adStats.push({ day: d, campaignId: id, creativeId: `cre_${id}`, productId: p.id, spend: spendPerDay, impressions: 5000, clicks: 100, ctr: 0.02, cpc: spendPerDay / 100, cpm: spendPerDay / 5, landingViews: 90, purchases: Math.round((spendPerDay * roas) / p.price), revenue: spendPerDay * roas, roas, frequency: 1.4, comments: [] });
    bookOn(world, d, () => sim.recordLedger(world, { type: 'ad_spend', amount: -spendPerDay, memo: 'Pub (fixture)', ref: id }));
  }
}

function closeDay(world: World, day: number): void {
  world.day = day;
  world.tick = 0;
  world.ledger.push({ id: `led_fixed_${day}`, day: day - 1, type: 'tool_subscription', amount: -1, memo: 'Boutique', ref: `fixed:${day - 1}` });
}

function lesson(over: Partial<Lesson>): Lesson {
  return { id: `les_${over.key}`, day: 20, topic: 'niche', insight: '', evidence: '', confidence: 0.8, source: 'nora', appliesTo: [], notePath: 'lecons/x.md', ...over };
}

// ───────────────────────────── C3 ─────────────────────────────

describe('money decides, on the current version (C3)', () => {
  /** 60 sales long ago, then two weeks of ads that do not pay back: the lifetime looks fine, the present does not. */
  async function loser(e: Env, over: Partial<Product> = {}): Promise<Product> {
    const p = addProduct(e.world, 'prd_chat', { title: 'Chat qui griffe', ...over });
    addOrders(e.world, e.sim, p, 6, 60);
    addCampaign(e.world, e.sim, p, 'cpg_a', 26, 32, 12, 0.5);
    addCampaign(e.world, e.sim, p, 'cpg_b', 33, 39, 12, 0.5);
    addOrders(e.world, e.sim, p, 30, 6);
    e.sim.recordLedger(e.world, { type: 'revenue', amount: 200, memo: 'Autre activité (fixture)', ref: null });
    closeDay(e.world, 40);
    return p;
  }

  it('a guide with many lifetime sales that loses money over 14 days and 2 campaigns gets neither budget nor posts', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const p = await loser(e);
      const loss = acq.recentLoss(e.world, p);
      expect(loss).toMatchObject({ campaigns: 2, fromDay: 26, toDay: 39 });
      expect(loss!.profit).toBeLessThan(0);
      expect(acq.promotionBlock(e.world, p)).toMatch(/perd/);
      expect(acq.productPaidBlock(e.world, p)).toMatchObject({ hard: true, final: true });
      expect(acq.acquisitionCandidates(e.world).find((c) => c.product.id === p.id)?.block?.final).toBe(true);
    } finally { clean(e.root); }
  });

  it('the CEO stops it when its buyers are happy: the market is the problem, not the text', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = await loser(e);
      const plan = await buildHeuristicPlan(e.ctx);
      expect(p.status).toBe('killed');
      expect(plan.items.some((i) => i.input.productId === p.id && ['post_organic', 'launch_campaign', 'write_ad_hooks'].includes(i.kind))).toBe(false);
      expect(e.world.activity.some((a) => /arrête « Chat qui griffe » : perd/.test(a.text))).toBe(true);
    } finally { clean(e.root); }
  });

  it('with unhappy buyers it goes to a rewrite, and gets no budget until then', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = await loser(e, { stats: { views: 0, sales: 68, revenue: 0, refunds: 0, refundAmount: 0, rating: 3.2, upsellSales: 0, reviews: [1, 2, 3, 4, 5].map((i) => ({ id: `rev_${i}`, day: 20 + i, customerId: `c${i}`, rating: 3 as const, text: 'Beaucoup de généralités.' })) } });
      const plan = await buildHeuristicPlan(e.ctx);
      expect(p.status).toBe('live');
      expect(plan.items.some((i) => i.kind === 'write_pdf' && i.input.productId === p.id && i.input.pipeline === 'v2')).toBe(true);
      expect(plan.items.some((i) => i.input.productId === p.id && ['post_organic', 'launch_campaign', 'write_ad_hooks'].includes(i.kind))).toBe(false);
    } finally { clean(e.root); }
  });

  it('a new version starts a new window, and a turnaround is left alone', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const p = await loser(e);
      const { createTask } = await import('../src/runtime/tasks.js');
      const republish = createTask(e.world, { kind: 'publish_product', input: { productId: p.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 35;
      expect(acq.recentLoss(e.world, p)).toBeNull();
      republish.status = 'cancelled';
      expect(acq.recentLoss(e.world, p)).not.toBeNull();
      e.world.market.adStats = e.world.market.adStats.filter((r) => r.day < 36); // the bad campaign stopped…
      addCampaign(e.world, e.sim, p, 'cpg_c', 36, 39, 8, 1.6); // …and a new angle pays back
      expect(acq.recentLoss(e.world, p)).toBeNull();
    } finally { clean(e.root); }
  });

  it('kill rule: the last 14 days count, lifetime sales do not save a guide nobody buys any more', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = addProduct(e.world, 'prd_old', { title: 'Vieux guide' });
      addOrders(e.world, e.sim, p, 5, 36);
      addCampaign(e.world, e.sim, p, 'cpg_old', 34, 44, 10, 0.2);
      closeDay(e.world, 45);
      await buildHeuristicPlan(e.ctx);
      expect(p.status).toBe('killed');
    } finally { clean(e.root); }
  });

  it('a guide the budget went past is not killed for lack of traction: it was never shown', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = addProduct(e.world, 'prd_shelf', { title: 'Guide oublié' });
      addOrders(e.world, e.sim, p, 8, 6);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 900, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 45);
      await buildHeuristicPlan(e.ctx);
      expect(p.status).toBe('live');
      for (let i = 0; i < 6; i++) e.world.market.organicPosts.push({ id: `org_${i}`, day: 35 + i, productId: p.id, hook: 'h', hookStyle: 'pov', format: 'carousel', views: 100, likes: 1, clicks: 1, sales: 0, viral: false });
      await buildHeuristicPlan(e.ctx);
      expect(p.status).toBe('killed'); // shown for two weeks, nobody bought
    } finally { clean(e.root); }
  });

  it('a winner leaves room in the envelope while another guide waits for its first test', async () => {
    const e = await setup();
    try {
      const { scalingRoom } = await import('../src/runtime/acquisition.js');
      const niches = e.world.market.niches;
      const winner = addProduct(e.world, 'prd_win', { nicheId: niches[0]!.id });
      addCampaign(e.world, e.sim, winner, 'cpg_win', 10, 12, 100, 2, 'active');
      expect(scalingRoom(e.world, winner, 200)).toBe(200);
      const next = addProduct(e.world, 'prd_next', { nicheId: niches[1]!.id });
      expect(scalingRoom(e.world, winner, 200)).toBe(150);
      addCampaign(e.world, e.sim, next, 'cpg_next', 12, 12, 20, 1, 'active');
      expect(scalingRoom(e.world, winner, 200)).toBe(200);
    } finally { clean(e.root); }
  });

  it('a « Couper les pubs » lesson is a hard block that not even the watchdog tests, until a new version', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_cut', { title: 'Canapé griffé' });
      addOrders(e.world, e.sim, p, 24, 6);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 28);
      e.world.company.lessons.push(lesson({ key: e.learning.LESSON_KEYS.niche(p.nicheId), day: 20, insight: `Couper les pubs de la niche « Chat » ou retravailler l'offre : ROAS de 0,40 sur 3 jours.` }));
      const cand = acq.acquisitionCandidates(e.world)[0]!;
      expect(cand.block).toMatchObject({ hard: true, final: true });
      expect(cand.block!.reason).toMatch(/Couper les pubs/);
      const plan = await buildHeuristicPlan(e.ctx);
      expect(plan.items.some((i) => i.input.productId === p.id && ['launch_campaign', 'write_ad_hooks'].includes(i.kind))).toBe(false);
      const republish = createTask(e.world, { kind: 'publish_product', input: { productId: p.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 22;
      expect(acq.acquisitionCandidates(e.world)[0]!.block).toBeNull();
    } finally { clean(e.root); }
  });

  it('a « Couper les pubs » rewritten on the current version blocks it and quotes the day of the rewrite, not its first date', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_cut', { version: 2 });
      const republish = createTask(e.world, { kind: 'publish_product', input: { productId: p.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 40;
      closeDay(e.world, 50);
      const key = e.learning.LESSON_KEYS.niche(p.nicheId);
      e.world.company.lessons.push(lesson({ key, day: 33, insight: `Couper les pubs de la niche « Chat » ou retravailler l'offre : ROAS de 0,61 sur 6 jours.` }));
      expect(acq.productPaidBlock(e.world, p)).toBeNull(); // written on the version before
      e.world.company.lessons[0]!.changedDay = 47;
      const block = acq.productPaidBlock(e.world, p)!;
      expect(block).toMatchObject({ hard: true, final: true });
      expect(block.reason).toContain('leçon du jour 47');
    } finally { clean(e.root); }
  });

  it('a lesson rewritten on numbers that still hold the previous version does not bar the new one', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_cut', { version: 2 });
      addCampaign(e.world, e.sim, p, 'cpg_v1', 36, 38, 40, 0.5); // the last 3 days of the v1
      const republish = createTask(e.world, { kind: 'publish_product', input: { productId: p.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 40;
      closeDay(e.world, 44);
      const key = e.learning.LESSON_KEYS.niche(p.nicheId);
      e.world.company.lessons.push(lesson({ key, day: 33, changedDay: 41, insight: `Couper les pubs de la niche « Chat » ou retravailler l'offre : ROAS de 0,50 sur 3 jours.` }));
      expect(acq.cutLesson(e.world, p)).toBeNull(); // the window of J41 is J35-41: all of its ads are the v1's
      e.world.company.lessons[0]!.changedDay = 45;
      expect(acq.cutLesson(e.world, p)).not.toBeNull(); // the window of J45 is J39-45: no ad of the v1 left
    } finally { clean(e.root); }
  });

  it('an upsell whose parent is gone is a guide like any other: it is a candidate, and it gets its ads', async () => {
    const e = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const { isUpsellProduct } = await import('../src/runtime/metrics.js');
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const parent = addProduct(e.world, 'prd_parent', { upsellProductId: 'prd_next' });
      const next = addProduct(e.world, 'prd_next', { title: 'Les siestes de 30 minutes', launchedDay: 8 });
      closeDay(e.world, 12);
      expect(isUpsellProduct(e.world, next.id)).toBe(true);
      expect(acq.acquisitionCandidates(e.world).map((c) => c.product.id)).toEqual(['prd_parent']);
      expect(acq.productPaidBlock(e.world, next)!.reason).toContain('upsell');

      parent.status = 'killed';
      expect(isUpsellProduct(e.world, next.id)).toBe(false);
      expect(acq.acquisitionCandidates(e.world).map((c) => c.product.id)).toEqual(['prd_next']);
      expect(acq.productPaidBlock(e.world, next)).toBeNull();
      const plan = await buildHeuristicPlan(e.ctx);
      expect(plan.items.some((i) => i.input.productId === next.id && ['launch_campaign', 'write_ad_hooks'].includes(i.kind))).toBe(true);
    } finally { clean(e.root); }
  });

  it('an orphan is not judged on the weeks it spent as an upsell: only a paid test of its own can kill it', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      addProduct(e.world, 'prd_parent', { status: 'killed', upsellProductId: 'prd_next' });
      const next = addProduct(e.world, 'prd_next', { title: 'Les siestes de 30 minutes' });
      addOrders(e.world, e.sim, next, 8, 6);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 900, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 45);
      for (let i = 0; i < 6; i++) e.world.market.organicPosts.push({ id: `org_${i}`, day: 35 + i, productId: next.id, hook: 'h', hookStyle: 'pov', format: 'carousel', views: 100, likes: 1, clicks: 1, sales: 0, viral: false });
      await buildHeuristicPlan(e.ctx);
      expect(next.status).toBe('live'); // shown as a follow-up, never given its chance in ads
      addCampaign(e.world, e.sim, next, 'cpg_test', 38, 44, 30, 0.3);
      await buildHeuristicPlan(e.ctx);
      expect(next.status).toBe('killed');
    } finally { clean(e.root); }
  });

  it('a running campaign of a barred product is stopped, a founder-forced one is not', async () => {
    const e = await setup();
    try {
      const { growthHandlers } = await import('../src/runtime/handlers/growth.js');
      const p = addProduct(e.world, 'prd_cut');
      addOrders(e.world, e.sim, p, 24, 6);
      addCampaign(e.world, e.sim, p, 'cpg_ok', 26, 27, 30, 1.5, 'active');
      addCampaign(e.world, e.sim, p, 'cpg_fnd', 26, 27, 30, 1.5, 'active');
      e.world.company.campaigns.find((c) => c.id === 'cpg_fnd')!.founderForced = true;
      closeDay(e.world, 28);
      e.world.company.lessons.push(lesson({ key: e.learning.LESSON_KEYS.niche(p.nicheId), day: 20, insight: 'Couper les pubs de la niche « Chat ».' }));
      const task = { input: {}, createdBy: 'camille' } as unknown as Task;
      await growthHandlers.optimize_ads!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'adam')!, mind(e.world, 'adam'));
      expect(e.world.company.campaigns.find((c) => c.id === 'cpg_ok')!.status).toBe('paused');
      expect(e.world.company.campaigns.find((c) => c.id === 'cpg_fnd')!.status).toBe('active');
    } finally { clean(e.root); }
  });

  it('organic posts go to what earns money, not to what has no campaign', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const niches = e.world.market.niches;
      const rows = [['prd_a', 40, 'active'], ['prd_b', 30, 'active'], ['prd_c', 20, 'paused'], ['prd_d', 10, 'paused'], ['prd_e', 0, 'paused']] as const;
      const products = rows.map(([id, sales, status], i) => {
        const p = addProduct(e.world, id, { nicheId: niches[i]!.id, title: `Guide ${id}` });
        if (sales) addOrders(e.world, e.sim, p, 25, sales);
        addOrders(e.world, e.sim, p, 26, 3);
        addCampaign(e.world, e.sim, p, `cpg_${id}`, 24, 25, 6, 1.5, status);
        return p;
      });
      closeDay(e.world, 30);
      const posts = (await buildHeuristicPlan(e.ctx)).items.filter((i) => i.kind === 'post_organic').map((i) => i.input.productId);
      expect(posts).toHaveLength(4);
      expect(posts).toEqual(['prd_a', 'prd_b', 'prd_c', 'prd_d']);
      expect(posts).not.toContain(products[4]!.id); // the only one without any traction, no campaign or not
    } finally { clean(e.root); }
  });

  it('trolls and people who never bought never feed a v2 brief', async () => {
    const e = await setup();
    try {
      const { customerFeedback } = await import('../src/runtime/strategy.js');
      const { detectedComplaints } = await import('../src/runtime/metrics.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_fb');
      p.stats.reviews.push(
        { id: 'r1', day: 5, customerId: 'c1', rating: 1, text: 'Arnaque. Fuyez.' },
        { id: 'r2', day: 5, customerId: 'c2', rating: 2, text: 'Trop court pour le prix, et aucun exemple concret.' },
        { id: 'r3', day: 5, customerId: 'c3', rating: 1, text: "J'ai écrit trois fois, zéro réponse. Boutique à fuir." },
      );
      addOrders(e.world, e.sim, p, 4, 1);
      const inbox = (id: string, orderId: string | null, body: string) => ({ id, day: 5, customerId: 'c', channel: 'email', subject: 'x', body, intent: 'plainte_qualite', productId: p.id, orderId, mood: -0.5, status: 'resolved', deadlineDay: 7, thread: [], resolution: null }) as unknown as InboxMessage;
      e.world.market.inbox.push(inbox('m1', null, "J'ai pas acheté mais ça a l'air nul. 1 étoile."), inbox('m2', `ord_${p.id}_4_0`, 'Il y a des répétitions partout.'));
      const t = createTask(e.world, { kind: 'reply_inbox', input: {} });
      t.status = 'done';
      t.dayDone = 5;
      t.output = { replies: [
        { messageId: 'm1', productId: p.id, detected: 'plainte_qualite', complaint: "J'ai pas acheté mais ça a l'air nul. 1 étoile." },
        { messageId: 'm2', productId: p.id, detected: 'plainte_qualite', complaint: 'Il y a des répétitions partout.' },
      ] };
      const brief = customerFeedback(e.ctx, p, 1);
      expect(brief).toEqual(['Il y a des répétitions partout.', 'Avis 2/5 : Trop court pour le prix, et aucun exemple concret.']);
      expect(detectedComplaints(e.world, p.id)).toBe(1);
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── C4 ─────────────────────────────

describe('the portfolio follows capacity and evidence (C4)', () => {
  function portfolio(e: Env, profits: number[], sales = 30): Product[] {
    const niches = e.world.market.niches;
    return profits.map((profit, i) => {
      const p = addProduct(e.world, `prd_m${i}`, { nicheId: niches[i]!.id, createdDay: 10 + i, launchedDay: 12 + i });
      p.upsellProductId = 'prd_x';
      addOrders(e.world, e.sim, p, 25, sales);
      addCampaign(e.world, e.sim, p, `cpg_m${i}`, 24, 26, profit > 0 ? 10 : 100, 1.2, 'active');
      return p;
    });
  }

  it('a profitable guide gets its upsell planned, until the shop has looked and found nothing distinct to sell', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_up', { createdDay: 10, launchedDay: 12 });
      addOrders(e.world, e.sim, p, 25, 30);
      addCampaign(e.world, e.sim, p, 'cpg_up', 24, 26, 10, 2, 'active');
      closeDay(e.world, 28);
      const planned = async () => (await buildHeuristicPlan(e.ctx)).items.some((i) => i.kind === 'design_upsell' && i.input.productId === p.id);
      expect(await planned()).toBe(true);
      const looked = createTask(e.world, { kind: 'design_upsell', input: { productId: p.id } });
      looked.status = 'done';
      looked.output = { noSubject: true };
      expect(await planned()).toBe(false);
    } finally { clean(e.root); }
  });

  it('unprofitable mains do not fill the portfolio: 3 of them do not stop a new niche', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      portfolio(e, [-1, -1, -1]);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 3000, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 28);
      const plan = await buildHeuristicPlan(e.ctx);
      expect(plan.items.some((i) => i.kind === 'pick_opportunity' || i.kind === 'scan_trends')).toBe(true);
      expect(plan.memo).toMatch(/Diversification/);
    } finally { clean(e.root); }
  });

  it('3 profitable mains and comfortable cash: production goes on', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      portfolio(e, [1, 1, 1]);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 3000, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 28);
      const plan = await buildHeuristicPlan(e.ctx);
      expect(plan.memo).toMatch(/Diversification/);
    } finally { clean(e.root); }
  });

  it('capacity: an envelope that feeds 3 mains does not open a fourth while they earn; a new niche never starts in survival', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      portfolio(e, [1, 1, 1], 5);
      closeDay(e.world, 28);
      expect((await buildHeuristicPlan(e.ctx)).memo).not.toMatch(/Diversification/);
    } finally { clean(e.root); }
  });

  it('the market watch comes back every week', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      addProduct(e.world, 'prd_w');
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 900, memo: 'Ventes (fixture)', ref: null });
      const scan = createTask(e.world, { kind: 'scan_trends' });
      scan.status = 'done';
      scan.dayDone = 8;
      closeDay(e.world, 14);
      expect((await buildHeuristicPlan(e.ctx)).items.some((i) => i.input.refresh === true)).toBe(false);
      closeDay(e.world, 15);
      expect((await buildHeuristicPlan(e.ctx)).items.some((i) => i.kind === 'scan_trends' && i.input.refresh === true)).toBe(true);
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── C5 ─────────────────────────────

describe('the Red Team is a gate on publish_product (C5)', () => {
  /** A company whose Red Team on guides answers from a script; everything else is the real thing. */
  async function run(verdicts: RedTeamVerdict['verdict'][], days = 9, editEngine?: (engine: ContentEngine) => void) {
    const m = await modules();
    const root = mkdtempSync(join(tmpdir(), 'pixel-agency-gate-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const world = m.createWorld(m.defaultScenario({ ...LEGACY, seed: 11, mindMode: 'heuristic' }), 'test-gate');
    const engine = m.minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 11 });
    const script = [...verdicts];
    engine.redTeam = async (input) => {
      if (input.subject !== 'pdf') return { verdict: 'go', reasons: ['Idée solide.'], fixes: [] };
      const verdict = script.length > 1 ? script.shift()! : script[0]!;
      return { verdict, reasons: [`Verdict imposé : ${verdict}`], fixes: verdict === 'go' ? [] : ['Reprendre le guide.'] };
    };
    editEngine?.(engine);
    const company = new m.Company(world, { paths, engine, brain: m.vault.createBrainVault(paths) });
    await company.runDays(days);
    return { world, root };
  }
  const redTeams = (w: World, p: Product) => w.company.tasks.filter((t) => t.kind === 'red_team' && t.input.productId === p.id && t.input.subject === 'pdf');
  const firstProduct = (w: World) => w.company.products.find((p) => redTeams(w, p).length > 0)!;

  it('a « kill » blocks the publication until a structural rewrite gets a new « go »', async () => {
    const { world, root } = await run(['kill', 'go']);
    try {
      const p = firstProduct(world);
      const [first, second] = redTeams(world, p);
      expect(first!.output).toMatchObject({ verdict: 'kill', finalVerdict: 'kill' });
      expect(second!.input).toMatchObject({ cycle: 1 });
      expect(second!.output).toMatchObject({ finalVerdict: 'go' });
      const reworked = world.company.tasks.filter((t) => t.input.productId === p.id && t.input.revision === 1).map((t) => t.kind);
      expect(reworked).toEqual(expect.arrayContaining(['write_outline', 'write_pdf']));
      const publish = world.company.tasks.find((t) => t.kind === 'publish_product' && t.input.productId === p.id && t.status === 'done')!;
      expect(publish.dependsOn).toContain(second!.id);
      expect(p.status).toBe('live');
      expect(first!.output?.fingerprint).not.toBe(second!.output?.fingerprint);
      // the refusal counts against the author
      const author = world.company.tasks.find((t) => t.kind === 'write_pdf' && t.input.productId === p.id && t.status === 'done' && !t.input.rework)!;
      expect(author.reviews.some((r) => r.verdict === 'changes' && /Red Team/.test(r.notes.join(' ')))).toBe(true);
      expect(world.company.agents.find((a) => a.id === author.assignee)!.perf.rejected).toBeGreaterThan(0);
    } finally { clean(root); }
  }, 30_000);

  it('a kill that survives 2 rewrites ends the product: nothing ships, nothing waits', async () => {
    const { world, root } = await run(['kill'], 11);
    try {
      const p = firstProduct(world);
      expect(p.status).toBe('killed');
      expect(redTeams(world, p)).toHaveLength(3);
      expect(world.company.tasks.some((t) => t.kind === 'publish_product' && t.input.productId === p.id && t.status === 'done')).toBe(false);
    } finally { clean(root); }
  }, 30_000);

  it('a « fix » that does not change the file does not pass: the gate reopens on a structural rewrite, then a logged waiver', async () => {
    const { world, root } = await run(['fix', 'go', 'fix'], 11, (engine) => {
      const real = engine.humanize.bind(engine);
      // the correction pass does nothing; every other pass works
      engine.humanize = async (input, ctx) => (ctx.playbook.some((r) => r.startsWith('Correctif demandé')) ? input.content : real(input, ctx));
    });
    try {
      const p = firstProduct(world);
      const runs = redTeams(world, p);
      expect(runs).toHaveLength(3);
      const unchanged = runs[1]!;
      expect(unchanged.output).toMatchObject({ verdict: 'fix', finalVerdict: 'fix', unchanged: true });
      expect(String((unchanged.output!.reasons as string[])[0])).toMatch(/n’a pas changé/);
      expect(world.company.tasks.some((t) => t.kind === 'write_outline' && t.input.rework === true && t.input.productId === p.id)).toBe(true);
      const last = runs[2]!;
      expect(last.input.cycle).toBe(2);
      expect(last.output?.waiver).toBeTruthy();
      expect(p.status).toBe('live');
    } finally { clean(root); }
  }, 30_000);

  it('a re-review of an identical file cannot pass, whatever the engine says', async () => {
    const e = await setup();
    try {
      const { researchHandlers } = await import('../src/runtime/handlers/research.js');
      const { pdfFingerprint } = await import('../src/runtime/redteam.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const content = await e.engine.writePdfContent({ title: 'Nuits hachées', outline: await e.engine.writeOutline({ title: 'Nuits hachées', niche: { nicheId: 'sommeil-bebe', name: 'Sommeil', audience: 'parents', problem: 'réveils', category: 'parents', keywords: [] }, voc: e.ctx.tools.minePains('sommeil-bebe', 'deep') }, mind(e.world, 'theo')), niche: { nicheId: 'sommeil-bebe', name: 'Sommeil', audience: 'parents', problem: 'réveils', category: 'parents', keywords: [] }, voc: e.ctx.tools.minePains('sommeil-bebe', 'deep'), upsellTitle: null }, mind(e.world, 'theo'));
      const p = addProduct(e.world, 'prd_same', { status: 'qa', content, launchedDay: null });
      e.engine.redTeam = async () => ({ verdict: 'go', reasons: ['Tout va bien.'], fixes: [] });
      const task = createTask(e.world, { kind: 'red_team', input: { productId: p.id, subject: 'pdf', cycle: 1, previousPrint: pdfFingerprint(p), previousVerdict: 'fix' } });
      const out = await researchHandlers.red_team!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'axel')!, mind(e.world, 'axel'));
      expect(out.output).toMatchObject({ verdict: 'fix', finalVerdict: 'fix', unchanged: true });
    } finally { clean(e.root); }
  });

  it('publish_product refuses a version the Red Team did not clear', async () => {
    const e = await setup();
    try {
      const { redTeamGate } = await import('../src/runtime/redteam.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_gate', { status: 'qa', launchedDay: null });
      expect(redTeamGate(e.world, p).state).toBe('clear');
      const t = createTask(e.world, { kind: 'red_team', input: { productId: p.id, subject: 'pdf', version: 1, cycle: 0 } });
      expect(redTeamGate(e.world, p).state).toBe('waiting');
      t.status = 'done';
      t.output = { subject: 'pdf', finalVerdict: 'kill' };
      expect(redTeamGate(e.world, p).state).toBe('blocked');
      t.output = { subject: 'pdf', finalVerdict: 'fix', waiver: { day: 5 } };
      expect(redTeamGate(e.world, p).state).toBe('clear');
      t.output = { subject: 'pdf', finalVerdict: 'go' };
      expect(redTeamGate(e.world, p).state).toBe('clear');
      p.version = 2; // a v2 goes through its own chain
      t.output = { subject: 'pdf', finalVerdict: 'kill' };
      expect(redTeamGate(e.world, p).state).toBe('clear');
    } finally { clean(e.root); }
  });

  it('reviewers send back what the scorer calls blocking, whatever the global score; an ad that stays blocked never reaches TikTok', async () => {
    const e = await setup();
    try {
      const { reviewTask, closeLoop, MAX_ATTEMPTS } = await import('../src/runtime/review.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const nicheId = 'sommeil-bebe';
      const voc = e.ctx.tools.minePains(nicheId, 'deep');
      e.world.company.research.voc[nicheId] = voc;
      const p = addProduct(e.world, 'prd_ad', { nicheId, title: 'Bébé se réveille la nuit', audience: 'parents de bébés de 6 à 12 mois', problem: 'bébé se réveille la nuit' });
      const draft = await e.engine.writeAd({ product: p, voc, hook: 'Bébé se réveille la nuit ?', hookStyle: 'question', format: 'text_slideshow', bannedClaims: [] }, mind(e.world, 'chloe'));
      const off = 'Un détail change tout, regardez bien la fin de cette vidéo';
      const creative = { ...draft, id: 'cre_off', productId: p.id, hook: off, scenes: draft.scenes.map((s, i) => (i === 0 ? { ...s, onScreenText: off, voiceover: off } : s)), files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending' as const, reason: null, day: null }, createdDay: 1, createdBy: 'chloe' };
      e.world.company.creatives.push(creative);
      const q = e.sim.scoreCreative(creative, p, voc);
      expect(q.overall).toBeGreaterThanOrEqual(60);
      expect((q.blocking ?? []).map((b) => b.text).join(' ')).toMatch(/hook ne parle ni du problème/);
      const task = createTask(e.world, { kind: 'produce_ad', input: { productId: p.id, nicheId }, assignee: 'chloe' });
      task.output = { creativeId: creative.id };
      const res = await reviewTask(e.ctx, task, e.world.company.agents.find((a) => a.id === 'leo')!);
      expect(res.verdict).toBe('changes');
      expect(res.noWaiver).toBe(true);
      task.attempts = MAX_ATTEMPTS - 1;
      const closed = await closeLoop(e.ctx, task, res);
      expect(closed.verdict).toBe('approve');
      expect(task.output).toMatchObject({ dropped: true });
      expect(creative.review.status).toBe('rejected');
    } finally { clean(e.root); }
  });

  it('the end of a review loop is a decision: a logged waiver, or the end of a product that cannot comply', async () => {
    const e = await setup();
    try {
      const { closeLoop } = await import('../src/runtime/review.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_w', { status: 'writing', launchedDay: null });
      const task = createTask(e.world, { kind: 'write_pdf', input: { productId: p.id }, reviewer: 'samuel' });
      const waived = await closeLoop(e.ctx, task, { verdict: 'changes', notes: ['Exemple manquant.'], score: 60 });
      expect(waived.verdict).toBe('approve');
      expect(waived.notes.join(' ')).toMatch(/Dérogation/);
      expect(task.output?.waiver).toBeTruthy();
      expect(e.ctx.incidents.join(' ')).toMatch(/Dérogation/);
      await closeLoop(e.ctx, task, { verdict: 'changes', notes: ['Allégation interdite.'], score: 60, noWaiver: true });
      expect(p.status).toBe('killed');
    } finally { clean(e.root); }
  });

  it('heuristic verdicts come from the product: no canned text, the platform’s banned list is not our claim', async () => {
    const { heuristicRedTeam } = await import('../src/minds/heuristic/commerce.js');
    const facts = (title: string, anchor: number, rival: number) => ({
      title, audience: 'parents de bébés de 6 à 12 mois', problem: 'les réveils nocturnes', price: 19,
      signal: { searchInterest: 70, tiktokBuzz: 70, competition: 'moyenne' as const },
      competitors: { count: 3, medianPrice: rival, avgRating: 3.9, reviews: 120 }, voc: { pains: 8, medianAnchor: anchor, sensitiveClaims: 2 }, guide: null,
    });
    const summary = 'Niche — public — problème. Allégations interdites par la plateforme : guérir, 100 %, garanti.';
    const good = heuristicRedTeam({ subject: 'idea', summary, quality: null, facts: facts('Sommeil de bébé', 24, 29) });
    expect(good.verdict).toBe('go');
    expect(good.reasons[0]).toContain('Sommeil de bébé');
    const cheap = heuristicRedTeam({ subject: 'idea', summary, quality: null, facts: facts('Chat qui griffe', 9, 9) });
    expect(cheap.verdict).toBe('kill');
    expect(cheap.reasons.join(' ')).toMatch(/Chat qui griffe/);
    expect(cheap.reasons.join(' ')).toMatch(/9/);
    const q = { overall: 95, specificity: 95, structure: 95, actionability: 95, humanTone: 95, design: 95, promiseMatch: 95, compliance: 100, issues: [], evaluator: 'heuristic' as const };
    const guide = (uncoveredPains: string[]) => ({ ...facts('Mon guide', 24, 29), guide: { promise: 'Des nuits plus calmes', wordCount: 3000, painsKnown: 8, uncoveredPains, chaptersWithoutExample: [], chapters: 7 } });
    const clean2 = heuristicRedTeam({ subject: 'pdf', summary, quality: q, facts: guide([]) });
    expect(clean2.verdict).toBe('go');
    const gaps = heuristicRedTeam({ subject: 'pdf', summary, quality: q, facts: guide(['Le couple se dispute', 'Les siestes sont trop courtes']) });
    expect(gaps.verdict).toBe('fix');
    expect(gaps.reasons.join(' ')).toMatch(/Le couple se dispute/);
    expect(heuristicRedTeam({ subject: 'pdf', summary, quality: q, facts: guide(['a a a a', 'b b b b', 'c c c c', 'd d d d', 'e e e e']) }).verdict).toBe('kill');
  });

  it('a fix pass really adds what the guide lacked, from the research', async () => {
    const e = await setup();
    try {
      const { guideGaps } = await import('../src/runtime/redteam.js');
      const { heuristicHumanize } = await import('../src/minds/heuristic/editing.js');
      const { seededRng } = await import('../src/minds/util.js');
      const voc = e.ctx.tools.minePains('sommeil-bebe', 'deep');
      const niche = { nicheId: 'sommeil-bebe', name: 'Sommeil', audience: 'parents de bébés de 6 à 12 mois', problem: 'bébé se réveille la nuit', category: 'parents', keywords: [] };
      const m = mind(e.world, 'theo');
      const outline = await e.engine.writeOutline({ title: 'Bébé se réveille la nuit', niche, voc }, m);
      const content = await e.engine.writePdfContent({ title: 'Bébé se réveille la nuit', outline, niche, voc, upsellTitle: null }, m);
      const missing = voc.pains.filter((_, i) => i < 2);
      for (const ch of content.chapters) ch.paragraphs = ch.paragraphs.filter((x) => !missing.some((pain) => x.includes(pain)));
      const before = guideGaps(content, voc);
      const out = heuristicHumanize(content, [], voc, seededRng(1, 'fix'), before);
      expect(JSON.stringify(out)).not.toBe(JSON.stringify(content));
      expect(guideGaps(out, voc).pains.length).toBeLessThanOrEqual(before.pains.length);
    } finally { clean(e.root); }
  });

  it('the HR review shows what was sent back and does not promote through it', async () => {
    const e = await setup();
    try {
      const { createTask } = await import('../src/runtime/tasks.js');
      e.world.day = 7;
      const theo = e.world.company.agents.find((a) => a.id === 'theo')!;
      theo.perf = { done: 20, approved: 20, rejected: 4, failed: 0, score: 80 };
      for (let i = 0; i < 4; i++) {
        const t = createTask(e.world, { kind: 'write_pdf', assignee: 'theo' });
        t.status = 'done';
        t.dayDone = 6;
        t.reviews.push({ by: 'samuel', day: 6, verdict: 'changes', notes: ['Exemple manquant.'] }, { by: 'samuel', day: 6, verdict: 'approve', notes: [] });
      }
      const lines = await e.learning.performanceReview(e.world, e.brain);
      expect(lines.join('\n')).toMatch(/Renvois en relecture cette semaine — Théo : 4 renvois \(motif fréquent : « Exemple manquant/);
      expect(lines.some((l) => /Promotion : Théo/.test(l))).toBe(false);
      const note = await e.brain.read('rh/revue-semaine-1.md');
      expect(note!.body).toMatch(/## Renvois en relecture/);
      expect(note!.body).toMatch(/Renvois \(sem\.\)/);
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── C9 ─────────────────────────────

describe('lessons change what the company does (C9)', () => {
  it('a page-conversion lesson plans the rewrite of the page, once', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = addProduct(e.world, 'prd_page');
      addOrders(e.world, e.sim, p, 18, 12);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 20);
      e.world.company.lessons.push(lesson({ key: e.learning.LESSON_KEYS.page(p.id), day: 19, topic: 'pricing', insight: `Réécrire la page de vente de « ${p.title} » : seulement 0,8 % des visiteurs achètent.` }));
      const item = (await buildHeuristicPlan(e.ctx)).items.find((i) => i.kind === 'write_sales_page' && i.input.productId === p.id);
      expect(item?.input).toMatchObject({ reason: 'lesson' });
      const { createTask } = await import('../src/runtime/tasks.js');
      const done = createTask(e.world, { kind: 'write_sales_page', input: { productId: p.id } });
      done.status = 'done';
      done.dayDone = 20;
      closeDay(e.world, 21);
      expect((await buildHeuristicPlan(e.ctx)).items.some((i) => i.kind === 'write_sales_page')).toBe(false);
    } finally { clean(e.root); }
  });

  it('a quality lesson backed by the current version plans a rework; one the numbers do not back does not', async () => {
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = addProduct(e.world, 'prd_q', { stats: { views: 0, sales: 40, revenue: 760, refunds: 0, refundAmount: 0, rating: 4.6, upsellSales: 0, reviews: [] } });
      addOrders(e.world, e.sim, p, 15, 40);
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 20);
      e.world.company.lessons.push(lesson({ key: e.learning.LESSON_KEYS.quality(p.id), day: 19, topic: 'product', insight: `Retravailler « ${p.title} » en v2.` }));
      const rework = () => buildHeuristicPlan(e.ctx).then((plan) => plan.items.some((i) => i.input.pipeline === 'v2' && i.input.productId === p.id));
      expect(await rework()).toBe(false);
      p.stats.reviews = [1, 2, 3].map((i) => ({ id: `r${i}`, day: 12, customerId: `c${i}`, rating: 3 as const, text: 'Trop général.' }));
      expect(await rework()).toBe(true);
    } finally { clean(e.root); }
  });

  it('the mild refund trigger needs significance: a few refund hunters do not pay for a v2', async () => {
    const acq = await import('../src/runtime/acquisition.js');
    expect(acq.refundsWorthRework(1, 8)).toBe(false);
    expect(acq.refundsWorthRework(2, 12)).toBe(false);
    expect(acq.refundsWorthRework(6, 40)).toBe(false); // 15 %: what refund hunters alone do in cauchemar
    expect(acq.refundsWorthRework(10, 40)).toBe(true); // 25 %
    const e = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      const p = addProduct(e.world, 'prd_r');
      addOrders(e.world, e.sim, p, 15, 9, 1); // 11 % on 9 sales: the old rule rewrote this guide
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 18);
      expect((await buildHeuristicPlan(e.ctx)).items.some((i) => i.input.pipeline === 'v2')).toBe(false);
    } finally { clean(e.root); }
  });

  it('a claim the fact-checker removes joins the writers’ « Ne jamais écrire », with an incident, and never comes back', async () => {
    const e = await setup();
    try {
      const { studioHandlers, claimRule } = await import('../src/runtime/handlers/studio.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const { parsePlaybook } = await import('../src/runtime/playbook.js');
      const nicheId = 'sommeil-bebe';
      const voc = e.ctx.tools.minePains(nicheId, 'deep');
      e.world.company.research.voc[nicheId] = voc;
      const niche = { nicheId, name: 'Sommeil', audience: 'parents de bébés de 6 à 12 mois', problem: 'bébé se réveille la nuit', category: 'parents', keywords: [] };
      const write = async (title: string, day: number) => {
        e.world.day = day;
        const m = { ...mind(e.world, 'theo'), day };
        const outline = await e.engine.writeOutline({ title, niche, voc }, m);
        return e.engine.writePdfContent({ title, outline, niche, voc, upsellTitle: null }, m);
      };
      let content = await write('Bébé se réveille la nuit', 1);
      let day = 1;
      while (!JSON.stringify(content).includes('Plus de 80 %') && day < 60) content = await write('Bébé se réveille la nuit', ++day);
      expect(JSON.stringify(content)).toContain('Plus de 80 %');
      const p = addProduct(e.world, 'prd_fc', { nicheId, status: 'writing', content, launchedDay: null });
      const task = createTask(e.world, { kind: 'fact_check', input: { productId: p.id, nicheId }, assignee: 'samuel' });
      await studioHandlers.fact_check!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'samuel')!, mind(e.world, 'samuel'));
      expect(e.world.company.playbooks.theo!.some((r) => /^Ne jamais écrire « Plus de 80 %/.test(r))).toBe(true);
      expect(e.world.company.playbooks.lina!.some((r) => /^Ne jamais écrire « Plus de 80 %/.test(r))).toBe(true);
      expect(e.ctx.incidents.join(' ')).toMatch(/Fact-check : « Plus de 80 %/);
      expect(parsePlaybook(e.world.company.playbooks.theo!).banned.some((b) => b.startsWith('Plus de 80 %'))).toBe(true);
      // Every guide the same writer drafts from now on is free of it.
      for (let d = 2; d < 40; d++) expect(JSON.stringify(await write(`Guide ${d}`, d))).not.toContain('Plus de 80 %');
      expect(claimRule('Il dit « oui » et guérit tout.')).toBe('Ne jamais écrire « Il dit oui et guérit tout »');
      expect(claimRule('Non.')).toBeNull();
    } finally { clean(e.root); }
  });

  it('a full playbook sheds advice before a banned claim', async () => {
    const { addPlaybookRule } = await import('../src/runtime/playbook.js');
    const world = { company: { playbooks: { theo: ['Ne jamais écrire « première phrase »'] } } } as unknown as World;
    for (let i = 0; i < 14; i++) addPlaybookRule(world, 'theo', `Conseil numéro ${i}`);
    expect(world.company.playbooks.theo).toHaveLength(12);
    expect(world.company.playbooks.theo![0]).toBe('Ne jamais écrire « première phrase »');
  });
});

// ───────────────────────────── C10 ─────────────────────────────

describe('experiments (C10)', () => {
  function withArms(e: Env, p: Product): void {
    const c = e.world.company;
    c.campaigns.push({ id: 'cpg_live', productId: p.id, name: 'Campagne', creativeIds: [], dailyBudget: 20, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 5, createdBy: 'adam' });
    c.bandits[`hook_style:${p.nicheId}`] = [{ key: 'pov', alpha: 5, beta: 2, pulls: 6, reward: 3 }, { key: 'story', alpha: 3, beta: 2, pulls: 4, reward: 2 }];
  }
  function settled(e: Env, p: Product, status: 'concluded' | 'cancelled', endDay: number) {
    const exp = { id: 'exp_1', day: endDay - 5, owner: 'emma', hypothesis: 'x', dimension: 'hook_style' as const, nicheId: p.nicheId, productId: p.id, variants: ['pov', 'story'], metric: 'ctr' as const, status, results: { pov: { n: 4000, value: 0.04 }, story: { n: 4000, value: 0.02 } }, winner: status === 'concluded' ? 'pov' : null, endDay };
    e.world.company.experiments.push(exp);
    return exp;
  }

  it('a concluded test is settled, however long ago; a new version or a strong drift reopens it', async () => {
    const e = await setup();
    try {
      const { experimentCandidate } = await import('../src/runtime/handlers/ops.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_x', { title: 'Guide test' });
      withArms(e, p);
      settled(e, p, 'concluded', 10);
      e.world.company.creatives.push({ id: 'cre_pov', productId: p.id, hook: 'h', hookStyle: 'pov', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'chloe' });
      const row = (day: number, ctr: number) => ({ day, campaignId: 'cpg_live', creativeId: 'cre_pov', productId: p.id, spend: 10, impressions: 1000, clicks: Math.round(1000 * ctr), ctr, cpc: 1, cpm: 10, landingViews: 10, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [] });
      e.world.day = 60;
      for (let d = 53; d <= 59; d++) e.world.market.adStats.push(row(d, 0.035)); // the winner still holds
      expect(experimentCandidate(e.ctx)).toBeNull();
      e.world.market.adStats = [];
      for (let d = 53; d <= 59; d++) e.world.market.adStats.push(row(d, 0.015)); // down 60 %
      expect(experimentCandidate(e.ctx)).toMatchObject({ dimension: 'hook_style', variants: ['pov', 'story'] });
      e.world.market.adStats = [];
      expect(experimentCandidate(e.ctx)).toBeNull();
      const republish = createTask(e.world, { kind: 'publish_product', input: { productId: p.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 30; // a new version asks the question again
      expect(experimentCandidate(e.ctx)).toMatchObject({ dimension: 'hook_style' });
    } finally { clean(e.root); }
  });

  it('a test without a campaign is not started, and a question settled on one niche stays open on another', async () => {
    const e = await setup();
    try {
      const { experimentCandidate } = await import('../src/runtime/handlers/ops.js');
      const p = addProduct(e.world, 'prd_y', { title: 'Guide niche A' });
      withArms(e, p);
      e.world.company.campaigns[0]!.status = 'paused';
      e.world.day = 20;
      expect(experimentCandidate(e.ctx)).toBeNull();
      e.world.company.campaigns[0]!.status = 'active';
      const exp = settled(e, p, 'concluded', 18);
      exp.nicheId = 'autre-niche';
      expect(experimentCandidate(e.ctx)).toMatchObject({ dimension: 'hook_style', nicheId: p.nicheId, productId: p.id });
    } finally { clean(e.root); }
  });

  it('starting a test orders creatives for the variants without a live ad, attached to the running campaign', async () => {
    const e = await setup();
    try {
      const { orderVariantCreatives } = await import('../src/runtime/handlers/ops.js');
      const { growthHandlers } = await import('../src/runtime/handlers/growth.js');
      const p = addProduct(e.world, 'prd_v');
      withArms(e, p);
      e.world.company.campaigns[0]!.creativeIds = ['cre_pov'];
      e.world.company.creatives.push({ id: 'cre_pov', productId: p.id, hook: 'h', hookStyle: 'pov', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'chloe' });
      const exp = e.learning.startExperiment(e.world, { day: 10, owner: 'emma', hypothesis: 'test', dimension: 'hook_style', nicheId: p.nicheId, productId: p.id, variants: ['pov', 'story'], metric: 'ctr' });
      expect(orderVariantCreatives(e.ctx, exp)).toBe(1);
      const hooks = e.world.company.tasks.find((t) => t.kind === 'write_ad_hooks')!;
      expect(hooks.input).toMatchObject({ productId: p.id, produce: 1, experimentVariants: ['story'], attachTo: 'cpg_live' });
      expect(orderVariantCreatives(e.ctx, exp)).toBe(0); // already ordered
      await growthHandlers.write_ad_hooks!.onDone!(e.ctx, hooks);
      expect(e.world.company.tasks.find((t) => t.kind === 'produce_ad')!.input).toMatchObject({ experimentVariant: 'story', attachTo: 'cpg_live' });
    } finally { clean(e.root); }
  });

  it('a variant with no data 2 days after the start cancels the test; the price then goes back to the control, never as a winner', async () => {
    const e = await setup();
    try {
      const { priceMove } = await import('../src/runtime/strategy.js');
      const { boutiqueHandlers } = await import('../src/runtime/handlers/boutique.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_p', { title: 'Guide prix', price: 24, priceHistory: [{ day: 3, price: 19 }, { day: 10, price: 24 }] });
      e.learning.startExperiment(e.world, { day: 10, owner: 'emma', hypothesis: '« Guide prix » rapporte plus par visiteur à 24 € qu\'à 19 €', dimension: 'price', nicheId: p.nicheId, productId: p.id, variants: ['19', '24'], metric: 'roas' });
      e.world.day = 11;
      e.learning.updateExperiments(e.world);
      expect(e.world.company.experiments[0]!.status).toBe('running');
      e.world.day = 12;
      expect(e.learning.updateExperiments(e.world)).toEqual([]);
      expect(e.world.company.experiments[0]).toMatchObject({ status: 'cancelled', winner: null, endDay: 12 });
      expect(e.world.activity.some((a) => /Test A\/B annulé/.test(a.text))).toBe(true);
      const move = priceMove(e.ctx, p)!;
      expect(move.input).toMatchObject({ reason: 'controle', price: 19 });
      const task = createTask(e.world, { kind: 'set_price', input: move.input });
      const out = await boutiqueHandlers.set_price!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'paul')!, mind(e.world, 'paul'));
      expect(out.output).toMatchObject({ price: 19 });
      expect(String(out.output!.why)).toMatch(/prix de contrôle/);
      expect(String(out.output!.why)).not.toMatch(/gagnant du test/);
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── prices ─────────────────────────────

describe('the price ceiling comes from what buyers do', () => {
  const row = (p: Product, day: number, views: number, revenue: number) => ({ day, campaignId: 'c', creativeId: 'k', productId: p.id, spend: 10, impressions: 100, clicks: 10, ctr: 0.1, cpc: 1, cpm: 1, landingViews: views, purchases: 1, revenue, roas: 1, frequency: 1, comments: [] });

  it('one quoted anchor at 35 € does not make 39 € possible: the median of the market does the talking', async () => {
    const e = await setup();
    try {
      const { priceCeiling } = await import('../src/runtime/metrics.js');
      const p = addProduct(e.world, 'prd_c', { price: 19 });
      e.world.company.research.voc[p.nicheId] = { ...e.ctx.tools.minePains(p.nicheId, 'quick'), priceAnchors: [9, 12, 14, 14, 35] };
      e.world.company.research.competitors[p.nicheId] = [];
      expect(priceCeiling(e.world, p).ceiling).toBeCloseTo(17.5, 1);
    } finally { clean(e.root); }
  });

  it('a tier that earned less per visitor is a wall; a tier that holds opens the next step', async () => {
    const e = await setup();
    try {
      const { priceCeiling } = await import('../src/runtime/metrics.js');
      const { boutiqueHandlers } = await import('../src/runtime/handlers/boutique.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_w', { price: 24, priceHistory: [{ day: 2, price: 19 }, { day: 10, price: 24 }, { day: 15, price: 29 }, { day: 20, price: 24 }] });
      e.world.company.research.voc[p.nicheId] = { ...e.ctx.tools.minePains(p.nicheId, 'quick'), priceAnchors: [24, 29, 35] };
      e.world.company.research.competitors[p.nicheId] = [];
      e.world.market.adStats.push(row(p, 5, 200, 190), row(p, 12, 200, 200), row(p, 17, 200, 90));
      expect(priceCeiling(e.world, p)).toMatchObject({ ceiling: 24 });
      e.world.day = 30;
      const task = createTask(e.world, { kind: 'set_price', input: { productId: p.id, reason: 'hausse' } });
      const out = await boutiqueHandlers.set_price!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'paul')!, mind(e.world, 'paul'));
      expect(out.output).toMatchObject({ price: 24 });
      expect(String(out.output!.why)).toMatch(/plafond/);
      p.priceHistory = [{ day: 2, price: 19 }, { day: 10, price: 24 }];
      e.world.market.adStats = [row(p, 5, 200, 190), row(p, 12, 200, 200)];
      expect(priceCeiling(e.world, p).ceiling).toBeGreaterThanOrEqual(29);
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── M6, creators ─────────────────────────────

describe('creators: advances are investments, scams are read on public numbers (M6)', () => {
  const honest: CreatorProfile = { id: 'crt_h', handle: 'honnete', nicheId: 'n', followers: 20000, avgViews: 4000, engagement: 0.05, askUpfront: 80, askCommission: 0.3, redFlags: [] };
  const budget = { adCap: 150, survival: false, cash: 2000, runwayDays: null, rate: 0.15, bankrupt: false, outage: false };

  async function deals(world: World) {
    world.market.creators.push(honest, { ...honest, id: 'crt_past', handle: 'passe' });
  }

  it('reads scams on 2 of 4 public signals; an honest profile passes; a commission-only offer stays open on 1 signal', async () => {
    const { fraudSignals, profileSignals } = await import('../src/runtime/handlers/partners.js');
    expect(profileSignals(honest)).toEqual([]);
    expect(fraudSignals(honest)).toEqual([]);
    const stealth = { ...honest, avgViews: 1400, engagement: 0.025, askUpfront: 60, askCommission: 0.15 };
    expect(profileSignals(stealth).length).toBeGreaterThanOrEqual(2);
    expect(fraudSignals(stealth).length).toBeGreaterThanOrEqual(2);
    const lone = { ...honest, engagement: 0.025 };
    expect(fraudSignals(lone)).toEqual([]);
    expect(fraudSignals({ ...lone, redFlags: ['Bio un peu vague'] }).length).toBe(2);
  });

  it('no advance without observed results; paid when past creators show it pays back; never after advances that did not', async () => {
    const e = await setup();
    try {
      const { advanceDecision } = await import('../src/runtime/handlers/partners.js');
      await deals(e.world);
      const p = addProduct(e.world, 'prd_c', { price: 29 });
      e.world.day = 20;
      expect(advanceDecision(e.world, honest, p, budget, 0.3)).toMatchObject({ pay: false, expected: null });
      // A past commission deal: 10 sales for 4 000 views, read after its video had time to sell.
      e.world.market.partnerships.push({ id: 'prt_1', creatorId: 'crt_past', productId: p.id, day: 5, upfront: 0, commission: 0.3, status: 'delivered', sales: 10, revenue: 290 });
      const paid = advanceDecision(e.world, honest, p, budget, 0.3);
      expect(paid).toMatchObject({ pay: true });
      expect(paid.expected).toBeCloseTo(4 * 2.5 * 29 * 0.7, 1);
      // The same creator asking more than he can bring.
      expect(advanceDecision(e.world, { ...honest, askUpfront: 300 }, p, budget, 0.3)).toMatchObject({ pay: false });
      // Above 10 % of the cash, whatever the forecast.
      expect(advanceDecision(e.world, honest, p, { ...budget, cash: 500 }, 0.3)).toMatchObject({ pay: false });
      // Past advances lost money.
      e.world.market.partnerships.push({ id: 'prt_2', creatorId: 'crt_past', productId: p.id, day: 6, upfront: 200, commission: 0.3, status: 'delivered', sales: 2, revenue: 58 });
      expect(advanceDecision(e.world, honest, p, budget, 0.3)).toMatchObject({ pay: false });
      expect(advanceDecision(e.world, honest, p, budget, 0.3).why).toMatch(/remboursées/);
    } finally { clean(e.root); }
  });

  it('after the « partenariat-avance » lesson the deal is commission only, plus 10 points at most', async () => {
    const e = await setup();
    try {
      const { partnerHandlers } = await import('../src/runtime/handlers/partners.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      await deals(e.world);
      const nicheId = e.world.market.niches[0]!.id;
      const creator = { ...honest, nicheId };
      e.world.market.creators[e.world.market.creators.length - 2] = creator;
      const p = addProduct(e.world, 'prd_l', { price: 29, nicheId });
      e.world.day = 20;
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 2000, memo: 'Ventes (fixture)', ref: null });
      e.world.market.partnerships.push({ id: 'prt_1', creatorId: 'crt_past', productId: p.id, day: 5, upfront: 0, commission: 0.3, status: 'delivered', sales: 10, revenue: 290 });
      e.world.company.lessons.push(lesson({ key: e.learning.LESSON_KEYS.advance, topic: 'partnership', insight: 'Limiter les avances aux créateurs.' }));
      const task = createTask(e.world, { kind: 'negotiate_deal', input: { productId: p.id, nicheId, creatorId: creator.id } });
      const out = await partnerHandlers.negotiate_deal!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'rayan')!, mind(e.world, 'rayan'));
      expect(out.output).toMatchObject({ upfront: 0 });
      expect(Number(out.output!.commission)).toBeLessThanOrEqual(creator.askCommission + 0.1 + 1e-9);
      expect(String(out.output!.advanceWhy)).toMatch(/leçon/);
    } finally { clean(e.root); }
  });

  it('someone who refuses any commission is struck off for good', async () => {
    const e = await setup();
    try {
      const { partnerHandlers } = await import('../src/runtime/handlers/partners.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const nicheId = e.world.market.niches[0]!.id;
      const p = addProduct(e.world, 'prd_s', { nicheId });
      const c = { ...honest, id: 'crt_cash', handle: 'cash', nicheId };
      e.world.market.creators = [c];
      const done = createTask(e.world, { kind: 'negotiate_deal', input: { creatorId: c.id, productId: 'prd_autre' } });
      done.status = 'done';
      done.output = { cashOnly: true };
      const task = createTask(e.world, { kind: 'find_creators', input: { productId: p.id } });
      const out = await partnerHandlers.find_creators!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'louise') ?? e.world.company.agents.find((a) => a.id === 'rayan')!, mind(e.world, 'rayan'));
      expect(out.output).toMatchObject({ candidates: [] });
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── support ─────────────────────────────

describe('support checks claims against the logs', () => {
  function message(world: World, p: Product, order: Order | null, body: string, over: Partial<InboxMessage> = {}): InboxMessage {
    const m = { id: 'msg_1', day: world.day, customerId: 'cus_1', channel: 'email', subject: 'Réclamation', body, intent: 'arnaque', productId: p.id, orderId: order?.id ?? null, mood: -0.4, status: 'open', deadlineDay: world.day + 2, thread: [{ from: 'customer', text: body, day: world.day }], resolution: null, ...over } as InboxMessage;
    world.market.inbox.push(m);
    return m;
  }
  const order = (p: Product, over: Partial<Order> = {}): Order => ({ id: 'ord_1', day: 5, customerId: 'cus_1', productId: p.id, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 2, ...over });

  it('reads the claim against the payment and delivery logs', async () => {
    const e = await setup();
    try {
      const { checkClaim } = await import('../src/runtime/handlers/support.js');
      const p = addProduct(e.world, 'prd_s');
      const m = (body: string) => ({ id: 'x', day: 6, customerId: 'cus_1', subject: '', body }) as InboxMessage;
      expect(checkClaim(e.world, m("J'ai été débité deux fois de 19 €."), order(p))).toMatchObject({ falseClaim: true });
      expect(checkClaim(e.world, m("J'ai été débité deux fois de 19 €."), order(p, { charges: 2 }))).toMatchObject({ falseClaim: false, realDoubleCharge: true });
      expect(checkClaim(e.world, m("Je n'ai jamais rien reçu."), order(p))).toMatchObject({ falseClaim: true });
      expect(checkClaim(e.world, m("Je n'ai jamais rien reçu."), order(p, { downloads: 0 }))).toMatchObject({ falseClaim: false });
      expect(checkClaim(e.world, m("Ce paiement n'a pas été fait par moi."), order(p))).toMatchObject({ falseClaim: true });
      expect(checkClaim(e.world, m("Votre collègue m'a promis le remboursement au téléphone."), order(p))).toMatchObject({ falseClaim: true });
      e.world.market.inbox.push({ id: 'y', day: 5, customerId: 'cus_1' } as InboxMessage);
      expect(checkClaim(e.world, m("Votre collègue m'a promis le remboursement au téléphone."), order(p))).toMatchObject({ falseClaim: false });
      expect(checkClaim(e.world, m('Le guide est très général.'), order(p))).toMatchObject({ falseClaim: false });
      expect(checkClaim(e.world, m("J'ai été débité deux fois."), null)).toMatchObject({ falseClaim: false });
      expect(checkClaim(e.world, m("J'ai été débité deux fois."), order(p, { charges: undefined }))).toMatchObject({ falseClaim: false });
    } finally { clean(e.root); }
  });

  it('a false claim gets a polite, logged answer and no money; the buyer is not blocked', async () => {
    const e = await setup();
    try {
      const { supportHandlers } = await import('../src/runtime/handlers/support.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_f');
      const o = order(p);
      e.world.market.orders.push(o);
      e.world.day = 6;
      const msg = message(e.world, p, o, "Bonjour, j'ai été débité deux fois de 19 € pour ce guide. Merci de me rembourser dès aujourd'hui.");
      const task = createTask(e.world, { kind: 'reply_inbox', input: { messageIds: [msg.id] } });
      const before = e.sim.financeSnapshot(e.world).cash;
      const out = await supportHandlers.reply_inbox!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'fatou')!, mind(e.world, 'fatou'));
      const reply = (out.output!.replies as Record<string, unknown>[])[0]!;
      expect(reply).toMatchObject({ detected: 'arnaque', action: 'none' });
      expect(Number(reply.score)).toBeGreaterThanOrEqual(80);
      expect(e.sim.financeSnapshot(e.world).cash).toBe(before);
      expect(o.refunded).toBe(false);
      expect(msg.thread.find((t) => t.from !== 'customer')!.text).toMatch(/journal de paiement/);
    } finally { clean(e.root); }
  });

  it('a real double charge is repaid and says so without a made-up amount', async () => {
    const e = await setup();
    try {
      const { supportHandlers } = await import('../src/runtime/handlers/support.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_d');
      const o = order(p, { charges: 2 });
      e.world.market.orders.push(o);
      e.world.day = 6;
      const msg = message(e.world, p, o, "Bonjour, j'ai été débité deux fois de 19 € pour la même commande. Pouvez-vous rembourser le doublon ?", { intent: 'bug_paiement' });
      const task = createTask(e.world, { kind: 'reply_inbox', input: { messageIds: [msg.id] } });
      const out = await supportHandlers.reply_inbox!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'fatou')!, mind(e.world, 'fatou'));
      expect((out.output!.replies as Record<string, unknown>[])[0]).toMatchObject({ detected: 'bug_paiement', action: 'refund' });
      expect(msg.status).toBe('resolved');
    } finally { clean(e.root); }
  });

  it('a refund after a goodwill gesture announces what is really paid', async () => {
    const e = await setup();
    try {
      const { supportHandlers } = await import('../src/runtime/handlers/support.js');
      const { createTask } = await import('../src/runtime/tasks.js');
      const p = addProduct(e.world, 'prd_g');
      const o = order(p, { refundedAmount: 7.6 });
      e.world.market.orders.push(o);
      const task = createTask(e.world, { kind: 'handle_refund', input: { orderId: o.id } });
      const out = await supportHandlers.handle_refund!.run(e.ctx, task, e.world.company.agents.find((a) => a.id === 'fatou')!, mind(e.world, 'fatou'));
      expect(out.output).toMatchObject({ amount: 11.4 });
    } finally { clean(e.root); }
  });
});

// ───────────────────────────── M12 ─────────────────────────────

describe('one stop-loss rule (M12)', () => {
  it('the code applies the policy: 25 € over 2 days under 0,8, at once under 0,4', async () => {
    const { stopLossReason } = await import('../src/runtime/handlers/growth.js');
    const { campaignMetrics } = await import('../src/runtime/metrics.js');
    const metrics = (rows: { day: number; spend: number; revenue: number }[]) => campaignMetrics(rows.map((r) => ({ campaignId: 'x', creativeId: 'c', productId: 'p', impressions: 100, clicks: 2, ctr: 0.02, cpc: 1, cpm: 1, landingViews: 2, purchases: 0, roas: 0, frequency: 1, comments: [], ...r })), 'x');
    const under = metrics([{ day: 3, spend: 13, revenue: 9 }, { day: 4, spend: 13, revenue: 10 }]);
    expect(stopLossReason(under, under)).toMatch(/après 26 € sur 2 jours/);
    const oneDay = metrics([{ day: 3, spend: 37, revenue: 24 }]);
    expect(stopLossReason(oneDay, oneDay)).toBeNull();
    const dead = metrics([{ day: 3, spend: 26, revenue: 0 }]);
    expect(stopLossReason(dead, dead)).toMatch(/aucune traction/);
    const fine = metrics([{ day: 3, spend: 13, revenue: 11 }, { day: 4, spend: 13, revenue: 11 }]);
    expect(stopLossReason(fine, fine)).toBeNull();
  });

  it('a campaign under the rule is paused, not trimmed for days', async () => {
    const e = await setup();
    try {
      const { growthHandlers } = await import('../src/runtime/handlers/growth.js');
      const p = addProduct(e.world, 'prd_t');
      addCampaign(e.world, e.sim, p, 'cpg_day', 9, 9, 22, 0.6, 'active');
      e.sim.recordLedger(e.world, { type: 'revenue', amount: 1000, memo: 'Ventes (fixture)', ref: null });
      closeDay(e.world, 10);
      const adam = e.world.company.agents.find((a) => a.id === 'adam')!;
      const task = { input: {}, createdBy: 'camille' } as unknown as Task;
      await growthHandlers.optimize_ads!.run(e.ctx, task, adam, mind(e.world, 'adam'));
      const c = e.world.company.campaigns.find((x) => x.id === 'cpg_day')!;
      expect(c.status).toBe('active');
      expect(c.dailyBudget).toBe(22); // one day under the rule: the next day's sample decides, a smaller budget only delays it
      e.world.market.adStats.push({ ...e.world.market.adStats[e.world.market.adStats.length - 1]!, day: 10 });
      closeDay(e.world, 11);
      await growthHandlers.optimize_ads!.run(e.ctx, task, adam, mind(e.world, 'adam'));
      expect(c.status).toBe('paused');
    } finally { clean(e.root); }
  });

  it('the brain, the seed playbooks and the constants say the same thing', async () => {
    const acq = await import('../src/runtime/acquisition.js');
    const { SEED_PLAYBOOKS } = await import('../src/runtime/roster.js');
    expect([acq.STOP_LOSS_ROAS, acq.STOP_LOSS_SPEND, acq.STOP_LOSS_DAYS, acq.NO_TRACTION_ROAS]).toEqual([0.8, 25, 2, 0.4]);
    const policy = readFileSync(join(repo, 'brain', 'politiques', 'Budget et garde-fous.md'), 'utf8');
    const growth = readFileSync(join(repo, 'brain', 'playbooks', 'Playbook Growth.md'), 'utf8');
    expect(policy).toMatch(/ROAS < 0,8 après 25 € dépensés sur au moins 2 jours/);
    expect(growth).toMatch(/ROAS < 0,8 après 25 € dépensés sur au moins 2 jours/);
    expect(growth).not.toMatch(/40 €/);
    expect(SEED_PLAYBOOKS.growth.join(' ')).toMatch(/ROAS < 0,8 après 25 € dépensés sur au moins 2 jours/);
    expect(SEED_PLAYBOOKS.growth.join(' ')).not.toMatch(/40 €/);
  });
});

// ───────────────────────────── a whole run ─────────────────────────────

describe('over 45 days', () => {
  let world: World;
  let root: string;
  let reviewNote: string;

  beforeAll(async () => {
    const m = await modules();
    root = mkdtempSync(join(tmpdir(), 'pixel-agency-run-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const seed = 14; // these tests read a healthy company: a seed where the run is one, not a property of the code
    world = m.createWorld(m.defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic' }), 'test-45');
    const brain = m.vault.createBrainVault(paths);
    const company = new m.Company(world, { paths, engine: m.minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed }), brain });
    await company.runDays(45);
    reviewNote = (await brain.read('rh/revue-semaine-6.md'))?.body ?? '';
  }, 120_000);
  afterAll(() => { if (root && existsSync(root)) clean(root); });

  const doneDays = (kind: Task['kind']) => world.company.tasks.filter((t) => t.kind === kind && t.status === 'done').map((t) => t.dayDone ?? 0).sort((a, b) => a - b);
  const longestGap = (days: number[], until: number) => Math.max(...[...days, until].map((d, i, all) => (i ? d - all[i - 1]! : 0)));

  it('a healthy company never stops researching or producing', () => {
    const k = world.company.kpis.find((x) => x.day === 15)!;
    expect(k.cash).toBeGreaterThan(world.scenario.startingCash);
    expect(longestGap(doneDays('scan_trends'), 45)).toBeLessThanOrEqual(8);
    expect(longestGap(doneDays('pick_opportunity'), 45)).toBeLessThanOrEqual(10);
    expect(longestGap(doneDays('write_pdf'), 45)).toBeLessThanOrEqual(10);
    expect(new Set(world.company.tasks.filter((t) => t.dept === 'recherche' && t.status === 'done').map((t) => t.assignee)).size).toBeGreaterThanOrEqual(3);
  });

  it('reviews genuinely ask for changes, and it shows in performance and in the HR review', () => {
    const reviews = world.company.tasks.flatMap((t) => t.reviews);
    expect(reviews.filter((r) => r.verdict === 'changes').length).toBeGreaterThan(0);
    expect(world.company.agents.filter((a) => a.perf.rejected > 0).length).toBeGreaterThan(0);
    expect(reviewNote).toMatch(/## Renvois en relecture/);
  });

  it('Red Team texts differ from one product to the next', () => {
    const ideas = world.company.tasks.filter((t) => t.kind === 'red_team' && t.input.subject === 'idea').map((t) => String((t.output?.reasons as string[] | undefined)?.[0] ?? ''));
    expect(ideas.length).toBeGreaterThan(1);
    expect(new Set(ideas).size).toBe(ideas.length);
  });

  it('every rework loop ended, and the same invented claim is caught at most once', () => {
    const cycles = world.company.tasks.filter((t) => t.kind === 'red_team').map((t) => Number(t.input.cycle ?? 0));
    expect(Math.max(...cycles)).toBeLessThanOrEqual(2);
    const claims = world.company.tasks.filter((t) => t.kind === 'fact_check').flatMap((t) => (t.output?.claims as string[] | undefined) ?? []);
    const normal = claims.map((c) => c.replace(/\d+/g, '#'));
    expect(new Set(normal).size).toBe(normal.length);
  });

  it('no question asked in a loop: a concluded test comes back on a new version or a strong drift, not again and again', () => {
    const asked = new Map<string, number>();
    for (const e of world.company.experiments.filter((x) => x.status === 'concluded')) {
      const version = world.company.tasks.filter((t) => t.kind === 'publish_product' && t.status === 'done' && t.input.republish === true && t.input.productId === e.productId && (t.dayDone ?? 0) <= e.day).length;
      const key = `${e.dimension}|${e.nicheId}|${[...e.variants].sort().join('|')}|${version}`;
      asked.set(key, (asked.get(key) ?? 0) + 1);
    }
    expect(Math.max(0, ...asked.values())).toBeLessThanOrEqual(2);
  });

  it('no advance is paid after the lesson that says they do not pay back', () => {
    const lessons = [...world.company.lessons, ...(world.company.retiredLessons ?? [])].filter((l) => l.key === 'partenariat-avance');
    const first = Math.min(...lessons.map((l) => l.day), Number.POSITIVE_INFINITY);
    expect(world.market.partnerships.filter((p) => p.upfront > 0 && p.day > first)).toEqual([]);
  });
});
