/**
 * The integration of the design build: the design bandits' prior sits on what a worn look really scores, a cover's style also
 * learns from the clicks of the ads it is the frame of, covers use their style's own compositions, a templated page shows the
 * kit and follows the 30-day rule, `refresh_design` reads and trains `design`, the founder's digest carries the « Design » block,
 * every Claude call reads the law of selling, and the V1 copy says what the law asks.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MindContext, RunPaths } from '../src/contracts.js';
import type { AdCreative, AgentState, DailyAdStats, Experiment, Product, ScenarioConfig, Task, WorldState } from '../src/shared.js';
import { pickComposition } from '../src/deliverables/art/evaluate.js';
import { styleDef } from '../src/deliverables/art/styles/index.js';
import { effortFor } from '../src/deliverables/effort.js';
import { demoContent, demoProduct, demoSalesPage } from '../src/deliverables/fixture.js';
import { renderSalesPageHtml } from '../src/deliverables/index.js';
import { kitOffer } from '../src/deliverables/kit.js';
import { REVIEWS_VERIFIED } from '../src/deliverables/sales/law.js';
import { armStats, rewardArm } from '../src/learning/bandits.js';
import { createBrainVault } from '../src/learning/index.js';
import { ensureLookArms, LOOK_PRIOR, lookDim } from '../src/learning/looks.js';
import { applyDailyRewards } from '../src/learning/retro.js';
import { systemBlocks } from '../src/minds/claude/prompts.js';
import { heuristicSalesPage } from '../src/minds/heuristic/commerce.js';
import { createContentEngine } from '../src/minds/index.js';
import { seededRng } from '../src/minds/util.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { buildDigest, designOf } from '../src/runtime/digest.js';
import { syncSalesPages } from '../src/runtime/handlers/boutique.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { deliverables } from '../src/runtime/modules.js';
import { createTask } from '../src/runtime/tasks.js';
import { craftFor, KIND_SKILL, seedTruth } from '../src/runtime/talent/index.js';
import { findPageClaims } from '../src/sim/compliance.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 3 }); });

const LONG = 300_000;
const NICHE = 'proprete-chiot';
const scenario = (over: Partial<ScenarioConfig> = {}): ScenarioConfig => defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over });

interface Shop { world: WorldState; ctx: RuntimeCtx; root: string }

async function shop(over: Partial<ScenarioConfig> = {}): Promise<Shop> {
  const world = createWorld(scenario(over), 'test-integration');
  const root = mkdtempSync(join(tmpdir(), 'pixel-integration-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }), brain });
  const ctx = (company as unknown as { ctx: RuntimeCtx }).ctx;
  world.company.research.voc[NICHE] = ctx.tools.minePains(NICHE, 'deep');
  return { world, ctx, root };
}

function newGuide(s: Shop, id: string, over: Partial<Product> = {}): Product {
  const p: Product = {
    ...demoProduct, id, nicheId: NICHE, title: 'Le chiot fait ses besoins partout', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 2, launchedDay: 3,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [], ...over,
  };
  s.world.company.products.push(p);
  return p;
}

/** A handler of the pipeline, as the company runs it: the talent pillar gives the agent the craft of the task's skill. */
async function run(s: Shop, product: Product, kind: Task['kind'], input: Record<string, unknown> = {}): Promise<{ output: Record<string, unknown>; summary: string }> {
  const agent = s.world.company.agents.find((a) => a.taskKinds.includes(kind))!;
  const craft = craftFor(s.world, agent, kind);
  const mind: MindContext = { agent, playbook: [], brainNotes: [], lessons: [], day: s.world.day, brand: 'Pixel', ...(craft ? { craft } : {}) };
  const task = createTask(s.world, { kind, assignee: agent.id, input: { productId: product.id, ...input } });
  const out = await HANDLERS[kind]!.run(s.ctx, task, agent, mind);
  expect(out.fail, kind).toBeUndefined();
  task.output = out.output ?? null;
  task.status = 'done';
  return { output: out.output ?? {}, summary: out.summary ?? '' };
}

async function written(s: Shop, product: Product): Promise<void> {
  for (const kind of ['write_titles', 'write_outline', 'write_pdf'] as const) await run(s, product, kind);
}

/** What the designer's eye judged: the cover's own input, the drawn design without the art seed the search picks after it. */
function coverOf(s: Shop, p: Product) {
  const { artSeed: _art, composition: _kept, ...design } = p.design!;
  return { title: p.title, subtitle: p.content?.subtitle || p.subtitle || '', audience: p.audience, design, brand: s.world.company.name };
}

// ───────────────────────────── 2. the prior of the design bandits ─────────────────────────────

describe('the design bandits start where a worn look scores (D203)', () => {
  it('an untried look sits on what the bandit measured, the conventions a small lift on top, worth a few days', () => {
    const w = createWorld(scenario(), 'test-prior');
    const shelf = { family: 'parentalite', archetype: null };
    const dim = lookDim('style', 'sommeil-bebe');
    const mean = (k: string): number => armStats(w, dim).find((a) => a.key === k)!.mean;
    ensureLookArms(w, 'style', 'sommeil-bebe', shelf);
    expect(mean('bauhaus')).toBeCloseTo(LOOK_PRIOR.mean, 3); // nothing measured: a typical worn look
    for (let d = 0; d < 20; d++) rewardArm(w, dim, 'bauhaus', 0.12, 2); // a niche that converts 1 %
    ensureLookArms(w, 'style', 'sommeil-bebe', shelf);
    const worn = mean('bauhaus');
    expect(worn).toBeLessThan(0.13);
    expect(mean('typo')).toBeCloseTo(worn, 3);           // neither convention nor opposite: level with the measured look
    expect(mean('trait')).toBeCloseTo(worn * 1.1, 3);    // a convention of the shelf
    expect(mean('grille')).toBeCloseTo(worn * 0.92, 3);  // its opposite
    const typo = w.company.bandits[dim]!.find((a) => a.key === 'typo')!;
    expect(typo.alpha + typo.beta).toBeCloseTo(LOOK_PRIOR.strength, 3);
    expect(LOOK_PRIOR.strength).toBeLessThanOrEqual(5);
    // days weigh as the bandit weighs them: heavy days of clicks at 0.5 and light days of sales at 0.1 put an untried look level
    // with the look that holds them, never above it (the mean of the days alone, 0.3, would)
    const v = createWorld(scenario(), 'test-prior-weights');
    const vdim = lookDim('style', 'sommeil-bebe');
    ensureLookArms(v, 'style', 'sommeil-bebe', shelf);
    for (let d = 0; d < 10; d++) { rewardArm(v, vdim, 'pop', 0.5, 0.5); rewardArm(v, vdim, 'pop', 0.1, 3); }
    ensureLookArms(v, 'style', 'sommeil-bebe', shelf);
    const at = (k: string): number => armStats(v, vdim).find((a) => a.key === k)!.mean;
    expect(at('typo')).toBeCloseTo(at('pop'), 3);
    expect(at('typo')).toBeLessThan(0.2);
    // once measured, an arm keeps its prior: its own days move it, not the others'
    rewardArm(w, dim, 'typo', 0.5, 1);
    const before = { ...w.company.bandits[dim]!.find((a) => a.key === 'typo')! };
    for (let d = 0; d < 5; d++) rewardArm(w, dim, 'bauhaus', 0.3, 2);
    ensureLookArms(w, 'style', 'sommeil-bebe', shelf);
    expect(w.company.bandits[dim]!.find((a) => a.key === 'typo')).toEqual(before);
  });
});

// ───────────────────────────── 3. a style learns from the clicks too ─────────────────────────────

describe('a cover’s style is rewarded on the clicks of the ads it is the frame of (D201)', () => {
  const row = (day: number, p: Product, c: AdCreative, impressions: number, clicks: number, landingViews: number): DailyAdStats => ({
    day, campaignId: `cmp_${p.id}`, creativeId: c.id, productId: p.id, spend: 10, impressions, clicks, ctr: clicks / impressions, cpc: 0.2, cpm: 5,
    landingViews, purchases: 0, revenue: 0, roas: 0, frequency: 1.1, comments: [],
  });
  const creative = (id: string, p: Product, format: AdCreative['format']): AdCreative => ({ id, productId: p.id, hookStyle: 'question', format } as AdCreative);

  function day(over: Partial<ScenarioConfig> = {}): WorldState {
    const w = createWorld(scenario(over), 'test-clicks');
    const base = { ...demoProduct, nicheId: 'sommeil-bebe', status: 'live' as const, kind: undefined, design: { ...demoProduct.design!, style: 'aura' as const } };
    const shown = { ...base, id: 'prd_901' } as Product;
    const film = { ...base, id: 'prd_902', design: { ...base.design, style: 'pop' as const } } as Product;
    const carousel = creative('cre_1', shown, 'carousel');
    const voice = creative('cre_2', film, 'faceless_voiceover');
    w.company.products.push(shown, film);
    w.company.creatives.push(carousel, voice);
    // 10 landing views each: under the 20 a day of conversion needs, so only the clicks can speak
    w.market.adStats.push(row(5, shown, carousel, 2000, 60, 10), row(5, film, voice, 2000, 80, 10));
    w.company.lastRetroDay = 4;
    applyDailyRewards(w, 5);
    return w;
  }

  it('the CTR of a cover-framed ad reaches its style, normalised as for the hook; a film’s does not', () => {
    const w = day();
    const arms = w.company.bandits[lookDim('style', 'sommeil-bebe')]!;
    const aura = arms.find((a) => a.key === 'aura')!;
    expect(aura.pulls).toBe(1);
    expect(aura.reward).toBeCloseTo(0.03 / 0.05, 4);                  // as hook_style: CTR over CTR_REWARD_SCALE
    const hook = w.company.bandits['hook_style:sommeil-bebe']!.find((a) => a.key === 'question')!;
    expect(hook.pulls).toBe(2);
    expect(arms.find((a) => a.key === 'pop')!.pulls).toBe(0);         // a film shows the cover only on its end card
    // once the day is in, a style nobody wore stands level with the one measured, not where the bandit stood before the day
    const mean = (k: string): number => armStats(w, lookDim('style', 'sommeil-bebe')).find((a) => a.key === k)!.mean;
    expect(mean('bauhaus')).toBeCloseTo(mean('aura'), 3);
  });

  it('without design learning, no style is rewarded', () => {
    const w = day({ control: { noDesignLearning: true } });
    expect(w.company.bandits[lookDim('style', 'sommeil-bebe')]).toBeUndefined();
  });
});

// ───────────────────────────── 4. the style's own compositions ─────────────────────────────

describe('a cover is drawn in one of its style’s real compositions (D203)', () => {
  it('a weak eye keeps the style’s default, of three for Typo XXL; a full eye the best of them, as the foundation picks', async () => {
    const weak = await shop({ control: { designTalent: 0 } });
    const g = newGuide(weak, 'prd_weak');
    await written(weak, g);
    const kept: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t = await run(weak, g, 'design_cover', { hint: 'en style typo' });
      expect(t.output).toMatchObject({ style: 'typo', styleSource: 'founder' });
      expect(t.output.composition).toBe(styleDef('typo').defaultComposition(g.design!));
      kept.push(t.output.composition as number);
    }
    expect(styleDef('typo').compositions).toHaveLength(3);
    expect(kept).toContain(2); // a third composition: never drawn while two were assumed
    const full = await shop({ control: { designTalent: 1 } });
    const h = newGuide(full, 'prd_full');
    await written(full, h);
    for (let i = 0; i < 4; i++) {
      const t = await run(full, h, 'design_cover', { hint: 'en style typo' });
      const pick = deliverables.pickComposition(coverOf(full, h), effortFor(1));
      expect(pick.explored).toBe(3);
      expect(t.output.composition).toBe(pick.composition);
    }
  }, LONG);

  it('a refresh that keeps its style draws another of its compositions, and says which', async () => {
    for (const designTalent of [0, 1]) {
      const s = await shop({ control: { designTalent } });
      const g = newGuide(s, `prd_refresh_${designTalent}`);
      await written(s, g);
      await run(s, g, 'design_cover', { hint: 'en style typo' });
      const worn = g.design!.composition!;
      const t = await run(s, g, 'refresh_design', { hint: 'garde le style typo' });
      expect(t.output).toMatchObject({ style: 'typo', previous: 'typo' });
      expect(t.output.composition).not.toBe(worn);
      expect(t.summary).toContain(`nouvelle composition « ${styleDef('typo').compositions[t.output.composition as number]!.label} »`);
    }
    // the search itself: left out while the style has another, whatever the eye
    const s = await shop();
    const g = newGuide(s, 'prd_avoid');
    await written(s, g);
    await run(s, g, 'design_cover', { hint: 'en style typo' });
    for (const avoid of [0, 1, 2]) for (const t of [0, 1]) expect(pickComposition(coverOf(s, g), effortFor(t), { avoid }).composition).not.toBe(avoid);
  }, LONG);
});

// ───────────────────────────── 5. the page shows the kit and follows the 30-day rule ─────────────────────────────

describe('a templated page shows the kit the checkout offers, and a reduction for 30 days only (D208)', () => {
  it('the bundle hero draws the live kit; the crossed-out price leaves the page once the reduction is a month old', async () => {
    const s = await shop();
    const g = newGuide(s, 'prd_bundle');
    await written(s, g);
    for (const kind of ['design_cover', 'render_pdf', 'write_sales_page'] as const) await run(s, g, kind);
    expect(g.salesPage!.template).toBeDefined();
    const kit = newGuide(s, 'prd_kit', { kind: 'kit', title: 'Le kit du chiot propre', design: { ...g.design! }, status: 'live' });
    g.bumpProductId = kit.id;
    g.salesPage = { ...g.salesPage!, template: 'value', hero: 'bundle' };
    const html = (): string => readFileSync(join(s.root, ...g.files.salesPage!.split('/')), 'utf8');
    await syncSalesPages(s.ctx);
    expect(html()).toContain('<symbol id="kit-art"');
    expect(html()).toContain('class="bd-kit"');
    kit.status = 'paused'; // the checkout stops offering it: the page stops showing it
    await syncSalesPages(s.ctx);
    expect(html()).not.toContain('class="bd-kit"');
    s.world.day = 50;
    g.priceHistory = [{ day: 10, price: 29 }, { day: 45, price: 19 }];
    g.price = 19;
    await syncSalesPages(s.ctx);
    expect(html()).toContain('class="price-was"');
    s.world.day = 74;
    await syncSalesPages(s.ctx);
    expect(html()).toContain('class="price-was"'); // the 29th day of the reduction
    s.world.day = 75; // 30 days after it started: the reduced price is the price of the month, the page follows at the end of the tick
    await syncSalesPages(s.ctx);
    expect(html()).not.toContain('class="price-was"');
  }, LONG);
});

// ───────────────────────────── 6. a refresh reads and trains design ─────────────────────────────

describe('refresh_design is design work (talent §3)', () => {
  it('maps to the design skill: the art director brings the craft of their covers to it', () => {
    expect(KIND_SKILL.refresh_design).toBe('design');
    const w = createWorld(scenario({ talent: 'league' }), 'test-skill');
    w.talentTruth ??= seedTruth(w);
    const director = w.company.agents.find((a: AgentState) => a.taskKinds.includes('refresh_design'))!;
    expect(craftFor(w, director, 'refresh_design')?.skill).toBe('design');
    expect(craftFor(w, director, 'refresh_design')).toEqual(craftFor(w, director, 'design_cover'));
  });
});

// ───────────────────────────── 8. the founder's digest carries the design block ─────────────────────────────

describe('the founder’s digest (D207)', () => {
  it('carries the « Design » block: page tests, new looks, favourites', () => {
    const w = createWorld(scenario(), 'test-digest');
    w.day = 40;
    const p = { ...demoProduct, id: 'prd_901', nicheId: 'sommeil-bebe', designLog: [{ day: 30, version: 2, style: 'aura' as const, template: 'creator' as const, hero: 'book' as const, why: 'Refonte v2 : style « Aura » au lieu de « Bauhaus »' }] } as Product;
    w.company.products.push(p);
    w.company.experiments.push({
      id: 'exp_1', day: 10, owner: 'gabriel', hypothesis: 'h', dimension: 'page_template', variants: ['express', 'creator'], metric: 'cvr', productId: p.id, nicheId: p.nicheId,
      status: 'concluded', results: { express: { n: 900, value: 0.012 }, creator: { n: 880, value: 0.031 } }, winner: 'creator', endDay: 24,
    } as Experiment);
    const d = buildDigest(w, 1, 40);
    expect(d.design).toEqual(designOf(w, d.fromDay, d.toDay));
    expect(d.design!.some((l) => l.includes('Test de page') && l.includes('« Créatrice » gagne'))).toBe(true);
    expect(d.design!.some((l) => l.includes('change de look'))).toBe(true);
  });
});

// ───────────────────────────── 9. every Claude call reads the law of selling ─────────────────────────────

describe('the Claude mind’s guardrails', () => {
  it('point every call to « Conformité vente et pub » and say its five rules', () => {
    const w = createWorld(scenario(), 'test-prompt');
    const [stable] = systemBlocks({ agent: w.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: 1 }, 'Pixel Agency');
    const line = stable!.text.split('\n').find((l) => l.includes('« Conformité vente et pub »'));
    expect(line).toBeDefined();
    for (const rule of ['plus bas des 30 jours précédents', 'garantie commerciale', 'ni fausse urgence ni fausse rareté', 'avis vérifiés', 'jamais inventés', '« Images virtuelles »']) expect(line, rule).toContain(rule);
    expect(stable!.cache_control).toEqual({ type: 'ephemeral' }); // in the stable prefix every call shares
  });
});

// ───────────────────────────── 10. the V1 copy says what the law asks ─────────────────────────────

describe('the V1 copy and page (D208)', () => {
  const voc = { nicheId: 'n', depth: 'deep' as const, pains: demoSalesPage.painBullets, phrases: ['on a tout essayé'], objections: [], desiredOutcomes: ['des nuits de 6 heures'], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [19], bannedClaims: [] };

  it('the guarantee is the shop’s own, valid after the download, never « satisfait ou remboursé »', () => {
    for (const hype of [0.2, 0.4, 0.6]) {
      const { guarantee } = heuristicSalesPage({ product: demoProduct, content: demoContent, voc, hype }, seededRng(5, 'page'), { maxHype: null, banned: [], brand: 'Pixel' });
      expect(guarantee).not.toMatch(/satisfait ou rembours/i);
      expect(guarantee).toContain('même après le téléchargement');
      expect(guarantee).not.toMatch(/garanti/i); // a playbook may ban the word: the guarantee never needs it
      expect(findPageClaims([guarantee])).toEqual([]);
    }
    const kit = kitOffer({ content: demoContent }, { title: demoProduct.title, salesPage: demoSalesPage });
    expect(kit.guarantee).not.toMatch(/satisfait ou rembours/i);
  });

  it('the V1 page says how its reviews are verified, and names a commercial guarantee only when the copy states one', () => {
    const review = { id: 'rev_1', day: 3, rating: 5, text: 'Très utile.', customerId: 'cus_1', orderId: 'ord_1' };
    const page = (over: Partial<Product> = {}, sp = demoSalesPage): string => renderSalesPageHtml({ product: { ...demoProduct, content: demoContent, ...over }, salesPage: sp, coverSvg: '<svg viewBox="0 0 10 10"></svg>', design: demoProduct.design!, brand: 'Pixel Agency' });
    const reviewed = page({ stats: { ...demoProduct.stats, reviews: [review] as Product['stats']['reviews'], rating: 5 } });
    expect(reviewed).toContain('1 avis vérifiés');
    expect(reviewed).toContain(REVIEWS_VERIFIED);
    expect(reviewed).not.toMatch(/Satisfait ou rembours/);
    expect(reviewed).toContain('Notre garantie commerciale');
    expect(page({}, { ...demoSalesPage, guarantee: '' })).not.toContain('Garantie commerciale');
  });
});
