/**
 * Copy, page and buying levers (talent §4.2, §4.3, §4.5, D26): what talent changes in the text a writer hands in and in
 * what a buyer does with a campaign. Numbered tests are those of talent §11. Each lever is read on the real scorers, on
 * every niche of a first run: a lever seen on one guide would prove little.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, AgentState, Campaign, DailyAdStats, HookStyle, NicheBrief, NicheTruth, PdfContent, Product, SalesPage, Task, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { AdDraft, ContentEngine, Craft, MindContext, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { designFor } from '../src/deliverables/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { AD_CLICHES, heuristicAd, makeHook } from '../src/minds/heuristic/ads.js';
import { heuristicSalesPage } from '../src/minds/heuristic/commerce.js';
import { buildNicheCtx } from '../src/minds/heuristic/niche.js';
import { seededRng, type LocalRng } from '../src/minds/util.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { boutiqueHandlers } from '../src/runtime/handlers/boutique.js';
import { growthHandlers, reworkCraft, stopLossReason } from '../src/runtime/handlers/growth.js';
import { campaignMetrics } from '../src/runtime/metrics.js';
import { sim } from '../src/runtime/modules.js';
import { armSharp, bestDraft, craftOf, pruneRead, shrunkRoas } from '../src/runtime/talent/craft.js';
import { createTask } from '../src/runtime/tasks.js';
import { countHype, findBannedClaims } from '../src/sim/compliance.js';
import { NICHE_CATALOG } from '../src/sim/niches.js';
import { genericPhraseHits, scoreCreative, scoreSalesPage, unbackedClaims, vocPhraseHits } from '../src/sim/quality.js';
import { norm } from '../src/sim/text.js';
import { LEGACY } from './legacy.js';

vi.mock('../src/runtime/talent/craft.js', async (load) => {
  const real = await load<typeof import('../src/runtime/talent/craft.js')>();
  return { ...real, armSharp: vi.fn(real.armSharp) };
});

// ───────────────────────────── fixtures ─────────────────────────────

const SEED = 7;
const DRAWS = 40;
const HYPES = [0.2, 0.4, 0.6, 0.8];
const FORMATS = ['faceless_voiceover', 'text_slideshow', 'carousel', 'ugc_avatar'] as const;

interface Guide { niche: NicheTruth; voc: VoiceOfCustomer; product: Product; content: PdfContent; hooks: { hook: string; hookStyle: HookStyle }[] }

const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: SEED });
const writer = { id: 'ecrivain', name: 'Léa', tier: 'sonnet', hiredDay: 0 } as AgentState;
const mindOn = (day: number, craft?: Craft): MindContext => ({ agent: writer, playbook: [], brainNotes: [], lessons: [], day, ...(craft ? { craft } : {}) });

const productOf = (n: NicheTruth, content: PdfContent | null, title: string): Product => ({
  id: 'prd_1', nicheId: n.id, title, subtitle: '', audience: n.audience, problem: n.problem, price: 19, status: 'live', version: 1, content,
  design: designFor({ nicheName: n.name, category: n.category, seed: 1 }),
  salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: { overall: 85 } as Product['quality'], salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
  stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
});

async function guideOf(n: NicheTruth): Promise<Guide> {
  const brief: NicheBrief = { nicheId: n.id, name: n.name, audience: n.audience, problem: n.problem, category: n.category, keywords: n.keywords };
  const [title] = await engine.writeTitles({ niche: brief, voc: n.voc, count: 1 }, mindOn(3));
  const outline = await engine.writeOutline({ title: title!, niche: brief, voc: n.voc }, mindOn(3));
  const content = await engine.writePdfContent({ title: title!, outline, niche: brief, voc: n.voc, upsellTitle: null }, mindOn(3));
  const product = productOf(n, content, title!);
  const hooks = await engine.writeAdHooks({ product, voc: n.voc, styles: ['question', 'mistake', 'pov', 'stat'] }, mindOn(3));
  return { niche: n, voc: n.voc, product, content, hooks };
}

const asCreative = (d: AdDraft, productId = 'prd_1'): AdCreative => ({
  ...d, id: 'cre_x', productId, files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: 1, createdBy: writer.id,
});
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

/** The company's `ctx` as far as a draft needs it: the talent stream reads the world, `bestDraft` the engine's mode. */
const draftCtx = (day: number) => ({ engine, world: { day, tick: 0, scenario: { seed: SEED } } }) as unknown as RuntimeCtx;

function adInput(g: Guide, i: number) {
  const h = g.hooks[i % g.hooks.length]!;
  return { product: g.product, voc: g.voc, hook: h.hook, hookStyle: h.hookStyle, format: FORMATS[i % FORMATS.length]!, bannedClaims: g.voc.bannedClaims };
}

/** One creative as this writer hands it in: its drafts, read by its own eye. */
async function handedInAd(g: Guide, i: number, craft?: Craft): Promise<number> {
  const score = (d: AdDraft) => scoreCreative(asCreative(d), g.product, g.voc).overall;
  return (await bestDraft(draftCtx(i + 1), writer, mindOn(i + 1, craft), 'ad', (m) => engine.writeAd(adInput(g, i), m), score)).realScore;
}

async function handedInPage(g: Guide, i: number, craft?: Craft): Promise<number> {
  const hype = HYPES[i % HYPES.length]!;
  const score = (sp: SalesPage) => scoreSalesPage({ ...sp, hypeLevel: hype }, g.product, g.voc).overall;
  return (await bestDraft(draftCtx(i + 1), writer, mindOn(i + 1, craft), 'page', (m) => engine.writeSalesPage({ product: g.product, content: g.content, voc: g.voc, hype }, m), score)).realScore;
}

async function meanAcross(guides: Guide[], handIn: (g: Guide, i: number) => Promise<number>): Promise<number> {
  const scores: number[] = [];
  for (const g of guides) for (let i = 0; i < DRAWS; i++) scores.push(await handIn(g, i));
  return mean(scores);
}

/** `chance` answers yes on the listed calls only: one flaw site at a time, the rest of the stream untouched. */
function forced(...fire: number[]): LocalRng {
  const base = seededRng(1, 'forced');
  let call = 0;
  return { ...base, chance: () => fire.includes(call++) };
}

const adWith = (g: Guide, fire: number[], t = 0.5): AdDraft => heuristicAd(adInput(g, 0), seededRng(SEED, 'ad'), { banned: [], preferredFormats: [], t, flaw: 0.5, flawRng: forced(...fire) });
const pageWith = (g: Guide, hype: number, fire: number[], draw?: number): SalesPage => ({
  ...heuristicSalesPage({ product: g.product, content: g.content, voc: g.voc, hype }, seededRng(SEED, 'page', draw), { maxHype: null, banned: [], brand: 'Pixel Agency', flaw: 0.5, flawRng: forced(...fire), ...(draw ? { draw } : {}) }),
  hypeLevel: hype,
});

let guides: Guide[] = [];
beforeAll(async () => {
  for (const n of NICHE_CATALOG.slice(0, 12)) guides.push(await guideOf(n));
});

// ───────────────────────────── copy ─────────────────────────────

describe('copy lever (talent §4.2)', () => {
  it('6. mean scoreCreative over 40 draws: t=.8 at least 4 points above t=.2', async () => {
    const weak = await meanAcross(guides, (g, i) => handedInAd(g, i, craftOf('copy', 0.2, 'sonnet')));
    const strong = await meanAcross(guides, (g, i) => handedInAd(g, i, craftOf('copy', 0.8, 'sonnet')));
    expect(strong - weak).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('a writer without craft writes the same ad as before, flaw 0 too: flaws are text, not a second scorer', async () => {
    const g = guides[0]!;
    const plain = await engine.writeAd(adInput(g, 0), mindOn(3));
    const none = heuristicAd(adInput(g, 0), seededRng(SEED, 'a'), { banned: [], preferredFormats: [] });
    const flawless = heuristicAd(adInput(g, 0), seededRng(SEED, 'a'), { banned: [], preferredFormats: [], flaw: 0, flawRng: seededRng(SEED, 'b') });
    expect(flawless).toEqual(none);
    expect(plain).toEqual(await engine.writeAd(adInput(g, 0), { ...mindOn(3), draw: 0 }));
  });

  it('each flaw site writes what its row says, and only the two blocking ones block', () => {
    const g = guides.find((x) => x.product.problem.length > 0 && !scoreCreative(asCreative(adWith(x, [])), x.product, x.voc).blocking?.length)!;
    const clean = adWith(g, []);
    const base = scoreCreative(asCreative(clean), g.product, g.voc);
    const site = (fire: number) => { const d = adWith(g, [fire]); return { d, q: scoreCreative(asCreative(d), g.product, g.voc) }; };

    const a1 = site(0);
    expect(a1.d.scenes[1]!.voiceover).not.toBe(clean.scenes[1]!.voiceover);
    expect(a1.q.specificity + a1.q.humanTone).toBeLessThanOrEqual(base.specificity + base.humanTone);

    const a2 = site(1);
    expect(genericPhraseHits(norm(a2.d.scenes.map((s) => s.voiceover).join(' '))).total).toBeGreaterThan(genericPhraseHits(norm(clean.scenes.map((s) => s.voiceover).join(' '))).total);
    expect(a2.q.humanTone).toBeLessThan(base.humanTone);

    const a3 = site(2);
    expect(a3.d.scenes[2]!.onScreenText.split(/\s+/).length).toBeGreaterThan(12);
    expect(a3.q.design).toBeLessThan(base.design);

    const a4 = site(3);
    expect(base.overall - a4.q.overall).toBeGreaterThanOrEqual(4);
    expect((a4.q.blocking ?? []).map((b) => b.text).join(' ')).toMatch(/première scène/);

    const a5 = site(4);
    expect(base.overall - a5.q.overall).toBeGreaterThanOrEqual(9);
    expect((a5.q.blocking ?? []).map((b) => b.text).join(' ')).toMatch(/appel à l'action/i);

    for (const soft of [a1, a2, a3]) expect(soft.q.blocking ?? []).toEqual([]);
  });

  it('every stock line holds a cliché the scorer counts, and no claim the platform refuses', () => {
    for (const line of AD_CLICHES) {
      expect(genericPhraseHits(norm(line)).total, line).toBeGreaterThanOrEqual(1);
      expect(countHype([line]), line).toBe(0);
      expect(findBannedClaims([line], []), line).toEqual([]);
    }
  });

  it('a stronger writer picks a hook that names the problem more often', () => {
    const g = guides[0]!;
    const c = buildNicheCtx({ nicheId: g.niche.id, name: g.product.title, audience: g.niche.audience, problem: g.niche.problem, category: '', keywords: [] }, g.voc);
    const key = new Set(norm(`${g.niche.problem} ${g.niche.audience}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 5));
    const named = (t: number) => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const hook = makeHook('mistake', c, seededRng(SEED, 'hook', i), null, new Set(), t);
        n += norm(hook).split(/[^a-z0-9]+/).filter((w) => key.has(w)).length;
      }
      return n;
    };
    expect(named(0.9)).toBeGreaterThan(named(0.1));
  });

  it('a stronger writer slips fewer risky lines into a hype-ish style', () => {
    const g = guides[0]!;
    const risky = (t: number) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const d = heuristicAd({ ...adInput(g, 0), hookStyle: 'stat', bannedClaims: [] }, seededRng(SEED, 'risky', i), { banned: [], preferredFormats: [], t });
        if (/garanti|100 %|à coup sûr|3 jours seulement/.test(d.scenes[3]!.voiceover)) n++;
      }
      return n / 300;
    };
    const [weak, strong] = [risky(0.1), risky(0.9)];
    expect(weak).toBeGreaterThan(0.3);
    expect(strong).toBeLessThan(0.1);
  });
});

// ───────────────────────────── page ─────────────────────────────

describe('page lever (talent §4.3)', () => {
  it('7. drafts vary at t=.5, and t=.8 beats t=.2 by at least 6 points over 40 draws', async () => {
    const g = guides[0]!;
    const middling: number[] = [];
    for (let i = 0; i < DRAWS; i++) middling.push(await handedInPage(g, i * HYPES.length, craftOf('page', 0.5, 'sonnet')));
    expect(sd(middling)).toBeGreaterThan(0);

    const weak = await meanAcross(guides, (x, i) => handedInPage(x, i, craftOf('page', 0.2, 'sonnet')));
    const strong = await meanAcross(guides, (x, i) => handedInPage(x, i, craftOf('page', 0.8, 'sonnet')));
    expect(strong - weak).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('draw 0 of a flawless writer is today\'s page, word for word', async () => {
    for (const hype of HYPES) {
      const g = guides[1]!;
      const today = await engine.writeSalesPage({ product: g.product, content: g.content, voc: g.voc, hype }, mindOn(3));
      expect(pageWith(g, hype, [])).toEqual({ ...today, hypeLevel: hype });
    }
  });

  it('a further draft opens on another customer phrase and reorders the pains, never a word outside the research', () => {
    const g = guides[0]!;
    const zero = pageWith(g, 0.4, []);
    const drafts = [1, 2, 3, 4, 5].map((d) => pageWith(g, 0.4, [], d));
    expect(new Set(drafts.map((d) => d.headline)).size).toBeGreaterThan(1);
    expect(drafts.every((d) => [...d.painBullets].sort().join('|') === [...zero.painBullets].sort().join('|'))).toBe(true);
    expect(drafts.some((d) => d.painBullets.join('|') !== zero.painBullets.join('|'))).toBe(true);
    const opened = drafts.filter((d) => d.headline !== zero.headline);
    expect(opened.length).toBeGreaterThan(0);
    for (const d of opened) expect(vocPhraseHits(norm(d.headline), g.voc), d.headline).toBeGreaterThan(0);
  });

  it('each flaw site costs what its row says, and none sells what the guide does not hold', () => {
    const low = HYPES[0]!;
    const costs: Record<string, number[]> = { p1: [], p2: [], p3: [], p4: [], p4both: [] };
    for (const g of guides) {
      const score = (sp: SalesPage) => scoreSalesPage(sp, g.product, g.voc).overall;
      const base = (h: number) => score(pageWith(g, h, []));
      costs.p1!.push(base(low) - score(pageWith(g, low, [0])));
      for (const hype of HYPES.slice(1, 3)) {
        costs.p2!.push(base(hype) - score(pageWith(g, hype, [1])));
        costs.p3!.push(base(hype) - score(pageWith(g, hype, [2])));
        costs.p4!.push(base(hype) - score(pageWith(g, hype, [3])));
        costs.p4both!.push(base(hype) - score(pageWith(g, hype, [3, 4])));
        for (const fire of [[0], [1], [2], [3], [3, 4], [0, 1, 2, 3, 4]]) {
          expect(unbackedClaims(pageWith(g, hype, fire), g.content).lies, `${g.niche.id} ${fire}`).toEqual(unbackedClaims(pageWith(g, hype, []), g.content).lies);
        }
      }
    }
    expect(Math.max(...costs.p1!)).toBeGreaterThanOrEqual(5);
    expect(mean(costs.p2!)).toBeGreaterThan(2.5);
    expect(mean(costs.p3!)).toBeGreaterThan(6);
    expect(mean(costs.p4!)).toBeGreaterThan(2);
    expect(mean(costs.p4both!)).toBeGreaterThan(mean(costs.p4!));
  });

  it('P2 leaves no number in the headline when the outcomes offer one without', () => {
    for (const g of guides.filter((x) => x.voc.desiredOutcomes.some((o) => !/\d/.test(o)))) {
      expect(pageWith(g, 0.4, [1]).headline, g.niche.id).not.toMatch(/\d/);
    }
  });
});

// ───────────────────────────── buying ─────────────────────────────

function row(creativeId: string, day: number, impressions: number, clicks: number, over: Partial<DailyAdStats> = {}): DailyAdStats {
  return {
    day, campaignId: 'cmp_1', creativeId, productId: 'prd_1', spend: 10, impressions, clicks, ctr: impressions ? clicks / impressions : 0, cpc: clicks ? 10 / clicks : 0, cpm: 2,
    landingViews: clicks, purchases: 0, revenue: 0, roas: 0, frequency: 1.2, comments: [], ...over,
  };
}

describe('pruneRead (talent §4.5)', () => {
  const twoDays = (a: [number, number], b: [number, number]) => [10, 11].flatMap((d) => [row('a', d, a[0] / 2, a[1] / 2), row('b', d, b[0] / 2, b[1] / 2)]);

  it('9. CTR 3 % and 1 % on 1 500 impressions: t=.8 drops the second, t=.2 does not', () => {
    const rows = twoDays([1500, 45], [1500, 15]);
    expect(pruneRead(rows, ['a', 'b'], 0.8)).toEqual(['b']);
    expect(pruneRead(rows, ['a', 'b'], 0.2)).toEqual([]);
  });

  it('9. the best creative is never dropped, whatever the sample', () => {
    const rng = seededRng(SEED, 'prune');
    for (let i = 0; i < 300; i++) {
      const ids = ['a', 'b', 'c', 'd'];
      const rows = ids.flatMap((id) => [10, 11, 12].map((d) => { const n = rng.int(200, 2000); return row(id, d, n, Math.floor(n * rng.next() * 0.05)); }));
      const dropped = pruneRead(rows, ids, rng.next());
      const ctr = (id: string) => { const r = rows.filter((x) => x.creativeId === id); return r.reduce((s, x) => s + x.clicks, 0) / r.reduce((s, x) => s + x.impressions, 0); };
      const top = ids.slice().sort((x, y) => ctr(y) - ctr(x))[0]!;
      expect(dropped).not.toContain(top);
      expect(dropped.length).toBeLessThan(ids.length);
    }
  });

  it('a noise-sized gap stays, and so does a lone creative', () => {
    expect(pruneRead(twoDays([3000, 60], [3000, 54]), ['a', 'b'], 0.9)).toEqual([]);
    expect(pruneRead([row('a', 10, 9000, 5)], ['a'], 0.9)).toEqual([]);
  });
});

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A world, a real engine, and the `ctx` a handler runs with. Legacy team: the tests below name no agent but pin its kinds. */
async function bench(over: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-agency-levers-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const world = createWorld(defaultScenario({ ...LEGACY, seed: SEED, mindMode: 'heuristic', ...over }), 'test-levers');
  const eng: ContentEngine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: SEED });
  const brain = createBrainVault(paths);
  await brain.init();
  const rng = createRng(world.rngState);
  const ctx: RuntimeCtx = { world, engine: eng, brain, tools: sim.createMarketTools(world, rng), rng, channelRng: rng, ritual: async () => undefined, paths, incidents: [], lastMarketNotes: [] };
  return { world, ctx, eng };
}

describe('optimize_ads (talent §4.5, D26)', () => {
  async function company(over: Record<string, unknown> = {}) {
    const { world, ctx } = await bench(over);
    const niche = world.market.niches[0]!;
    world.company.research.voc[niche.id] = niche.voc;
    const product = productOf(niche, null, 'Le guide du test');
    world.company.products.push(product);
    const buyer = world.company.agents.find((a) => a.taskKinds.includes('optimize_ads'))!;
    world.day = 20;
    return { world, ctx, product, buyer };
  }

  function campaign(world: WorldState, product: Product, creativeIds: string[], dailyBudget = 20): Campaign {
    for (const id of creativeIds) world.company.creatives.push({ ...asCreative({ hook: `Hook ${id}`, hookStyle: 'question', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '' }, product.id), id, review: { status: 'approved', reason: null, day: 1 } });
    const c: Campaign = { id: 'cmp_1', productId: product.id, name: 'Campagne test', creativeIds, dailyBudget, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 10, createdBy: 'test' };
    world.company.campaigns.push(c);
    return c;
  }

  /** Two creatives over the last 4 days, CTR 3 % and 1 % on 1 500 impressions each: only a strong read sees it. */
  function strongAndWeak(world: WorldState, product: Product) {
    const rows = [16, 17, 18, 19].flatMap((day) => [
      row('cre_a', day, 375, 11, { productId: product.id, spend: 12, revenue: 24, roas: 2 }),
      row('cre_b', day, 375, 4, { productId: product.id, spend: 12, revenue: 24, roas: 2 }),
    ]);
    world.market.adStats.push(...rows);
  }

  const optimize = async (ctx: RuntimeCtx, buyer: AgentState, t?: number) => growthHandlers.optimize_ads!.run(
    ctx, createTask(ctx.world, { kind: 'optimize_ads', input: {} }), buyer,
    { agent: buyer, playbook: [], brainNotes: [], lessons: [], day: ctx.world.day, ...(t === undefined ? {} : { craft: craftOf('buying', t, buyer.tier) }) },
  );

  it('a strong buyer drops the loser before the fatigue pass, a weak one and the legacy code do not', async () => {
    for (const [t, kept] of [[0.8, ['cre_a']], [0.2, ['cre_a', 'cre_b']], [undefined, ['cre_a', 'cre_b']]] as const) {
      const { world, ctx, product, buyer } = await company();
      const c = campaign(world, product, ['cre_a', 'cre_b']);
      strongAndWeak(world, product);
      const out = await optimize(ctx, buyer, t);
      expect(c.creativeIds, `t=${t}`).toEqual(kept);
      if (kept.length === 1) expect(String(out.summary)).toMatch(/1 créa\(s\) perdante\(s\) retirée\(s\)/);
    }
  });

  it('a dropped creative stays approved, and a drop waits for nobody in approval mode', async () => {
    const { world, ctx, product, buyer } = await company({ founderApproval: true });
    const c = campaign(world, product, ['cre_a', 'cre_b']);
    strongAndWeak(world, product);
    const out = await optimize(ctx, buyer, 0.8);
    expect(c.creativeIds).toEqual(['cre_a']);
    expect(world.company.creatives.find((x) => x.id === 'cre_b')!.review.status).toBe('approved');
    expect(out.awaitFounder).toBeUndefined();
  });

  it('a thin lucky sample scales under the raw read, not under a strong buyer\'s', async () => {
    const budgetAfter = async (t?: number) => {
      const { world, ctx, product, buyer } = await company();
      const c = campaign(world, product, ['cre_a'], 10);
      world.market.adStats.push(row('cre_a', 19, 2000, 40, { productId: product.id, spend: 12, revenue: 24, roas: 2 }));
      await optimize(ctx, buyer, t);
      return c.dailyBudget;
    };
    expect(await budgetAfter()).toBe(13);
    expect(await budgetAfter(0.8)).toBe(10);
    expect(shrunkRoas(24, 12, 0.8)).toBeLessThan(1.8);
  });

  it('a shrunk read never trims a campaign under the stop-loss line: tomorrow\'s sample must arrive whole', async () => {
    const { world, ctx, product, buyer } = await company();
    const c = campaign(world, product, ['cre_a'], 20);
    // 22 € at ROAS 0,7 over three days: under the line, under the stop-loss sample of 25 €. Shrunk, it reads 0,98
    for (const day of [17, 18, 19]) world.market.adStats.push(row('cre_a', day, 1000, 20, { productId: product.id, spend: 22 / 3, revenue: (22 * 0.7) / 3, roas: 0.7 }));
    await optimize(ctx, buyer, 0.8);
    expect(c).toMatchObject({ status: 'active', dailyBudget: 20 });
  });

  it('10. the stop-loss is the same for every t: it reads the raw number, a buyer never holds it back', async () => {
    const reasons = new Set<string>();
    for (const t of [undefined, 0, 0.2, 0.5, 0.8, 1]) {
      const { world, ctx, product, buyer } = await company();
      const c = campaign(world, product, ['cre_a', 'cre_b'], 20);
      strongAndWeak(world, product);
      for (const r of world.market.adStats) { r.revenue = r.spend * 0.5; r.roas = 0.5; }
      const out = await optimize(ctx, buyer, t);
      expect(c.status, `t=${t}`).toBe('paused');
      reasons.add(String(out.summary));
    }
    expect(reasons.size).toBe(1);
    const rows = [17, 18, 19].map((day) => row('cre_a', day, 1000, 20, { spend: 10, revenue: 5, roas: 0.5 }));
    const life = campaignMetrics(rows, 'cmp_1', 10);
    expect(stopLossReason(life, life)).toMatch(/stop-loss/);
  });
});

// ───────────────────────────── drafts and reads ─────────────────────────────

describe('handlers draft and read (talent §4.1, §4.8)', () => {
  afterEach(() => { vi.mocked(armSharp).mockClear(); });

  async function live() {
    const { world, ctx, eng } = await bench();
    const g = await guideOf(world.market.niches[0]!);
    world.company.research.voc[g.niche.id] = g.voc;
    const product = productOf(g.niche, g.content, g.product.title);
    world.company.products.push(product);
    const hooks = createTask(world, { kind: 'write_ad_hooks', input: { productId: product.id } });
    Object.assign(hooks, { status: 'done', dayDone: world.day, output: { hooks: g.hooks } });
    const owner = (kind: Task['kind']) => world.company.agents.find((a) => a.taskKinds.includes(kind))!;
    const mind = (a: AgentState, craft?: Craft): MindContext => ({ agent: a, playbook: [], brainNotes: [], lessons: [], day: world.day, ...(craft ? { craft } : {}) });
    return { world, ctx, eng, g, product, owner, mind };
  }

  /** The real engine, with one method replaced: `ContentEngine` is a class, its methods live on the prototype. */
  const spied = (eng: ContentEngine, over: Partial<ContentEngine>): ContentEngine => Object.assign(Object.create(eng) as ContentEngine, over);

  it('produce_ad hands in the draft its writer reads as best, and spends one id', async () => {
    const { world, ctx, eng, product, owner, mind } = await live();
    const a = owner('produce_ad');
    const draws: (number | undefined)[] = [];
    // Eye 0 at t=1: draft 2 is the only clean one, the writer must see it
    ctx.engine = spied(eng, {
      writeAd: async (input, m) => {
        draws.push(m.draw);
        const d = await eng.writeAd(input, { ...m, craft: undefined, draw: undefined });
        return m.draw === 2 ? d : { ...d, cta: '', scenes: d.scenes.slice(0, 2) };
      },
    });
    const before = world.company.creatives.length;
    const task = createTask(world, { kind: 'produce_ad', input: { productId: product.id } });
    const out = await growthHandlers.produce_ad!.run(ctx, task, a, mind(a, craftOf('copy', 1, 'sonnet')));
    expect(draws).toEqual([undefined, 1, 2, 3]);
    const fresh = world.company.creatives.slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.id).toBe(out.output?.creativeId);
    expect(fresh[0]!.cta).not.toBe('');
    expect(fresh[0]!.scenes.length).toBeGreaterThan(2);
  }, 30_000);

  it('without craft a task is one draft, as before', async () => {
    const { world, ctx, eng, product, owner, mind } = await live();
    const a = owner('produce_ad');
    let calls = 0;
    ctx.engine = spied(eng, { writeAd: async (input, m) => { calls++; return eng.writeAd(input, m); } });
    await growthHandlers.produce_ad!.run(ctx, createTask(world, { kind: 'produce_ad', input: { productId: product.id } }), a, mind(a));
    expect(calls).toBe(1);
  }, 30_000);

  it('write_sales_page keeps its best draft too, and the page online is that draft', async () => {
    const { world, ctx, eng, product, owner, mind } = await live();
    const a = owner('write_sales_page');
    ctx.engine = spied(eng, {
      writeSalesPage: async (input, m) => {
        const sp = await eng.writeSalesPage(input, { ...m, craft: undefined, draw: undefined });
        return m.draw === 1 ? sp : { ...sp, headline: 'Trop court', objections: [] };
      },
    });
    const task = createTask(world, { kind: 'write_sales_page', input: { productId: product.id } });
    await boutiqueHandlers.write_sales_page!.run(ctx, task, a, mind(a, craftOf('page', 1, 'sonnet')));
    expect(product.salesPage!.headline).not.toBe('Trop court');
    expect(product.salesPage!.objections.length).toBeGreaterThan(0);
  }, 30_000);

  it('a rework halves the flaws, a first attempt and a writer without craft stay as they are', () => {
    const craft = craftOf('copy', 0.2, 'sonnet');
    const m: MindContext = { agent: writer, playbook: [], brainNotes: [], lessons: [], day: 3, craft };
    expect(reworkCraft({ attempts: 0 } as Task, m)).toBe(m);
    expect(reworkCraft({ attempts: 1 } as Task, m).craft!.flaw).toBeCloseTo(craft.flaw / 2);
    expect(craft.flaw).toBeCloseTo(craftOf('copy', 0.2, 'sonnet').flaw);
    const plain: MindContext = { agent: writer, playbook: [], brainNotes: [], lessons: [], day: 3 };
    expect(reworkCraft({ attempts: 2 } as Task, plain)).toBe(plain);
  });

  it('every bandit read of copy and page goes through the agent\'s eye: hook ×3, format, hype', async () => {
    const { world, ctx, product, owner, mind } = await live();
    const purposes = () => vi.mocked(armSharp).mock.calls.map((c) => c[3]);
    const copy = craftOf('copy', 0.8, 'sonnet');

    const hooks = owner('write_ad_hooks');
    await growthHandlers.write_ad_hooks!.run(ctx, createTask(world, { kind: 'write_ad_hooks', input: { productId: product.id } }), hooks, mind(hooks, copy));
    expect(purposes()).toEqual(['hook']);
    vi.mocked(armSharp).mockClear();

    const ad = owner('produce_ad');
    await growthHandlers.produce_ad!.run(ctx, createTask(world, { kind: 'produce_ad', input: { productId: product.id, variant: 1 } }), ad, mind(ad, copy));
    expect(purposes()).toEqual(['hook', 'format']);
    vi.mocked(armSharp).mockClear();

    const page = owner('write_sales_page');
    await boutiqueHandlers.write_sales_page!.run(ctx, createTask(world, { kind: 'write_sales_page', input: { productId: product.id } }), page, mind(page, craftOf('page', 0.8, 'sonnet')));
    expect(purposes()).toEqual(['hype']);
    vi.mocked(armSharp).mockClear();

    const poster = owner('post_organic');
    world.company.bandits[`hook_style:${product.nicheId}`] ??= [];
    await growthHandlers.post_organic!.run(ctx, createTask(world, { kind: 'post_organic', input: { productId: product.id } }), poster, mind(poster, copy));
    expect(purposes()).toEqual(['hook']);
  }, 30_000);
});

// ───────────────────────────── reload ─────────────────────────────

describe('a reload with every lever live', () => {
  const decisions = (w: unknown) => JSON.stringify(w, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  /** Long enough for a campaign to be read: a run that never prunes would prove nothing about these streams. */
  async function play(ticks: number, reloadEvery: number): Promise<{ world: WorldState; text: string }> {
    const root = mkdtempSync(join(tmpdir(), 'pixel-agency-levers-'));
    try {
      const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
      const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: SEED }), brain: createBrainVault(paths) };
      let world = createWorld(defaultScenario({ seed: SEED, mindMode: 'heuristic', horizonDays: 90 }), 'test-levers');
      let company = new Company(world, opts);
      for (let i = 1; i <= ticks; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = new Company(world, opts);
        }
      }
      return { world, text: decisions(world) };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('ends like an uninterrupted run, a pruned campaign included', async () => {
    const ticks = 21 * 12;
    const straight = await play(ticks, 0);
    const pruned = straight.world.company.tasks.flatMap((t) => (t.kind === 'optimize_ads' ? (t.output?.actions as string[] | undefined) ?? [] : [])).filter((a) => /perdante/.test(a));
    expect(pruned.length).toBeGreaterThan(0);
    expect((await play(ticks, 7)).text === straight.text).toBe(true);
  }, 240_000);
});
