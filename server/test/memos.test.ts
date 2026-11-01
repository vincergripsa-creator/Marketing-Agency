/**
 * Row A6: the three readings a year of play repeats are paid once. A memo is pure or it does not ship, so each one is also held
 * to read again as soon as what it depends on moves. The market's own rows of a whole year are read by `scripts/longrun.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Rng } from '../src/contracts.js';
import { BoundedMemo, createRng, streamRng } from '../src/core/index.js';
import { addRule, MAX_RULES } from '../src/learning/playbooks.js';
import type { Lesson, Order, PdfContent, Product, ScenarioConfig, WorldState } from '../src/shared.js';
import { createMarketState, recordLedger } from '../src/sim/index.js';
import { guideSubstance } from '../src/sim/quality.js';
import { tickMarket } from '../src/sim/tick.js';

const count = vi.hoisted(() => ({ scorePdf: 0, fold: 0 }));

vi.mock('../src/sim/quality.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/sim/quality.js')>();
  return { ...real, scorePdf: (...args: Parameters<typeof real.scorePdf>) => { count.scorePdf += 1; return real.scorePdf(...args); } };
});

vi.mock('../src/learning/text.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/learning/text.js')>();
  return { ...real, fold: (s: string) => { count.fold += 1; return real.fold(s); } };
});

function content(title: string): PdfContent {
  return {
    title, subtitle: 'Six semaines pour y arriver', audience: 'Parents de jeunes enfants', promise: 'Des soirées plus calmes.', introduction: ['Une introduction courte.'],
    chapters: [{ title: 'Chapitre un', intro: 'On commence ici.', paragraphs: ['Un paragraphe qui dit quelque chose de précis sur le sujet du guide.'], steps: ['Faire ceci pendant 10 minutes'], example: null, checklist: [], visual: null }],
    bonus: { title: 'Bonus', intro: '', paragraphs: [], steps: [], example: null, checklist: [], visual: null },
    nextStep: { title: 'La suite', text: 'La suite du guide.', upsellProductId: null }, wordCount: 40,
  };
}

/** One guide on sale. */
function shop(): { world: WorldState; rng: Rng; p: Product } {
  const rng = createRng(7);
  const scenario: ScenarioConfig = {
    name: 'test', companyName: 'Pixel Agency', seed: 7, startingCash: 5000, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
    founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 },
  };
  const market = createMarketState(scenario, rng);
  const n = market.niches[0]!;
  const p = {
    id: 'prd_1', nicheId: n.id, title: 'Le guide', subtitle: '', audience: n.audience, problem: n.problem, price: 19, status: 'live', version: 1, content: content('Le guide'), design: null,
    salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price: 19 }],
  } as unknown as Product;
  const world = {
    version: 1, runId: 'test', createdAt: '2026-01-01T00:00:00.000Z', scenario, day: 1, tick: 10, phase: 'market', rngState: 0, idCounter: 0,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 }, status: 'running',
    company: {
      name: 'Pixel Agency', agents: [], departments: [], tasks: [], missions: [], products: [p], creatives: [], campaigns: [], deliverables: [],
      research: { trends: [], voc: {}, competitors: {}, shortlist: [] }, lessons: [], experiments: [], bandits: {}, playbooks: {}, kpis: [], chats: {}, pendingApprovals: [],
    },
    market, ledger: [], activity: [],
  } as unknown as WorldState;
  recordLedger(world, { type: 'capital', amount: 5000, memo: 'Capital de départ' });
  return { world, rng, p };
}

/** A close with yesterday's order in its refund window: the market reads the guide that day, whatever became of the earlier ones. */
const close = (world: WorldState, day: number): void => {
  world.market.orders.push({ id: `ord_${day}`, day: day - 1, productId: 'prd_1', customerId: 'cus_absent', price: 19, source: 'ads', refunded: false, chargeback: false } as unknown as Order);
  world.day = day;
  tickMarket(world, streamRng(7, 3, day));
};

describe('the market reads a guide once', () => {
  it('across days, and again as soon as one of its inputs moves', () => {
    const { world, p } = shop();
    count.scorePdf = 0;
    close(world, 2);
    expect(count.scorePdf).toBe(1);
    close(world, 3);
    expect(count.scorePdf).toBe(1);
    const moves: (() => void)[] = [
      () => { p.content!.chapters[0]!.intro = 'Le texte a changé en place.'; },
      () => { p.audience = 'Une autre audience'; },
      () => { p.problem = 'Un autre problème'; },
      () => { world.market.niches[0]!.voc.pains.push('une douleur de plus'); },
      () => { p.design = { motif: 'paw' } as Product['design']; },
      () => { p.visual = { interior: 70, cover: 70, issues: [] } as unknown as Product['visual']; },
    ];
    moves.forEach((move, i) => {
      move();
      close(world, 4 + i);
      expect(count.scorePdf, `move ${i}`).toBe(2 + i);
    });
  });
});

describe('guideSubstance reads a content once', () => {
  it('the same text gives the same reading, an edit in place gives a new one', () => {
    const c = content('Un titre qui ne sert qu’ici');
    const first = guideSubstance(c);
    expect(guideSubstance(c)).toBe(first);
    expect(guideSubstance(JSON.parse(JSON.stringify(c)) as PdfContent)).toBe(first);
    const words = first.words;
    c.chapters[0]!.paragraphs.push('Cinq mots de plus ici.');
    expect(guideSubstance(c).words).toBe(words + 5);
  });
});

describe('ruleKey folds a text once', () => {
  it('a full playbook does not fold every lesson again for each rule it ranks', () => {
    const lessons = Array.from({ length: 200 }, (_, i) => ({ insight: `Leçon numéro ${i} : ce que le mois a montré.`, confidence: 0.5, appliesTo: [] })) as unknown as Lesson[];
    const world = { scenario: {}, company: { lessons, playbooks: { clara: Array.from({ length: MAX_RULES }, (_, i) => `Règle écrite numéro ${i}`) } } } as unknown as WorldState;
    count.fold = 0;
    addRule(world, 'clara', 'Une règle de plus');
    const first = count.fold;
    expect(first).toBeGreaterThan(200); // every lesson was read once
    count.fold = 0;
    addRule(world, 'clara', 'Une autre règle');
    expect(count.fold).toBeLessThan(first / 20);
    expect(world.company.playbooks.clara).toHaveLength(MAX_RULES);
  });
});

describe('BoundedMemo', () => {
  it('computes once, and past its cap forgets the oldest', () => {
    const memo = new BoundedMemo<number>(2);
    let computed = 0;
    const read = (key: string): number => memo.read(key, () => (computed += 1));
    expect([read('a'), read('a'), read('b')]).toEqual([1, 1, 2]);
    expect(computed).toBe(2);
    read('c');
    expect(memo.size).toBe(2);
    expect(read('b')).toBe(2);
    expect(read('a')).toBe(4);
  });
});
