/**
 * Design build, package L (design plan D201 to D205): the market's hidden taste for looks, what it does to conversion and clicks,
 * the agents' choices on their own stream, the needs of a look, page tests, lessons and rules, refreshes, the two controls, and a
 * reload in the middle of a page test.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentEngine, DayPlanItem, RunPaths } from '../src/contracts.js';
import type { ArtStyle, DailyAdStats, Experiment, NicheTruth, PageTemplate, Product, ScenarioConfig, VisualTaste, WorldState } from '../src/shared.js';
import { ART_STYLES, PAGE_HEROES, PAGE_TEMPLATES } from '../src/shared.js';
import { liveSnapshotJson, toSnapshot, viewOf, type ViewName } from '../src/api/snapshot.js';
import { onActivity, streamRng } from '../src/core/index.js';
import { designFor } from '../src/deliverables/design.js';
import { startExperiment } from '../src/learning/experiments.js';
import { createBrainVault } from '../src/learning/index.js';
import { chooseLook, eligibleLooks, LOOK_RULE, lookDim, lookLabel, variantOn } from '../src/learning/looks.js';
import { createContentEngine } from '../src/minds/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { designOf } from '../src/runtime/digest.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { officerId } from '../src/runtime/org/officers.js';
import { parsePlaybook } from '../src/runtime/playbook.js';
import { materialize, planDesignRefresh, REFRESH } from '../src/runtime/strategy.js';
import { STREAM } from '../src/runtime/streams.js';
import { LOOK_MARKET, styleConvention, TASTE } from '../src/sim/catalog/looks.js';
import { ensureVisualTaste, meanOne } from '../src/sim/market.js';
import { lookCtr, lookCvr } from '../src/sim/tick.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 }); });

/** Lab runs of a full company are long proofs: under the whole suite a day costs several times what it costs alone. */
const LONG = 600_000;

const scenario = (over: Partial<ScenarioConfig> = {}): ScenarioConfig => defaultScenario({ seed: 1, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 120, ...over });

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; paths: RunPaths; open(w: WorldState): Promise<Company> }

const ctxOf = (c: Company): RuntimeCtx => (c as unknown as { ctx: RuntimeCtx }).ctx;

async function lab(over: Partial<ScenarioConfig> = {}, wrap: (e: ContentEngine) => ContentEngine = (e) => e): Promise<Lab> {
  const world = createWorld(scenario(over), 'test-design');
  const root = mkdtempSync(join(tmpdir(), 'pixel-design-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const open = async (w: WorldState): Promise<Company> => {
    const brain = createBrainVault(paths);
    await brain.init();
    return new Company(w, { paths, engine: wrap(createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: w.scenario.seed })), brain });
  };
  const company = await open(world);
  return { world, company, ctx: ctxOf(company), paths, open };
}

/** Every call an engine receives, arguments and context, as text. */
function recording(calls: string[]) {
  return (engine: ContentEngine): ContentEngine => new Proxy(engine, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(`${String(key)} ${JSON.stringify(args)}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

function filesText(dir: string): string {
  let out = '';
  for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, name);
    if (statSync(path).isFile() && /\.(md|json|html|svg)$/.test(name)) out += readFileSync(path, 'utf8');
  }
  return out;
}

const neutral = (keys: readonly string[]): Record<string, number> => Object.fromEntries(keys.map((k) => [k, 1]));
const tasteWith = (over: { style?: Record<string, number>; page?: Record<string, number>; hero?: Record<string, number> }): VisualTaste => ({
  style: { ...neutral(ART_STYLES), ...over.style } as VisualTaste['style'],
  page: { ...neutral(PAGE_TEMPLATES), ...over.page } as VisualTaste['page'],
  hero: { ...neutral(PAGE_HEROES), ...over.hero } as VisualTaste['hero'],
});

/** A guide as the market and the strategy read it: only what these tests set matters. */
function guide(id: string, over: Partial<Product> = {}): Product {
  return {
    id, nicheId: 'sommeil-bebe', title: `Guide ${id}`, subtitle: '', audience: 'parents', problem: 'réveils', price: 19, status: 'live', version: 1,
    content: null, design: { ...designFor({ nicheName: 'Sommeil de bébé', category: 'Parentalité', seed: 1 }), style: 'bauhaus' },
    salesPage: { headline: 'h', subheadline: 's', painBullets: [], solution: '', chapterBlurbs: [], bonusBlurb: '', objections: [], guarantee: '', cta: '', hypeLevel: 0.4, template: 'express', hero: 'book' },
    files: { pdf: null, cover: null, salesPage: null, previews: ['p.svg'] }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 1, launchedDay: 5, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
    ...over,
  };
}

function row(day: number, productId: string, landingViews: number, purchases: number): DailyAdStats {
  return {
    day, campaignId: `cmp_${productId}`, creativeId: `cre_${productId}`, productId, spend: 5, impressions: landingViews * 40, clicks: landingViews, ctr: 0.025, cpc: 0.2, cpm: 5,
    landingViews, purchases, revenue: purchases * 19, roas: (purchases * 19) / 5, frequency: 1.1, comments: [],
  };
}

// ───────────────────────────── the hidden taste ─────────────────────────────

describe('hidden taste (D201)', () => {
  it('averages exactly 1 on every record, inside its range, on every niche of five seeds', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const w = createWorld(scenario({ seed }), 'test-taste');
      for (const n of w.market.niches) {
        const t = n.visualTaste!;
        expect(Object.keys(t.style)).toEqual([...ART_STYLES]);
        expect(Object.keys(t.page)).toEqual([...PAGE_TEMPLATES]);
        expect(Object.keys(t.hero)).toEqual([...PAGE_HEROES]);
        for (const [rec, range] of [[t.style, TASTE.style], [t.page, TASTE.page], [t.hero, TASTE.hero]] as const) {
          const values = Object.values(rec);
          expect(values.reduce((a, b) => a + b, 0) / values.length, `${seed} ${n.id}`).toBeCloseTo(1, 12);
          for (const v of values) {
            expect(v).toBeGreaterThanOrEqual(range.min - 1e-12);
            expect(v).toBeLessThanOrEqual(range.max + 1e-12);
          }
        }
      }
    }
  });

  it('keeps the mean at 1 where the range clamps', () => {
    const v = meanOne([3, 1, 1, 1, 0.2], 0.86, 1.16);
    expect(v.reduce((a, b) => a + b, 0) / v.length).toBeCloseTo(1, 12);
    expect(v[0]).toBe(1.16);
    expect(v[4]).toBe(0.86);
  });

  it('follows the genre conventions before the run’s draw: a convention style beats an opposite one on average', () => {
    const sums = { convention: [0, 0], opposite: [0, 0] };
    for (let seed = 1; seed <= 12; seed++) {
      for (const n of createWorld(scenario({ seed }), 'test-taste').market.niches) {
        const family = designFor({ nicheName: n.name, category: n.category, keywords: n.keywords, seed: 0 }).family;
        for (const s of ART_STYLES) {
          const c = styleConvention(s, family);
          const side = c > 0 ? sums.convention : c < 0 ? sums.opposite : null;
          if (side) { side[0] += n.visualTaste!.style[s]; side[1] += 1; }
        }
      }
    }
    expect(sums.convention[0]! / sums.convention[1]!).toBeGreaterThan(sums.opposite[0]! / sums.opposite[1]! + 0.1);
  });

  it('draws on its own stream: a world with the visual model off holds every other byte of the market', () => {
    const on = createWorld(scenario({ seed: 5 }), 'test-a');
    const off = createWorld(scenario({ seed: 5, visualModel: 'off' }), 'test-b');
    expect(on.rngState).toBe(off.rngState);
    const strip = (w: WorldState): string => JSON.stringify({ ...w.market, niches: w.market.niches.map(({ visualTaste: _t, ...n }) => n) });
    expect(strip(on)).toBe(strip(off));
    expect(off.market.niches.some((n) => n.visualTaste)).toBe(false);
  });

  it('gives a save without taste the taste a new run draws, at its first market close', async () => {
    const l = await lab({ seed: 9 });
    const expected = l.world.market.niches.map((n) => n.visualTaste);
    const old = JSON.parse(JSON.stringify(l.world)) as WorldState;
    for (const n of old.market.niches) delete n.visualTaste;
    const company = await l.open(old);
    for (let i = 0; i < 12; i++) await company.step();
    expect(old.market.niches.map((n) => n.visualTaste)).toEqual(expected);
    const v1 = JSON.parse(JSON.stringify(l.world)) as WorldState;
    v1.scenario.visualModel = 'off';
    for (const n of v1.market.niches) delete n.visualTaste;
    ensureVisualTaste(v1);
    expect(v1.market.niches.some((n) => n.visualTaste)).toBe(false);
  });
});

// ───────────────────────────── what the market does with a look ─────────────────────────────

describe('market effects of looks (D201)', () => {
  const on = { scenario: { visualModel: 'on' } } as WorldState;
  const niche = (taste?: VisualTaste): NicheTruth => ({ visualTaste: taste }) as NicheTruth;
  const taste = tasteWith({ style: { aura: 1.12 }, page: { express: 1.15, proof: 1.1, inside: 0.95 }, hero: { desk: 1.04 } });
  const p = (over: Partial<Product> = {}): Product => guide('prd_1', { design: { ...guide('x').design!, style: 'aura' }, ...over });
  const page = (template: PageTemplate) => ({ ...guide('x').salesPage!, template, hero: 'desk' as const });

  it('multiplies conversion by page × hero × style^0.35, and reads 1 without a look', () => {
    expect(lookCvr(on, niche(taste), p({ salesPage: page('express') }))).toBeCloseTo(1.15 * 1.04 * 1.12 ** LOOK_MARKET.cvrStyleExp, 12);
    expect(lookCvr(on, niche(taste), p({ design: guide('x').design && { ...guide('x').design!, style: undefined }, salesPage: { ...page('express'), template: undefined, hero: undefined } }))).toBe(1);
    expect(lookCvr(on, niche(undefined), p({ salesPage: page('value') }))).toBe(1);
  });

  it('adds the public conditions of a template: price for express and editorial, proof without reviews, inside without pages', () => {
    const flat = niche(tasteWith({}));
    const plain = (template: PageTemplate, over: Partial<Product> = {}): number => lookCvr(on, flat, p({ design: { ...guide('x').design!, style: undefined }, salesPage: page(template), ...over }));
    expect(plain('express', { price: 9 })).toBeCloseTo(LOOK_MARKET.priceLift, 12);
    expect(plain('express', { price: 39 })).toBeCloseTo(LOOK_MARKET.priceDrop, 12);
    expect(plain('express', { price: 19 })).toBe(1);
    expect(plain('editorial', { price: 9 })).toBeCloseTo(LOOK_MARKET.priceDrop, 12);
    expect(plain('editorial', { price: 39 })).toBeCloseTo(LOOK_MARKET.priceLift, 12);
    expect(plain('proof')).toBeCloseTo(LOOK_MARKET.proofWithout, 12);
    const reviewed = { ...guide('x').stats, ratingCount: 5 };
    expect(plain('proof', { stats: reviewed })).toBe(1);
    expect(plain('inside', { files: { pdf: null, cover: null, salesPage: null, previews: [] } })).toBeCloseTo(LOOK_MARKET.insideWithout, 12);
  });

  it('reads the cover in the clicks: style^0.8 where the frame is the cover, ^0.4 in a film, nothing in a search ad', () => {
    expect(lookCtr(on, niche(taste), p(), 'static_image')).toBeCloseTo(1.12 ** 0.8, 12);
    expect(lookCtr(on, niche(taste), p(), 'carousel')).toBeCloseTo(1.12 ** 0.8, 12);
    expect(lookCtr(on, niche(taste), p(), 'text_slideshow')).toBeCloseTo(1.12 ** 0.8, 12);
    expect(lookCtr(on, niche(taste), p(), 'faceless_voiceover')).toBeCloseTo(1.12 ** 0.4, 12);
    expect(lookCtr(on, niche(taste), p(), 'search_text')).toBe(1);
  });

  it('leaves the V1 market untouched: visual model off, or the designV1 control', () => {
    for (const w of [{ scenario: { visualModel: 'off' } }, { scenario: { visualModel: 'on', control: { designV1: true } } }] as WorldState[]) {
      expect(lookCvr(w, niche(taste), p({ salesPage: page('express') }))).toBe(1);
      expect(lookCtr(w, niche(taste), p(), 'static_image')).toBe(1);
    }
  });
});

// ───────────────────────────── a shared run ─────────────────────────────

interface Shared { l: Lab; calls: string[]; marks: string[]; feed: string[] }
let shared: Promise<Shared> | null = null;

/** One default company, 40 days, with a sentinel planted in every niche's taste: what it may never show. The feed is kept whole. */
function sharedRun(): Promise<Shared> {
  shared ??= (async () => {
    const calls: string[] = [];
    const feed: string[] = [];
    const l = await lab({ seed: 3 }, recording(calls));
    const marks = ['1.0987654', '0.9123457'];
    for (const n of l.world.market.niches) {
      n.visualTaste!.style.aura = Number(marks[0]);
      n.visualTaste!.page.express = Number(marks[1]);
    }
    const stop = onActivity((a) => { if (a.text) feed.push(a.text); });
    try {
      await l.company.runDays(40);
    } finally {
      stop();
    }
    return { l, calls, marks, feed };
  })();
  return shared;
}

describe('the taste stays hidden (E4)', () => {
  it('never reaches a snapshot, a view, a prompt, the feed or the brain; god mode shows it', async () => {
    const { l, calls, marks, feed } = await sharedRun();
    const views = (['org', 'league', 'channels', 'growth', 'digest', 'deliverables', 'playbook'] as ViewName[]).map((v) => {
      try { return JSON.stringify(viewOf(l.world, v, new URLSearchParams())); } catch { return ''; }
    });
    const products = l.world.company.products.map((p) => { try { return JSON.stringify(viewOf(l.world, 'product', new URLSearchParams({ id: p.id }))); } catch { return ''; } });
    const outside = [JSON.stringify(toSnapshot(l.world, false)), liveSnapshotJson(l.world), JSON.stringify(l.world.company), JSON.stringify(l.world.activity), ...feed, ...views, ...products, ...calls, filesText(l.paths.brain)];
    expect(calls.length).toBeGreaterThan(50);
    for (const text of outside) for (const m of ['visualTaste', ...marks]) expect(text.includes(m), m).toBe(false);
    const god = toSnapshot(l.world, true).godMode!.niches;
    expect(god.every((n) => n.visualTaste)).toBe(true);
    expect(JSON.stringify(god)).toContain(marks[0]);
  }, LONG);

  it('every page wears a look its guide can show, and every choice says why in the feed', async () => {
    const { l, feed } = await sharedRun();
    const guides = l.world.company.products.filter((p) => p.kind !== 'kit' && p.salesPage);
    expect(guides.some((p) => p.salesPage!.template)).toBe(true);
    for (const p of guides) {
      const previews = (p.files.previews?.length ?? 0) > 0;
      if (p.salesPage!.template === 'inside') expect(previews, p.id).toBe(true);
      if (p.salesPage!.template === 'proof') expect(Math.max(p.stats.reviews.length, p.stats.ratingCount ?? 0), p.id).toBeGreaterThanOrEqual(5);
      if (p.salesPage!.hero === 'devices' || p.salesPage!.hero === 'spread') expect(previews, p.id).toBe(true);
      if (p.salesPage!.hero === 'bundle') expect(!!p.bumpProductId || !!p.content?.bonus?.title, p.id).toBe(true);
    }
    expect(feed.some((t) => /choisit le style « [^»]+ » : \S/.test(t))).toBe(true);
    expect(feed.some((t) => /choisit le gabarit « [^»]+ » et le visuel « [^»]+ » : \S/.test(t))).toBe(true);
    const logged = l.world.company.products.filter((p) => p.designLog?.length);
    expect(logged.length).toBeGreaterThan(0);
    for (const p of logged) for (const e of p.designLog!) expect(e.why.length, p.id).toBeGreaterThan(10);
  }, LONG);
});

// ───────────────────────────── choices ─────────────────────────────

describe('choices draw on STREAM.design alone (D203)', () => {
  it('leave the company stream and the ids of the V1 looks untouched until a look reaches the market', async () => {
    const states = async (l: Lab): Promise<number[]> => {
      const out: number[] = [];
      while (!l.world.company.products.some((p) => p.launchedDay !== null) && l.world.day < 30) {
        await l.company.step();
        out.push(l.ctx.rng.state());
      }
      return out;
    };
    const def = await lab({ seed: 4 });
    const v1 = await lab({ seed: 4, control: { designV1: true } });
    const [a, b] = [await states(def), await states(v1)];
    expect(a.length).toBeGreaterThan(36);
    expect(a).toEqual(b);
    expect(def.world.idCounter).toBe(v1.world.idCounter);
    expect(def.world.company.products.some((p) => p.design?.style && p.salesPage?.template && p.salesPage.hero)).toBe(true);
    expect(v1.world.company.products.some((p) => p.design?.style || p.salesPage?.template || p.salesPage?.hero)).toBe(false);
  }, LONG);

  it('never pick a look whose needs fail, whatever the hint or the rule names', () => {
    const bare = guide('prd_1', { files: { pdf: null, cover: null, salesPage: null, previews: [] }, bumpProductId: null, content: null });
    expect(eligibleLooks(bare, 'template')).toEqual(['express', 'editorial', 'creator', 'value']);
    expect(eligibleLooks(bare, 'hero')).toEqual(['book', 'desk']);
    const full = guide('prd_2', { stats: { ...bare.stats, ratingCount: 6 }, bumpProductId: 'prd_3' });
    expect(eligibleLooks(full, 'template')).toEqual([...PAGE_TEMPLATES]);
    expect(eligibleLooks(full, 'hero')).toEqual([...PAGE_HEROES]);
    const w = createWorld(scenario(), 'test-needs');
    const eligible = eligibleLooks(bare, 'template');
    for (let i = 0; i < 300; i++) {
      const pick = chooseLook(w, { kind: 'template', nicheId: 'sommeil-bebe', shelf: { family: 'parentalite', archetype: 'paliers' }, eligible, founder: 'proof', rule: 'inside', rng: streamRng(i, STREAM.design) });
      expect(eligible).toContain(pick!.key);
    }
  });

  it('follow a playbook rule for the niche before the bandit, and say so', async () => {
    const l = await lab({ seed: 6 });
    for (const id of Object.keys(l.world.company.playbooks)) {
      l.world.company.playbooks[id]!.push(`${LOOK_RULE.style} « Pop »`, `${LOOK_RULE.template} « Valeur claire »`, `${LOOK_RULE.hero} « Livre 3D »`);
    }
    for (let i = 0; i < 40 * 12 && !l.world.company.products.some((p) => p.salesPage?.template); i++) await l.company.step();
    const p = l.world.company.products.find((x) => x.salesPage?.template)!;
    expect(p.design?.style).toBe('pop');
    expect(p.salesPage!.template).toBe('value');
    expect(p.salesPage!.hero).toBe('book');
    expect(l.world.activity.some((a) => /choisit le style « Pop » : règle du playbook/.test(a.text))).toBe(true);
    expect(parsePlaybook([`${LOOK_RULE.template} « Mur d’avis » sur « Sommeil de bébé »`], 'Sommeil de bébé').pageTemplate).toBe('proof');
    expect(parsePlaybook([`${LOOK_RULE.template} « proof » sur « Sommeil de bébé »`], 'Propreté du chiot').pageTemplate).toBeNull();
  }, LONG);
});

// ───────────────────────────── page tests ─────────────────────────────

/** The first live guide with a page, its campaigns running, and nothing that rewrites it. */
function testable(w: WorldState): Product | undefined {
  return w.company.products.find((p) => p.status === 'live' && p.kind !== 'kit' && p.salesPage?.template
    && w.company.campaigns.some((c) => c.productId === p.id && c.status === 'active'));
}

function openPageTest(w: WorldState, p: Product, taste?: { control: number; challenger: number }): Experiment {
  const current = p.salesPage!.template!;
  const challenger = eligibleLooks(p, 'template').find((t) => t !== current)!;
  for (const e of w.company.experiments) if (e.dimension === 'page_template' && e.status === 'running') e.status = 'cancelled'; // the company's own test leaves the slot
  if (taste) {
    const n = w.market.niches.find((x) => x.id === p.nicheId)!;
    n.visualTaste = { ...n.visualTaste!, page: { ...n.visualTaste!.page, [current]: taste.control, [challenger]: taste.challenger } };
  }
  return startExperiment(w, {
    nicheId: p.nicheId, productId: p.id, hypothesis: `Sur « ${p.title} », le gabarit ${lookLabel('template', challenger)} convertit mieux que ${lookLabel('template', current)}`,
    dimension: 'page_template', variants: [current, challenger], metric: 'cvr', day: w.day, owner: officerId(w, 'analyst'),
  });
}

describe('a page test (D204)', () => {
  it('opens, alternates by day, re-renders the page, and concludes into a lesson and a rule', async () => {
    // a road of the market: the first guide on sale must keep its traffic for two weeks. Since the integration, seed 1's falls to
    // 8 sales, under the 10 a winner needs; seed 4's concludes for the challenger with a wide lead.
    const l = await lab({ seed: 4 });
    const w = l.world;
    for (let i = 0; i < 40 * 12 && !testable(w); i++) await l.company.step();
    const p = testable(w)!;
    expect(p).toBeDefined();
    const e = openPageTest(w, p, { control: 0.2, challenger: 4 });
    const [control, challenger] = e.variants as [PageTemplate, PageTemplate];
    const seen = new Set<string>();
    for (let i = 0; i < 18 * 12 && e.status === 'running'; i++) {
      const r = await l.company.step();
      if (r.phase !== 'morning' || e.status !== 'running') continue;
      expect(p.salesPage!.template).toBe(variantOn(e, r.day));
      expect(p.pagePrint).toContain(`/${p.salesPage!.template}/`); // the page followed at the end of the morning
      seen.add(p.salesPage!.template!);
    }
    expect([...seen].sort()).toEqual([control, challenger].sort());
    expect(e.status).toBe('concluded');
    expect(e.winner).toBe(challenger);
    // the evening of the conclusion: a lesson, routed to the studio, creation and the shop; its rule reads back for the niche
    const lesson = w.company.lessons.find((x) => x.insight.startsWith(`${LOOK_RULE.template} « ${lookLabel('template', challenger)} »`));
    expect(lesson).toBeDefined();
    const shop = officerId(w, 'shop');
    expect(w.company.playbooks[shop]).toContain(lesson!.insight);
    const niche = w.company.research.trends.find((t) => t.nicheId === p.nicheId)?.name ?? w.market.niches.find((n) => n.id === p.nicheId)!.name;
    expect(parsePlaybook(w.company.playbooks[shop]!, niche).pageTemplate).toBe(challenger);
    expect(w.company.agents.filter((a) => a.dept === 'creation' || a.dept === 'studio').every((a) => w.company.playbooks[a.id]?.includes(lesson!.insight))).toBe(true);
    // the morning after, the page keeps the winner, in the guide's log
    for (let i = 0; i < 12 && p.salesPage!.template !== challenger; i++) await l.company.step();
    expect(p.salesPage!.template).toBe(challenger);
    expect(p.designLog!.at(-1)!.why).toContain('gagne le test A/B');
  }, LONG);

  it('ends like an uninterrupted run when the world reloads in the middle of it', async () => {
    const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));
    const play = async (reloadEvery: number): Promise<{ dump: string; reloads: number; during: number }> => {
      const l = await lab({ seed: 1 });
      let { world, company } = l;
      let test: Experiment | undefined;
      let reloads = 0;
      let during = 0;
      for (let i = 1; i <= 26 * 12; i++) {
        await company.step();
        if (!test && world.day >= 12 && world.tick === 1) {
          const p = testable(world);
          if (p) test = openPageTest(world, p);
        }
        if (reloadEvery && i % reloadEvery === 0) {
          if (world.company.experiments.some((e) => e.dimension === 'page_template' && e.status === 'running')) during += 1;
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = await l.open(world);
          test = test && world.company.experiments.find((e) => e.id === test!.id);
          reloads += 1;
        }
      }
      return { dump: decisions(world), reloads, during };
    };
    const straight = await play(0);
    const reloaded = await play(7);
    expect(reloaded.during).toBeGreaterThan(10);
    expect(reloaded.dump === straight.dump).toBe(true);
  }, LONG);
});

// ───────────────────────────── refresh ─────────────────────────────

describe('refresh of a look (D204)', () => {
  /** Two guides of one niche: the one in Bauhaus and Express converts half as well as the one in Aura and Créatrice. */
  async function lagging(over: Partial<ScenarioConfig> = {}): Promise<{ l: Lab; a: Product; b: Product }> {
    const l = await lab({ seed: 2, ...over });
    const w = l.world;
    const a = guide('prd_901', { launchedDay: 10 });
    const b = guide('prd_902', { launchedDay: 10, design: { ...guide('x').design!, style: 'aura' }, salesPage: { ...guide('x').salesPage!, template: 'creator' } });
    w.company.products.push(a, b);
    for (let day = 11; day <= 120; day++) {
      w.market.adStats.push(row(day, a.id, 20, day % 3 === 0 ? 1 : 0), row(day, b.id, 20, day % 3 === 0 ? 2 : 0));
    }
    w.day = 50;
    return { l, a, b };
  }
  const plan = (l: Lab): DayPlanItem[] => {
    const items: DayPlanItem[] = [];
    planDesignRefresh(l.ctx, items, []);
    return items;
  };

  it('schedules a new version for a guide whose look lags its niche, at most once a day for the company', async () => {
    const { l, a, b } = await lagging();
    const items = plan(l);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'refresh_design', input: { productId: a.id, pipeline: 'refresh', excludeStyle: true, excludeTemplate: true } });
    expect(String(items[0]!.why)).toContain('« Bauhaus »');
    const tasks = materialize(l.ctx, items, { createdBy: officerId(l.world, 'ceo'), missionId: null });
    expect(tasks.map((t) => t.kind)).toEqual(['refresh_design', 'render_pdf', 'write_sales_page', 'publish_product']);
    expect(a.version).toBe(2);
    expect(plan(l)).toHaveLength(0); // one a day for the company
    l.world.day += 1;
    expect(plan(l)).toHaveLength(0); // the guide is under refresh
    expect(b.version).toBe(1);
  }, LONG);

  it('waits 30 days before the same guide again, 21 days after a launch, and never without design learning', async () => {
    const { l, a } = await lagging();
    a.designLog = [{ day: 50, version: 2, style: 'bauhaus', template: 'express', hero: 'book', why: 'Refonte v2 : style « Bauhaus » gardé' }];
    l.world.day = 50 + REFRESH.gapDays - 1;
    expect(plan(l)).toHaveLength(0);
    l.world.day = 50 + REFRESH.gapDays;
    expect(plan(l).map((i) => i.input.productId)).toEqual([a.id]);
    const young = await lagging();
    young.a.launchedDay = young.l.world.day - REFRESH.minAgeDays + 1;
    expect(plan(young.l)).toHaveLength(0);
    for (const control of [{ noDesignLearning: true }, { designV1: true }]) expect(plan((await lagging({ control })).l)).toHaveLength(0);
  }, LONG);
});

// ───────────────────────────── controls ─────────────────────────────

describe('controls (D205)', () => {
  it('noDesignLearning draws every look uniformly, ignores rules and tests, and learns nothing', async () => {
    const w = createWorld(scenario({ control: { noDesignLearning: true } }), 'test-control');
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const pick = chooseLook(w, { kind: 'style', nicheId: 'sommeil-bebe', shelf: { family: 'parentalite', archetype: 'habitude' }, eligible: ART_STYLES, rule: 'pop', test: 'aura', rng: streamRng(i, STREAM.design, 1) })!;
      expect(pick.source).toBe('random');
      counts.set(pick.key, (counts.get(pick.key) ?? 0) + 1);
    }
    for (const s of ART_STYLES) expect((counts.get(s) ?? 0) / 4000, s).toBeGreaterThan(0.1);
    for (const s of ART_STYLES) expect((counts.get(s) ?? 0) / 4000, s).toBeLessThan(0.15);
    const l = await lab({ seed: 3, control: { noDesignLearning: true } });
    await l.company.runDays(30);
    const c = l.world.company;
    expect(c.products.some((p) => p.design?.style && p.salesPage?.template)).toBe(true);
    expect(Object.keys(c.bandits).filter((k) => /^(cover_style|page_template|page_hero):/.test(k))).toEqual([]);
    expect(c.experiments.filter((e) => e.dimension === 'page_template')).toEqual([]);
    expect(c.lessons.filter((x) => Object.values(LOOK_RULE).some((r) => x.insight.startsWith(r)))).toEqual([]);
    expect(c.tasks.filter((t) => t.kind === 'refresh_design')).toEqual([]);
    expect(l.world.activity.some((a) => /tirage au sort/.test(a.text))).toBe(true);
  }, LONG);

  it('designV1 keeps the V1 looks: no style, template or hero, and a market that reads none', async () => {
    const l = await lab({ seed: 3, control: { designV1: true } });
    await l.company.runDays(25);
    const c = l.world.company;
    expect(c.products.some((p) => p.salesPage)).toBe(true);
    for (const p of c.products) {
      expect(p.design?.style, p.id).toBeUndefined();
      expect(p.salesPage?.template, p.id).toBeUndefined();
      expect(p.salesPage?.hero, p.id).toBeUndefined();
      expect(p.designLog ?? [], p.id).toEqual([]);
    }
    expect(Object.keys(c.bandits).some((k) => k.startsWith(lookDim('style', '').slice(0, -1)))).toBe(false);
  }, LONG);
});

describe('the founder’s « Design » block (D207)', () => {
  it('says what the page tests found, which guides changed their look, and what each niche favours', () => {
    const w = createWorld(scenario(), 'test-digest');
    const p = guide('prd_901', { designLog: [{ day: 30, version: 2, style: 'aura', template: 'creator', hero: 'book', why: 'Refonte v2 : style « Aura » au lieu de « Bauhaus »' }] });
    w.company.products.push(p);
    w.company.experiments.push({
      id: 'exp_1', day: 10, owner: 'gabriel', hypothesis: 'h', dimension: 'page_template', variants: ['express', 'creator'], metric: 'cvr', productId: p.id, nicheId: p.nicheId,
      status: 'concluded', results: { express: { n: 900, value: 0.012 }, creator: { n: 880, value: 0.031 } }, winner: 'creator', endDay: 24,
    } as Experiment);
    w.company.bandits[lookDim('style', p.nicheId)] = [{ key: 'aura', alpha: 8, beta: 12, pulls: 9, reward: 3 }, { key: 'pop', alpha: 2, beta: 9, pulls: 6, reward: 1 }];
    const lines = designOf(w, 1, 40);
    expect(lines.some((l) => l.includes('Test de page') && l.includes('« Créatrice » gagne'))).toBe(true);
    expect(lines.some((l) => l.includes('change de look') && l.includes('Aura'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Préférés sur') && l.includes('style « Aura »'))).toBe(true);
    expect(designOf(w, 41, 50).some((l) => l.includes('change de look'))).toBe(false);
  });
});

/** Styles the agents may name as a founder's hint: only after the word of their kind, so « il aura » names no style. */
describe('a founder’s words name a look', () => {
  it('reads « style pop », « gabarit éditorial », « mur d’avis », never « il aura »', async () => {
    const { lookIn } = await import('../src/learning/looks.js');
    expect(lookIn('style', 'Refais la couverture en style pop')).toBe('pop');
    expect(lookIn('style', 'Une couverture Ligne claire')).toBe('trait');
    expect(lookIn('style', 'Il aura une belle couverture')).toBeNull();
    expect(lookIn('template', 'Passe la page en gabarit éditoriale')).toBe('editorial');
    expect(lookIn('template', 'Un mur d’avis sur la page')).toBe('proof');
    expect(lookIn('hero', 'Mets le visuel Livre 3D')).toBe('book');
    const styles: ArtStyle[] = [...ART_STYLES];
    expect(styles.every((s) => lookIn('style', `en style ${s}`) === s)).toBe(true);
  });
});
