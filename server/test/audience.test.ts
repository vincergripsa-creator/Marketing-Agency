/**
 * What the market does with a list, a kit and a rival (scale §6, tests 13 to 17). The company side lands in P11.2: here the
 * tools and the market close are called directly, on a shop built by hand.
 */
import { describe, expect, it } from 'vitest';
import { createRng, streamRng } from '../src/core/index.js';
import type { Rng } from '../src/contracts.js';
import type {
  AdCreative, AudienceState, ChapterContent, EmailStep, HookStyle, ListBucket, NicheTruth, Order, PdfContent, Product, SalesPage, ScenarioConfig, VisualSpec, WorldState,
} from '../src/shared.js';
import { reconcileDay } from '../src/runtime/accounting.js';
import { priceTiers } from '../src/runtime/metrics.js';
import { addBuyers, addLeads, audienceOf, audienceView, deliverEmails, emailCost, listSize, monthOf, openRate } from '../src/sim/audience.js';
import { addRival, refreshRivals, rivalFactor, rollRivals } from '../src/sim/rivals.js';
import { forceEvent } from '../src/sim/events.js';
import { GROWTH, kitPrice } from '../src/sim/growth.js';
import { refundOrder } from '../src/sim/ops.js';
import { bumpRate } from '../src/sim/tick.js';
import { createMarketState, createMarketTools, findNiche, financeSnapshot, recordLedger, scoreEmail, scorePdf, scoreSalesPage, tickMarket } from '../src/sim/index.js';

// ───────────────────────────── a shop built by hand ─────────────────────────────

const NICHE = 'proprete-chiot';
const SEED = 3;

function makeWorld(seed: number, cash: number, over: Partial<ScenarioConfig> = {}): { world: WorldState; rng: Rng } {
  const rng = createRng(seed);
  const scenario: ScenarioConfig = {
    name: 'test', companyName: 'Pixel Agency', seed, startingCash: cash, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
    founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 }, ...over,
  };
  const world: WorldState = {
    version: 1, runId: 'test', createdAt: '2026-01-01T00:00:00.000Z', scenario, day: 1, tick: 10, phase: 'market', rngState: 0, idCounter: 0,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: 'Pixel Agency', agents: [], departments: [], tasks: [], missions: [], products: [], creatives: [], campaigns: [], deliverables: [],
      research: { trends: [], voc: {}, competitors: {}, shortlist: [] }, lessons: [], experiments: [], bandits: {}, playbooks: {}, kpis: [],
      chats: {}, pendingApprovals: [],
    },
    market: createMarketState(scenario, rng),
    ledger: [], activity: [],
  };
  recordLedger(world, { type: 'capital', amount: cash, memo: 'Capital de départ' });
  return { world, rng };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const at = <T,>(xs: readonly T[], i: number): T => xs[i % xs.length]!;
const VISUALS: VisualSpec['type'][] = ['steps_diagram', 'checklist_card', 'timeline', 'do_dont', 'icon_grid', 'quote'];

function guide(n: NicheTruth): PdfContent {
  const k = n.voc.knowledge;
  const chapters: ChapterContent[] = [];
  for (let i = 0; i < 6; i++) {
    chapters.push({
      title: `Étape ${i + 1} : ${at(k.steps, i).replace(/\.$/, '')}`,
      intro: `Pour ${lower(n.audience)}, ce chapitre s'attaque à un point précis du problème : ${lower(at(n.voc.pains, i))}.`,
      paragraphs: [
        `${at(k.tips, i * 2)} C'est souvent la première chose qui débloque la situation, parce que le problème (${lower(n.problem)}) s'entretient tout seul quand on ne change rien.`,
        `${at(k.tips, i * 2 + 1)} Beaucoup de lecteurs nous ont écrit la même phrase : « ${at(n.voc.phrases, i)} ». Si c'est votre cas, commencez par là, sans chercher à tout changer d'un coup.`,
        `${at(k.facts, i)} Gardez ce repère en tête pendant toute la durée du programme et notez vos observations chaque soir dans un carnet.`,
        `L'erreur la plus fréquente à ce stade : ${lower(at(k.mistakes, i))} Si vous l'avez déjà faite, pas de panique, il suffit de reprendre l'étape le lendemain avec la même régularité.`,
        'Concrètement, prévoyez 15 à 20 minutes par jour pendant 7 jours pour cette étape, puis faites le point avec la checklist en fin de chapitre avant de passer à la suite.',
      ],
      steps: [at(k.steps, i), at(k.steps, i + 1), at(k.tips, i + 3), 'Noter chaque soir pendant 7 jours ce qui a changé, en 2 minutes.'],
      example: at(k.examples, i),
      checklist: [`J'ai appliqué l'étape ${i + 1} pendant 7 jours`, `J'ai évité : ${lower(at(k.mistakes, i + 1))}`, "J'ai noté mes observations du soir"],
      visual: { type: VISUALS[i % VISUALS.length]!, title: `Repères de l'étape ${i + 1}`, labels: ['Jour 1', 'Jour 3', 'Jour 7'], values: [] },
    });
  }
  return {
    title: `${n.name} : la méthode en 6 étapes et 14 jours`, subtitle: `Pour ${lower(n.audience)} — ${lower(n.problem)}`, audience: n.audience,
    promise: `En 14 jours, ${lower(at(n.voc.desiredOutcomes, 0))}.`,
    introduction: [`Vous êtes ${lower(n.audience)} et ${lower(n.problem)} ? « ${at(n.voc.phrases, 0)} » : c'est la phrase que nous lisons le plus souvent.`, 'Ce guide vous donne une méthode en 6 étapes numérotées, des exemples de vraies personnes et une checklist par chapitre.'],
    chapters,
    bonus: {
      title: 'Bonus : la checklist imprimable des 14 jours', intro: 'Un récapitulatif à coller sur le frigo.', paragraphs: [k.tips.slice(0, 3).join(' ')],
      steps: k.steps.slice(0, 4), example: null, checklist: k.tips.slice(3, 7), visual: { type: 'checklist_card', title: 'Checklist', labels: ['Matin', 'Soir'], values: [] },
    },
    nextStep: { title: 'La suite est ici', text: 'Vous avez posé les bases. Le guide suivant vous accompagne pour consolider ces progrès, semaine par semaine.', upsellProductId: null },
    wordCount: 0,
  };
}

function page(n: NicheTruth, c: PdfContent): SalesPage {
  return {
    headline: `${n.name} : la méthode en 6 étapes pour ${lower(n.audience)}`,
    subheadline: `Des étapes concrètes, des exemples réels et une checklist par chapitre, pour en finir avec ce problème : ${lower(n.problem)}.`,
    painBullets: n.voc.phrases.slice(0, 5).map((p) => `« ${p} »`),
    solution: 'Un guide en 6 étapes numérotées, construit à partir de centaines de témoignages. Chaque chapitre vous dit quoi faire, combien de temps, et quelles erreurs éviter.',
    chapterBlurbs: c.chapters.map((ch) => ({ title: ch.title, blurb: 'Ce que vous allez appliquer concrètement dans cette étape, avec un exemple réel et une checklist.' })),
    bonusBlurb: 'Cadeau inclus : la checklist imprimable des 14 jours.',
    objections: n.voc.objections.slice(0, 4).map((q) => ({ q, a: 'Ce guide est construit à partir de vrais témoignages et vous donne des étapes précises, avec des exemples concrets.' })),
    guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.', cta: 'Je télécharge le guide', hypeLevel: 0.4,
  };
}

function product(world: WorldState, id: string, n: NicheTruth, price: number, status: Product['status'] = 'live', over: Partial<Product> = {}): Product {
  const content = guide(n);
  const salesPage = page(n, content);
  const p: Product = {
    id, nicheId: n.id, title: content.title, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price, status, version: 1, content,
    design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    salesPage, files: { pdf: `files/${id}/v1/guide.pdf`, cover: `files/${id}/v1/cover.svg`, salesPage: `files/${id}/v1/sales-page.html` },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: status === 'live' ? 1 : null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price }], ...over,
  };
  p.quality = scorePdf(content, { audience: p.audience, problem: p.problem, voc: n.voc, design: p.design });
  p.salesQuality = scoreSalesPage(salesPage, p);
  world.company.products.push(p);
  return p;
}

function creative(world: WorldState, id: string, p: Product, n: NicheTruth, style: HookStyle, i: number): AdCreative {
  const phrase = at(n.voc.phrases, i);
  const hook = `POV : « ${phrase.slice(0, 50)} »`;
  const c: AdCreative = {
    id, productId: p.id, hook, hookStyle: style, format: 'faceless_voiceover',
    scenes: [
      { visual: 'Gros plan, texte qui apparaît mot à mot', onScreenText: hook.slice(0, 68), voiceover: hook, durationSec: 4 },
      { visual: 'Scène du quotidien, lumière du soir', onScreenText: at(n.voc.pains, i).slice(0, 60), voiceover: at(n.voc.pains, i), durationSec: 5 },
      { visual: 'Pages du guide qui défilent', onScreenText: 'Le guide : 6 étapes concrètes', voiceover: `Ce guide vous donne une méthode en 6 étapes pour ${lower(n.audience)}.`, durationSec: 6 },
      { visual: 'Couverture du guide et flèche vers la bio', onScreenText: 'Lien en bio : télécharge le guide', voiceover: 'Le lien est en bio, télécharge le guide dès ce soir.', durationSec: 5 },
    ],
    caption: `${n.voc.pains[0]} Le guide est en bio.`, hashtags: n.keywords.slice(0, 4).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, '')}`), cta: 'Lien en bio : télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'test',
  };
  world.company.creatives.push(c);
  return c;
}

/** A guide on sale with paid traffic: 5 000 € in the till, so a day's spend never depends on what sold before. */
function shop(seed = SEED, budget = 60, over: Partial<ScenarioConfig> = {}) {
  const { world, rng } = makeWorld(seed, 5000, over);
  const tools = createMarketTools(world, rng);
  const n = findNiche(world, NICHE)!;
  const p = product(world, 'prd_main', n, n.wtp.sweet);
  const ids = (['pov', 'story'] as const).map((s, i) => creative(world, `cre_${i}`, p, n, s, i).id);
  const camp = tools.createCampaign({ productId: p.id, name: 'Test', creativeIds: ids, dailyBudget: budget, targeting: { interests: [], ageMin: 25, ageMax: 45 }, createdBy: 'test' });
  expect(camp.ok, camp.message).toBe(true);
  return { world, tools, n, p };
}

const close = (world: WorldState, day: number) => {
  world.day = day;
  return tickMarket(world, streamRng(world.scenario.seed, 3, day));
};

const days = (world: WorldState, from: number, to: number, before?: (day: number) => void) => {
  for (let d = from; d <= to; d++) { world.day = d; before?.(d); close(world, d); }
};

function mail(n: NicheTruth) {
  return {
    subject: 'Trois gestes à tester ce soir ?',
    body: `Bonjour, « ${n.voc.phrases[0]} » : c'est la phrase que nous lisons le plus souvent. ${n.voc.knowledge.tips[0]} Le guide reprend tout ça en 6 étapes, avec un exemple par chapitre et une checklist à cocher chaque soir pendant 14 jours. Le lien est juste ici si vous voulez le télécharger. Pour vous désabonner, un clic en bas de cet e-mail.`,
  };
}

const broadcast = (n: NicheTruth, p: Product, over: Record<string, unknown> = {}) => ({ nicheId: n.id, productId: p.id, audience: 'niche' as const, ...mail(n), angle: 'erreur', hasUnsubscribe: true, ...over });

function steps(n: NicheTruth): EmailStep[] {
  return ([[0, 'value'], [2, 'pitch'], [4, 'value'], [7, 'pitch'], [10, 'pitch']] as const).map(([day, kind]) => ({ day, kind, ...mail(n), score: 0 }));
}

const sizeOf = (world: WorldState): number => (world.market.audience ? listSize(world.market.audience) : 0);
const bucketsOf = (a: AudienceState, nicheId: string): ListBucket[] => a.buckets.filter((b) => b.nicheId === nicheId);
const ordersBy = (world: WorldState, source: Order['source']): Order[] => world.market.orders.filter((o) => o.source === source);
const cashOf = (world: WorldState): number => world.ledger.reduce((s, e) => s + e.amount, 0);

// ───────────────────────────── list ─────────────────────────────

describe('capture (scale 13)', () => {
  it('a guide with a lead magnet turns the day\'s visitors into leads and most buyers into buyers on the list', () => {
    const { world, n, p } = shop();
    p.leadMagnet = { title: 'Les 5 erreurs', file: 'magnet.pdf', day: 1 };
    days(world, 1, 12);
    const a = world.market.audience!;
    const views = world.market.adStats.reduce((s, x) => s + x.landingViews, 0);
    const bought = ordersBy(world, 'ads').length;
    expect(bought).toBeGreaterThan(3);
    expect(a.totals.leads).toBeGreaterThan(views * GROWTH.email.optin.ads * 0.4);
    expect(a.totals.leads).toBeLessThan(views * GROWTH.email.optin.ads * 1.3);
    expect(a.totals.buyers).toBeGreaterThan(bought * 0.5);
    expect(a.totals.buyers).toBeLessThanOrEqual(bought);
    expect(a.welcome[n.id]!.length).toBe(11);
    expect(listSize(a)).toBe(a.totals.leads + a.totals.buyers);
  });

  it('with capture off the list never rises: no magnet, no address, whatever sells', () => {
    const { world, n, p } = shop();
    days(world, 1, 12);
    expect(p.stats.sales).toBeGreaterThan(3);
    expect(world.market.audience).toBeUndefined();

    addBuyers(world, n.id, 300);
    let size = sizeOf(world);
    const tools = createMarketTools(world, createRng(1));
    days(world, 13, 40, (d) => {
      if (d % 7 === 0) expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
    });
    expect(ordersBy(world, 'email').length).toBeGreaterThan(0);
    for (let d = 41; d <= 50; d++) { close(world, d); expect(sizeOf(world)).toBeLessThanOrEqual(size); size = sizeOf(world); }
    expect(world.market.audience!.totals.buyers).toBe(300);
  });

  it('an e-mail buyer is already on the list: he does not join it twice', () => {
    const { world, n, p } = shop();
    p.leadMagnet = { title: 'Les 5 erreurs', file: 'magnet.pdf', day: 1 };
    addBuyers(world, n.id, 40_000);
    const tools = createMarketTools(world, createRng(1));
    world.day = 5;
    expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
    days(world, 5, 5);
    expect(ordersBy(world, 'email').length).toBeGreaterThan(ordersBy(world, 'ads').length);
    expect(world.market.audience!.totals.buyers - 40_000).toBeLessThanOrEqual(ordersBy(world, 'ads').length);
  });
});

describe('the welcome sequence (scale 13)', () => {
  const pipe = () => {
    const { world, tools, n, p } = shop();
    expect(tools.activateSequence({ nicheId: n.id, productId: p.id, steps: steps(n), createdBy: 'test' }).ok).toBe(true);
    world.day = 5;
    addLeads(world, n.id, 400);
    return { world, tools, n, p };
  };

  it('sends each step on its day, then the lead joins this month\'s bucket', () => {
    const { world, n } = pipe();
    const a = world.market.audience!;
    const sent: number[] = [];
    const rng = createRng(9);
    for (let d = 6; d <= 17; d++) {
      world.day = d;
      const before = a.totals.delivered;
      deliverEmails(world, rng);
      if (a.totals.delivered > before) sent.push(d - 6);
    }
    expect(sent).toEqual([0, 2, 4, 7, 10]);
    expect(a.welcome[n.id]!.every((x) => x === 0)).toBe(true);
    const [bucket] = bucketsOf(a, n.id);
    expect(bucket).toMatchObject({ kind: 'lead', month: monthOf(16), fatigue: 0 });
    expect(bucket!.size + a.totals.unsubscribed).toBe(400);
    expect(a.totals.unsubscribed).toBeLessThan(20);
  });

  it('pitch steps are traffic and value steps are not', () => {
    const { world } = pipe();
    const a = world.market.audience!;
    const rng = createRng(9);
    const clicksOn: Record<number, number> = {};
    for (let d = 6; d <= 16; d++) {
      world.day = d;
      const { rows } = deliverEmails(world, rng);
      clicksOn[d - 6] = rows.reduce((s, r) => s + r.clicks, 0);
      for (const r of rows) expect(r).toMatchObject({ cvrMult: GROWTH.email.cvrMult.lead });
      expect(rows.every((r) => r.repeat === undefined)).toBe(true);
    }
    expect([clicksOn[0], clicksOn[4]]).toEqual([0, 0]);
    expect(clicksOn[2]! + clicksOn[7]! + clicksOn[10]!).toBeGreaterThan(0);
    expect(a.totals.clicks).toBe(clicksOn[2]! + clicksOn[7]! + clicksOn[10]!);
    expect(a.totals.opens).toBeGreaterThan(a.totals.delivered * 0.3);
  });

  it('a sequence replaces the one before, and a pitch is not sent for a guide off sale', () => {
    const { world, tools, n, p } = pipe();
    expect(tools.activateSequence({ nicheId: n.id, productId: p.id, steps: steps(n).slice(0, 2), createdBy: 'test' }).ok).toBe(true);
    const a = world.market.audience!;
    expect(a.sequences.filter((s) => s.nicheId === n.id)).toHaveLength(1);
    expect(a.sequences[0]!.steps[0]!.score).toBeGreaterThan(0); // the market reads it itself
    p.status = 'paused';
    world.day = 6;
    deliverEmails(world, createRng(9));
    world.day = 7;
    deliverEmails(world, createRng(9));
    world.day = 8;
    const { rows } = deliverEmails(world, createRng(9));
    expect(rows).toEqual([]);
    expect(a.totals.delivered).toBe(400); // day 0 went out, day 2 did not
  });
});

describe('broadcasts (scale 13)', () => {
  it('Σ delivered per send never passes the bucket, and the unsubscribed stay out', () => {
    const { world, tools, n, p } = shop();
    p.leadMagnet = { title: 'Les 5 erreurs', file: 'magnet.pdf', day: 1 };
    addBuyers(world, n.id, 900);
    addLeads(world, n.id, 2000);
    let sends = 0;
    for (let d = 1; d <= 60; d++) {
      world.day = d;
      const queued = d % 3 === 0 && tools.sendBroadcast(broadcast(n, p)).ok;
      const a = world.market.audience!;
      const held = bucketsOf(a, n.id).reduce((s, b) => s + b.size, 0);
      const before = a.totals.delivered;
      close(world, d);
      if (!queued) continue;
      sends += 1;
      const sent = a.sent.at(-1)!;
      expect(sent).toMatchObject({ day: d, status: 'sent' });
      expect(a.queue).toEqual([]);
      expect(sent.delivered).toBe(held); // everyone once, nobody past the bucket
      expect(sent.opens).toBeLessThanOrEqual(sent.delivered);
      expect(sent.clicks).toBeLessThanOrEqual(sent.opens);
      expect(a.totals.delivered - before).toBeGreaterThanOrEqual(sent.delivered);
      for (const b of a.buckets) expect(b.size).toBeGreaterThan(0);
    }
    expect(sends).toBeGreaterThan(5);
    const a = world.market.audience!;
    expect(a.totals.unsubscribed).toBeGreaterThan(0);
    const inside = listSize(a);
    expect(inside).toBeLessThan(a.totals.leads + a.totals.buyers);
    expect(inside).toBe(a.totals.leads + a.totals.buyers - a.totals.unsubscribed);
  });

  it('an unsubscribe leaves the bucket, three times more often with no link to do it', () => {
    const run = (hasUnsubscribe: boolean) => {
      const { world, tools, n, p } = shop();
      addBuyers(world, n.id, 100_000);
      world.day = 5;
      tools.sendBroadcast(broadcast(n, p, { hasUnsubscribe }));
      deliverEmails(world, createRng(4));
      return world.market.audience!;
    };
    const linked = run(true);
    const silent = run(false);
    expect(linked.sent[0]!.delivered).toBe(100_000);
    expect(linked.buckets[0]!.size).toBe(100_000 - linked.sent[0]!.unsubscribed);
    expect(linked.sent[0]!.unsubscribed).toBeGreaterThan(300);
    expect(linked.sent[0]!.unsubscribed).toBeLessThan(500);
    expect(silent.sent[0]!.unsubscribed / linked.sent[0]!.unsubscribed).toBeGreaterThan(2.5);
    expect(silent.sent[0]!.unsubscribed / linked.sent[0]!.unsubscribed).toBeLessThan(3.5);
  });

  it('opens follow the formula: writing, fatigue, age, and a floor', () => {
    const { open } = GROWTH.email;
    const fresh: ListBucket = { nicheId: NICHE, kind: 'lead', month: 0, size: 100, fatigue: 0 };
    expect(openRate(fresh, 70, 1)).toBeCloseTo(open.lead, 6);
    expect(openRate({ ...fresh, kind: 'buyer' }, 70, 1)).toBeCloseTo(open.buyer, 6);
    expect(openRate(fresh, 100, 1)).toBeCloseTo(open.lead * 1.2, 6);
    expect(openRate(fresh, 10, 1)).toBeCloseTo(open.lead * 0.7, 6);
    expect(openRate({ ...fresh, fatigue: 0.5 }, 70, 1)).toBeCloseTo(open.lead * 0.5, 6);
    expect(openRate(fresh, 70, 181)).toBeCloseTo(open.lead * Math.exp(-1), 6);
    expect(openRate(fresh, 70, 2000)).toBeCloseTo(open.floor, 6);
  });

  it('fatigue rises with each send and fades by the day', () => {
    const { world, tools, n, p } = shop();
    addBuyers(world, n.id, 500);
    world.day = 5;
    tools.sendBroadcast(broadcast(n, p));
    deliverEmails(world, createRng(4));
    const [b] = world.market.audience!.buckets;
    expect(b!.fatigue).toBeCloseTo(GROWTH.email.fatiguePerSend, 6);
    world.day = 6;
    deliverEmails(world, createRng(4));
    expect(b!.fatigue).toBeCloseTo(GROWTH.email.fatiguePerSend - GROWTH.email.fatigueDecayDaily, 6);
  });

  it('a launch also reaches buyers of the same category, colder, and nobody else', () => {
    const { world, tools, n, p } = shop();
    const near = world.market.niches.find((x) => x.category === n.category && x.id !== n.id)!;
    const far = world.market.niches.find((x) => x.category !== n.category)!;
    addBuyers(world, n.id, 50_000);
    addBuyers(world, near.id, 50_000);
    addBuyers(world, far.id, 50_000);
    addLeads(world, near.id, 50_000);
    deliverEmails(world, createRng(1)); // the pipe's leads reach no broadcast: only buckets do
    world.day = 5;
    expect(tools.sendBroadcast(broadcast(n, p, { audience: 'launch' })).ok).toBe(true);
    deliverEmails(world, createRng(4));
    const launch = world.market.audience!.sent[0]!;
    expect(launch.delivered).toBe(100_000);
    const home = world.market.audience!.buckets.find((b) => b.nicheId === n.id)!;
    expect(home.fatigue).toBeGreaterThan(0);
    expect(world.market.audience!.buckets.find((b) => b.nicheId === far.id)!.fatigue).toBe(0);
    const rate = launch.opens / launch.delivered;
    expect(rate).toBeCloseTo((GROWTH.email.open.buyer * (launch.score >= 84 ? 1.2 : launch.score / 70) * (1 + GROWTH.email.crossCategory)) / 2, 1);
  });

  it('a mail for a guide gone off sale is dropped, not sent', () => {
    const { world, tools, n, p } = shop();
    addBuyers(world, n.id, 500);
    world.day = 5;
    tools.sendBroadcast(broadcast(n, p));
    p.status = 'paused';
    const { notes, rows } = deliverEmails(world, createRng(4));
    expect(rows).toEqual([]);
    expect(notes.join(' ')).toMatch(/annulé/);
    expect(world.market.audience!.queue).toEqual([]);
    expect(world.market.audience!.sent).toEqual([]);
    expect(world.market.audience!.totals.delivered).toBe(0);
  });

  it('the tools refuse what no list should receive', () => {
    const { world, tools, n, p } = shop();
    const other = world.market.niches.find((x) => x.id !== n.id)!;
    expect(tools.sendBroadcast(broadcast(n, p, { subject: '   ' })).ok).toBe(false);
    expect(tools.sendBroadcast(broadcast(other, p)).ok).toBe(false);
    expect(tools.sendBroadcast(broadcast(n, p, { body: 'Résultat garanti en 7 jours, sans effort.' })).message).toMatch(/interdite/);
    expect(tools.activateSequence({ nicheId: n.id, productId: p.id, steps: [], createdBy: 'test' }).ok).toBe(false);
    expect(tools.activateSequence({ nicheId: n.id, productId: p.id, steps: [{ ...steps(n)[0]!, body: 'Méthode secrète, résultat garanti.' }], createdBy: 'test' }).ok).toBe(false);
    p.status = 'paused';
    expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(false);
    p.status = 'live';
    world.day = 10;
    expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
    expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
    const third = tools.sendBroadcast(broadcast(n, p));
    expect(third.ok).toBe(false);
    expect(third.message).toMatch(/Déjà 2 e-mails/);
    world.day = 17;
    expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
  });

  it('listStats shows the list, its measured open rate and no mail body', () => {
    const { world, tools, n, p } = shop();
    expect(tools.listStats()).toMatchObject({ size: 0, byNiche: [], dailyCost: 0 });
    addBuyers(world, n.id, 3000);
    addLeads(world, n.id, 200);
    expect(tools.activateSequence({ nicheId: n.id, productId: p.id, steps: steps(n), createdBy: 'test' }).ok).toBe(true);
    world.day = 5;
    tools.sendBroadcast(broadcast(n, p));
    deliverEmails(world, createRng(4));
    const view = tools.listStats();
    const sent = world.market.audience!.sent[0]!;
    expect(view).toEqual(audienceView(world));
    expect(view.buyers + view.leads).toBe(view.size);
    expect(view.leads).toBeGreaterThan(150);
    expect(view.byNiche).toEqual([{ nicheId: n.id, size: view.size, openRate: sent.opens / sent.delivered }]);
    expect(view.dailyCost).toBe(emailCost(view.size));
    expect(view.recent[0]).toMatchObject({ id: sent.id, delivered: sent.delivered });
    expect(view.recent[0]).not.toHaveProperty('body');
    expect(view.sequences).toEqual([{ nicheId: n.id, productId: p.id, status: 'active' }]);
    expect(JSON.stringify(view)).not.toContain('désabonner');
  });
});

describe('what a list costs', () => {
  it('nothing under the free tier, then per thousand, billed as a tool', () => {
    const { world, n } = shop();
    addBuyers(world, n.id, 500);
    world.day = 5;
    deliverEmails(world, createRng(4));
    expect(world.ledger.filter((e) => e.ref?.startsWith('email:'))).toEqual([]);
    addBuyers(world, n.id, 2000);
    world.day = 6;
    deliverEmails(world, createRng(4));
    expect(world.ledger.filter((e) => e.ref === 'email:6')).toMatchObject([{ type: 'tool_subscription', amount: -0.4 }]);
  });
});

describe('400 days of cohorts (scale 13)', () => {
  it('keep at most 224 buckets, and lose nobody on the way', () => {
    const { world } = makeWorld(5, 500);
    const rng = createRng(11);
    const { niches } = world.market;
    expect(niches).toHaveLength(16);
    let peak = 0;
    for (let d = 1; d <= 400; d++) {
      world.day = d;
      deliverEmails(world, rng);
      for (const n of niches) { addLeads(world, n.id, 3); addBuyers(world, n.id, 2); }
      const a = world.market.audience!;
      peak = Math.max(peak, a.buckets.length);
      expect(a.buckets.length).toBeLessThanOrEqual(224);
    }
    const a = world.market.audience!;
    expect(peak).toBe(224);
    for (const n of niches) for (const kind of ['lead', 'buyer'] as const) expect(a.buckets.filter((b) => b.nicheId === n.id && b.kind === kind).length).toBeLessThanOrEqual(7);
    expect(listSize(a)).toBe(400 * 16 * 5);
    const cold = a.buckets.filter((b) => b.month <= monthOf(400) - GROWTH.email.bucketMonths);
    expect(cold).toHaveLength(32);
    expect(cold.every((b) => b.size > 0)).toBe(true);
  });
});

// ───────────────────────────── money ─────────────────────────────

/** A shop with a list, a kit at checkout and a follow-up guide. */
function fullShop(kit = true) {
  const s = shop();
  const { world, n, p } = s;
  if (kit) {
    product(world, 'prd_kit', n, kitPrice(p.price), 'live', { kind: 'kit' });
    p.bumpProductId = 'prd_kit';
  }
  return { ...s, kit: world.company.products.find((x) => x.id === 'prd_kit') };
}

describe('kit', () => {
  it('its price follows its guide, inside its bounds', () => {
    expect(kitPrice(10)).toBe(5);
    expect(kitPrice(19)).toBe(6);
    expect(kitPrice(25)).toBe(8);
    expect(kitPrice(49)).toBe(9);
  });

  it('takes the plain rate at a kit\'s price for the niche, less when it asks too much', () => {
    const wtp = { min: 9, sweet: 19, max: 29 };
    expect(bumpRate(wtp.sweet * GROWTH.bump.priceShare, wtp)).toBeCloseTo(GROWTH.bump.rate, 6);
    expect(bumpRate(9, wtp)).toBeLessThan(GROWTH.bump.rate);
    expect(bumpRate(9, wtp)).toBeGreaterThan(0);
    expect(bumpRate(9, wtp) * 3).toBeLessThan(bumpRate(5, wtp) * 3);
  });

  it('a kit nobody wired sells nothing, and a live one sells at its own price (scale 15)', () => {
    const { world, p, kit } = fullShop();
    days(world, 1, 30);
    const bumps = ordersBy(world, 'bump');
    const guides = world.market.orders.filter((o) => o.productId === p.id);
    expect(guides.length).toBeGreaterThan(20);
    expect(bumps.length).toBeGreaterThan(guides.length * 0.08);
    expect(bumps.length).toBeLessThan(guides.length * 0.45);
    expect(bumps.every((o) => o.productId === kit!.id && o.price === kit!.price)).toBe(true);
    expect(guides.every((o) => o.price === p.price)).toBe(true);
    const buyers = new Set(guides.map((o) => o.customerId));
    expect(bumps.every((o) => buyers.has(o.customerId))).toBe(true); // the guide's buyer, no one new
    expect(kit!.stats.sales).toBe(bumps.length);

    const off = fullShop(false);
    days(off.world, 1, 30);
    expect(ordersBy(off.world, 'bump')).toEqual([]);
  });

  it('leaves the guide\'s pricing evidence alone (scale 15)', () => {
    const on = fullShop();
    const off = fullShop(false);
    days(on.world, 1, 3); // later on a kit's reviews reach the store rating, and the two arms part ways
    days(off.world, 1, 3);
    expect(ordersBy(on.world, 'bump').length).toBeGreaterThan(0);
    expect(priceTiers(on.world, on.p)).toEqual(priceTiers(off.world, off.p));
    expect(on.world.market.adStats).toEqual(off.world.market.adStats);
    expect(on.p.stats.sales).toBe(off.p.stats.sales);

    days(on.world, 4, 30);
    const paid = ordersBy(on.world, 'ads');
    expect(ordersBy(on.world, 'bump').some((o) => o.campaignId)).toBe(true);
    expect(priceTiers(on.world, on.p).reduce((s, t) => s + t.revenue, 0)).toBeCloseTo(paid.reduce((s, o) => s + o.price, 0), 2);
  });

  it('a refund of the kit leaves the guide\'s order alone (scale 15)', () => {
    const { world, p, kit } = fullShop();
    days(world, 1, 30);
    const bump = ordersBy(world, 'bump')[0]!;
    const guideOrder = world.market.orders.find((o) => o.customerId === bump.customerId && o.productId === p.id)!;
    const before = cashOf(world);
    const sold = p.stats.refunds;
    expect(refundOrder(world, bump, 'Remboursement du kit')).toBe(bump.price);
    expect(cashOf(world)).toBeCloseTo(before - bump.price, 2);
    expect(bump.refunded).toBe(true);
    expect(guideOrder).toMatchObject({ refunded: false, chargeback: false });
    expect(p.stats.refunds).toBe(sold);
    expect(kit!.stats.refundAmount).toBeGreaterThanOrEqual(bump.price);
  });

  it('a bump opens no upsell and no conversation: it is not a sale of its own', () => {
    const { world, n, p, kit } = fullShop();
    product(world, 'prd_up', n, 15);
    p.upsellProductId = 'prd_up';
    kit!.upsellProductId = 'prd_up'; // even if the kit's last page pointed somewhere
    days(world, 1, 40);
    expect(ordersBy(world, 'bump').length).toBeGreaterThan(3);
    expect(p.stats.upsellSales).toBeGreaterThan(0);
    expect(kit!.stats.upsellSales).toBe(0);
    const bumps = new Map(ordersBy(world, 'bump').map((o) => [o.id, o.day]));
    expect(world.market.inbox.filter((m) => m.orderId && bumps.get(m.orderId) === m.day)).toEqual([]); // a refund request comes a day later at best
  });
});

describe('the books on a day with e-mail and kit orders (scale 14)', () => {
  it('reconcile to the cent, and Σ ledger = cash', () => {
    const { world, tools, n, p } = fullShop();
    addBuyers(world, n.id, 6000);
    let both = 0;
    for (let d = 1; d <= 30; d++) {
      world.day = d;
      if (d % 4 === 0) tools.sendBroadcast(broadcast(n, p));
      close(world, d);
      const r = reconcileDay(world, d);
      expect(r.gaps, `jour ${d}`).toEqual([]);
      const sold = world.market.orders.filter((o) => o.day === d);
      if (sold.some((o) => o.source === 'email') && sold.some((o) => o.source === 'bump')) both += 1;
    }
    expect(both).toBeGreaterThan(1);
    expect(financeSnapshot(world).cash).toBeCloseTo(cashOf(world), 2);
    const a = world.market.audience!;
    const emailOrders = ordersBy(world, 'email');
    expect(a.totals.sales).toBe(emailOrders.length);
    expect(a.totals.revenue).toBeCloseTo(emailOrders.reduce((s, o) => s + o.price, 0), 2);
    expect(a.sent.reduce((s, b) => s + b.sales, 0)).toBe(emailOrders.length);
    expect(world.ledger.filter((e) => e.type === 'revenue' && /e-mails/.test(e.memo)).length).toBeGreaterThan(0);
    expect(world.ledger.filter((e) => e.type === 'revenue' && /offre à la commande/.test(e.memo)).length).toBeGreaterThan(0);
  });
});

describe('email clicks at the shop', () => {
  it('come last and saturate nothing: the same ads sell the same on the same day (scale §6.1)', () => {
    const play = (send: boolean) => {
      const { world, tools, n, p } = shop();
      days(world, 1, 4);
      addBuyers(world, n.id, 30_000);
      world.day = 5;
      if (send) expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
      close(world, 5);
      return world;
    };
    const mailed = play(true);
    const quiet = play(false);
    expect(mailed.market.audience!.sent[0]!.clicks).toBeGreaterThan(300);
    expect(mailed.market.orders.filter((o) => o.source === 'email').length).toBeGreaterThan(10);
    expect(mailed.market.adStats).toEqual(quiet.market.adStats);
  });

  it('are not capped by the niche\'s pool: ten times the clicks, about ten times the sales', () => {
    const sold = (list: number) => {
      const { world, tools, n, p } = shop();
      addBuyers(world, n.id, list);
      world.day = 5;
      expect(tools.sendBroadcast(broadcast(n, p)).ok).toBe(true);
      close(world, 5);
      return ordersBy(world, 'email').length;
    };
    expect(sold(30_000)).toBeGreaterThan(10);
    expect(sold(300_000)).toBeGreaterThan(sold(30_000) * 6);
  });

  it('a past buyer is drawn from the last 120 days only, with or without the older rows', () => {
    const play = (keepOld: boolean) => {
      const { world, tools, n, p } = shop();
      const other = product(world, 'prd_other', n, 15);
      const row = (id: string, day: number, customerId: string): Order => ({ id, day, customerId, productId: other.id, price: 15, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 });
      const customer = (id: string) => world.market.customers.push({ id, name: 'Léa B.', email: 'x@y.z', archetype: 'normal', patience: 0.5, orders: [], satisfaction: 0 });
      customer('cus_old');
      customer('cus_hot');
      world.market.orders.push(row('ord_hot', 200 - 119, 'cus_hot'));
      if (keepOld) world.market.orders.unshift(row('ord_old', 200 - 120, 'cus_old'));
      addBuyers(world, n.id, 60_000);
      world.day = 200;
      tools.sendBroadcast(broadcast(n, p));
      close(world, 200);
      return world;
    };
    const kept = play(true);
    const gone = play(false);
    const buyers = (w: WorldState) => ordersBy(w, 'email').map((o) => o.customerId);
    expect(buyers(kept).length).toBeGreaterThan(5);
    expect(buyers(kept)).toContain('cus_hot');
    expect(buyers(kept)).not.toContain('cus_old');
    expect(buyers(kept).map((id) => (id === 'cus_hot' ? id : 'new'))).toEqual(buyers(gone).map((id) => (id === 'cus_hot' ? id : 'new')));
  });

  it('a buyer who owns the guide is not sold it again, nor drawn twice in a day', () => {
    const { world, tools, n, p } = shop();
    const row = (id: string, productId: string): Order => ({ id, day: 3, customerId: 'cus_a', productId, price: 15, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 });
    const other = product(world, 'prd_other', n, 15);
    world.market.customers.push({ id: 'cus_a', name: 'Léa B.', email: 'x@y.z', archetype: 'normal', patience: 0.5, orders: [], satisfaction: 0 });
    world.market.orders.push(row('ord_a', other.id), row('ord_b', p.id));
    addBuyers(world, n.id, 60_000);
    world.day = 10;
    tools.sendBroadcast(broadcast(n, p));
    close(world, 10);
    expect(ordersBy(world, 'email').length).toBeGreaterThan(5);
    expect(ordersBy(world, 'email').map((o) => o.customerId)).not.toContain('cus_a');
  });
});

// ───────────────────────────── rivals ─────────────────────────────

describe('rivals (scale 17)', () => {
  const nicheOf = (world: WorldState) => findNiche(world, NICHE)!;
  const copy = { title: 'Le guide du chiot propre' };

  it('lower the conversion, up to the ceiling', () => {
    const { world } = makeWorld(5, 500);
    const n = nicheOf(world);
    expect(rivalFactor(world, n.id)).toBe(1);
    addRival(world, n, copy, createRng(1), 0.08, 9);
    expect(rivalFactor(world, n.id)).toBeCloseTo(0.92, 6);
    expect(rivalFactor(world, world.market.niches.find((x) => x.id !== n.id)!.id)).toBe(1);
    for (let i = 0; i < 6; i++) addRival(world, n, copy, createRng(1), 0.1, 9);
    expect(rivalFactor(world, n.id)).toBeCloseTo(1 - GROWTH.rivals.maxTotal, 6);
  });

  it('sell against the guide: same ads, fewer sales', () => {
    const play = (pressure: number) => {
      const { world, n } = shop(SEED, 80);
      if (pressure) addRival(world, n, copy, createRng(1), pressure, 9);
      days(world, 1, 12);
      return world;
    };
    const free = play(0);
    const hit = play(0.3);
    expect(hit.market.adStats.map((s) => s.impressions)).toEqual(free.market.adStats.map((s) => s.impressions));
    const sold = (w: WorldState) => w.market.adStats.reduce((s, x) => s + x.purchases, 0);
    expect(sold(free)).toBeGreaterThan(15);
    expect(sold(hit)).toBeLessThan(sold(free) * 0.9);
  });

  it('fade with a half-life, on their own, from the day after they appear', () => {
    const { world } = makeWorld(5, 500);
    const n = nicheOf(world);
    world.day = 1;
    const { rival } = addRival(world, n, copy, createRng(1), 0.1, 9);
    rollRivals(world, createRng(1));
    expect(rival.pressure).toBe(0.1);
    for (let d = 2; d <= 61; d++) { world.day = d; rollRivals(world, createRng(d)); }
    expect(rival.pressure).toBeCloseTo(0.05, 6);
  });

  it('a new version halves them, once, in its niche only', () => {
    const { world, tools, n, p } = shop();
    const other = world.market.niches.find((x) => x.id !== n.id)!;
    const { rival } = addRival(world, n, copy, createRng(1), 0.2, 9);
    const away = addRival(world, other, copy, createRng(1), 0.2, 9).rival;
    expect(tools.publishProduct(p.id).ok).toBe(true);
    expect(rival.pressure).toBe(0.2); // v1 is no new version
    p.version = 2;
    expect(tools.publishProduct(p.id).ok).toBe(true); // already live: a rework never leaves the shelf
    expect(rival.pressure).toBeCloseTo(0.1, 6);
    expect(tools.publishProduct(p.id).ok).toBe(true);
    expect(tools.setProductStatus(p.id, 'paused').ok).toBe(true);
    expect(tools.setProductStatus(p.id, 'live').ok).toBe(true);
    expect(rival.pressure).toBeCloseTo(0.1, 6);
    expect(away.pressure).toBe(0.2);
    p.version = 3;
    p.status = 'paused';
    refreshRivals(world, p);
    expect(rival.pressure).toBeCloseTo(0.05, 6);
  });

  it('a refused publication shakes nobody off', () => {
    const { world, tools, p, n } = shop();
    const { rival } = addRival(world, n, copy, createRng(1), 0.2, 9);
    p.version = 2;
    p.status = 'ready';
    p.files.pdf = null;
    expect(tools.publishProduct(p.id).ok).toBe(false);
    expect(rival.pressure).toBe(0.2);
  });

  it('a clone is a rival: 0,1 of pressure, listed, and the niche\'s competition stays where it was', () => {
    const { world, tools, n, p } = shop();
    const competition = n.competition;
    const listed = tools.listCompetitors(n.id).length;
    const ev = forceEvent(world, createRng(2), 'competitor_clone')!;
    expect(ev).toMatchObject({ kind: 'competitor_clone', refs: { productId: p.id, nicheId: n.id } });
    expect(n.competition).toBe(competition);
    expect(world.market.rivals).toMatchObject([{ nicheId: n.id, pressure: 0.1, day: world.day, price: Math.max(5, Math.round(p.price * 0.6)) }]);
    const rows = tools.listCompetitors(n.id);
    expect(rows).toHaveLength(listed + 1);
    expect(rows.at(-1)!.title).toContain('édition express');
    expect(JSON.stringify(rows)).not.toContain('pressure');
  });

  it('come for what sells: the daily chance follows the last 14 days of sales, up to twice the base', () => {
    const rate = (orders: number, source: Order['source'] = 'ads') => {
      const { world, n, p } = shop();
      world.day = 100;
      world.market.orders = Array.from({ length: orders }, (_, i): Order => ({ id: `o${i}`, day: 100 - (i % 14), customerId: 'c', productId: p.id, price: 19, source, campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 }));
      let hits = 0;
      for (let k = 0; k < 4000; k++) {
        const notes = rollRivals(world, streamRng(7, k));
        hits += notes.length;
        world.market.rivals = [];
        n.competitors = n.competitors.filter((c) => !c.id.startsWith('cmp_riv_'));
      }
      return hits / 4000;
    };
    const { baseDaily } = GROWTH.rivals;
    expect(rate(0)).toBe(0);
    expect(rate(56, 'bump')).toBe(0); // a kit is no sale of its own
    expect(rate(56)).toBeGreaterThan(baseDaily * 0.75);
    expect(rate(56)).toBeLessThan(baseDaily * 1.25);
    expect(rate(112)).toBeGreaterThan(baseDaily * 1.6);
    expect(rate(1000)).toBeLessThan(baseDaily * 2.4);
  });

  it('reach the market close: a niche that sells draws one, and yesterday\'s fade', () => {
    const { world, n, p } = shop();
    const { rival } = addRival(world, n, copy, createRng(1), 0.1, 9);
    world.market.orders = Array.from({ length: 60 }, (_, i): Order => ({ id: `o${i}`, day: 20 - (i % 14), customerId: 'c', productId: p.id, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 }));
    const { baseDaily } = GROWTH.rivals;
    GROWTH.rivals.baseDaily = 1; // a certainty, for one close
    try {
      const { notes } = close(world, 20);
      expect(world.market.rivals).toHaveLength(2);
      expect(world.market.rivals![1]).toMatchObject({ nicheId: n.id, day: 20 });
      expect(world.market.rivals![1]!.pressure).toBeGreaterThanOrEqual(GROWTH.rivals.pressureMin);
      expect(world.market.rivals![1]!.pressure).toBeLessThan(GROWTH.rivals.pressureMax);
      expect(notes.join(' ')).toMatch(/copie « /);
      expect(rival.pressure).toBeLessThan(0.1);
      expect(world.market.events.filter((e) => e.kind === 'competitor_clone')).toEqual([]); // who gets copied follows the sales: no world event
    } finally {
      GROWTH.rivals.baseDaily = baseDaily;
    }
  });

  it('stay bounded on a run of any length, listing included', () => {
    const { world } = makeWorld(5, 500);
    const n = nicheOf(world);
    const catalog = n.competitors.length;
    for (let d = 1; d <= 40; d++) { world.day = d; addRival(world, n, copy, createRng(d), 0.08, 9); }
    expect(world.market.rivals).toHaveLength(GROWTH.rivals.maxListed);
    expect(world.market.rivals![0]!.day).toBe(29);
    expect(n.competitors).toHaveLength(catalog + GROWTH.rivals.maxListed);
    expect(new Set(world.market.rivals!.map((r) => r.id)).size).toBe(GROWTH.rivals.maxListed);
  });
});

// ───────────────────────────── streams ─────────────────────────────

describe('stream isolation (scale 16)', () => {
  it('a rival forced on D10 leaves the ads of D1-10 identical, and what later days bought', () => {
    const play = (force: boolean) => {
      const { world, n } = shop();
      for (let d = 1; d <= 20; d++) {
        close(world, d);
        if (force && d === 10) addRival(world, n, { title: 'Copie' }, createRng(1), 0.3, 9);
      }
      return world;
    };
    const plain = play(false);
    const rival = play(true);
    const until10 = (w: WorldState) => w.market.adStats.filter((s) => s.day <= 10);
    expect(until10(rival)).toEqual(until10(plain));
    const bought = (w: WorldState) => w.market.adStats.filter((s) => s.day > 10).map((s) => [s.day, s.spend, s.impressions, s.clicks, s.landingViews]);
    expect(bought(rival)).toEqual(bought(plain));
    const events = (w: WorldState) => w.market.events.map((e) => [e.day, e.kind]);
    expect(events(rival)).toEqual(events(plain));
  });

  it('`scaling` false and true share the market\'s draws: it gates company decisions only', () => {
    const play = (scaling: boolean) => {
      const { world } = shop(SEED, 60, { scaling });
      close(world, 1);
      close(world, 2);
      return world.market;
    };
    const on = play(true);
    expect(on.adStats.length).toBeGreaterThan(0);
    expect(play(false)).toEqual(on);
  });

  it('a list that nobody built draws nothing and writes nothing', () => {
    const { world } = shop();
    days(world, 1, 6);
    expect(world.market.audience).toBeUndefined();
    expect(world.ledger.some((e) => e.ref?.startsWith('email:'))).toBe(false);
  });

  it('a reload on any day of a run with a list, a kit and rivals ends byte for byte the same', () => {
    const play = (reload: boolean) => {
      const s = fullShop();
      const { n, p } = s;
      let { world, tools } = s;
      p.leadMagnet = { title: 'Les 5 erreurs', file: 'magnet.pdf', day: 1 };
      tools.activateSequence({ nicheId: n.id, productId: p.id, steps: steps(n), createdBy: 'test' });
      addBuyers(world, n.id, 8000);
      addRival(world, n, { title: 'Copie' }, createRng(1), 0.05, 9);
      for (let d = 1; d <= 25; d++) {
        world.day = d;
        if (d % 5 === 0) tools.sendBroadcast(broadcast(n, p));
        close(world, d);
        if (reload) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          tools = createMarketTools(world, createRng(1));
        }
      }
      return world;
    };
    const decisions = (w: WorldState): string => JSON.stringify(w, (k, v: unknown) => (k === 'at' ? undefined : v)); // the wall clock of the feed
    const straight = play(false);
    expect(ordersBy(straight, 'email').length).toBeGreaterThan(0);
    expect(ordersBy(straight, 'bump').length).toBeGreaterThan(0);
    expect(straight.market.audience!.totals.leads).toBeGreaterThan(0);
    expect(decisions(play(true)) === decisions(straight)).toBe(true);
  });
});

// ───────────────────────────── scoreEmail ─────────────────────────────

describe('scoreEmail', () => {
  const { world } = makeWorld(5, 500);
  const n = findNiche(world, NICHE)!;
  const good = mail(n);

  it('reads the object, the length, the customer\'s words and the call to action', () => {
    const r = scoreEmail(good.subject, good.body, n.voc, n.voc.bannedClaims);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.issues).toEqual([]);
    expect(scoreEmail('', good.body, n.voc, []).score).toBeLessThan(r.score - 20);
    expect(scoreEmail(good.subject, 'Bonjour.', n.voc, []).score).toBeLessThan(r.score - 15);
    expect(scoreEmail('Bonjour à tous mes amis', good.body, n.voc, []).issues.join(' ')).toMatch(/Objet sans chiffre/);
    const noLink = good.body.replace(/Le guide reprend.*Le lien est juste ici si vous voulez le télécharger\./, 'Voilà pour aujourd\'hui, à bientôt.');
    expect(scoreEmail(good.subject, noLink, undefined, []).issues.join(' ')).toMatch(/appel à l'action/);
  });

  it('marks down the same generic phrases and hype as an ad', () => {
    const empty = `${good.body} Il est important de noter que dans le monde d'aujourd'hui, il est essentiel de rester positif.`;
    const r = scoreEmail(good.subject, empty, n.voc, []);
    expect(r.score).toBeLessThan(scoreEmail(good.subject, good.body, n.voc, []).score);
    expect(r.issues.join(' ')).toMatch(/Formules creuses/);
    expect(scoreEmail(good.subject, `${good.body} Une méthode révolutionnaire et incroyable !`, n.voc, []).score).toBeLessThan(scoreEmail(good.subject, good.body, n.voc, []).score);
  });

  it('a banned claim sinks it, generic or the niche\'s own', () => {
    const generic = scoreEmail(good.subject, `${good.body} Résultat garanti.`, n.voc, n.voc.bannedClaims);
    expect(generic.score).toBeLessThanOrEqual(30);
    expect(generic.issues[0]).toMatch(/Allégation interdite/);
    const own = scoreEmail(good.subject, `${good.body} Du jamais vu chez les chiots.`, n.voc, ['chez les chiots']);
    expect(own.score).toBeLessThanOrEqual(30);
  });

  it('is the module\'s, no longer a stub', () => {
    expect(() => scoreEmail('', '', undefined, [])).not.toThrow();
    expect(scoreEmail('', '', undefined, []).score).toBeLessThan(40);
  });
});
