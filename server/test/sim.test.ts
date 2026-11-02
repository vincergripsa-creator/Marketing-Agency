import { describe, expect, it } from 'vitest';
import { createRng, streamRng } from '../src/core/index.js';
import type { Rng } from '../src/contracts.js';
import type {
  AdCreative, AdFormat, ChapterContent, CreatorProfile, Difficulty, HookStyle, InboxMessage, NicheTruth, Order, PdfContent, Product, SalesPage,
  ScenarioConfig, SupportReplyInput, VisualSpec, WorldState,
} from '../src/shared.js';
import {
  GENERIC_PHRASES, createMarketState, createMarketTools, difficultyProfile, financeSnapshot, findNiche, recordLedger, scoreCreative,
  scorePdf, scoreSalesPage, scoreSupportReply, tickMarket,
} from '../src/sim/index.js';
import { NICHE_CATALOG } from '../src/sim/niches.js';
import { isScamFlag, isScammer } from '../src/sim/market.js';
import { createCustomer } from '../src/sim/customers.js';
import { createMessage } from '../src/sim/inbox.js';
import { announcedOutageDays, forceEvent, isAnnouncedOutage } from '../src/sim/events.js';
import { partialRefund, refundOrder, repayableLeft, reviewProduct } from '../src/sim/ops.js';
import { priceFactor, SETUP_REF, storeRating, trustFactor, upsellRate } from '../src/sim/tick.js';
import { ADS, CONVERSION, DIFFICULTY, ESCALATION, FEES, RESEARCH, SCAM, UPSELL } from '../src/sim/balance.js';
import { brokenPromises, guideOverlap, guideSubstance, unbackedClaims, untreatedPains } from '../src/sim/quality.js';

// ───────────────────────────── fixtures ─────────────────────────────

function makeWorld(seed: number, difficulty: Difficulty = 'normal', cash = 500): { world: WorldState; rng: Rng } {
  const rng = createRng(seed);
  const scenario: ScenarioConfig = {
    name: 'test', companyName: 'Pixel Agency', seed, startingCash: cash, horizonDays: 60, difficulty, mindMode: 'heuristic',
    founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 },
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

/** A guide built the way the business video says: one problem, one audience, steps, examples, bonus, next step. */
function goodContent(n: NicheTruth): PdfContent {
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
    title: `${n.name} : la méthode en 6 étapes et 14 jours`,
    subtitle: `Pour ${lower(n.audience)} — ${lower(n.problem)}`,
    audience: n.audience,
    promise: `En 14 jours, ${lower(at(n.voc.desiredOutcomes, 0))}.`,
    introduction: [
      `Vous êtes ${lower(n.audience)} et ${lower(n.problem)} ? « ${at(n.voc.phrases, 0)} » : c'est la phrase que nous lisons le plus souvent.`,
      'Ce guide vous donne une méthode en 6 étapes numérotées, des exemples de vraies personnes et une checklist par chapitre.',
    ],
    chapters,
    bonus: {
      title: 'Bonus : la checklist imprimable des 14 jours', intro: 'Un récapitulatif à coller sur le frigo.',
      paragraphs: [k.tips.slice(0, 3).join(' ')], steps: k.steps.slice(0, 4), example: null, checklist: k.tips.slice(3, 7),
      visual: { type: 'checklist_card', title: 'Checklist', labels: ['Matin', 'Soir'], values: [] },
    },
    nextStep: { title: 'La suite est ici', text: 'Vous avez posé les bases. Le guide suivant vous accompagne pour consolider ces progrès, semaine par semaine.', upsellProductId: null },
    wordCount: 0,
  };
}

/** The "AI first draft" nobody should ship. */
function badContent(): PdfContent {
  const generic = "Il est important de noter que chaque situation est unique. N'hésitez pas à être patient. Dans le monde d'aujourd'hui, il est essentiel de rester positif. En conclusion, soyez patient et faites-vous confiance.";
  const ch = (t: string): ChapterContent => ({ title: t, intro: generic, paragraphs: [generic, generic], steps: [], example: null, checklist: [], visual: null });
  return {
    title: 'Le guide ultime pour tout réussir', subtitle: 'Libérez votre potentiel', audience: 'Tout le monde', promise: 'Une vie meilleure garantie',
    introduction: [generic], chapters: [ch('Introduction'), ch('Les bases'), ch('Conclusion')], bonus: ch(''),
    nextStep: { title: '', text: '', upsellProductId: null }, wordCount: 0,
  };
}

function goodSalesPage(n: NicheTruth, c: PdfContent, hype = 0.4): SalesPage {
  return {
    headline: `${n.name} : la méthode en 6 étapes pour ${lower(n.audience)}`,
    subheadline: `Des étapes concrètes, des exemples réels et une checklist par chapitre, pour en finir avec ce problème : ${lower(n.problem)}.`,
    painBullets: n.voc.phrases.slice(0, 5).map((p) => `« ${p} »`),
    solution: 'Un guide en 6 étapes numérotées, construit à partir de centaines de témoignages. Chaque chapitre vous dit quoi faire, combien de temps, et quelles erreurs éviter.',
    chapterBlurbs: c.chapters.map((ch) => ({ title: ch.title, blurb: 'Ce que vous allez appliquer concrètement dans cette étape, avec un exemple réel et une checklist.' })),
    bonusBlurb: 'Cadeau inclus : la checklist imprimable des 14 jours.',
    objections: n.voc.objections.slice(0, 4).map((q) => ({ q, a: 'Ce guide est construit à partir de vrais témoignages et vous donne des étapes précises, avec des exemples concrets.' })),
    guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.',
    cta: 'Je télécharge le guide',
    hypeLevel: hype,
  };
}

function badSalesPage(): SalesPage {
  return {
    headline: 'Le guide ultime qui va changer votre vie !!!', subheadline: '', painBullets: ['Vous en avez marre ?'], solution: 'Notre méthode révolutionnaire.',
    chapterBlurbs: [], bonusBlurb: '', objections: [], guarantee: 'Résultat garanti à 100%', cta: 'Acheter', hypeLevel: 0.9,
  };
}

function makeProduct(world: WorldState, id: string, n: NicheTruth, content: PdfContent, sp: SalesPage | null, price: number, withPdf = true): Product {
  const p: Product = {
    id, nicheId: n.id, title: content.title, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price, status: 'ready', version: 1,
    content,
    design: { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'paw', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 },
    salesPage: sp,
    files: { pdf: withPdf ? `files/${id}/v1/guide.pdf` : null, cover: `files/${id}/v1/cover.svg`, salesPage: `files/${id}/v1/sales-page.html` },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: world.day, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [{ day: world.day, price }],
  };
  p.quality = scorePdf(content, { audience: p.audience, problem: p.problem, voc: n.voc, design: p.design });
  if (sp) p.salesQuality = scoreSalesPage(sp, p);
  world.company.products.push(p);
  return p;
}

function goodCreative(world: WorldState, id: string, p: Product, n: NicheTruth, style: HookStyle, format: AdFormat, i = 0): AdCreative {
  const phrase = at(n.voc.phrases, i);
  const hooks: Record<HookStyle, string> = {
    pov: `POV : « ${phrase.slice(0, 50)} »`,
    question: `${n.audience.split(' ').slice(0, 4).join(' ')} : vous aussi, ${phrase.slice(0, 40)} ?`,
    story: `Il y a 3 semaines : « ${phrase.slice(0, 50)} »`,
    mistake: `L'erreur n°1 quand ${phrase.slice(0, 45)}`,
    stat: `3 étapes ont tout changé : « ${phrase.slice(0, 40)} »`,
    contrarian: `Arrêtez de tout essayer : « ${phrase.slice(0, 45)} »`,
    before_after: `Avant : « ${phrase.slice(0, 40)} ». Après 14 jours :`,
    listicle: `5 étapes si « ${phrase.slice(0, 45)} »`,
  };
  const hook = hooks[style];
  const pain = at(n.voc.pains, i);
  const c: AdCreative = {
    id, productId: p.id, hook, hookStyle: style, format,
    scenes: [
      { visual: 'Gros plan, texte qui apparaît mot à mot', onScreenText: hook.slice(0, 68), voiceover: hook, durationSec: 4 },
      { visual: 'Scène du quotidien, lumière du soir', onScreenText: pain.slice(0, 60), voiceover: pain, durationSec: 5 },
      { visual: 'Pages du guide qui défilent', onScreenText: 'Le guide : 6 étapes concrètes', voiceover: `Ce guide vous donne une méthode en 6 étapes pour ${lower(n.audience)}.`, durationSec: 6 },
      { visual: 'Couverture du guide et flèche vers la bio', onScreenText: 'Lien en bio : télécharge le guide', voiceover: 'Le lien est en bio, télécharge le guide dès ce soir.', durationSec: 5 },
    ],
    caption: `${n.voc.pains[0]} Le guide est en bio.`,
    hashtags: n.keywords.slice(0, 4).map((k) => `#${k.replace(/[^\p{L}\p{N}]/gu, '')}`),
    cta: 'Lien en bio : télécharge le guide',
    files: { storyboard: [], preview: null }, quality: null, review: { status: 'pending', reason: null, day: null }, createdDay: world.day, createdBy: 'test',
  };
  c.quality = scoreCreative(c, p, n.voc);
  world.company.creatives.push(c);
  return c;
}

function badCreative(world: WorldState, id: string, p: Product, style: HookStyle = 'stat', format: AdFormat = 'carousel', hook?: string): AdCreative {
  const h = hook ?? 'Découvrez notre nouveau produit numérique disponible dès maintenant sur notre boutique en ligne officielle';
  const c: AdCreative = {
    id, productId: p.id, hook: h, hookStyle: style, format,
    scenes: [{ visual: '', onScreenText: h, voiceover: '', durationSec: 6 }],
    caption: 'Nouveau', hashtags: [], cta: 'Acheter', files: { storyboard: [], preview: null }, quality: null,
    review: { status: 'pending', reason: null, day: null }, createdDay: world.day, createdBy: 'test',
  };
  c.quality = scoreCreative(c, p);
  world.company.creatives.push(c);
  return c;
}

const RIGHT_ACTION: Record<string, SupportReplyInput['action']> = {
  question: 'none', non_recu: 'resend_link', remboursement: 'refund', plainte_qualite: 'refund', sur_mesure: 'none', partenariat: 'ignore',
  arnaque: 'block', compliment: 'none', troll: 'ignore', menace_chargeback: 'refund', bug_paiement: 'resend_link',
};

function competentReply(msg: InboxMessage): SupportReplyInput {
  let action = RIGHT_ACTION[msg.intent] ?? 'none';
  if (msg.intent === 'bug_paiement' && /deux fois|double/i.test(msg.body)) action = 'refund';
  const text = action === 'ignore' || action === 'block' ? ''
    : `Bonjour, merci pour votre message et désolé pour ce souci, je comprends tout à fait. ${action === 'refund' ? 'Je viens de lancer votre remboursement, il apparaîtra sous 3 à 5 jours.'
      : action === 'resend_link' ? "Je vous renvoie le lien de téléchargement à l'instant, pensez à vérifier vos spams."
        : 'Le guide détaille cela au chapitre 2, étape par étape, avec un exemple concret.'}\nBelle journée,\n— Inès, service client`;
  return { text, action, detectedIntent: msg.intent };
}

/** Publishes a product and launches one campaign; returns the tools for the daily loop. */
function launch(world: WorldState, rng: Rng, opts: { niche: string; good: boolean; price?: number; styles: [HookStyle, AdFormat][]; budget: number }) {
  const tools = createMarketTools(world, rng);
  const n = findNiche(world, opts.niche)!;
  const content = opts.good ? goodContent(n) : badContent();
  const p = makeProduct(world, 'prd_main', n, content, opts.good ? goodSalesPage(n, content) : badSalesPage(), opts.price ?? n.wtp.sweet);
  expect(tools.publishProduct(p.id).ok).toBe(true);
  const ids: string[] = [];
  opts.styles.forEach(([s, f], i) => {
    const c = opts.good ? goodCreative(world, `cre_${i}`, p, n, s, f, i) : badCreative(world, `cre_${i}`, p, s, f);
    if (approve(tools, c.id) === 'approved') ids.push(c.id);
  });
  const camp = tools.createCampaign({ productId: p.id, name: 'Test', creativeIds: ids, dailyBudget: opts.budget, targeting: { interests: [], ageMin: 25, ageMax: 45 }, createdBy: 'test' });
  return { tools, product: p, niche: n, campaign: camp };
}

/** Submits a creative, resubmitting after automatic-moderation false positives (they carry no strike). */
function approve(tools: ReturnType<typeof createMarketTools>, id: string): 'approved' | 'rejected' {
  for (let i = 0; i < 5; i++) {
    const r = tools.submitCreative(id);
    if (r.status === 'approved' || r.strike) return r.status;
  }
  return 'rejected';
}

function runDays(world: WorldState, rng: Rng, days: number, each?: (day: number) => void) {
  const results = [];
  for (let d = 1; d <= days; d++) {
    world.day = d;
    each?.(d);
    results.push(tickMarket(world, rng));
  }
  return results;
}

const SEEDS = [1, 2, 3];

// ───────────────────────────── catalog ─────────────────────────────

describe('niche catalog', () => {
  it('has at least 14 rich French niches with full voice-of-customer', () => {
    expect(NICHE_CATALOG.length).toBeGreaterThanOrEqual(14);
    const ids = new Set(NICHE_CATALOG.map((n) => n.id));
    expect(ids.size).toBe(NICHE_CATALOG.length);
    for (const n of NICHE_CATALOG) {
      const v = n.voc;
      expect(v.pains.length, n.id).toBeGreaterThanOrEqual(8);
      expect(v.phrases.length, n.id).toBeGreaterThanOrEqual(10);
      expect(v.objections.length, n.id).toBeGreaterThanOrEqual(5);
      expect(v.desiredOutcomes.length, n.id).toBeGreaterThanOrEqual(5);
      expect(v.knowledge.tips.length, n.id).toBeGreaterThanOrEqual(10);
      expect(v.knowledge.steps.length, n.id).toBeGreaterThanOrEqual(8);
      expect(v.knowledge.mistakes.length, n.id).toBeGreaterThanOrEqual(6);
      expect(v.knowledge.examples.length, n.id).toBeGreaterThanOrEqual(4);
      expect(v.knowledge.facts.length, n.id).toBeGreaterThanOrEqual(4);
      expect(v.priceAnchors.length, n.id).toBeGreaterThan(0);
      expect(v.bannedClaims.length, n.id).toBeGreaterThan(0);
      expect(n.competitors.length, n.id).toBeGreaterThanOrEqual(3);
      expect(n.competitors.length, n.id).toBeLessThanOrEqual(5);
      expect(n.seasonality).toHaveLength(7);
      expect(n.wtp.min).toBeLessThan(n.wtp.sweet);
      expect(n.wtp.sweet).toBeLessThan(n.wtp.max);
      expect(Object.keys(n.hookAffinity)).toHaveLength(8);
      expect(Object.keys(n.formatAffinity)).toHaveLength(4);
    }
  });

  it('hides gems and traps behind different hidden parameters', () => {
    const chiot = NICHE_CATALOG.find((n) => n.id === 'proprete-chiot')!;
    const ventre = NICHE_CATALOG.find((n) => n.id === 'ventre-apres-40')!;
    const chat = NICHE_CATALOG.find((n) => n.id === 'chat-griffe-canape')!;
    expect(chiot.competition).toBeLessThan(0.4);
    expect(ventre.complianceRisk).toBeGreaterThan(0.8);
    expect(chat.tiktokAffinity).toBeGreaterThan(chiot.tiktokAffinity);
    expect(chat.wtp.sweet).toBeLessThan(chiot.wtp.sweet);
  });
});

// ───────────────────────────── market state ─────────────────────────────

describe('createMarketState', () => {
  it('varies hidden parameters by at most ±15 % and creates 3-6 creators per niche', () => {
    const { world } = makeWorld(42);
    const m = world.market;
    expect(m.niches).toHaveLength(NICHE_CATALOG.length);
    for (const n of m.niches) {
      const base = NICHE_CATALOG.find((c) => c.id === n.id)!;
      expect(n.demand).toBeLessThanOrEqual(Math.min(1, base.demand * 1.151));
      expect(n.demand).toBeGreaterThanOrEqual(base.demand * 0.849 - 0.01);
      expect(n.cpmBase).toBeGreaterThanOrEqual(base.cpmBase * 0.849);
      expect(n.cpmBase).toBeLessThanOrEqual(base.cpmBase * 1.151);
      const creators = m.creators.filter((c) => c.nicheId === n.id);
      expect(creators.length).toBeGreaterThanOrEqual(3);
      expect(creators.length).toBeLessThanOrEqual(6);
      expect(creators.some((c) => !isScammer(world, c))).toBe(true);
    }
    expect(m.customers).toEqual([]);
    expect(m.orders).toEqual([]);
    expect(m.adAccount).toEqual({ strikes: 0, banned: false, bannedUntilDay: 0 });
    // the catalog itself is never mutated
    expect(NICHE_CATALOG.find((n) => n.id === 'sommeil-bebe')!.cpmBase).toBe(6.2);
  });

  it('~25 % of creators are scammers on normal: all ask for an advance, some without any explicit red flag', () => {
    let scams = 0; let total = 0; let stealth = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { world } = makeWorld(seed);
      for (const c of world.market.creators) {
        total++;
        if (!isScammer(world, c)) { expect(c.redFlags.some(isScamFlag)).toBe(false); continue; }
        scams++;
        expect(c.askUpfront).toBeGreaterThan(0);
        if (!c.redFlags.some(isScamFlag)) stealth++;
      }
    }
    expect(scams / total).toBeGreaterThan(0.12);
    expect(scams / total).toBeLessThan(0.38);
    expect(stealth).toBeGreaterThan(0);
    expect(stealth).toBeLessThan(scams);
  });

  it('exposes difficulty profiles', () => {
    expect(difficultyProfile('facile').cpmMultiplier).toBeLessThan(1);
    expect(difficultyProfile('normal').cpmMultiplier).toBe(1);
    expect(difficultyProfile('cauchemar').cpmMultiplier).toBeGreaterThan(1);
    expect(difficultyProfile('cauchemar').annoyingShare).toBeGreaterThan(difficultyProfile('facile').annoyingShare);
  });
});

// ───────────────────────────── research tools ─────────────────────────────

describe('research tools', () => {
  it('returns noisy trend signals and filters by query', () => {
    const { world, rng } = makeWorld(5);
    const tools = createMarketTools(world, rng);
    const all = tools.searchTrends();
    expect(all).toHaveLength(world.market.niches.length);
    for (const t of all) {
      const n = findNiche(world, t.nicheId)!;
      expect(Math.abs(t.searchInterest - n.demand * 100)).toBeLessThanOrEqual(21);
      expect(t.searchInterest).toBeGreaterThanOrEqual(0);
      expect(t.searchInterest).toBeLessThanOrEqual(100);
      expect(['faible', 'moyenne', 'forte']).toContain(t.competitionHint);
      expect(t.sampleTitles.length).toBeGreaterThan(0);
    }
    const bebe = tools.searchTrends('bébé');
    expect(bebe.length).toBeGreaterThan(0);
    expect(bebe.length).toBeLessThan(all.length);
    expect(bebe.every((t) => /bébé|bebe/i.test(`${t.name} ${t.audience}`) || t.category === 'Parentalité')).toBe(true);
    expect(tools.searchTrends('zzzzzz')).toEqual([]);
  });

  it('mines a partial voice-of-customer: a quick look, a deeper one, and a second pass finds more', () => {
    const { world, rng } = makeWorld(6);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'sommeil-bebe')!;
    const quick = tools.minePains('sommeil-bebe', 'quick');
    const deep = tools.minePains('sommeil-bebe', 'deep');
    expect(quick.depth).toBe('quick');
    expect(quick.phrases.length).toBe(Math.ceil(n.voc.phrases.length * RESEARCH.quick));
    expect(deep.phrases.length).toBe(Math.ceil(n.voc.phrases.length * RESEARCH.deep));
    expect(deep.phrases.length).toBeLessThan(n.voc.phrases.length);
    expect(deep.knowledge.tips.length).toBeGreaterThan(quick.knowledge.tips.length);
    const again = tools.minePains('sommeil-bebe', 'deep');
    expect(new Set([...deep.pains, ...again.pains]).size).toBeGreaterThan(deep.pains.length);
    for (const p of quick.phrases) expect(n.voc.phrases).toContain(p);
    expect(tools.minePains('inconnue', 'deep').pains).toEqual([]);
    expect(tools.nicheBrief('sommeil-bebe')?.audience).toBe(n.audience);
    expect(tools.nicheBrief('inconnue')).toBeNull();
    expect(tools.listCompetitors('sommeil-bebe').length).toBe(n.competitors.length);
  });
});

// ───────────────────────────── store ─────────────────────────────

describe('store', () => {
  it('requires a PDF, a sales page and a price before publishing', () => {
    const { world, rng } = makeWorld(7);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const noPdf = makeProduct(world, 'p1', n, c, goodSalesPage(n, c), 19, false);
    const noPage = makeProduct(world, 'p2', n, c, null, 19);
    const noPrice = makeProduct(world, 'p3', n, c, goodSalesPage(n, c), 0);
    const ok = makeProduct(world, 'p4', n, c, goodSalesPage(n, c), 19);
    expect(tools.publishProduct('p1').ok).toBe(false);
    expect(tools.publishProduct('p2').ok).toBe(false);
    expect(tools.publishProduct('p3').ok).toBe(false);
    expect(tools.publishProduct('nope').ok).toBe(false);
    expect([noPdf.status, noPage.status, noPrice.status]).toEqual(['ready', 'ready', 'ready']);
    const r = tools.publishProduct('p4');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/en ligne/);
    expect(ok.status).toBe('live');
    expect(ok.launchedDay).toBe(1);
    expect(tools.setPrice('p4', 0).ok).toBe(false);
    expect(tools.setPrice('p4', 24).ok).toBe(true);
    expect(ok.priceHistory.at(-1)).toEqual({ day: 1, price: 24 });
    expect(tools.setProductStatus('p4', 'paused').ok).toBe(true);
    expect(ok.status).toBe('paused');
    expect(tools.setProductStatus('p4', 'killed').ok).toBe(true);
    expect(tools.publishProduct('p4').ok).toBe(false);
  });
});

// ───────────────────────────── TikTok ads ─────────────────────────────

describe('ad platform', () => {
  it('rejects banned claims with a French reason, strikes, warns, then bans for 7 days', () => {
    const { world, rng } = makeWorld(8);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    const good = goodCreative(world, 'ok', p, n, 'pov', 'faceless_voiceover');
    expect(tools.submitCreative('ok').status).toBe('approved');

    const hooks = ['Résultat garanti en une semaine', 'La méthode miracle pour ton chiot', 'Propre en 3 jours, promis'];
    const results = hooks.map((h, i) => tools.submitCreative(badCreative(world, `bad${i}`, p, 'stat', 'carousel', h).id));
    expect(results.every((r) => r.status === 'rejected' && r.strike)).toBe(true);
    expect(results[0]!.reason).toMatch(/« garanti » enfreint/);
    expect(results[1]!.reason).toMatch(/miracle/);
    expect(results[2]!.reason).toMatch(/propre en 3 jours/);
    const kinds = world.market.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'ad_rejected')).toHaveLength(3);
    expect(kinds).toContain('ad_account_warning');
    expect(kinds).toContain('ad_account_banned');
    expect(world.market.adAccount.banned).toBe(true);
    expect(world.market.adAccount.bannedUntilDay).toBe(8);

    // banned: no campaign, no submission, no delivery
    expect(tools.createCampaign({ productId: 'p', name: 'x', creativeIds: [good.id], dailyBudget: 20, targeting: { interests: [], ageMin: 18, ageMax: 50 }, createdBy: 't' }).ok).toBe(false);
    expect(tools.submitCreative('ok').strike).toBe(false);
    world.company.campaigns.push({ id: 'cpg_x', productId: 'p', name: 'x', creativeIds: ['ok'], dailyBudget: 20, status: 'active', targeting: { interests: [], ageMin: 18, ageMax: 50 }, startDay: 1, createdBy: 't' });
    good.review = { status: 'approved', reason: null, day: 1 };
    const r = runDays(world, rng, 3);
    expect(r.every((x) => x.adSpend === 0)).toBe(true);
    expect(r[0]!.notes.join(' ')).toMatch(/suspendu/);

    // the ban is lifted on its end day
    world.day = 8;
    const after = tickMarket(world, rng);
    expect(world.market.adAccount.banned).toBe(false);
    expect(after.adSpend).toBeGreaterThan(0);
  });

  it('validates campaigns (live product, approved creative, budget, cash)', () => {
    const { world, rng } = makeWorld(9, 'normal', 30);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'mariage-moins-10k')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 27);
    const cr = goodCreative(world, 'c', p, n, 'story', 'carousel');
    const base = { productId: 'p', name: 'Mariage', creativeIds: ['c'], targeting: { interests: [], ageMin: 25, ageMax: 40 }, createdBy: 't' };
    expect(tools.createCampaign({ ...base, dailyBudget: 20 }).ok).toBe(false); // not live
    tools.publishProduct('p');
    expect(tools.createCampaign({ ...base, dailyBudget: 20 }).ok).toBe(false); // not approved
    tools.submitCreative(cr.id);
    if (cr.review.status !== 'approved') cr.review = { status: 'approved', reason: null, day: 1 };
    expect(tools.createCampaign({ ...base, dailyBudget: 3 }).ok).toBe(false); // below minimum
    expect(tools.createCampaign({ ...base, dailyBudget: 50 }).ok).toBe(false); // more than cash
    const ok = tools.createCampaign({ ...base, dailyBudget: 20 });
    expect(ok.ok).toBe(true);
    expect(tools.updateCampaign(ok.id!, { dailyBudget: 2 }).ok).toBe(false);
    expect(tools.updateCampaign(ok.id!, { dailyBudget: 25, status: 'paused' }).ok).toBe(true);
    expect(world.company.campaigns[0]!.status).toBe('paused');
  });

  it('gives a good creative a clearly better CTR than a bad one over many days', () => {
    for (const seed of SEEDS) {
      const { world, rng } = makeWorld(seed);
      const tools = createMarketTools(world, rng);
      const n = findNiche(world, 'sommeil-bebe')!;
      const c = goodContent(n);
      const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), n.wtp.sweet);
      tools.publishProduct('p');
      const good = goodCreative(world, 'good', p, n, 'question', 'faceless_voiceover');
      const bad = badCreative(world, 'bad', p, 'question', 'faceless_voiceover');
      expect(approve(tools, 'good')).toBe('approved');
      if (approve(tools, 'bad') !== 'approved') bad.review = { status: 'approved', reason: null, day: 1 };
      expect(tools.createCampaign({ productId: 'p', name: 'AB', creativeIds: ['good', 'bad'], dailyBudget: 30, targeting: { interests: [], ageMin: 25, ageMax: 40 }, createdBy: 't' }).ok).toBe(true);
      runDays(world, rng, 20);
      const ctr = (id: string) => {
        const rows = world.market.adStats.filter((s) => s.creativeId === id);
        return rows.reduce((s, r) => s + r.clicks, 0) / Math.max(1, rows.reduce((s, r) => s + r.impressions, 0));
      };
      expect(good.quality!.overall).toBeGreaterThan(bad.quality!.overall);
      expect(ctr('good')).toBeGreaterThan(ctr('bad') * 1.5);
      expect(world.market.creativeImpressions.good).toBeGreaterThan(0);
    }
  });
});

describe('ad rows past their retention', () => {
  it('leave the market but stay in the total of their creative', () => {
    const { world, rng } = makeWorld(3);
    const row = (day: number, spend: number) => ({ day, campaignId: 'c', creativeId: 'old', productId: 'p', spend, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0.5, cpm: 10, landingViews: 15, purchases: 1, revenue: 19, roas: 1.9, frequency: 1.2, comments: [] });
    world.market.adStats = [row(1, 10), row(2, 15), row(60, 5)];
    world.day = 100;
    tickMarket(world, rng);
    expect(world.market.adStats.map((s) => s.day)).toEqual([60]);
    expect(world.market.retiredAdTotals).toEqual({ old: { spend: 25, impressions: 2000, clicks: 40, purchases: 2, revenue: 38, lastDay: 2 } });
  });
});

// ───────────────────────────── determinism ─────────────────────────────

describe('determinism', () => {
  it('same seed + same decisions → identical market days', () => {
    const play = () => {
      const { world, rng } = makeWorld(1234, 'cauchemar');
      const { tools } = launch(world, rng, { niche: 'sommeil-bebe', good: true, styles: [['story', 'text_slideshow'], ['pov', 'faceless_voiceover']], budget: 20 });
      const results = runDays(world, rng, 15, (d) => {
        tools.postOrganic({ productId: 'prd_main', hook: `Jour ${d} : « il se réveille toutes les 2h »`, hookStyle: 'story', format: 'text_slideshow' });
        for (const m of tools.listInbox('open')) tools.replyToMessage(m.id, competentReply(m), 'support');
      });
      const { activity: _a, ...rest } = world;
      return { results, state: JSON.stringify(rest) };
    };
    const a = play();
    const b = play();
    expect(a.results).toEqual(b.results);
    expect(a.state).toBe(b.state);
    expect(a.results.some((r) => r.sales > 0)).toBe(true);
  });

  it('a stream depends on its key alone, not on what other streams drew', () => {
    const first = streamRng(7, 3, 12).next();
    const other = streamRng(7, 3, 13);
    for (let i = 0; i < 50; i++) other.next();
    expect(streamRng(7, 3, 12).next()).toBe(first);
    expect(streamRng(7, 3, 13).next()).not.toBe(first);
    expect(streamRng(8, 3, 12).next()).not.toBe(first);
  });

  it('the same seed is the same market: what the company does elsewhere moves neither the events nor another product', () => {
    const play = (extra: boolean) => {
      const { world } = makeWorld(21, 'cauchemar', 5000);
      const { tools } = launch(world, createRng(1), { niche: 'sommeil-bebe', good: true, styles: [['story', 'text_slideshow']], budget: 20 });
      for (let d = 1; d <= 20; d++) {
        world.day = d;
        if (extra && d === 5) tools.postOrganic({ productId: 'prd_main', hook: 'Un post de plus', hookStyle: 'story', format: 'text_slideshow' });
        tickMarket(world, streamRng(21, 3, d));
      }
      return world;
    };
    const events = (w: WorldState) => w.market.events.map((e) => `${e.day}:${e.kind}`);
    const spend = (w: WorldState) => w.market.adStats.map((s) => s.impressions);
    const quiet = play(false);
    const busy = play(true);
    expect(events(quiet).length).toBeGreaterThan(0);
    expect(events(busy)).toEqual(events(quiet));
    expect(spend(busy)).toEqual(spend(quiet));
  });

  it('closes a given day only once', () => {
    const { world, rng } = makeWorld(3);
    world.day = 4;
    tickMarket(world, rng);
    const n = world.ledger.length;
    const again = tickMarket(world, rng);
    expect(world.ledger.length).toBe(n);
    expect(again.notes[0]).toMatch(/déjà clôturé/);
  });
});

// ───────────────────────────── inbox & support ─────────────────────────────

describe('inbox', () => {
  it('generates varied French messages with archetype-specific deadlines', () => {
    const { world, rng } = makeWorld(11, 'cauchemar', 2000);
    launch(world, rng, { niche: 'sommeil-bebe', good: true, styles: [['story', 'text_slideshow'], ['pov', 'faceless_voiceover']], budget: 40 });
    runDays(world, rng, 25);
    const inbox = world.market.inbox;
    expect(inbox.length).toBeGreaterThan(25);
    const intents = new Set(inbox.map((m) => m.intent));
    expect(intents.size).toBeGreaterThanOrEqual(7);
    expect(new Set(inbox.map((m) => m.body)).size).toBeGreaterThan(inbox.length * 0.6);
    expect(new Set(inbox.map((m) => m.channel)).size).toBeGreaterThanOrEqual(2);
    for (const m of inbox) {
      expect(m.body.trim().length).toBeGreaterThan(2); // TikTok comments can be one word (« ratio »)
      expect(m.thread[0]!.from).toBe('customer');
      expect(m.deadlineDay).toBeGreaterThan(m.day);
      const c = world.market.customers.find((x) => x.id === m.customerId)!;
      if (c.archetype === 'karen' || c.archetype === 'impatient') expect(m.deadlineDay).toBe(m.day + 1);
    }
    const all = inbox.map((m) => m.body).join('\n');
    expect(all).toMatch(/[éèàçù]/);
    expect(all).toMatch(/\b(je|vous|votre|guide)\b/i);
    // ignored messages escalate (bad reviews / chargebacks) — nobody answered in this run
    expect(inbox.some((m) => m.status === 'escalated')).toBe(true);
  });

  it('applies archetype voices (karen shouts, sceptique doubts, impatient insists)', () => {
    const { world, rng } = makeWorld(12);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    const karen = createCustomer(world, rng, 'karen');
    const scep = createCustomer(world, rng, 'sceptique');
    const imp = createCustomer(world, rng, 'impatient');
    const k = createMessage(world, rng, { intent: 'plainte_qualite', customer: karen, product: p, order: null, niche: n });
    const s = createMessage(world, rng, { intent: 'question', customer: scep, product: p, order: null, niche: n });
    const i = createMessage(world, rng, { intent: 'non_recu', customer: imp, product: p, order: null, niche: n });
    expect(k.body).toMatch(/[A-ZÉÈ]{5,}/);
    expect(k.subject).toBe(k.subject.toUpperCase());
    expect(s.body).toMatch(/ChatGPT|IA|forum|sources/);
    expect(i.body).toMatch(/\?\?\?|MAINTENANT/);
    expect(k.deadlineDay).toBe(world.day + 1);
    expect(s.deadlineDay).toBe(world.day + 2);
  });

  it('evaluates replies and applies consequences (scam paid, scam blocked, refund, troll fed)', () => {
    const { world, rng } = makeWorld(13);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    const scammer = createCustomer(world, rng, 'arnaqueur');
    const scam1 = createMessage(world, rng, { intent: 'arnaque', customer: scammer, product: p, order: null, niche: n, templateIndex: 1 });
    const scam2 = createMessage(world, rng, { intent: 'arnaque', customer: scammer, product: p, order: null, niche: n, templateIndex: 5 });
    const cashBefore = financeSnapshot(world).cash;
    const blocked = tools.replyToMessage(scam1.id, { text: '', action: 'block', detectedIntent: 'arnaque' }, 'ines');
    expect(blocked.consequence).toBe('none');
    expect(blocked.resolved).toBe(true);
    expect(blocked.score).toBeGreaterThanOrEqual(80);
    const paid = tools.replyToMessage(scam2.id, { text: 'Bonjour, je vous rembourse la différence.', action: 'refund', detectedIntent: 'question' }, 'ines');
    expect(paid.consequence).toBe('scam_loss');
    expect(paid.cost).toBe(300);
    expect(paid.score).toBeLessThanOrEqual(15);
    expect(financeSnapshot(world).cash).toBeCloseTo(cashBefore - 300, 2);
    expect(world.ledger.at(-1)!.type).toBe('scam_loss');

    // refund request on a real order
    const buyer = createCustomer(world, rng, 'normal');
    const order = { id: 'ord_t', day: 1, customerId: buyer.id, productId: 'p', price: 19, source: 'ads' as const, campaignId: null, creatorId: null, refunded: false, chargeback: false };
    world.market.orders.push(order);
    buyer.orders.push(order.id);
    const req = createMessage(world, rng, { intent: 'remboursement', customer: buyer, product: p, order, niche: n });
    const ok = tools.replyToMessage(req.id, competentReply(req), 'ines');
    expect(ok.consequence).toBe('refund');
    expect(ok.cost).toBe(19);
    expect(order.refunded).toBe(true);
    expect(p.stats.refunds).toBe(1);
    expect(req.status).toBe('resolved');
    expect(req.thread.length).toBe(3);
    expect(tools.replyToMessage(req.id, competentReply(req), 'ines').customerReaction).toMatch(/déjà traité/);
    expect(tools.issueRefund('ord_t', 'doublon').ok).toBe(false);

    // arguing with a troll backfires: a troll who bought the guide leaves a 1-star store review…
    const argue = { text: 'Vous avez tort, ' + 'notre guide est excellent et vous ne l\'avez même pas lu, c\'est ridicule. '.repeat(5), action: 'none' as const, detectedIntent: 'question' as const };
    const troll = createCustomer(world, rng, 'troll');
    const trollOrder = { ...order, id: 'ord_troll', customerId: troll.id, refunded: false };
    world.market.orders.push(trollOrder);
    troll.orders.push(trollOrder.id);
    const tm = createMessage(world, rng, { intent: 'troll', customer: troll, product: p, order: trollOrder, niche: n });
    const fed = tools.replyToMessage(tm.id, argue, 'ines');
    expect(fed.consequence).toBe('bad_review');
    expect(p.stats.reviews.at(-1)!.rating).toBe(1);
    // …while a troll who never bought it cannot rate the store (verified reviews only): they just come back.
    const reviews = p.stats.reviews.length;
    const stranger = createCustomer(world, rng, 'troll');
    const sm = createMessage(world, rng, { intent: 'troll', customer: stranger, product: p, order: null, niche: n });
    const fedStranger = tools.replyToMessage(sm.id, argue, 'ines');
    expect(fedStranger.consequence).toBe('none');
    expect(fedStranger.resolved).toBe(false);
    expect(p.stats.reviews.length).toBe(reviews);
  });
});

// ───────────────────────────── scorers ─────────────────────────────

describe('quality scorers', () => {
  const n = NICHE_CATALOG.find((x) => x.id === 'sommeil-bebe')!;
  const product = (content: PdfContent): Product => ({
    id: 'p', nicheId: n.id, title: content.title, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price: 19, status: 'ready', version: 1,
    content, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: { ...scorePdf(content, { audience: n.audience, problem: n.problem, voc: n.voc }) },
    salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  });

  it('lists at least 30 generic AI phrases', () => {
    expect(GENERIC_PHRASES.length).toBeGreaterThanOrEqual(30);
    expect(GENERIC_PHRASES).toContain('chaque bébé est différent');
    expect(GENERIC_PHRASES).toContain("n'hésitez pas à");
  });

  it('ranks a specific, structured PDF far above a generic one', () => {
    const good = scorePdf(goodContent(n), { audience: n.audience, problem: n.problem, voc: n.voc, design: { palette: { bg: '#fff', primary: '#000', secondary: '#111', accent: '#f00', ink: '#000', soft: '#eee' }, motif: 'moon', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1 } });
    const bad = scorePdf(badContent(), { audience: n.audience, problem: n.problem, voc: n.voc, design: null });
    expect(good.overall).toBeGreaterThanOrEqual(70);
    expect(bad.overall).toBeLessThan(40);
    expect(good.specificity).toBeGreaterThan(bad.specificity);
    expect(good.humanTone).toBeGreaterThan(bad.humanTone);
    expect(good.structure).toBeGreaterThan(bad.structure);
    expect(bad.issues.join(' ')).toMatch(/générique/);
    expect(bad.issues.some((i) => /chapitre/i.test(i))).toBe(true);
    expect(bad.issues[0]).toMatch(/Allégations/); // compliance always comes first
    expect(good.evaluator).toBe('heuristic');
    // humanising (removing clichés) raises the tone score
    const g = goodContent(n);
    g.chapters[0]!.paragraphs.push("Chaque bébé est différent, soyez patient. Il est important de noter qu'en fin de compte, n'hésitez pas à demander de l'aide.");
    expect(scorePdf(g, { audience: n.audience, problem: n.problem, voc: n.voc }).humanTone).toBeLessThan(good.humanTone);
  });

  it('flags risky claims in a PDF', () => {
    const g = goodContent(n);
    g.promise = 'Bébé fait ses nuits en 3 jours, résultat garanti à 100%';
    const r = scorePdf(g, { audience: n.audience, problem: n.problem, voc: n.voc });
    expect(r.compliance).toBeLessThan(70);
    expect(r.issues.join(' ')).toMatch(/Allégations risquées/);
  });

  it('ranks a customer-worded, honest sales page above a hyped empty one', () => {
    const c = goodContent(n);
    const p = product(c);
    const good = scoreSalesPage(goodSalesPage(n, c), p, n.voc);
    const bad = scoreSalesPage(badSalesPage(), p, n.voc);
    expect(good.overall).toBeGreaterThan(bad.overall + 25);
    expect(bad.compliance).toBeLessThan(good.compliance);
    expect(goodSalesPage(n, c).hypeLevel).toBeLessThan(badSalesPage().hypeLevel);
    // overpromising a weak guide hurts promise match
    const weak = product(badContent());
    expect(scoreSalesPage({ ...goodSalesPage(n, c), hypeLevel: 0.95 }, weak, n.voc).promiseMatch).toBeLessThan(good.promiseMatch);
  });

  it('ranks a hook-first, compliant creative above a vague one', () => {
    const { world } = makeWorld(1);
    const c = goodContent(n);
    const p = makeProduct(world, 'p', findNiche(world, n.id)!, c, goodSalesPage(n, c), 19);
    const good = goodCreative(world, 'g', p, n, 'pov', 'faceless_voiceover');
    const bad = badCreative(world, 'b', p);
    const banned = badCreative(world, 'x', p, 'stat', 'carousel', 'Méthode miracle : résultat garanti à 100%');
    expect(good.quality!.overall).toBeGreaterThan(bad.quality!.overall + 20);
    expect(scoreCreative(banned, p, n.voc).compliance).toBeLessThan(50);
    expect(bad.quality!.issues.length).toBeGreaterThan(2);
  });

  it('scores support replies: right intent + action + empathy beats wrong or rude', () => {
    const base: InboxMessage = {
      id: 'm', day: 1, customerId: 'c', channel: 'email', subject: 'PDF non reçu', body: "J'ai payé et je n'ai rien reçu.", intent: 'non_recu',
      productId: null, orderId: null, mood: -0.3, status: 'open', deadlineDay: 3, thread: [], resolution: null,
    };
    const good = scoreSupportReply(base, { text: "Bonjour, toutes nos excuses pour ce souci, je comprends votre inquiétude. Je vous renvoie le lien de téléchargement à l'instant, pensez à regarder dans vos spams.\nBelle journée,\n— Inès", action: 'resend_link', detectedIntent: 'non_recu' });
    const wrong = scoreSupportReply(base, { text: 'Ok.', action: 'ignore', detectedIntent: 'troll' });
    const rude = scoreSupportReply(base, { text: "Ce n'est pas notre problème, lisez mieux vos mails. C'EST RIDICULE DE NOUS ÉCRIRE POUR ÇA.", action: 'none', detectedIntent: 'non_recu' });
    expect(good.score).toBeGreaterThanOrEqual(85);
    expect(wrong.score).toBeLessThan(25);
    expect(rude.score).toBeLessThan(good.score - 40);
    expect(rude.issues.join(' ')).toMatch(/agressif|majuscules/);
    const scam: InboxMessage = { ...base, intent: 'arnaque', body: 'Payez 149 € et je vous garantis 1 million de vues.' };
    expect(scoreSupportReply(scam, { text: '', action: 'block', detectedIntent: 'arnaque' }).score).toBeGreaterThan(80);
    expect(scoreSupportReply(scam, { text: "D'accord, je vous paie par virement.", action: 'refund', detectedIntent: 'partenariat' }).score).toBeLessThanOrEqual(15);
    const troll: InboxMessage = { ...base, intent: 'troll', body: 'Arnaque, du ChatGPT recraché.' };
    expect(scoreSupportReply(troll, { text: '', action: 'ignore', detectedIntent: 'troll' }).score)
      .toBeGreaterThan(scoreSupportReply(troll, { text: 'Vous avez tort ! '.repeat(30), action: 'none', detectedIntent: 'troll' }).score);
  });
});

// ───────────────────────────── what the market reads in a deliverable ─────────────────────────────

describe('the market reads what the buyer really gets', () => {
  const n = NICHE_CATALOG.find((x) => x.id === 'proprete-chiot')!;
  const ctx = { audience: n.audience, problem: n.problem, voc: n.voc };
  const report = (c: PdfContent) => scorePdf(c, ctx);
  const sheet: VisualSpec = { type: 'grid', title: 'Le carnet de suivi', labels: [], values: [], grid: { columns: ['Jour', 'Fait', 'Notes'], rows: ['Jour 1', 'Jour 2', 'Jour 3', 'Jour 4'] } };
  /** The fixture, with a bonus that is what it says it is. */
  const honest = (): PdfContent => {
    const c = goodContent(n);
    c.bonus = { ...c.bonus, title: 'Bonus : le carnet de suivi à imprimer', visual: sheet };
    return c;
  };
  const product = (content: PdfContent, salesPage: SalesPage | null = null): Product => ({
    id: 'p', nicheId: n.id, title: content.title, subtitle: content.subtitle, audience: n.audience, problem: n.problem, price: 19, status: 'live', version: 1,
    content, design: null, salesPage, files: { pdf: null, cover: null, salesPage: null }, quality: scorePdf(content, ctx), salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  });

  it('is deterministic and reads the deliverable only', () => {
    const c = honest();
    expect(report(c)).toEqual(report(JSON.parse(JSON.stringify(c)) as PdfContent));
    expect(guideSubstance(c)).toEqual(guideSubstance(JSON.parse(JSON.stringify(c)) as PdfContent));
  });

  it('padding is not value: the same text printed twice adds words, not depth', () => {
    const c = honest();
    const padded = honest();
    for (const ch of padded.chapters) ch.paragraphs = [...ch.paragraphs, ...ch.paragraphs];
    const a = guideSubstance(c);
    const b = guideSubstance(padded);
    expect(b.words).toBeGreaterThan(a.words * 1.3);
    expect(b.freshWords).toBeLessThanOrEqual(a.freshWords);
    expect(b.repeatedShare).toBeGreaterThan(a.repeatedShare + 0.1); // the fixture already reuses a lot between its chapters
    expect(b.repeatedSentences.length).toBeGreaterThan(a.repeatedSentences.length);
    const q = report(padded);
    expect(q.overall).toBeLessThanOrEqual(report(c).overall);
    expect(q.humanTone).toBeLessThanOrEqual(report(c).humanTone);
    expect((q.blocking ?? []).some((x) => /plusieurs fois/.test(x.text))).toBe(true);
  });

  it('rewards real value: more of what customers ask, worked cases, tools to fill in', () => {
    const thin = honest();
    for (const ch of thin.chapters) { ch.example = null; ch.visual = null; }
    thin.bonus = { ...thin.bonus, visual: null, checklist: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six'] };
    const rich = honest();
    rich.chapters.forEach((ch, i) => {
      ch.example = `Exemple type : Léa, 3${i} ans, a commencé par l'étape ${i + 1} un lundi et note ce qui change chaque soir pendant ${10 + i} jours.`;
    });
    rich.chapters[1]!.visual = sheet;
    rich.chapters.push({ ...rich.chapters[0]!, title: 'Tout ce que les clients demandent', intro: 'Les questions lues le plus souvent.', paragraphs: n.voc.pains.map((p, i) => `${p} : réponse numéro ${i + 1}, en détail, avec ce qu'il faut faire ce soir.`), steps: [], example: null, checklist: [], visual: null });
    expect(guideSubstance(rich).cases).toBeGreaterThan(guideSubstance(thin).cases);
    expect(guideSubstance(rich).sheets).toBeGreaterThan(guideSubstance(thin).sheets);
    expect(untreatedPains(rich, n.voc).length).toBeLessThan(untreatedPains(thin, n.voc).length);
    expect(report(rich).overall).toBeGreaterThan(report(thin).overall + 5);
    expect(report(rich).specificity).toBeGreaterThan(report(thin).specificity);
    expect(report(rich).structure).toBeGreaterThan(report(thin).structure);
  });

  it('an example that repeats another chapter is not a worked case', () => {
    const c = honest();
    c.chapters.forEach((ch, i) => { ch.example = `Exemple type : Léa, 3${i} ans, a commencé un lundi par la partie ${i + 1} du plan et note ce qui change.`; });
    const before = guideSubstance(c).cases;
    expect(before).toBe(c.chapters.length);
    c.chapters[1]!.example = c.chapters[0]!.example;
    expect(guideSubstance(c).cases).toBeLessThan(before);
  });

  it('a promised bonus that is not delivered breaks the promise and blocks the guide', () => {
    expect(brokenPromises(honest())).toEqual([]);
    const c = honest();
    c.bonus = { ...c.bonus, visual: null, checklist: [] }; // « à imprimer », and nothing to print
    expect(brokenPromises(c).join(' ')).toMatch(/ne contient pas l'outil/);
    const q = report(c);
    expect(q.promiseMatch).toBeLessThan(report(honest()).promiseMatch);
    expect((q.blocking ?? []).some((b) => b.dimension === 'promiseMatch')).toBe(true);
    const other = honest();
    other.introduction = [...other.introduction, 'Bonus offert : la fiche SOS des mauvais jours.'];
    expect(brokenPromises(other).join(' ')).toMatch(/fiche sos/i);
  });

  it('what a guide announces must be in the guide: chapters, steps, cases, the length of the plan', () => {
    const chapters = honest();
    chapters.subtitle = 'Le guide en 12 chapitres';
    expect(brokenPromises(chapters).join(' ')).toMatch(/12 chapitres/);
    const steps = honest();
    steps.title = 'La méthode en 30 étapes';
    expect(brokenPromises(steps).join(' ')).toMatch(/30 étapes/);
    const cases = honest();
    cases.chapters[0]!.title = 'Les 9 erreurs à éviter';
    expect(brokenPromises(cases).join(' ')).toMatch(/9 cas/);
    const plan = honest();
    plan.title = 'Le plan de 30 jours';
    plan.chapters[0]!.steps = ['Jour 1 : observer', 'Jour 2 : noter', 'Jour 7 : faire le point'];
    expect(brokenPromises(plan).join(' ')).toMatch(/son plan s'arrête à \d+/);
  });

  it('a page is judged on what the guide backs: a chapter or a bonus it does not have is a lie', () => {
    const c = honest();
    const page = goodSalesPage(n, c);
    page.bonusBlurb = 'Cadeau inclus : le carnet de suivi à imprimer.';
    expect(unbackedClaims(page, c)).toEqual({ lies: [], stretches: [] });
    const fair = scoreSalesPage(page, product(c, page), n.voc);
    const lying = { ...page, subheadline: 'Le guide complet en 12 chapitres.', bonusBlurb: 'Cadeau inclus : un appel privé avec notre éducatrice.', chapterBlurbs: [...page.chapterBlurbs, { title: 'Le secret des éleveurs japonais', blurb: 'Un chapitre que personne ne vous donne.' }] };
    const lies = unbackedClaims(lying, c).lies;
    expect(lies.length).toBe(3);
    const q = scoreSalesPage(lying, product(c, lying), n.voc);
    expect(q.promiseMatch).toBeLessThanOrEqual(fair.promiseMatch - 3 * 30);
    expect(q.overall).toBeLessThan(fair.overall);
    expect((q.blocking ?? []).filter((b) => b.dimension === 'promiseMatch').length).toBeGreaterThanOrEqual(3);
  });

  it('a page that overstates the guide loses promise match without blocking it', () => {
    const c = honest();
    const page = goodSalesPage(n, c);
    page.bonusBlurb = 'Cadeau inclus : le carnet de suivi à imprimer.';
    page.solution = 'Le plan de 90 jours pas à pas, avec des exemples de chaque situation et une méthode vraiment complète pour y arriver.';
    for (const ch of c.chapters) ch.example = null;
    const u = unbackedClaims(page, c);
    expect(u.lies).toEqual([]);
    expect(u.stretches.length).toBe(2);
    const q = scoreSalesPage(page, product(c, page), n.voc);
    expect(q.promiseMatch).toBeLessThanOrEqual(70);
    expect((q.blocking ?? []).some((b) => /plan de 90/.test(b.text))).toBe(false);
  });

  it('an objection answered with a sentence that fits anything is not answered', () => {
    const c = honest();
    const stock = goodSalesPage(n, c); // the same answer for every objection
    const answered = { ...stock, objections: stock.objections.map((o, i) => ({ ...o, a: `Réponse propre à cette objection numéro ${i + 1} : voici ce que le guide fait, et ce qu'il ne fait pas.` })) };
    const q = (p: SalesPage) => scoreSalesPage(p, product(c, p), n.voc);
    expect(q(answered).structure).toBeGreaterThan(q(stock).structure + 15);
    expect(q(answered).overall).toBeGreaterThan(q(stock).overall);
    expect(q(stock).issues.join(' ')).toMatch(/passe-partout/);
  });

  it('a follow-up guide is measured against the one its buyer already owns', () => {
    const parent = honest();
    expect(guideOverlap(parent, parent)).toBeGreaterThan(0.9);
    const sameTitle = { ...honest(), title: parent.title, chapters: [], introduction: [], bonus: { ...parent.bonus, intro: '', paragraphs: [], steps: [], checklist: [] } };
    expect(guideOverlap(sameTitle, parent)).toBe(0.5);
    const other = goodContent(NICHE_CATALOG.find((x) => x.id === 'relooker-meuble')!);
    expect(guideOverlap(other, parent)).toBeLessThan(0.4); // both come from the same fixture template
  });

  /** 1 000 buyers of the same guide, the same market otherwise. */
  const afterSales = (content: PdfContent, source: Order['source'], parent: PdfContent | null) => {
    const { world, rng } = makeWorld(4, 'normal', 1000);
    const niche = findNiche(world, n.id)!;
    const p = makeProduct(world, 'p_sold', niche, content, goodSalesPage(niche, content), 19);
    const tools = createMarketTools(world, rng);
    tools.publishProduct(p.id);
    if (parent) {
      const main = makeProduct(world, 'p_main', niche, parent, null, 19);
      main.upsellProductId = p.id;
    }
    for (let i = 0; i < 1000; i++) {
      const buyer = createCustomer(world, rng, 'normal');
      world.market.orders.push({ id: `ord_${i}`, day: 1, customerId: buyer.id, productId: p.id, price: p.price, source, campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 });
      buyer.orders.push(`ord_${i}`);
    }
    for (let d = 2; d <= 16; d++) { world.day = d; tickMarket(world, rng); }
    return { refunds: world.market.orders.filter((o) => o.refunded).length, rating: p.stats.rating };
  };

  it('an upsell that repeats its parent: its buyer asks for their money back and rates it badly', () => {
    const copy = honest();
    const same = afterSales(copy, 'upsell', honest());
    const other = afterSales(copy, 'upsell', goodContent(NICHE_CATALOG.find((x) => x.id === 'relooker-meuble')!));
    expect(same.refunds).toBeGreaterThan(other.refunds * 1.5);
    expect(same.rating).toBeLessThan(other.rating - 0.5);
    // who did not buy the first guide has nothing to complain about
    expect(afterSales(copy, 'ads', honest()).refunds).toBeLessThan(same.refunds / 1.5);
  });

  it('a broken promise costs refunds and stars, on the same market', () => {
    const kept = afterSales(honest(), 'ads', null);
    const empty = honest();
    empty.bonus = { ...empty.bonus, visual: null, checklist: [] };
    const broken = afterSales(empty, 'ads', null);
    expect(broken.refunds).toBeGreaterThan(kept.refunds * 1.2);
    expect(broken.rating).toBeLessThan(kept.rating);
  });

  it('a guide without reviews inherits part of the store reputation, good or bad', () => {
    const { world } = makeWorld(1);
    const niche = findNiche(world, n.id)!;
    const fresh = makeProduct(world, 'p_new', niche, honest(), null, 19);
    const old = makeProduct(world, 'p_old', niche, honest(), null, 19);
    expect(storeRating(world)).toBe(0);
    expect(trustFactor(fresh, storeRating(world))).toBe(CONVERSION.ratingNone);
    old.stats.reviews = Array.from({ length: CONVERSION.storeMinReviews }, (_, i) => ({ id: `r${i}`, day: 3, customerId: `c${i}`, rating: 5 as const, text: 'Très bien' }));
    old.stats.rating = 5;
    expect(storeRating(world)).toBe(5);
    expect(trustFactor(fresh, 5)).toBeGreaterThan(CONVERSION.ratingNone);
    expect(trustFactor(fresh, 5)).toBeLessThan(trustFactor(old, 5));
    expect(trustFactor(fresh, 3)).toBeLessThan(CONVERSION.ratingNone);
  });
});

// ───────────────────────────── finance ─────────────────────────────

describe('ledger and finance snapshot', () => {
  it('normalises signs, excludes capital and payment holds from profit', () => {
    const { world } = makeWorld(1, 'normal', 500);
    world.day = 1;
    recordLedger(world, { type: 'revenue', amount: 100, memo: 'ventes' });
    recordLedger(world, { type: 'ad_spend', amount: 40, memo: 'pub (montant positif → normalisé)' });
    world.day = 5;
    recordLedger(world, { type: 'refund', amount: -19, memo: 'remboursement' });
    recordLedger(world, { type: 'compute', amount: -2.5, memo: 'Claude' });
    recordLedger(world, { type: 'payment_fee', amount: -1.2, memo: 'frais' });
    recordLedger(world, { type: 'platform_fee', amount: -30, memo: 'réserve', ref: 'hold:evt_1' });
    world.day = 10;
    recordLedger(world, { type: 'revenue', amount: 60, memo: 'ventes' });
    recordLedger(world, { type: 'ad_spend', amount: -20, memo: 'pub' });
    recordLedger(world, { type: 'creator_payout', amount: -10, memo: 'commission' });
    recordLedger(world, { type: 'platform_fee', amount: 30, memo: 'libération', ref: 'hold:release:10' });
    expect(world.ledger[2]!.amount).toBe(-40);
    const f = financeSnapshot(world);
    expect(f.cash).toBeCloseTo(500 + 100 - 40 - 19 - 2.5 - 1.2 + 60 - 20 - 10, 2);
    expect(f.revenue).toBe(160);
    expect(f.adSpend).toBe(60);
    expect(f.refunds).toBe(19);
    expect(f.compute).toBe(2.5);
    expect(f.fees).toBe(1.2);
    expect(f.otherCosts).toBe(10);
    expect(f.profit).toBeCloseTo(160 - 60 - 19 - 2.5 - 1.2 - 10, 2);
    // last 7 days = days 4..10
    expect(f.profit7d).toBeCloseTo(-19 - 2.5 - 1.2 + 60 - 20 - 10, 2);
    expect(f.roas7d).toBe(3);
    expect(f.runwayDays).toBeNull();
    expect(f.bankrupt).toBe(false);
  });

  it('reports burn, runway and bankruptcy', () => {
    const { world } = makeWorld(1, 'normal', 100);
    for (let d = 1; d <= 7; d++) { world.day = d; recordLedger(world, { type: 'ad_spend', amount: -10, memo: 'pub' }); }
    const f = financeSnapshot(world);
    expect(f.burn7d).toBe(10);
    expect(f.runwayDays).toBe(3);
    expect(f.roas7d).toBe(0);
    recordLedger(world, { type: 'chargeback', amount: -50, memo: 'litige' });
    expect(financeSnapshot(world).bankrupt).toBe(true);
    expect(financeSnapshot(world).runwayDays).toBe(0);
  });

  it('books every market money move in the ledger (cash = Σ ledger)', () => {
    const { world, rng } = makeWorld(21, 'cauchemar', 800);
    const { tools } = launch(world, rng, { niche: 'oral-aide-soignante', good: true, styles: [['mistake', 'text_slideshow'], ['story', 'faceless_voiceover']], budget: 25 });
    runDays(world, rng, 20, (d) => {
      if (d % 2 === 0) for (const m of tools.listInbox('open')) tools.replyToMessage(m.id, competentReply(m), 'support');
    });
    const sum = world.ledger.reduce((s, e) => s + e.amount, 0);
    expect(financeSnapshot(world).cash).toBeCloseTo(sum, 2);
    expect(world.ledger.every((e) => Number.isFinite(e.amount))).toBe(true);
    const fixed = world.ledger.filter((e) => e.ref?.startsWith('fixed:') && e.type === 'platform_fee');
    expect(fixed).toHaveLength(20);
    expect(fixed[0]!.amount).toBe(-0.97);
    const p = world.company.products[0]!;
    const orders = world.market.orders.filter((o) => o.productId === p.id);
    expect(p.stats.sales).toBe(orders.length);
    expect(p.stats.refunds).toBe(orders.filter((o) => o.refunded).length);
  });
});

// ───────────────────────────── creators ─────────────────────────────

describe('creators', () => {
  it('a scammer takes the upfront and never delivers; an honest creator brings commission sales', () => {
    const { world, rng } = makeWorld(31, 'normal', 1000);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    world.market.creators.push(
      { id: 'scam', handle: 'woof_mega', nicheId: n.id, followers: 120000, avgViews: 900, engagement: 0.004, askUpfront: 400, askCommission: 0, redFlags: ['abonnés achetés (pic de +40 000 en 2 jours)'] },
      { id: 'legit', handle: 'educ_lea', nicheId: n.id, followers: 30000, avgViews: 8000, engagement: 0.06, askUpfront: 0, askCommission: 0.3, redFlags: [] },
    );
    const s = tools.proposePartnership({ creatorId: 'scam', productId: 'p', upfront: 400, commission: 0 });
    expect(s.ok).toBe(true);
    expect(world.ledger.at(-1)).toMatchObject({ type: 'creator_payout', amount: -400 });
    let legit = tools.proposePartnership({ creatorId: 'legit', productId: 'p', upfront: 0, commission: 0.45 });
    for (let i = 0; i < 5 && !legit.ok; i++) {
      world.market.partnerships.pop();
      legit = tools.proposePartnership({ creatorId: 'legit', productId: 'p', upfront: 0, commission: 0.45 });
    }
    expect(legit.ok).toBe(true);
    world.day = 2;
    const r = tickMarket(world, rng);
    const scamDeal = world.market.partnerships.find((x) => x.creatorId === 'scam')!;
    expect(scamDeal.status).toBe('scam');
    expect(world.ledger.some((e) => e.type === 'scam_loss' && e.amount === -400)).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Arnaque/);
    for (let d = 3; d <= 7; d++) { world.day = d; tickMarket(world, rng); }
    const legitDeal = world.market.partnerships.find((x) => x.creatorId === 'legit' && x.status === 'delivered')!;
    expect(legitDeal).toBeTruthy();
    expect(legitDeal.sales).toBeGreaterThan(0);
    expect(world.market.orders.some((o) => o.source === 'creator' && o.creatorId === 'legit')).toBe(true);
    // the reclassification keeps cash consistent: the 400 € left exactly once
    const scamMoves = world.ledger.filter((e) => e.ref === scamDeal.id || e.ref === `reversal:${scamDeal.id}`).reduce((s2, e) => s2 + e.amount, 0);
    expect(scamMoves).toBe(-400);
  });
});

// ───────────────────────────── economics ─────────────────────────────

describe('economics (30 days, normal)', () => {
  // Calibration (docs/BALANCE.md): a STATIC competent policy — 3 creatives never rotated, launch price never
  // tested, a guide never reworked — earns ROAS ≈ 0,4-1,4 on the gem niche depending on the seed: it survives, it
  // does not always pay back its ads. Making real money takes the agency's learning (hooks, formats, prices, rewrites).
  it('a competent policy that never learns about breaks even on a gem niche: it survives, it does not get rich', () => {
    const roas: number[] = [];
    for (const seed of SEEDS) {
      const { world, rng } = makeWorld(seed, 'normal');
      const { tools, campaign } = launch(world, rng, {
        niche: 'proprete-chiot', good: true, budget: 20,
        styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar'], ['story', 'text_slideshow']],
      });
      expect(campaign.ok).toBe(true);
      const results = runDays(world, rng, 30, () => {
        for (const m of tools.listInbox('open')) tools.replyToMessage(m.id, competentReply(m), 'support');
      });
      const spend = results.reduce((s, r) => s + r.adSpend, 0);
      const revenue = results.reduce((s, r) => s + r.revenue, 0);
      const f = financeSnapshot(world);
      expect(spend).toBeGreaterThan(450);
      roas.push(revenue / spend);
      expect(revenue / spend, `seed ${seed} ROAS`).toBeLessThan(3);
      expect(f.bankrupt, `seed ${seed}`).toBe(false); // D75's escape for seed 3 left with the winner: 22,87 € at the end, a thin margin
    }
    expect(roas.reduce((a, b) => a + b, 0) / roas.length).toBeGreaterThan(0.6);
  });

  it('a bad policy (trap-like offer, generic PDF, overpriced, ignored inbox) loses money', () => {
    for (const seed of SEEDS) {
      const { world, rng } = makeWorld(seed, 'normal');
      launch(world, rng, { niche: 'proprete-chiot', good: false, price: 39, budget: 20, styles: [['stat', 'carousel'], ['question', 'carousel']] });
      const results = runDays(world, rng, 30);
      const spend = results.reduce((s, r) => s + r.adSpend, 0);
      const revenue = results.reduce((s, r) => s + r.revenue, 0);
      expect(revenue / Math.max(1, spend), `seed ${seed} ROAS`).toBeLessThan(0.6);
      expect(financeSnapshot(world).profit, `seed ${seed}`).toBeLessThan(-250);
    }
  });

  it('a naive ad on the weight-loss trap gets refused (compliance minefield)', () => {
    const { world, rng } = makeWorld(2, 'normal');
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'ventre-apres-40')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    const cr = goodCreative(world, 'c', p, n, 'before_after', 'ugc_avatar');
    cr.hook = 'Avant/après : -5 kilos de ventre en 3 semaines';
    cr.scenes[0]!.onScreenText = cr.hook;
    const r = tools.submitCreative('c');
    expect(r.status).toBe('rejected');
    expect(r.strike).toBe(true);
  });

  it('runs organic posts with views, clicks and occasional virality', () => {
    const { world, rng } = makeWorld(17, 'normal');
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'relooker-meuble')!;
    const c = goodContent(n);
    makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    runDays(world, rng, 40, (d) => {
      for (let i = 0; i < 5; i++) expect(tools.postOrganic({ productId: 'p', hook: `Avant / après : ${at(n.voc.phrases, d + i)}`, hookStyle: 'before_after', format: 'carousel' }).ok).toBe(true);
      expect(tools.postOrganic({ productId: 'p', hook: 'Un post de trop', hookStyle: 'story', format: 'carousel' }).ok).toBe(false);
    });
    const posts = world.market.organicPosts;
    expect(posts.every((x) => x.views > 0)).toBe(true);
    expect(posts.some((x) => x.clicks > 0)).toBe(true);
    expect(world.market.orders.some((o) => o.source === 'organic')).toBe(true);
    const median = posts.map((x) => x.views).sort((a, b) => a - b)[Math.floor(posts.length / 2)]!;
    expect(median).toBeGreaterThan(50);
    expect(median).toBeLessThan(5000);
  });
});

// ───────────────────────────── review fixes (ledger & market plausibility) ─────────────────────────────

describe('payment holds and pricing beyond the max willingness to pay', () => {
  it('a payment hold freezes cash (at most half of it) but never blocks checkout, and its release is exact', () => {
    const { world, rng } = makeWorld(5, 'normal', 800);
    const { tools } = launch(world, rng, { niche: 'proprete-chiot', good: true, budget: 30, styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar']] });
    runDays(world, rng, 8, () => { for (const m of tools.listInbox('open')) tools.replyToMessage(m.id, competentReply(m), 'support'); });
    const cashBefore = financeSnapshot(world).cash;
    const profitBefore = financeSnapshot(world).profit;
    const ev = forceEvent(world, rng, 'payment_hold');
    expect(ev?.kind).toBe('payment_hold');
    const hold = world.ledger.at(-1)!;
    expect(hold.ref).toBe(`hold:${ev!.id}`);
    expect(hold.amount).toBeLessThan(0);
    expect(-hold.amount).toBeLessThanOrEqual(cashBefore * 0.5 + 0.01);
    expect(financeSnapshot(world).cash).toBeCloseTo(cashBefore + hold.amount, 2);
    expect(financeSnapshot(world).profit).toBeCloseTo(profitBefore, 2); // cash timing, never a loss
    const untilDay = world.market.modifiers.paymentHoldUntilDay;
    let salesDuringHold = 0;
    for (let d = world.day + 1; d < untilDay; d++) {
      world.day = d;
      salesDuringHold += tickMarket(world, rng).sales;
    }
    expect(salesDuringHold).toBeGreaterThan(0);
    world.day = untilDay;
    tickMarket(world, rng);
    const release = world.ledger.find((e) => e.ref === `hold:release:${untilDay}`)!;
    expect(release).toBeDefined();
    expect(release.type).toBe('platform_fee');
    expect(release.amount).toBeCloseTo(-hold.amount, 2);
    expect(world.ledger.filter((e) => e.ref?.startsWith('hold:')).reduce((s, e) => s + e.amount, 0)).toBeCloseTo(0, 2);
    const f = financeSnapshot(world);
    expect(f.cash).toBeCloseTo(world.ledger.reduce((s, e) => s + e.amount, 0), 2);
    expect(f.profit).toBeCloseTo(world.ledger.filter((e) => e.type !== 'capital' && !e.ref?.startsWith('hold:')).reduce((s, e) => s + e.amount, 0), 2);
  });

  it('money released from a reserve is spendable on the release day', () => {
    const { world, rng } = makeWorld(6, 'normal', 300);
    launch(world, rng, { niche: 'proprete-chiot', good: true, budget: 100, styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar']] });
    recordLedger(world, { type: 'platform_fee', amount: -250, memo: 'réserve', ref: 'hold:evt_test' });
    world.market.modifiers.paymentHoldUntilDay = 2;
    world.day = 2;
    const r = tickMarket(world, rng);
    expect(world.ledger.some((e) => e.ref === 'hold:release:2' && e.amount === 250)).toBe(true);
    expect(r.adSpend).toBeGreaterThan(85); // was capped at the 50 € left before the release
  });

  it('demand fades smoothly above the max willingness to pay (no cliff), but the sweet spot still wins', () => {
    const wtp = { min: 9, sweet: 18, max: 33 };
    const f = (p: number) => priceFactor(p, wtp);
    for (let p = 5; p < 80; p += 1) expect(f(p + 1)).toBeLessThanOrEqual(f(p) + 1e-9);
    expect(f(33 + 1e-6)).toBeCloseTo(f(33), 4); // continuous at max
    const slopeBelow = (f(33) - f(32.9)) / 0.1;
    const slopeAbove = (f(33.1) - f(33)) / 0.1;
    expect(slopeAbove / slopeBelow).toBeLessThan(1.6); // the old cliff was a 2.5× jump in slope
    expect(f(39) / f(29)).toBeGreaterThan(0.3); // +34 % price: conversion roughly halved, not divided by 4.4
    expect(f(39) / f(29)).toBeLessThan(0.5);
    expect(39 * f(39)).toBeLessThan(29 * f(29)); // overpricing still loses money per visitor
    expect(f(60)).toBeLessThan(0.05);
  });

  it('a 1-star product loses most of its conversion but still sells over a week of traffic', () => {
    const { world, rng } = makeWorld(9, 'normal', 1500);
    const { product } = launch(world, rng, { niche: 'proprete-chiot', good: true, budget: 60, styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar']] });
    for (let i = 0; i < 6; i++) product.stats.reviews.push({ id: `rev_${i}`, day: 1, customerId: `c${i}`, rating: 1, text: 'Nul.' });
    product.stats.rating = 1;
    const results = runDays(world, rng, 7, () => { product.stats.rating = 1; });
    const sales = results.reduce((s, r) => s + r.sales, 0);
    const views = world.market.adStats.reduce((s, r) => s + r.landingViews, 0);
    expect(views).toBeGreaterThan(300);
    expect(sales).toBeGreaterThan(0);
  });
});

describe('optional fields filled by the market', () => {
  it('stamps customerName, replyScore and repliedDay on inbox messages', () => {
    const { world, rng } = makeWorld(12, 'normal');
    const tools = createMarketTools(world, rng);
    const c = createCustomer(world, rng, 'normal');
    c.name = 'Sophie Martin';
    const msg = createMessage(world, rng, { intent: 'question', customer: c, product: null, order: null });
    expect(msg.customerName).toBe('Sophie M.');
    expect(msg.replyScore).toBeNull();
    expect(msg.repliedDay).toBeNull();
    const handle = createCustomer(world, rng, 'troll');
    handle.name = '@lea_du_34';
    expect(createMessage(world, rng, { intent: 'troll', customer: handle, product: null, order: null }).customerName).toBe('@lea_du_34');
    world.day = 3;
    const out = tools.replyToMessage(msg.id, competentReply(msg), 'ines');
    expect(msg.replyScore).toBe(out.score);
    expect(msg.repliedDay).toBe(3);
  });

  it('dates refunds and chargebacks on the order, reports the refunded amount and refs events', () => {
    const { world, rng } = makeWorld(21, 'cauchemar', 1500);
    const { tools, product } = launch(world, rng, { niche: 'oral-aide-soignante', good: true, styles: [['mistake', 'text_slideshow'], ['story', 'faceless_voiceover']], budget: 40 });
    const results = runDays(world, rng, 25);
    const refunded = world.market.orders.filter((o) => o.refunded || o.chargeback);
    expect(refunded.length).toBeGreaterThan(0);
    for (const o of refunded) {
      expect(o.refundedDay).toBeGreaterThanOrEqual(o.day);
      const booked = world.ledger.filter((e) => e.ref === o.id && (e.type === 'refund' || e.type === 'chargeback'));
      expect(booked.length).toBeGreaterThan(0);
      expect(booked[0]!.day).toBe(o.refundedDay);
    }
    expect(results.some((r) => r.refunds > 0)).toBe(true);
    for (const r of results) {
      if (r.refunds === 0) expect(r.refundAmount).toBe(0);
      else expect(r.refundAmount).toBeGreaterThan(0);
    }
    // a refund issued by the support today is dated today
    const fresh = world.market.orders.find((o) => !o.refunded && !o.chargeback)!;
    world.day = 26;
    expect(tools.issueRefund(fresh.id, 'demande client').ok).toBe(true);
    expect(fresh.refundedDay).toBe(26);
    // events about a product / niche carry their refs
    for (const e of world.market.events.filter((x) => ['competitor_clone', 'bad_review_wave', 'creator_offer'].includes(x.kind))) {
      expect(e.refs).toMatchObject({ productId: product.id, nicheId: product.nicheId });
    }
    const cr = badCreative(world, 'cre_banned', product, 'stat', 'carousel', 'Résultat garanti en 7 jours');
    tools.submitCreative(cr.id);
    expect(world.market.events.at(-1)).toMatchObject({ kind: 'ad_rejected', refs: { creativeId: 'cre_banned', productId: product.id, nicheId: product.nicheId } });
  });
});

// ───────────────────────────── calibration (docs/BALANCE.md) ─────────────────────────────

describe('market calibration', () => {
  it('books the one-off launch costs once, at the very first market close', () => {
    const { world, rng } = makeWorld(5);
    tickMarket(world, rng);
    const setup = world.ledger.filter((e) => e.ref === SETUP_REF);
    expect(setup).toHaveLength(1);
    expect(setup[0]).toMatchObject({ day: 1, type: 'tool_subscription', amount: -FEES.setupCost });
    expect(tickMarket(world, rng).notes.join(' ')).toMatch(/déjà clôturé/);
    world.day = 2;
    tickMarket(world, rng);
    expect(world.ledger.filter((e) => e.ref === SETUP_REF)).toHaveLength(1);
    expect(financeSnapshot(world).profit).toBeCloseTo(-FEES.setupCost - 2 * (FEES.boutiqueDaily + FEES.toolsDaily), 2);
  });

  it('the right angle matters: CTR scales with (hook × format affinity)^affinityExp', () => {
    expect(ADS.affinityExp).toBeGreaterThan(1);
    const { world, rng } = makeWorld(8, 'normal', 50_000);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const content = goodContent(n);
    const p = makeProduct(world, 'p', n, content, goodSalesPage(n, content), n.wtp.sweet);
    tools.publishProduct(p.id);
    const aff = (s: HookStyle, f: AdFormat) => (n.hookAffinity[s] ?? 1) * (n.formatAffinity[f] ?? 1);
    const hooks = Object.keys(n.hookAffinity) as HookStyle[];
    const formats = Object.keys(n.formatAffinity) as AdFormat[];
    const best = hooks.flatMap((s) => formats.map((f) => [s, f] as const)).sort((a, b) => aff(b[0], b[1]) - aff(a[0], a[1]));
    const [hi, lo] = [best[0]!, best[best.length - 1]!];
    const ids: Record<string, string> = {};
    for (const [key, [s, f]] of [['hi', hi], ['lo', lo]] as const) {
      const c = goodCreative(world, `cre_${key}`, p, n, s, f, 0);
      expect(approve(tools, c.id)).toBe('approved');
      ids[key] = tools.createCampaign({ productId: p.id, name: key, creativeIds: [c.id], dailyBudget: 150, targeting: { interests: [], ageMin: 25, ageMax: 45 }, createdBy: 'test' }).id!;
    }
    runDays(world, rng, 6); // 4 days of noisy CTR were one RNG draw away from the ±25 % tolerance
    const ctr = (id: string) => {
      const rows = world.market.adStats.filter((s) => s.campaignId === id);
      return rows.reduce((s, r) => s + r.clicks, 0) / rows.reduce((s, r) => s + r.impressions, 0);
    };
    const q = (id: string) => Math.pow(scoreCreative(world.company.creatives.find((c) => c.id === id)!, p, n.voc).overall / ADS.qualityRef, ADS.qualityExp);
    const affRatio = aff(hi[0], hi[1]) / aff(lo[0], lo[1]);
    const measured = (ctr(ids.hi!) / ctr(ids.lo!)) / (q('cre_hi') / q('cre_lo'));
    expect(measured).toBeGreaterThan(Math.pow(affRatio, ADS.affinityExp) * 0.75);
    expect(measured).toBeLessThan(Math.pow(affRatio, ADS.affinityExp) * 1.33);
    expect(measured).toBeGreaterThan(affRatio * 1.2); // more than the raw affinity ratio: learning the angle pays
  });

  it('difficulty keeps its order: cheaper ads in facile, pricier in cauchemar', () => {
    expect(DIFFICULTY.facile.cpmMultiplier).toBeLessThan(DIFFICULTY.normal.cpmMultiplier);
    expect(DIFFICULTY.normal.cpmMultiplier).toBeLessThan(DIFFICULTY.cauchemar.cpmMultiplier);
    expect(DIFFICULTY.facile.refundBase).toBeLessThan(DIFFICULTY.cauchemar.refundBase);
  });
});

// ───────────────────────────── order repayment ─────────────────────────────

describe('an order is never repaid more than its price', () => {
  function sale(world: WorldState, rng: Rng, price = 24) {
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), price);
    const buyer = createCustomer(world, rng, 'normal');
    const order: Order = { id: 'ord_t', day: 1, customerId: buyer.id, productId: p.id, price, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false };
    world.market.orders.push(order);
    buyer.orders.push(order.id);
    return { tools, n, p, buyer, order };
  }
  const repaid = (world: WorldState, orderId: string) => -world.ledger.filter((e) => e.ref === orderId).reduce((s, e) => s + e.amount, 0);
  const GESTURE: SupportReplyInput = { text: 'Bonjour, désolé pour ce souci, je comprends. Voici un geste commercial sur votre commande, avec nos excuses.\nBelle journée,\n— Inès', action: 'discount_code', detectedIntent: 'plainte_qualite' };

  it('a gesture then a full refund repays exactly the price (the old flow reached 180 %)', () => {
    const { world, rng } = makeWorld(41);
    const { tools, n, p, buyer, order } = sale(world, rng);
    const first = createMessage(world, rng, { intent: 'plainte_qualite', customer: buyer, product: p, order, niche: n });
    expect(tools.replyToMessage(first.id, GESTURE, 'ines').cost).toBe(9.6);
    expect(order.refundedAmount).toBe(9.6);
    expect(repayableLeft(order)).toBe(14.4);

    // a second gesture on the same order gives nothing and settles nothing
    const second = createMessage(world, rng, { intent: 'plainte_qualite', customer: buyer, product: p, order, niche: n });
    const out = tools.replyToMessage(second.id, GESTURE, 'ines');
    expect(out.cost).toBe(0);
    expect(out.resolved).toBe(false);
    expect(repaid(world, order.id)).toBeCloseTo(9.6, 2);

    expect(tools.issueRefund(order.id, 'demande client').message).toMatch(/14,40/);
    expect(repaid(world, order.id)).toBeCloseTo(24, 2);
    expect(order.refundedAmount).toBe(24);
    expect(p.stats.refundAmount).toBe(24);
    expect(p.stats.refunds).toBe(1);
    expect(refundOrder(world, order, 'encore')).toBe(0);
    expect(partialRefund(world, order, 0.4, 'encore')).toBe(0);
    expect(repaid(world, order.id)).toBeCloseTo(24, 2);
  });

  it('a chargeback after a gesture reverses what is left, plus the bank fee', () => {
    const { world, rng } = makeWorld(42);
    const { order, p } = sale(world, rng);
    expect(partialRefund(world, order, 0.4, 'Geste')).toBe(9.6);
    world.day = 2;
    const m = createMessage(world, rng, { intent: 'menace_chargeback', customer: world.market.customers.find((c) => c.id === order.customerId)!, product: p, order });
    m.deadlineDay = 1;
    const escalation = ESCALATION.chargeback.menace_chargeback!;
    ESCALATION.chargeback.menace_chargeback = 1;
    const r = tickMarket(world, rng);
    ESCALATION.chargeback.menace_chargeback = escalation;
    expect(order.chargeback).toBe(true);
    expect(world.ledger.find((e) => e.type === 'chargeback')!.amount).toBeCloseTo(-(14.4 + FEES.chargebackFee), 2);
    expect(repaid(world, order.id)).toBeCloseTo(24 + FEES.chargebackFee, 2);
    expect(r.refundAmount).toBe(14.4);
    expect(order.refundedAmount).toBe(24);
  });

  it('a second gesture refused on a refund request stays a refusal', () => {
    const { world, rng } = makeWorld(43);
    const { tools, n, p, buyer, order } = sale(world, rng);
    partialRefund(world, order, 0.4, 'Geste');
    for (let i = 0; i < 12; i++) {
      const msg = createMessage(world, rng, { intent: 'remboursement', customer: buyer, product: p, order, niche: n });
      const out = tools.replyToMessage(msg.id, { ...GESTURE, detectedIntent: 'remboursement' }, 'ines');
      expect(out.resolved).toBe(false);
      expect(out.cost === 0 || out.consequence === 'chargeback').toBe(true);
      if (out.consequence === 'chargeback') break;
    }
    expect(repaid(world, order.id)).toBeLessThanOrEqual(24 + FEES.chargebackFee);
  });
});

// ───────────────────────────── verified reviews ─────────────────────────────

describe('only verified buyers can rate the store', () => {
  function shop(world: WorldState, rng: Rng) {
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    const other = makeProduct(world, 'autre', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct(p.id);
    tools.publishProduct(other.id);
    return { tools, n, p, other };
  }
  const buy = (world: WorldState, customerId: string, productId: string, id: string): Order => {
    const o: Order = { id, day: 1, customerId, productId, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false };
    world.market.orders.push(o);
    return o;
  };

  it('a stranger cannot rate on any path: quiet troll, compliment, furious message, direct call', () => {
    const { world, rng } = makeWorld(51);
    const { tools, n, p } = shop(world, rng);
    for (let i = 0; i < 80; i++) {
      const troll = createCustomer(world, rng, 'troll');
      const t = createMessage(world, rng, { intent: 'troll', customer: troll, product: p, order: null, niche: n });
      expect(tools.replyToMessage(t.id, { text: '', action: 'ignore', detectedIntent: 'troll' }, 'ines').consequence).toBe('none');
      const fan = createCustomer(world, rng, 'superfan');
      const f = createMessage(world, rng, { intent: 'compliment', customer: fan, product: p, order: null, niche: n });
      expect(tools.replyToMessage(f.id, competentReply(f), 'ines').consequence).toBe('none');
      const karen = createCustomer(world, rng, 'karen');
      const k = createMessage(world, rng, { intent: 'question', customer: karen, product: p, order: null, niche: n });
      expect(tools.replyToMessage(k.id, { text: 'Ok.', action: 'none', detectedIntent: 'troll' }, 'ines').consequence).toBe('none');
    }
    expect(p.stats.reviews).toEqual([]);
    expect(reviewProduct(world, rng, p, createCustomer(world, rng, 'normal'), 5, 'product')).toBe(false);
    expect(reviewProduct(world, rng, p, undefined, 5, 'product')).toBe(false);
  });

  it('buying another guide does not verify this one', () => {
    const { world, rng } = makeWorld(52);
    const { p, other } = shop(world, rng);
    const c = createCustomer(world, rng, 'normal');
    buy(world, c.id, other.id, 'ord_autre');
    expect(reviewProduct(world, rng, p, c, 5, 'product')).toBe(false);
    expect(reviewProduct(world, rng, other, c, 5, 'product')).toBe(true);
    expect(p.stats.reviews).toHaveLength(0);
    expect(other.stats.reviews).toHaveLength(1);
  });

  it('a troll wave reaches the rating only through a real buyer', () => {
    const { world, rng } = makeWorld(53);
    const { p, other } = shop(world, rng);
    other.status = 'paused';
    const empty = forceEvent(world, rng, 'bad_review_wave')!;
    expect(empty.description).not.toMatch(/étoile/);
    expect(p.stats.reviews).toEqual([]);
    const troll = createCustomer(world, rng, 'troll');
    buy(world, troll.id, p.id, 'ord_troll');
    const wave = forceEvent(world, rng, 'bad_review_wave')!;
    expect(wave.description).toMatch(/un avis 1 étoile/);
    expect(p.stats.reviews.map((r) => r.customerId)).toEqual([troll.id]);
  });

  it('over a long run every review of every product comes from one of its buyers', () => {
    const { world, rng } = makeWorld(54, 'cauchemar', 3000);
    const { tools, product } = launch(world, rng, { niche: 'proprete-chiot', good: true, budget: 60, styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar']] });
    runDays(world, rng, 40, (d) => {
      if (d % 9 === 0) forceEvent(world, rng, 'bad_review_wave');
      for (const m of tools.listInbox('open')) tools.replyToMessage(m.id, competentReply(m), 'support');
    });
    expect(product.stats.reviews.length).toBeGreaterThan(5);
    const buyers = new Set(world.market.orders.filter((o) => o.productId === product.id).map((o) => o.customerId));
    for (const r of product.stats.reviews) expect(buyers.has(r.customerId), r.text).toBe(true);
  });
});

// ───────────────────────────── upsell pricing ─────────────────────────────

describe('the upsell obeys the niche willingness to pay', () => {
  it('revenue per buyer peaks near the sweet price on every niche and collapses when overpriced', () => {
    for (const n of NICHE_CATALOG) {
      const { min, sweet, max } = n.wtp;
      const revenue = (price: number) => price * upsellRate(90, price, n.wtp);
      let best = 1;
      for (let price = 1; price <= 199; price += 0.5) if (revenue(price) > revenue(best)) best = price;
      expect(best, n.id).toBeGreaterThanOrEqual(min * 0.8);
      expect(best, n.id).toBeLessThanOrEqual(sweet * 1.35);
      expect(revenue(sweet), n.id).toBeGreaterThan(revenue(best) * 0.85);
      expect(revenue(max * 1.5), n.id).toBeLessThan(revenue(sweet) * 0.4);
      expect(revenue(199), n.id).toBeLessThan(revenue(sweet) * 0.01);
    }
    // at the sweet price the take rate is the old quality-only rate
    const wtp = { min: 9, sweet: 18, max: 33 };
    expect(upsellRate(100, 18, wtp)).toBeCloseTo(UPSELL.maxRate, 6);
    expect(upsellRate(0, 18, wtp)).toBeCloseTo(UPSELL.minRate, 6);
  });

  it('the market applies it: same run, an upsell at 199 € sells nothing, at the sweet price it sells', () => {
    const run = (price: (sweet: number) => number) => {
      const { world, rng } = makeWorld(3, 'normal', 5000);
      const { tools, product, niche } = launch(world, rng, { niche: 'proprete-chiot', good: true, budget: 120, styles: [['pov', 'faceless_voiceover'], ['mistake', 'ugc_avatar']] });
      const content = goodContent(niche);
      const up = makeProduct(world, 'prd_up', niche, content, goodSalesPage(niche, content), price(niche.wtp.sweet));
      tools.publishProduct(up.id);
      product.upsellProductId = up.id;
      runDays(world, rng, 25);
      return { sold: up.stats.sales, revenue: up.stats.revenue, buyers: product.stats.sales };
    };
    const fair = run((sweet) => sweet);
    const greedy = run(() => 199);
    expect(fair.buyers).toBeGreaterThan(30);
    expect(fair.sold).toBeGreaterThan(3);
    expect(greedy.buyers).toBeGreaterThan(30);
    expect(greedy.sold).toBe(0);
    expect(greedy.revenue).toBeLessThan(fair.revenue);
  });

  it('paying above what the niche finds fair brings more refunds and worse reviews', () => {
    const run = (price: (max: number) => number) => {
      const { world, rng } = makeWorld(4, 'normal', 1000);
      const n = findNiche(world, 'proprete-chiot')!;
      const c = goodContent(n);
      const p = makeProduct(world, 'p', n, c, goodSalesPage(n, c), price(n.wtp.max));
      createMarketTools(world, rng).publishProduct(p.id);
      for (let i = 0; i < 1500; i++) {
        const buyer = createCustomer(world, rng, 'normal');
        world.market.orders.push({ id: `ord_${i}`, day: 1, customerId: buyer.id, productId: p.id, price: p.price, source: 'upsell', campaignId: null, creatorId: null, refunded: false, chargeback: false });
        buyer.orders.push(`ord_${i}`);
      }
      for (let d = 2; d <= 15; d++) { world.day = d; tickMarket(world, rng); }
      return { refunds: world.market.orders.filter((o) => o.refunded).length, rating: p.stats.rating };
    };
    const fair = run(() => 18);
    const greedy = run((max) => max * 3);
    expect(greedy.refunds).toBeGreaterThan(fair.refunds * 1.4);
    expect(greedy.rating).toBeLessThan(fair.rating - 0.5);
  });
});

// ───────────────────────────── scams ─────────────────────────────

/** What a careful partner manager can compute from a public profile: four noisy signals, no hidden truth. */
function creatorSuspicion(c: CreatorProfile): number {
  return Number(c.avgViews / c.followers < 0.08) + Number(c.engagement < 0.03) + Number(c.askUpfront > 0 && (c.askUpfront * 1000) / c.avgViews > 30) + Number(c.askCommission < 0.2);
}

describe('scam creators are a real risk, and a careful agency limits it', () => {
  it('stealth scammers show no explicit flag, grow with difficulty, and their public numbers stay readable', () => {
    const share: Record<string, number> = {};
    for (const difficulty of ['facile', 'normal', 'cauchemar'] as const) {
      let stealth = 0; let total = 0; let caught = 0; let honest = 0; let falseAlarms = 0; let singleSignal = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { world } = makeWorld(seed, difficulty);
        for (const c of world.market.creators) {
          total++;
          if (!isScammer(world, c)) {
            honest++;
            if (creatorSuspicion(c) >= 2) falseAlarms++;
          } else if (!c.redFlags.some(isScamFlag)) {
            stealth++;
            if (creatorSuspicion(c) >= 2) caught++;
            if (c.avgViews / c.followers < 0.08) singleSignal++;
          }
        }
      }
      share[difficulty] = stealth / total;
      if (difficulty === 'cauchemar') {
        expect(caught / stealth).toBeGreaterThan(0.85); // the combination of signals works…
        expect(singleSignal / stealth).toBeLessThan(0.8); // …where each signal alone is noisy
      }
      expect(falseAlarms / honest).toBeLessThan(0.1);
    }
    expect(share.facile!).toBeLessThan(share.normal!);
    expect(share.normal!).toBeLessThan(share.cauchemar!);
    expect(share.cauchemar!).toBeGreaterThan(0.15);
  });

  it('the advances at risk scale with difficulty, and reading the public numbers keeps most of them, not at the cost of honest deals', () => {
    const exposure = (difficulty: Difficulty) => {
      let careless = 0; let careful = 0; let creators = 0; let honestAskers = 0; let honestKept = 0;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { world } = makeWorld(seed, difficulty);
        for (const c of world.market.creators) {
          creators++;
          if (c.redFlags.some(isScamFlag) || c.askUpfront === 0) continue; // nobody pays an explicit red flag
          if (!isScammer(world, c)) { honestAskers++; if (creatorSuspicion(c) < 2) honestKept++; continue; }
          careless += c.askUpfront;
          if (creatorSuspicion(c) < 2) careful += c.askUpfront;
        }
      }
      return { careless: careless / creators, careful: careful / creators, honestKept: honestKept / honestAskers };
    };
    const [facile, normal, cauchemar] = [exposure('facile'), exposure('normal'), exposure('cauchemar')];
    expect(facile.careless).toBeGreaterThan(0);
    expect(facile.careless).toBeLessThan(normal.careless);
    expect(normal.careless).toBeLessThan(cauchemar.careless);
    for (const r of [facile, normal, cauchemar]) {
      expect(r.careful).toBeLessThan(r.careless * 0.25);
      expect(r.honestKept).toBeGreaterThan(0.85);
    }
  });

  it('a stealth scammer takes the advance and vanishes; a commission offer costs nothing', () => {
    const { world, rng } = makeWorld(61, 'cauchemar', 2000);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    const fake: CreatorProfile = { id: 'crt_fake', handle: 'woof_clean', nicheId: n.id, followers: 42000, avgViews: 2600, engagement: 0.024, askUpfront: 110, askCommission: 0.15, redFlags: [] };
    world.market.creators.push(fake);
    (n.scamCreatorIds ??= []).push(fake.id);
    expect(isScammer(world, fake)).toBe(true);
    const cash = financeSnapshot(world).cash;
    expect(tools.proposePartnership({ creatorId: fake.id, productId: 'p', upfront: 0, commission: 0.3 }).ok).toBe(false);
    expect(financeSnapshot(world).cash).toBe(cash);
    expect(tools.proposePartnership({ creatorId: fake.id, productId: 'p', upfront: 110, commission: 0.15 }).ok).toBe(true);
    world.day = 2;
    tickMarket(world, rng);
    expect(world.market.partnerships.at(-1)!.status).toBe('scam');
    expect(world.ledger.filter((e) => e.type === 'scam_loss').map((e) => e.amount)).toEqual([-110]);
    expect(world.activity.find((a) => a.text.includes('woof_clean'))?.refs).toEqual({ productId: 'p' });
  });

  it('the hidden truth stays off the public profile, also for creators who write in', () => {
    const { world, rng } = makeWorld(62, 'cauchemar', 2000);
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
    tools.publishProduct('p');
    for (let i = 0; i < 40; i++) forceEvent(world, rng, 'creator_offer');
    const inbound = world.market.creators.filter((x) => x.id.includes('_j'));
    expect(inbound.some((x) => isScammer(world, x) && !x.redFlags.some(isScamFlag))).toBe(true);
    expect(inbound.some((x) => !isScammer(world, x))).toBe(true);
    const keys = new Set(['id', 'handle', 'nicheId', 'followers', 'avgViews', 'engagement', 'askUpfront', 'askCommission', 'redFlags']);
    for (const pub of tools.listCreators(n.id)) expect(Object.keys(pub).every((k) => keys.has(k))).toBe(true);
    expect(JSON.stringify(world.market.creators)).not.toMatch(/scam/i);
  });
});

describe('support scams from real buyers (friendly fraud)', () => {
  const REFUSAL: SupportReplyInput = { text: 'Bonjour, merci pour votre message. Votre commande montre un seul débit et le guide a bien été téléchargé : nous ne pouvons pas donner suite à cette demande, mais nous restons disponibles.\nBelle journée,\n— Inès, service client', action: 'none', detectedIntent: 'arnaque' };
  const REFUND: SupportReplyInput = { text: 'Bonjour, désolé pour ce souci, je comprends. Je lance votre remboursement.\nBelle journée,\n— Inès', action: 'refund', detectedIntent: 'remboursement' };

  function bought(world: WorldState, rng: Rng, seed = 0) {
    const tools = createMarketTools(world, rng);
    const n = findNiche(world, 'proprete-chiot')!;
    const c = goodContent(n);
    const p = makeProduct(world, `p${seed}`, n, c, goodSalesPage(n, c), 19);
    const buyer = createCustomer(world, rng, 'normal');
    const order: Order = { id: `ord_${seed}`, day: 1, customerId: buyer.id, productId: p.id, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 };
    world.market.orders.push(order);
    buyer.orders.push(order.id);
    return { tools, n, p, buyer, order };
  }

  it('a careless refund on a false claim is a real loss, a refusal from the logs costs nothing', () => {
    const { world, rng } = makeWorld(71);
    const { tools, n, p, buyer, order } = bought(world, rng);
    const claim = createMessage(world, rng, { intent: 'arnaque', customer: buyer, product: p, order, niche: n, templateIndex: 0 });
    expect(claim.body).toMatch(/débité deux fois/);
    expect(claim.orderId).toBe(order.id);
    expect(claim.mood).toBeLessThan(0); // nothing in the tone gives it away
    expect(order.charges).toBe(1); // the payment log says otherwise
    expect(order.downloads).toBeGreaterThanOrEqual(2);
    const cash = financeSnapshot(world).cash;
    const paid = tools.replyToMessage(claim.id, REFUND, 'ines');
    expect(paid).toMatchObject({ consequence: 'scam_loss', cost: 19 });
    expect(paid.score).toBeLessThanOrEqual(15);
    expect(financeSnapshot(world).cash).toBeCloseTo(cash - 19, 2);
    expect(world.ledger.at(-1)).toMatchObject({ type: 'scam_loss', ref: order.id, amount: -19 });
    expect(order.refunded).toBe(true);

    const other = bought(world, rng, 1);
    const claim2 = createMessage(world, rng, { intent: 'arnaque', customer: other.buyer, product: other.p, order: other.order, niche: other.n, templateIndex: 2 });
    const refused = tools.replyToMessage(claim2.id, REFUSAL, 'ines');
    expect(refused.score).toBeGreaterThanOrEqual(70);
    expect(refused.resolved).toBe(true);
    expect(other.order.refunded).toBe(false);
  });

  it('a claim on an order already refunded costs nothing more', () => {
    const { world, rng } = makeWorld(75);
    const { tools, n, p, buyer, order } = bought(world, rng);
    const claim = createMessage(world, rng, { intent: 'arnaque', customer: buyer, product: p, order, niche: n });
    refundOrder(world, order, 'Remboursement via la plateforme');
    const out = tools.replyToMessage(claim.id, REFUND, 'ines');
    expect(out).toMatchObject({ consequence: 'none', cost: 0 });
    expect(out.customerReaction).not.toMatch(/encaissé|bien reçu/);
  });

  it('a false claim paid through the refund task is booked the same way', () => {
    const { world, rng } = makeWorld(72);
    const { tools, n, p, buyer, order } = bought(world, rng);
    const claim = createMessage(world, rng, { intent: 'arnaque', customer: buyer, product: p, order, niche: n });
    expect(tools.issueRefund(order.id, 'demande client').ok).toBe(true);
    expect(world.ledger.at(-1)).toMatchObject({ type: 'scam_loss', ref: order.id });
    expect(claim.status).toBe('resolved');
  });

  it('honest claims leave matching logs: a real double charge is free to refund, a real non-delivery shows no download', () => {
    const { world, rng } = makeWorld(73);
    const { tools, n, p, buyer, order } = bought(world, rng);
    const bug = createMessage(world, rng, { intent: 'bug_paiement', customer: buyer, product: p, order, niche: n, templateIndex: 0 });
    expect(order.charges).toBe(2);
    expect(tools.replyToMessage(bug.id, { ...competentReply(bug), action: 'refund' }, 'ines')).toMatchObject({ resolved: true, cost: 0 });
    const lost = bought(world, rng, 1);
    const missing = createMessage(world, rng, { intent: 'non_recu', customer: lost.buyer, product: lost.p, order: lost.order, niche: lost.n });
    expect(lost.order.downloads).toBe(0);
    expect(tools.replyToMessage(missing.id, competentReply(missing), 'ines').resolved).toBe(true);
    expect(lost.order.downloads).toBe(1);
  });

  it('a claim left unanswered can end at the bank, and only with a real order', () => {
    const { world, rng } = makeWorld(74);
    const { n, p } = bought(world, rng);
    const claims: InboxMessage[] = [];
    for (let i = 0; i < 300; i++) {
      const buyer = createCustomer(world, rng, 'normal');
      const order: Order = { id: `ord_x${i}`, day: 1, customerId: buyer.id, productId: p.id, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false };
      world.market.orders.push(order);
      claims.push(createMessage(world, rng, { intent: 'arnaque', customer: buyer, product: p, order, niche: n }));
    }
    const stranger = createMessage(world, rng, { intent: 'arnaque', customer: createCustomer(world, rng, 'arnaqueur'), product: p, order: null, niche: n, templateIndex: 1 });
    world.day = 5;
    tickMarket(world, rng);
    const disputed = claims.filter((m) => m.status === 'escalated').length;
    expect(disputed / claims.length).toBeGreaterThan(SCAM.friendlyDisputeIgnored * 0.7);
    expect(disputed / claims.length).toBeLessThan(SCAM.friendlyDisputeIgnored * 1.3);
    expect(stranger.status).toBe('resolved');
  });

  it('the loss scales with difficulty, and a careful support keeps most of it', () => {
    const CLAIM_LIE = /deux fois|deux prélèvements|jamais rien reçu|jamais pu ouvrir|pas été fait par moi|promis le remboursement/i;
    const play = (difficulty: Difficulty, careful: boolean) => {
      const { world, rng } = makeWorld(5, difficulty, 30000);
      const tools = createMarketTools(world, rng);
      const n = findNiche(world, 'proprete-chiot')!;
      const c = goodContent(n);
      makeProduct(world, 'p', n, c, goodSalesPage(n, c), 19);
      tools.publishProduct('p');
      runDays(world, rng, 14, (d) => {
        for (const m of tools.listInbox('open')) {
          const order = world.market.orders.find((o) => o.id === m.orderId);
          if (!order || !CLAIM_LIE.test(m.body)) { tools.replyToMessage(m.id, competentReply(m), 'support'); continue; }
          // the careless desk pays whatever looks like a billing problem; the careful one reads the order first
          const firstContact = world.market.inbox.filter((x) => x.customerId === m.customerId).length === 1;
          const contradicted = /deux/i.test(m.body) ? (order.charges ?? 1) < 2 : /promis/i.test(m.body) ? firstContact : (order.downloads ?? 1) >= 1;
          tools.replyToMessage(m.id, careful && contradicted ? REFUSAL : REFUND, 'support');
        }
        for (let i = 0; i < 300 && d <= 8; i++) {
          const buyer = createCustomer(world, rng, 'normal');
          world.market.orders.push({ id: `ord_${d}_${i}`, day: d, customerId: buyer.id, productId: 'p', price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false, charges: 1, downloads: 1 });
          buyer.orders.push(`ord_${d}_${i}`);
        }
      });
      const fraud = new Set(world.market.inbox.filter((m) => m.intent === 'arnaque' && m.orderId).map((m) => m.orderId!));
      const orders = world.market.orders.length;
      const lost = -world.ledger.filter((e) => e.ref && fraud.has(e.ref)).reduce((sum, e) => sum + e.amount, 0);
      return { perOrder: lost / orders, lost, claimRate: fraud.size / orders };
    };
    const results = (['facile', 'normal', 'cauchemar'] as const).map((difficulty) => ({ difficulty, careless: play(difficulty, false), careful: play(difficulty, true) }));
    const [facile, normal, cauchemar] = results as [typeof results[0], typeof results[0], typeof results[0]];
    expect(facile.careless.lost).toBeGreaterThan(0);
    expect(facile.careless.perOrder).toBeLessThan(normal.careless.perOrder);
    expect(normal.careless.perOrder).toBeLessThan(cauchemar.careless.perOrder);
    for (const r of results) {
      const expected = DIFFICULTY[r.difficulty].scamRate * SCAM.friendlyFraudPerRate;
      expect(r.careless.claimRate, r.difficulty).toBeGreaterThan(expected * 0.4);
      expect(r.careless.claimRate, r.difficulty).toBeLessThan(expected * 1.6);
      expect(r.careful.lost, r.difficulty).toBeLessThan(r.careless.lost * 0.35);
    }
  });
});

// ───────────────────────────── finance on closed days ─────────────────────────────

describe('7-day figures use closed days only', () => {
  const DAILY = FEES.boutiqueDaily + FEES.toolsDaily;

  function burning(days: number) {
    const { world, rng } = makeWorld(81, 'normal', 1000);
    for (let d = 1; d <= days; d++) {
      world.day = d;
      recordLedger(world, { type: 'ad_spend', amount: -10, memo: 'pub' });
      tickMarket(world, rng);
    }
    return { world, rng };
  }

  it('the open day stays out until its market close is booked', () => {
    const { world, rng } = burning(8);
    const evening = financeSnapshot(world);
    world.day = 9; // morning: nothing of day 9 is closed yet
    const morning = financeSnapshot(world);
    expect(morning).toEqual(evening); // the old window held 6 days of data divided by 7
    expect(morning.burn7d).toBeCloseTo(10 + DAILY, 2);
    expect(morning.profit7d).toBeCloseTo(-7 * (10 + DAILY), 2);
    recordLedger(world, { type: 'refund', amount: -100, memo: 'remboursement du matin' });
    expect(financeSnapshot(world).profit7d).toBe(morning.profit7d);
    expect(financeSnapshot(world).burn7d).toBe(morning.burn7d);
    expect(financeSnapshot(world).cash).toBeCloseTo(morning.cash - 100, 2);
    tickMarket(world, rng);
    expect(financeSnapshot(world).profit7d).toBeCloseTo(-7 * DAILY - 60 - 100, 2);
  });

  it('divides by the days really closed, and the launch costs are not a daily burn', () => {
    const { world } = burning(1);
    world.day = 2;
    const f = financeSnapshot(world);
    expect(f.profit7d).toBeCloseTo(-60 - 10 - DAILY, 2);
    expect(f.burn7d).toBeCloseTo(10 + DAILY, 2);
    expect(f.runwayDays).toBe(Math.floor(f.cash / f.burn7d));
  });

  it('a bankrupt company never shows an unlimited runway', () => {
    const { world } = burning(9);
    world.ledger.push({ id: 'led_old', day: 1, type: 'chargeback', amount: -1200, memo: 'litiges hors fenêtre', ref: null });
    recordLedger(world, { type: 'revenue', amount: 200, memo: 'ventes' });
    const f = financeSnapshot(world);
    expect(f.bankrupt).toBe(true);
    expect(f.profit7d).toBeGreaterThan(0); // the old rule read this as "unlimited (profitable)"
    expect(f.runwayDays).toBe(0);
    world.ledger = world.ledger.filter((e) => e.id !== 'led_old');
    expect(financeSnapshot(world).runwayDays).toBeNull(); // solvent and not burning: no end in sight
  });

  it('ROAS leaves out the announced outage day, profit does not', () => {
    const { world, rng } = makeWorld(82, 'normal', 1000);
    world.day = 2;
    recordLedger(world, { type: 'ad_spend', amount: -20, memo: 'pub' });
    recordLedger(world, { type: 'revenue', amount: 60, memo: 'ventes' });
    world.day = 3;
    forceEvent(world, rng, 'platform_outage');
    world.day = 4;
    recordLedger(world, { type: 'ad_spend', amount: -40, memo: 'pub pendant la panne' });
    const f = financeSnapshot(world);
    expect(f.roas7d).toBe(3);
    expect(f.profit7d).toBeCloseTo(0, 2);
  });
});

describe('announced outages', () => {
  it('come from the public event log, with their day as a structured ref', () => {
    const { world, rng } = makeWorld(83);
    expect(announcedOutageDays(world)).toEqual([]);
    world.day = 4;
    const ev = forceEvent(world, rng, 'platform_outage')!;
    expect(ev.refs).toEqual({ day: 5 });
    expect(announcedOutageDays(world)).toEqual([5]);
    expect(isAnnouncedOutage(world, 5)).toBe(true);
    expect(isAnnouncedOutage(world, 4)).toBe(false);
    // the market's hidden modifier is not an announcement
    world.market.modifiers.outageDay = 9;
    expect(isAnnouncedOutage(world, 9)).toBe(false);
    // an event saved before refs.day announced the following day
    world.market.events.push({ id: 'evt_old', day: 11, kind: 'platform_outage', title: 'Panne', description: '', severity: 'danger' });
    expect(announcedOutageDays(world)).toEqual([5, 12]);
    expect(isAnnouncedOutage(world, 12)).toBe(true);
  });
});
