/**
 * The visual score reaches the market (pdf §12, §13, D32). The formulas are read on planted audits, the levels on the real
 * layout of the fixture, the market on two seeded days, the studio through its real handlers.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MindContext, PdfAudit, RunPaths } from '../src/contracts.js';
import type { AgentState, DesignEffort, DesignSpec, PdfContent, Product, ScenarioConfig, Task, VisualReport, WorldState } from '../src/shared.js';
import { createRng } from '../src/core/index.js';
import { toSnapshot, liveSnapshotJson } from '../src/api/snapshot.js';
import { coverScore } from '../src/deliverables/art/evaluate.js';
import { demoContent, demoProduct, demoSalesPage } from '../src/deliverables/fixture.js';
import { effortFor } from '../src/deliverables/effort.js';
import { coverAudit, designFor, pickArt, visualReport } from '../src/deliverables/index.js';
import { layoutPdf } from '../src/deliverables/pdf.js';
import { createBrainVault, MAX_LEVEL } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { scoreContent } from '../src/runtime/handlers/studio.js';
import { reviewTask } from '../src/runtime/review.js';
import { roleHolders } from '../src/runtime/org/officers.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { onDone, phi } from '../src/runtime/talent/evidence.js';
import { createTask } from '../src/runtime/tasks.js';
import { createMarketTools, scorePdf, scoreSalesPage, tickMarket } from '../src/sim/index.js';
import { refundProbability, reviewMean } from '../src/sim/tick.js';
import { VISUAL, visualCvr, visualRating, visualRefund, visualWtp } from '../src/sim/visual.js';
import { LEGACY } from './legacy.js';

/** Calls through, so that the market's and the tools' own reading of a guide can be seen. */
vi.mock('../src/sim/quality.js', async (actual) => {
  const real = await actual<typeof import('../src/sim/quality.js')>();
  return { ...real, scorePdf: vi.fn(real.scorePdf) };
});

const report = (over: Partial<VisualReport> = {}): VisualReport => ({
  version: 1, cover: 70, interior: 70, overall: 70, effort: effortFor(0.3), explored: 3, issues: [], ...over,
});

const AUDIT: PdfAudit = {
  pages: 30, bytes: 200_000, degraded: false, textPages: 12, shortPages: 0, fillMean: 0.8, widows: 0, strandedHeadings: 0,
  railShare: 0.6, figureKinds: 4, figuresPerChapter: 1, sheets: 2, overflow: 0,
};
const COVER = { art: 70, thumbPx: 13, lineBalance: 80, contrast: 12, titleLines: 3 };

/** The demo guide with what the writers add: a rail on every chapter, and half its visuals as second ones, that only finish 2 prints. */
const FULL: PdfContent = {
  ...demoContent,
  chapters: demoContent.chapters.map((c, k) => ({
    ...c, visual: k % 2 ? null : c.visual, figure: k % 2 ? c.visual : null,
    margin: { note: 'Un réveil sur deux suit un repère qui change : gardez le même rituel une semaine entière.', quote: 'Elle se rendort seule depuis qu’on garde la même heure.' },
  })),
};
const SEEDS = Array.from({ length: 24 }, (_, i) => 11 + i * 37);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const mind = { agent: { id: 'ag', name: 'Margaux', role: 'Rédactrice', dept: 'studio', persona: '', skills: [], tools: [] }, playbook: [], brainNotes: [], lessons: [], day: 3 } as never;

/** A guide as the writers write it: the fixture of P7.4, and of the numbers in `effort.ts`. */
async function guideOf(nicheId: string, seed = 7): Promise<Product> {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-visual-${seed}`);
  const tools = createMarketTools(world, createRng(seed));
  const niche = tools.nicheBrief(nicheId)!;
  const voc = tools.minePains(nicheId, 'deep');
  const eng = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
  const title = (await eng.writeTitles({ niche, voc, count: 3 }, mind))[0]!;
  const outline = await eng.writeOutline({ title, niche, voc, upsellOf: null }, mind);
  const draft = await eng.writePdfContent({ title, outline, niche, voc, upsellTitle: null, upsellOf: null }, mind);
  const { content } = await eng.factCheck({ content: await eng.humanize({ content: draft, flagged: [], voc }, mind), voc }, mind);
  return { ...demoProduct, title, content, subtitle: content.subtitle, audience: content.audience };
}

function reportOn(p: Product, design: DesignSpec, effort: DesignEffort): VisualReport {
  const art = pickArt(design, effort);
  const drawn = { ...design, artSeed: art.seed };
  const guide = layoutPdf({ product: p, content: p.content!, design: drawn, brand: 'Pixel Agency', effort });
  const cover = coverAudit({ title: p.title, subtitle: p.subtitle, audience: p.audience, design: drawn, brand: 'Pixel Agency' });
  return visualReport({ ...guide.audit, bytes: 0, degraded: guide.degraded }, cover, effort, art.explored);
}

describe('effortFor', () => {
  it('is monotone in talent, on every lever', () => {
    const levels = Array.from({ length: 21 }, (_, i) => effortFor(i / 20));
    levels.slice(1).forEach((e, i) => {
      const before = levels[i]!;
      expect(e.covers).toBeGreaterThanOrEqual(before.covers);
      expect(e.layouts).toBeGreaterThanOrEqual(before.layouts);
      expect(e.taste).toBeGreaterThan(before.taste);
      expect(e.finish).toBeGreaterThanOrEqual(before.finish);
    });
    expect([levels[0], levels[20]]).toEqual([{ covers: 1, layouts: 2, taste: 0.4, finish: 0 }, { covers: 8, layouts: 24, taste: 1, finish: 2 }]);
  });

  it('a rework buys two more candidates, and only that', () => {
    expect(effortFor(0.5, 2)).toEqual({ ...effortFor(0.5), covers: effortFor(0.5).covers + 4 });
  });
});

describe('talent on the fixture', () => {
  const TALENTS = [0.1, 0.4, 0.8];
  let guides: Product[] = [];
  /** Per guide, per talent: the same designs, so only the designer differs. */
  const levels = (): VisualReport[][][] => guides.map((p) => TALENTS.map((t) => SEEDS.map((seed) => reportOn(p, { ...demoProduct.design!, seed }, effortFor(t)))));

  beforeAll(async () => {
    guides = await Promise.all(['proprete-chiot', 'sommeil-bebe', 'urssaf-micro'].map((id) => guideOf(id)));
  }, 60_000);

  it('`interior` and `cover` rise with talent, level by level, and the mark the market reads with them', () => {
    const reports = levels();
    /** The mean over the three guides and all the designs, one number per talent. */
    const read = (of: (r: VisualReport) => number): number[] => TALENTS.map((_, t) => mean(reports.map((guide) => mean(guide[t]!.map(of)))));
    const [low, mid, high] = read((r) => r.interior);
    expect(mid!).toBeGreaterThan(low! + 10);
    expect(high!).toBeGreaterThan(mid!);
    const [drawnLow, drawnMid, drawnHigh] = read((r) => r.cover);
    expect(drawnMid!).toBeGreaterThan(drawnLow!);
    expect(drawnHigh!).toBeGreaterThan(drawnMid!);
    const [overallLow, overallMid, overallHigh] = read((r) => r.overall);
    expect(overallMid!).toBeGreaterThan(overallLow! + 5);
    expect(overallHigh!).toBeGreaterThan(overallMid!);
    for (const guide of reports) {
      const [one, , three] = guide.map((rows) => mean(rows.map((r) => r.interior)));
      expect(three!).toBeGreaterThan(one! + 10);
    }
  }, 120_000);

  it('a figure added at the top finish costs no rail points: only pages with a paragraph can hold one', () => {
    const [p] = guides;
    const at = (t: number) => layoutPdf({ product: p!, content: p!.content!, design: demoProduct.design!, brand: 'Pixel Agency', effort: effortFor(t) }).audit;
    expect(at(0.8).textPages).toBeGreaterThan(at(0.4).textPages);
    expect(at(0.8).railShare).toBeGreaterThanOrEqual(0.6);
    expect(at(0.1).railShare).toBe(0);
  });

  it('`explored` is what the search really went through', () => {
    expect(reportOn(guides[0]!, demoProduct.design!, effortFor(0.8)).explored).toBe(effortFor(0.8).covers);
  });
});

describe('visualReport (pdf §12.2)', () => {
  it('a guide that ticks every box reads 100 inside, and overall weighs .55 and .45', () => {
    const r = visualReport(AUDIT, COVER, effortFor(1), 8);
    expect(r.interior).toBe(100);
    expect(r.cover).toBe(coverScore(COVER));
    expect(r.overall).toBeCloseTo(0.55 * r.cover + 0.45 * r.interior, 1);
    expect(r).toMatchObject({ version: 1, effort: effortFor(1), explored: 8, issues: [] });
  });

  it('weighs each part as written', () => {
    const interior = (over: Partial<PdfAudit>) => visualReport({ ...AUDIT, ...over }, COVER, effortFor(1), 8).interior;
    expect(interior({ fillMean: 0.65 })).toBe(85);   // half of .3
    expect(interior({ shortPages: 6 })).toBe(90);    // half of .2
    expect(interior({ figureKinds: 2 })).toBe(93.8); // a quarter of .25
    expect(interior({ figuresPerChapter: 0.5 })).toBe(93.8);
    expect(interior({ railShare: 0.3 })).toBe(92.5); // half of .15
    expect(interior({ sheets: 1 })).toBe(95);        // half of .1
    expect(interior({ widows: 1, strandedHeadings: 1, overflow: 1 })).toBe(85);
    expect(interior({ fillMean: 0, shortPages: 12, figureKinds: 0, figuresPerChapter: 0, railShare: 0, sheets: 0, overflow: 20 })).toBe(0);
  });

  it('a long title that shrinks has a measured cost on the cover', () => {
    expect(visualReport(AUDIT, { ...COVER, thumbPx: 8 }, effortFor(1), 8).cover).toBeLessThan(visualReport(AUDIT, COVER, effortFor(1), 8).cover - 25);
  });

  it('the standard fonts cap the inside at 60, and say why', () => {
    const r = visualReport({ ...AUDIT, degraded: true }, COVER, effortFor(1), 8);
    expect(r.interior).toBe(60);
    expect(r.issues.join(' ')).toMatch(/polices/i);
  });

  it('issues are French, the worst first, and none reads the talent', () => {
    const { issues } = visualReport({ ...AUDIT, shortPages: 3, railShare: 0.1, sheets: 0, figuresPerChapter: 0.4 }, { ...COVER, thumbPx: 8 }, effortFor(0.73), 6);
    expect(issues[0]).toBe('Mise en page creuse : 3 pages à moitié vides.');
    expect(issues.length).toBeGreaterThan(3);
    expect(issues.join(' ')).not.toMatch(/piste|candidat|6/);
  });
});

describe('sim/visual.ts', () => {
  const WTP = { min: 9, sweet: 19, max: 29 };
  const at = (score: number) => report({ overall: score, interior: score, cover: score });

  it('without a report, nothing moves', () => {
    for (const v of [null, undefined]) {
      expect(visualCvr(v)).toBe(1);
      expect(visualRating(v)).toBe(0);
      expect(visualRefund(v)).toBe(0);
      expect(visualWtp(WTP, v)).toBe(WTP);
    }
  });

  it('all four effects are neutral at the reference, a starting agency', () => {
    const v = at(VISUAL.ref);
    expect(VISUAL.ref).toBe(70);
    expect(visualCvr(v)).toBe(1);
    expect(visualRating(v)).toBe(0);
    expect(visualRefund(v)).toBe(0);
    expect(visualWtp(WTP, v)).toEqual(WTP);
  });

  it('each one is monotone, and clamped both ways', () => {
    const points = [0, 20, 40, 55, 70, 85, 100];
    const series = points.map(at);
    for (const read of [visualCvr, visualRating, visualRefund, (v: VisualReport) => visualWtp(WTP, v).sweet]) {
      series.slice(1).forEach((v, i) => expect(read(v)).toBeGreaterThanOrEqual(read(series[i]!)));
    }
    expect([visualCvr(at(0)), visualCvr(at(100))]).toEqual([VISUAL.cvr.min, VISUAL.cvr.max]);
    expect(visualCvr(at(200))).toBe(VISUAL.cvr.max);
    expect([visualRating(at(0)), visualRating(at(100))]).toEqual([-VISUAL.rating.max, VISUAL.rating.max]);
    expect([visualRefund(at(0)), visualRefund(at(100))]).toEqual([-VISUAL.refund.max, VISUAL.refund.max]);
    expect(visualWtp(WTP, at(0)).sweet).toBeCloseTo(WTP.sweet * VISUAL.wtp.min, 6);
    expect(visualWtp(WTP, at(100)).sweet).toBeCloseTo(WTP.sweet * VISUAL.wtp.max, 6);
  });

  it('each one reads its own number: the price and the page on overall, the buyer on the inside', () => {
    const v = report({ overall: 100, interior: 40 });
    expect(visualCvr(v)).toBe(VISUAL.cvr.max);
    expect(visualWtp(WTP, v).max).toBeCloseTo(WTP.max * VISUAL.wtp.max, 6);
    expect(visualWtp(WTP, v).min).toBe(WTP.min);
    expect(visualRating(v)).toBe(-VISUAL.rating.max);
    expect(visualRefund(v)).toBe(-VISUAL.refund.max);
  });
});

describe('the existing quality reports (pdf §12.3)', () => {
  const ctx = { audience: demoProduct.audience, problem: demoProduct.problem, design: demoProduct.design };

  it('`interior` under 50 is a design block, and `design` is the interior', () => {
    const q = scorePdf(demoContent, { ...ctx, visual: report({ interior: 40, issues: ['Mise en page creuse : 4 pages à moitié vides.'] }) });
    expect(q.design).toBe(40);
    expect(q.blocking).toContainEqual({ dimension: 'design', text: 'Mise en page creuse : 4 pages à moitié vides.' });
  });

  it('a hand-made report with no issue still blocks, and 50 does not', () => {
    expect(scorePdf(demoContent, { ...ctx, visual: report({ interior: 40 }) }).blocking?.some((b) => b.dimension === 'design' && /creuse/.test(b.text))).toBe(true);
    expect(scorePdf(demoContent, { ...ctx, visual: report({ interior: 50 }) }).blocking?.some((b) => b.dimension === 'design')).toBe(false);
  });

  it('without a report, the score is exactly today’s; the weight stays .04 with one', () => {
    const none = scorePdf(demoContent, ctx);
    expect(scorePdf(demoContent, { ...ctx, visual: null })).toEqual(none);
    const q = scorePdf(demoContent, { ...ctx, visual: report({ interior: 40 }) });
    expect(Math.abs(none.overall - q.overall - 0.04 * (none.design - 40))).toBeLessThanOrEqual(1);
  });

  it('the sales page reads the cover instead of a constant', () => {
    const sp = demoSalesPage;
    const design = (visual: VisualReport | null) => scoreSalesPage(sp, { ...demoProduct, visual }, undefined).design;
    const blurbs = sp.chapterBlurbs.length ? 30 : 0;
    expect(design(report({ cover: 100 }))).toBeGreaterThan(design(report({ cover: 40 })));
    expect(design(report({ cover: 40 }))).toBeLessThanOrEqual(0.7 * 40 + blurbs);
    expect(design(null)).toBe(scoreSalesPage(sp, demoProduct, undefined).design);
  });
});

describe('the market', () => {
  /** Paid traffic on one guide: the same world, the same draws, only the report differs. */
  function market(visual: VisualReport | null | undefined, seed = 7): { w: WorldState; p: Product } {
    const w = createWorld(defaultScenario({ ...LEGACY, seed, startingCash: 100_000, mindMode: 'heuristic' }), 'test-visual');
    const n = w.market.niches[0]!;
    const p: Product = {
      ...demoProduct, id: 'prd_a', nicheId: n.id, price: n.wtp.sweet, content: demoContent, salesPage: demoSalesPage, upsellProductId: null, launchedDay: 1, createdDay: 1,
      stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
      ...(visual === undefined ? {} : { visual }),
    };
    w.company.products.push(p);
    w.company.creatives.push({
      id: 'crv_a', productId: p.id, hook: 'Bébé se réveille toutes les 2 h ?', hookStyle: 'question', format: 'faceless_voiceover',
      scenes: [{ visual: 'Gros plan', onScreenText: 'Bébé se réveille', voiceover: 'Bébé se réveille toutes les 2 h.', durationSec: 5 }],
      caption: 'Le guide est en bio.', hashtags: [], cta: 'Lien en bio', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
    });
    w.company.campaigns.push({ id: 'cmp_a', productId: p.id, name: 'a', creativeIds: ['crv_a'], dailyBudget: 800, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'test' });
    return { w, p };
  }

  const close = (w: WorldState, seed: number, days: number): void => {
    const rng = createRng(seed);
    for (let day = 1; day <= days; day++) {
      w.day = day;
      tickMarket(w, rng);
    }
  };
  const revenue = (w: WorldState): number => w.market.orders.reduce((s, o) => s + o.price, 0);

  it('two seeded days differing only in `visual` diverge in revenue, on the same day-1 draws', () => {
    const low = market(report({ overall: 40, interior: 40 }));
    const high = market(report({ overall: 100, interior: 100 }));
    close(low.w, 7, 1);
    close(high.w, 7, 1);
    expect(high.w.market.adStats.map((r) => [r.spend, r.impressions, r.clicks, r.landingViews])).toEqual(low.w.market.adStats.map((r) => [r.spend, r.impressions, r.clicks, r.landingViews]));
    expect(low.w.market.adStats[0]!.landingViews).toBeGreaterThan(50);
    expect(revenue(high.w)).toBeGreaterThan(revenue(low.w));
  });

  it('holds across seeds', () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const gains = seeds.map((seed) => {
      const low = market(report({ overall: 40, interior: 40 }), seed);
      const high = market(report({ overall: 100, interior: 100 }), seed);
      close(low.w, seed, 1);
      close(high.w, seed, 1);
      return revenue(high.w) - revenue(low.w);
    });
    expect(gains.filter((g) => g > 0).length).toBeGreaterThanOrEqual(5);
  });

  it('`null` is exactly neutral: same orders, same refunds, same reviews as a product with no field, over 10 days', () => {
    const none = market(undefined);
    const nulled = market(null);
    close(none.w, 7, 10);
    close(nulled.w, 7, 10);
    expect(nulled.w.ledger).toEqual(none.w.ledger);
    expect(nulled.w.market.orders).toEqual(none.w.market.orders);
    expect(nulled.w.company.products[0]!.stats).toEqual(none.w.company.products[0]!.stats);
  });

  it('a superb object is rated higher and refunded less, on the same 12 days', () => {
    const rate = (w: WorldState) => mean(w.company.products[0]!.stats.reviews.map((r) => r.rating));
    const refunds = (w: WorldState) => w.market.orders.filter((o) => o.refunded).length / Math.max(1, w.market.orders.length);
    const pairs = [1, 2, 3, 4].map((seed) => {
      const low = market(report({ overall: 70, interior: 40 }), seed);
      const high = market(report({ overall: 70, interior: 100 }), seed);
      close(low.w, seed, 12);
      close(high.w, seed, 12);
      return { rating: rate(high.w) - rate(low.w), refund: refunds(high.w) - refunds(low.w) };
    });
    expect(mean(pairs.map((p) => p.rating))).toBeGreaterThan(0);
    expect(mean(pairs.map((p) => p.refund))).toBeLessThan(0);
  });

  /** The two sums the market keeps for a sale, on a planted day: exact, no draw. */
  function aftersale() {
    const niche = market(null).w.market.niches[0]!;
    const q = scorePdf(demoContent, { audience: demoProduct.audience, problem: demoProduct.problem });
    const day = { niche: () => niche, pdfQ: () => q, pageQ: () => q, echo: () => 0, diff: { refundBase: 0.05 } } as unknown as Parameters<typeof refundProbability>[0];
    const product = (visual: VisualReport | null): Product => ({ ...demoProduct, visual });
    return {
      fair: niche.wtp.sweet, over: niche.wtp.max * 1.08,
      refund: (visual: VisualReport | null, price: number): number => refundProbability(day, product(visual), undefined, { price, source: 'organic' }),
      stars: (visual: VisualReport | null, price: number): number => reviewMean(day, product(visual), undefined, { price, source: 'organic', refunded: false }),
    };
  }

  it('a refund reads the report: the pages take off what they earn, a superb object forgives the price', () => {
    const { fair, over, refund } = aftersale();
    expect(refund(report({ interior: 100 }), fair)).toBeCloseTo(refund(null, fair) - VISUAL.refund.max, 9);
    expect(refund(report({ interior: 40 }), fair)).toBeCloseTo(refund(null, fair) + VISUAL.refund.max, 9);
    expect(refund(null, over)).toBeGreaterThan(refund(null, fair));
    expect(refund(report({ overall: 100 }), over)).toBeCloseTo(refund(null, fair), 9); // inside what a superb object carries: nothing to regret
  });

  it('a review reads the report the same way', () => {
    const { fair, over, stars } = aftersale();
    expect(stars(report({ interior: 100 }), fair)).toBeCloseTo(stars(null, fair) + VISUAL.rating.max, 9);
    expect(stars(report({ interior: 40 }), fair)).toBeCloseTo(stars(null, fair) - VISUAL.rating.max, 9);
    expect(stars(null, over)).toBeLessThan(stars(null, fair));
    expect(stars(report({ overall: 100 }), over)).toBeCloseTo(stars(null, fair), 9);
  });

  it('the market and its tools read the real pages in the guide’s own score too', () => {
    const visual = report({ interior: 55 });
    const { w, p } = market(visual);
    const readings = () => vi.mocked(scorePdf).mock.calls.filter(([content]) => content === demoContent).map(([, ctx]) => ctx.visual);
    vi.mocked(scorePdf).mockClear();
    close(w, 7, 1);
    expect(readings().length).toBeGreaterThan(0);
    expect(new Set(readings())).toEqual(new Set([visual]));
    vi.mocked(scorePdf).mockClear();
    createMarketTools(w, createRng(7)).proposePartnership({ creatorId: w.market.creators[0]!.id, productId: p.id, upfront: 0, commission: 0.2 });
    expect(readings()).toEqual([visual]);
  });

  it('a price above the niche’s max sells better, and is forgiven, on a superb object', () => {
    const over = (visual: VisualReport): number => {
      const { w, p } = market(visual);
      p.price = Math.round(w.market.niches[0]!.wtp.max * 1.05);
      close(w, 7, 1);
      return w.market.orders.length;
    };
    expect(over(report({ overall: 100, interior: 70 }))).toBeGreaterThan(over(report({ overall: 70, interior: 70 })));
  });
});

describe('the studio', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });

  async function lab(over: Partial<ScenarioConfig> = {}): Promise<{ world: WorldState; ctx: RuntimeCtx; root: string; designer: AgentState; product: Product }> {
    const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-visual');
    const root = mkdtempSync(join(tmpdir(), 'pixel-visual-'));
    roots.push(root);
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
    const product: Product = { ...demoProduct, id: 'prd_a', nicheId: world.market.niches[0]!.id, content: FULL, design: null, upsellProductId: null, status: 'design', files: { pdf: null, cover: null, salesPage: null } };
    world.company.products.push(product);
    const designer = world.company.agents.find((a) => a.taskKinds.includes('render_pdf')) ?? roleHolders(world, 'art_director')[0]!;
    return { world, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, root, designer, product };
  }

  const MIND = {} as MindContext;
  const taskOf = (l: Awaited<ReturnType<typeof lab>>, kind: 'design_cover' | 'render_pdf', input: Record<string, unknown> = {}): Task =>
    createTask(l.world, { kind, assignee: l.designer.id, input: { productId: l.product.id, ...input } });
  const run = async (l: Awaited<ReturnType<typeof lab>>, task: Task): Promise<Task> => {
    const out = await HANDLERS[task.kind]!.run(l.ctx, task, l.designer, MIND);
    task.output = out.output ?? null;
    return task;
  };
  const studio = async (l: Awaited<ReturnType<typeof lab>>): Promise<{ cover: Task; render: Task }> => ({ cover: await run(l, taskOf(l, 'design_cover')), render: await run(l, taskOf(l, 'render_pdf')) });

  it('a cover then a guide leave a report on the product, its previews next to the guide, and scores on the task', async () => {
    const l = await lab();
    const { cover, render } = await studio(l);
    const { product: p } = l;
    expect(p.design!.artSeed).toBeDefined();
    expect(p.visual).toMatchObject({ version: 1, explored: p.artExplored });
    expect(p.visual!.explored).toBeGreaterThanOrEqual(1);
    expect(p.visual!.interior).toBeGreaterThan(0);
    expect(cover.output!.cover).toBe(p.visual!.cover);
    expect(render.output!.visual).toBe(p.visual!.overall);
    expect(p.quality!.design).toBe(Math.round(p.visual!.interior));
    expect(p.files.previews!.length).toBeGreaterThanOrEqual(3);
    for (const rel of p.files.previews!) {
      expect(rel.startsWith(`files/${p.id}/v1/previews/`)).toBe(true);
      expect(readFileSync(join(l.root, ...rel.split('/')), 'utf8')).toMatch(/^<svg/);
    }
  });

  it('every reading of the guide after the render sees the real pages', async () => {
    const l = await lab();
    await studio(l);
    expect(scoreContent(l.ctx, l.product, l.product.content!).design).toBe(Math.round(l.product.visual!.interior));
  });

  it('the cover file wears the art the report scored', async () => {
    const l = await lab();
    await studio(l);
    const { product: p } = l;
    const audit = coverAudit({ title: p.title, subtitle: p.content!.subtitle, audience: p.audience, design: p.design!, brand: l.world.company.name });
    expect(p.visual!.cover).toBe(coverScore(audit));
    expect(p.design!.artSeed).toBe(pickArt(p.design!, effortFor(l.world.talentTruth!.agents[l.designer.id]!.talent.design!)).seed);
  });

  it('with the visual model off, the product, the files and the draws are today’s (D32)', async () => {
    const l = await lab({ ...LEGACY });
    const { cover, render } = await studio(l);
    const { product: p } = l;
    expect(p.visual).toBeUndefined();
    expect(p.artExplored).toBeUndefined();
    expect(p.design!.artSeed).toBeUndefined();
    expect(p.files.previews).toBeUndefined();
    expect(cover.output).not.toHaveProperty('cover');
    expect(render.output).not.toHaveProperty('visual');
    expect(existsSync(join(l.root, 'files', p.id, 'v1', 'previews'))).toBe(false);
  });

  it.each([0, 0.3, 1])('rendering at talent %f leaves the world’s rng where it was', async (designTalent) => {
    const l = await lab({ control: { designTalent } });
    await run(l, taskOf(l, 'design_cover'));
    const before = l.ctx.rng.state();
    await run(l, taskOf(l, 'render_pdf'));
    expect(l.ctx.rng.state()).toBe(before);
  });

  it('a cover draws what it drew before the search: one number, whatever the talent', async () => {
    const stateAfter = async (scenario: Partial<ScenarioConfig>): Promise<number> => {
      const l = await lab(scenario);
      await run(l, taskOf(l, 'design_cover'));
      return l.ctx.rng.state();
    };
    const off = await stateAfter({ visualModel: 'off' });
    expect(await stateAfter({ control: { designTalent: 0 } })).toBe(off);
    expect(await stateAfter({ control: { designTalent: 1 } })).toBe(off);
  });

  it('`control.designTalent` buys the finish on the real pages, and the eye on the real cover', async () => {
    const at = async (designTalent: number): Promise<VisualReport> => {
      const l = await lab({ control: { designTalent } });
      await studio(l);
      return l.product.visual!;
    };
    const [low, high] = [await at(0.1), await at(1)];
    expect(low.effort.finish).toBe(0);
    expect(high.effort.finish).toBe(2);
    expect(high.interior).toBeGreaterThan(low.interior);
  });

  it('without a talent module, the level says what the designer can do', async () => {
    const l = await lab({ talent: 'off', visualModel: 'on' });
    l.designer.level = 1;
    await studio(l);
    expect(l.product.visual!.effort).toEqual(effortFor(0));
    const senior = await lab({ talent: 'off', visualModel: 'on' });
    senior.designer.level = MAX_LEVEL;
    await studio(senior);
    expect(senior.product.visual!.effort).toEqual(effortFor(1));
  });

  it('`control.designTalent` freezes the designer whatever the mode: a control arm compares two values, nothing else', async () => {
    const l = await lab({ talent: 'off', visualModel: 'on', control: { designTalent: 1 } });
    l.designer.level = 1;
    await studio(l);
    expect(l.product.visual!.effort).toEqual(effortFor(1));
  });

  it('a rework of the cover looks at two more candidates', async () => {
    const l = await lab({ control: { designTalent: 0.3 } });
    const task = taskOf(l, 'design_cover');
    await run(l, task);
    expect(l.product.artExplored).toBe(effortFor(0.3).covers);
    task.attempts = 1;
    await run(l, task);
    expect(l.product.artExplored).toBe(effortFor(0.3).covers + 2);
  });

  it('the report counts the candidates of the cover, not the renderer’s: two people can sign one guide', async () => {
    const l = await lab({ control: { designTalent: 0.3 } });
    const cover = taskOf(l, 'design_cover');
    cover.attempts = 2;
    await run(l, cover);
    await run(l, taskOf(l, 'render_pdf'));
    expect(l.product.visual!.explored).toBe(effortFor(0.3).covers + 4);
    expect(l.product.visual!.effort.covers).toBe(effortFor(0.3).covers);
  });

  it('review: a cover under 60 goes back, a good one passes on its score', async () => {
    const l = await lab();
    const reviewer = l.world.company.agents.find((a) => a.id !== l.designer.id)!;
    const task = await run(l, taskOf(l, 'design_cover'));
    const score = task.output!.cover as number;
    expect(await reviewTask(l.ctx, task, reviewer)).toMatchObject({ verdict: score >= 60 ? 'approve' : 'changes', score });
    task.output = { ...task.output, cover: 59.9 };
    const back = await reviewTask(l.ctx, task, reviewer);
    expect(back).toMatchObject({ verdict: 'changes', score: 59.9 });
    expect(back.notes[0]).toMatch(/60|\/100/);
    task.output = { ...task.output, cover: 60 };
    expect((await reviewTask(l.ctx, task, reviewer)).verdict).toBe('approve');
  });

  it('review: the final read carries the hollow block', async () => {
    const l = await lab();
    await studio(l);
    const reviewer = l.world.company.agents.find((a) => a.id !== l.designer.id)!;
    l.product.files.pdf = `${l.product.files.cover!.replace('cover.svg', 'guide.pdf')}`;
    const task = taskOf(l, 'render_pdf');
    l.product.visual = { ...l.product.visual!, interior: 30, issues: ['Mise en page creuse : 5 pages à moitié vides.'] };
    const res = await reviewTask(l.ctx, task, reviewer);
    expect(res.verdict).toBe('changes');
    expect(res.notes).toContain('Mise en page creuse : 5 pages à moitié vides.');
    expect(res.noWaiver).toBe(false);
  });

  it('`visual` evidence: overall at render_pdf, its measured par and sd, weight 1, and a guide printed again for a link says nothing', async () => {
    const l = await lab();
    const { render } = await studio(l);
    const overall = l.product.visual!.overall;
    onDone(l.ctx, render);
    const events = l.world.company.league!.events.filter((e) => e.source === 'visual');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: l.designer.id, skill: 'design', w: 1 });
    expect(events[0]!.s).toBeCloseTo(phi((overall - 85.11) / 3.93), 3);
    expect(TALENT.par['design:visual']).toBe(85.11);
    expect(TALENT.sd['design:visual']).toBe(3.93);
    expect(l.world.company.league!.parStats['design:visual']).toMatchObject({ n: 1, sum: overall });
    onDone(l.ctx, { ...render, input: { ...render.input, reason: 'upsell_link' } });
    onDone(l.ctx, { ...render, output: { path: 'x' } });
    expect(l.world.company.league!.events.filter((e) => e.source === 'visual')).toHaveLength(1);
  });

  it('the snapshots show the scores, never what reads the designer’s talent out (A21)', async () => {
    const l = await lab({ control: { designTalent: 0.7654321 } });
    await studio(l);
    const { effort } = l.product.visual!;
    for (const json of [JSON.stringify(toSnapshot(l.world, false)), liveSnapshotJson(l.world)]) {
      const shown = (JSON.parse(json) as { company: { products: Product[] } }).company.products[0]!;
      expect(shown.visual).toMatchObject({ cover: l.product.visual!.cover, interior: l.product.visual!.interior, overall: l.product.visual!.overall });
      expect(shown.visual).not.toHaveProperty('effort');
      expect(shown.visual).not.toHaveProperty('explored');
      expect(shown).not.toHaveProperty('artExplored');
      expect(json).not.toContain('"taste"');
      expect(json).not.toContain(String(effort.taste));
    }
    expect(l.world.activity.map((a) => a.text).join(' ')).not.toMatch(/piste/);
  });
});
