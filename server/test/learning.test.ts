import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BrainVault, ContentEngine, LessonDraft, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import type {
  AdCreative, AgentState, DailyAdStats, DeptId, LedgerEntry, Order, Product, Task, WorldState,
} from '../src/shared.js';
import {
  armStats, chooseArm, computeDailyKpi, createBrainVault, performanceReview, rewardArm, runRetro, startExperiment,
  updateExperiments,
} from '../src/learning/index.js';
import { sampleBeta } from '../src/learning/bandits.js';
import { addRule, agentsForLesson } from '../src/learning/playbooks.js';
import { extractBannedTerm } from '../src/learning/heuristics.js';
import { parseNote, serializeNote } from '../src/learning/markdown.js';
import { slugify, safeFileName, tokenize } from '../src/learning/text.js';

// ───────────────────────────── fixture ─────────────────────────────

function agent(id: string, name: string, dept: DeptId, role: string, isChief = false): AgentState {
  return {
    id, name, role, dept, isChief, tier: 'haiku', persona: `${name} travaille avec méthode.`, skills: [], tools: [], taskKinds: [],
    avatar: { skin: '#f1c27d', hair: '#222', shirt: '#36c', pants: '#333', hairStyle: 0, accessory: 'none' },
    status: 'idle', place: dept, currentTaskId: null, energy: 100, level: 1, xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 }, bubble: null,
  };
}

function product(): Product {
  return {
    id: 'prd_1', nicheId: 'sommeil', title: 'Faire dormir bébé qui se réveille toutes les 2 h', subtitle: 'La méthode douce en 7 nuits',
    audience: 'Parents de bébés de 6 à 12 mois', problem: 'Réveils nocturnes', price: 19, status: 'live', version: 1,
    content: null, design: null,
    salesPage: {
      headline: 'Des nuits complètes', subheadline: 'Sans laisser pleurer', painBullets: ['il se réveille toutes les 2 h'], solution: 'Un plan nuit par nuit',
      chapterBlurbs: [], bonusBlurb: 'Bonus : le carnet de sommeil', objections: [], guarantee: 'Remboursé sous 14 jours', cta: 'Je télécharge', hypeLevel: 0.4,
    },
    files: { pdf: 'files/prd_1/v1/guide.pdf', cover: 'files/prd_1/v1/cover.svg', salesPage: 'files/prd_1/v1/sales-page.html' },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [{ day: 1, price: 19 }],
  };
}

function creative(id: string, hookStyle: AdCreative['hookStyle'], hook: string, review: AdCreative['review']): AdCreative {
  return {
    id, productId: 'prd_1', hook, hookStyle, format: 'text_slideshow',
    scenes: [{ visual: 'Chambre de bébé la nuit', onScreenText: hook, voiceover: hook, durationSec: 3 }],
    caption: hook, hashtags: ['#sommeilbebe'], cta: 'Télécharge le guide', files: { storyboard: [], preview: null },
    quality: null, review, createdDay: 1, createdBy: 'sarah',
  };
}

function stat(day: number, creativeId: string, impressions: number, clicks: number, landingViews: number, purchases: number, spend: number, price = 19): DailyAdStats {
  const revenue = purchases * price;
  return {
    day, campaignId: 'cmp_1', creativeId, productId: 'prd_1', spend, impressions, clicks, ctr: clicks / impressions,
    cpc: spend / Math.max(1, clicks), cpm: (spend / impressions) * 1000, landingViews, purchases, revenue,
    roas: revenue / spend, frequency: 1.2, comments: [],
  };
}

function makeWorld(): WorldState {
  const agents = [
    agent('nora', 'Nora', 'rh', 'DRH & coach', true),
    agent('leo', 'Léo', 'growth', 'Head of growth', true),
    agent('sarah', 'Sarah', 'growth', 'Scénariste de hooks'),
    agent('adam', 'Adam', 'growth', 'Media buyer'),
    agent('chloe', 'Chloé', 'creation', 'Productrice de créas', true),
    agent('clara', 'Clara', 'boutique', 'Cheffe boutique', true),
    agent('ines', 'Inès', 'support', 'Cheffe support', true),
    agent('elise', 'Élise', 'studio', 'Rédactrice en chef', true),
    agent('camille', 'Camille', 'direction', 'CEO & orchestratrice', true),
    agent('gabriel', 'Gabriel', 'finance', 'CFO', true),
  ];
  return {
    version: 1, runId: 'test', createdAt: '2026-10-30T00:00:00.000Z',
    scenario: {
      name: 'test', companyName: 'Pixel Agency', seed: 1, startingCash: 500, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
      founderApproval: false, chargeCompute: false, maxComputeEur: 0, goal: { targetProfit: 1000, byDay: 60 },
    },
    day: 1, tick: 11, phase: 'evening', rngState: 1, idCounter: 100,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: 'Pixel Agency', agents,
      departments: [
        { id: 'growth', name: 'Growth', color: '#f60', icon: 'GROWTH', description: 'Pubs TikTok et organique', chiefId: 'leo', grid: { col: 1, row: 0 } },
        { id: 'rh', name: 'RH & Apprentissage', color: '#b56576', icon: 'RH', description: 'Rétro et coaching', chiefId: 'nora', grid: { col: -1, row: 0 } },
      ],
      tasks: [], missions: [], products: [product()],
      creatives: [
        creative('crt_1', 'story', 'Elle a cru que son bébé ne dormirait jamais…', { status: 'approved', reason: null, day: 1 }),
        creative('crt_2', 'stat', '73 % des bébés se réveillent la nuit', { status: 'approved', reason: null, day: 1 }),
        creative('crt_3', 'question', 'Sommeil garanti en 3 nuits ?', { status: 'rejected', reason: 'Promesse de résultat « garanti » interdite', day: 1 }),
      ],
      campaigns: [], deliverables: [],
      research: {
        trends: [{ nicheId: 'sommeil', name: 'Sommeil de bébé (6-12 mois)', audience: 'Parents', category: 'parentalité', searchInterest: 80, tiktokBuzz: 70, competitionHint: 'moyenne', sampleTitles: [] }],
        voc: {}, competitors: {}, shortlist: ['sommeil'],
      },
      lessons: [], experiments: [], bandits: {},
      playbooks: { sarah: ['Ne jamais écrire « garanti »', 'Le hook tient dans les 2 premières secondes.'] },
      kpis: [], chats: {}, pendingApprovals: [],
    },
    market: {
      niches: [], customers: [], orders: [], inbox: [], adStats: [], organicPosts: [], creators: [], partnerships: [], events: [],
      modifiers: { cpmMultiplier: 1, cpmUntilDay: 0, paymentHoldUntilDay: 0, outageDay: 0 },
      adAccount: { strikes: 1, banned: false, bannedUntilDay: 0 },
      creativeImpressions: {},
    },
    ledger: [], activity: [],
  };
}

let ledgerId = 0;
function entry(day: number, type: LedgerEntry['type'], amount: number, ref: string | null = null): LedgerEntry {
  return { id: `led_${++ledgerId}`, day, type, amount, memo: type, ref };
}

function order(id: string, day: number, refunded = false): Order {
  return { id, day, customerId: `cus_${id}`, productId: 'prd_1', price: 19, source: 'ads', campaignId: 'cmp_1', creatorId: null, refunded, chargeback: false };
}

/** Day 1: "story" hook converts clicks 5× better than "stat", one ad rejected for « garanti ». */
function seedDay1(world: WorldState): void {
  world.market.adStats.push(stat(1, 'crt_1', 5000, 200, 150, 6, 25), stat(1, 'crt_2', 5000, 40, 30, 1, 25));
  for (let i = 1; i <= 7; i++) world.market.orders.push(order(`ord_${i}`, 1, i === 7));
  world.ledger.push(entry(1, 'capital', 500), entry(1, 'ad_spend', -50), entry(1, 'revenue', 133), entry(1, 'payment_fee', -4.5), entry(1, 'refund', -19, 'ord_7'));
}

function stubEngine(memo = 'Mémo du jour : on garde le hook histoire.'): ContentEngine {
  const engine = {
    mode: 'heuristic',
    async extractLessons(input: { heuristicLessons: LessonDraft[] }) {
      return input.heuristicLessons;
    },
    async dailyMemo() {
      return memo;
    },
  };
  return engine as unknown as ContentEngine;
}

const tempDirs: string[] = [];
async function tempPaths(): Promise<RunPaths> {
  const root = await mkdtemp(join(tmpdir(), 'pixel-learning-'));
  tempDirs.push(root);
  return { root, brain: join(root, 'brain'), files: join(root, 'files') };
}

afterAll(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
});

// ───────────────────────────── bandits ─────────────────────────────

describe('bandits', () => {
  it('Beta sampling (Marsaglia-Tsang) has the right mean', () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += sampleBeta(2, 5, rng);
    expect(sum / 4000).toBeGreaterThan(0.265);
    expect(sum / 4000).toBeLessThan(0.307); // 2/7 = 0.2857
    let small = 0;
    for (let i = 0; i < 4000; i++) small += sampleBeta(0.5, 0.5, rng);
    expect(small / 4000).toBeGreaterThan(0.46);
    expect(small / 4000).toBeLessThan(0.54);
  });

  it('Thompson sampling converges to the best of 3 arms within 300 pulls', () => {
    for (const seed of [1, 42, 2026]) {
      const world = makeWorld();
      const rng = createRng(seed);
      const truth: Record<string, number> = { a: 0.2, b: 0.5, c: 0.8 };
      const arms = ['a', 'b', 'c'];
      for (let i = 0; i < 300; i++) {
        const arm = chooseArm(world, 'test', arms, rng);
        rewardArm(world, 'test', arm, rng.chance(truth[arm]!) ? 1 : 0);
      }
      const stats = armStats(world, 'test');
      expect(stats[0]!.key).toBe('c');
      expect(stats.find((s) => s.key === 'c')!.pulls).toBeGreaterThan(180);
      expect(stats.reduce((s, x) => s + x.pulls, 0)).toBe(300);
    }
  });

  it('is deterministic for a given seed and creates arms lazily', () => {
    const run = () => {
      const world = makeWorld();
      const rng = createRng(99);
      return Array.from({ length: 20 }, () => chooseArm(world, 'hook_style:sommeil', ['story', 'stat', 'pov'], rng));
    };
    expect(run()).toEqual(run());
    const world = makeWorld();
    expect(chooseArm(world, 'x', [], createRng(1))).toBe('');
    chooseArm(world, 'price:sommeil', ['9', '19'], createRng(1));
    expect(world.company.bandits['price:sommeil']!.map((a) => [a.key, a.alpha, a.beta, a.pulls])).toEqual([['9', 1, 1, 0], ['19', 1, 1, 0]]);
  });

  it('rewardArm updates the Beta posterior with clamping and weights', () => {
    const world = makeWorld();
    rewardArm(world, 'hype', '0.4', 0.75, 2);
    rewardArm(world, 'hype', '0.4', 7); // clamped to 1
    rewardArm(world, 'hype', '0.4', Number.NaN); // treated as 0
    const arm = world.company.bandits.hype!.find((a) => a.key === '0.4')!;
    expect(arm.alpha).toBeCloseTo(1 + 1.5 + 1, 6);
    expect(arm.beta).toBeCloseTo(1 + 0.5 + 0 + 1, 6);
    expect(arm.pulls).toBe(3);
    expect(arm.reward).toBeCloseTo(1.75, 6);
    expect(armStats(world, 'hype')[0]!.mean).toBeCloseTo(3.5 / 6, 3);
  });
});

// ───────────────────────────── vault ─────────────────────────────

describe('brain vault', () => {
  let paths: RunPaths;
  let brain: BrainVault;
  beforeEach(async () => {
    paths = await tempPaths();
    brain = createBrainVault(paths);
    await brain.init();
  });

  it('copies the seed vault and parses frontmatter, title and links', async () => {
    const notes = await brain.list();
    const paths_ = notes.map((n) => n.path);
    expect(paths_).toContain('00 - Accueil.md');
    expect(paths_).toContain('business/Prix.md');
    expect(paths_).toContain('politiques/Conformité pub TikTok.md');
    const prix = await brain.read('business/Prix.md');
    expect(prix?.title).toBe('Prix');
    expect(prix?.tags).toEqual(['business', 'prix']);
    expect(prix?.links).toContain('Page de vente');
    expect(prix?.body.startsWith('# ')).toBe(false);
    // re-init must not overwrite an existing vault
    await brain.write({ path: 'business/Prix.md', title: 'Prix', tags: ['prix'], body: 'Version modifiée.', day: 4 });
    await brain.init();
    expect((await brain.read('business/Prix.md'))?.body).toBe('Version modifiée.');
  });

  it('writes, appends, searches and builds the graph', async () => {
    await brain.write({
      path: 'niches/Sommeil bébé.md', title: 'Sommeil de bébé', tags: ['niche', 'parentalité'], day: 3,
      body: 'Les parents disent « il se réveille toutes les 2 h ». Voir [[Prix]] et [[Règle du un|la règle]]. Les remboursements viennent des promesses trop fortes.',
    });
    const note = await brain.read('niches/Sommeil bébé.md');
    expect(note?.updatedDay).toBe(3);
    expect(note?.links).toEqual(['Prix', 'Règle du un']);
    expect(await brain.read('niches/Sommeil bébé')).not.toBeNull(); // extension optional
    expect((await brain.read('Sommeil bébé'))?.path).toBe('niches/Sommeil bébé.md'); // basename resolution

    await brain.append('niches/Sommeil bébé.md', '## Mise à jour\nNouveau verbatim : « il hurle à 3 h ».', 5);
    const appended = await brain.read('niches/Sommeil bébé.md');
    expect(appended?.updatedDay).toBe(5);
    expect(appended?.body).toContain('il hurle à 3 h');
    expect(appended?.tags).toEqual(['niche', 'parentalité']);
    const raw = await readFile(join(paths.brain, 'niches', 'Sommeil bébé.md'), 'utf8');
    expect(raw.startsWith('---\ntags: [niche, parentalité]\nday: 5\n---\n# Sommeil de bébé\n')).toBe(true);

    const hits = await brain.search('regle du un'); // accents and stopwords ignored
    expect(hits[0]?.path).toBe('business/Règle du un.md');
    const hits2 = await brain.search('rembourser les clients');
    expect(hits2.length).toBeGreaterThan(0);
    expect(hits2.length).toBeLessThanOrEqual(5);
    const sommeil = (await brain.search('sommeil réveille', 10)).find((h) => h.path === 'niches/Sommeil bébé.md');
    expect(sommeil?.excerpt).toMatch(/réveille/);
    expect(await brain.search('   ')).toEqual([]);
    expect(await brain.search('le la les de')).toEqual([]);

    const g = await brain.graph();
    expect(g.nodes.find((n) => n.id === 'niches/Sommeil bébé.md')?.group).toBe('niches');
    expect(g.nodes.find((n) => n.id === '00 - Accueil.md')?.group).toBe('racine');
    expect(g.edges).toContainEqual({ from: 'niches/Sommeil bébé.md', to: 'business/Prix.md' });
    expect(g.edges).toContainEqual({ from: 'niches/Sommeil bébé.md', to: 'business/Règle du un.md' });
    expect(g.edges).toContainEqual({ from: '00 - Accueil.md', to: 'business/Prix.md' });
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.to))).toBe(true);
  });

  it('keeps paths inside the vault and Windows-safe', async () => {
    await brain.write({ path: '../../evil.md', title: 'Évasion', tags: [], body: 'Rien.', day: 1 });
    expect(await brain.read('evil.md')).not.toBeNull();
    await brain.write({ path: 'lecons\\Prix: 19€?.md', title: 'Prix 19', tags: ['prix'], body: 'Test', day: 2 });
    const n = await brain.read('lecons/Prix: 19€?.md');
    expect(n?.path).toBe('lecons/Prix 19€.md');
    expect(safeFileName('CON')).toBe('_CON');
    expect(slugify('Ne jamais écrire « garanti » !')).toBe('ne-jamais-ecrire-garanti');
  });

  it('shares its index between instances and sees external edits after write', async () => {
    const other = createBrainVault(paths);
    await brain.write({ path: 'produits/guide.md', title: 'Guide sommeil', tags: ['produit'], body: 'Chapitre sur la sieste.', day: 2 });
    const hits = await other.search('sieste');
    expect(hits[0]?.path).toBe('produits/guide.md');
  });

  it('round-trips markdown with CRLF and list-style tags', () => {
    const p = parseNote('---\r\ntags:\r\n  - a\r\n  - b\r\nday: 7\r\nauteur: Nora\r\n---\r\n# Titre\r\n\r\nCorps [[Lien#Section]]\r\n', 'x/y.md');
    expect(p).toMatchObject({ title: 'Titre', tags: ['a', 'b'], day: 7, body: 'Corps [[Lien#Section]]', links: ['Lien'], extra: { auteur: 'Nora' } });
    expect(serializeNote({ title: 'T', tags: ['a'], day: 2, body: '# Doublon\nTexte' })).toBe('---\ntags: [a]\nday: 2\n---\n# T\n\nTexte\n');
    expect(tokenize('Les remboursements des clients')).toEqual(tokenize('rembourser client'));
  });
});

// ───────────────────────────── KPI ─────────────────────────────

describe('computeDailyKpi', () => {
  it('aggregates ledger, ad stats, orders, inbox and tasks of the day', () => {
    const world = makeWorld();
    world.day = 2;
    world.ledger.push(
      entry(1, 'capital', 500), entry(1, 'ad_spend', -20), entry(1, 'revenue', 38),
      entry(2, 'ad_spend', -40), entry(2, 'revenue', 95), entry(2, 'payment_fee', -3.5), entry(2, 'refund', -19, 'ord_9'), entry(2, 'chargeback', -15, 'ord_9'),
    );
    world.market.adStats.push(stat(2, 'crt_1', 4000, 100, 80, 4, 30), stat(2, 'crt_2', 1000, 20, 20, 1, 10), stat(1, 'crt_1', 9999, 999, 99, 9, 20));
    world.market.orders.push(order('ord_1', 2), order('ord_2', 2), order('ord_3', 2), order('ord_4', 2), order('ord_5', 2), order('ord_0', 1));
    world.market.inbox.push(
      { id: 'msg_1', day: 2, customerId: 'c1', channel: 'email', subject: 'Pas reçu', body: '…', intent: 'non_recu', productId: 'prd_1', orderId: 'ord_1', mood: -0.2, status: 'open', deadlineDay: 3, thread: [], resolution: null },
      { id: 'msg_2', day: 2, customerId: 'c2', channel: 'email', subject: 'Merci', body: '…', intent: 'compliment', productId: 'prd_1', orderId: null, mood: 0.8, status: 'resolved', deadlineDay: 3, thread: [], resolution: 'ok' },
    );
    const t: Task = {
      id: 'tsk_1', kind: 'write_pdf', title: 'Rédiger', dept: 'studio', assignee: 'elise', createdBy: 'system', missionId: null, dependsOn: [], status: 'done',
      priority: 2, dayCreated: 1, dayDone: 2, progress: 1, workLeft: 0, attempts: 1, reviewer: null, reviews: [], input: {}, output: null, deliverableIds: [], log: [],
    };
    world.company.tasks.push(t, { ...t, id: 'tsk_2', dayDone: 1 });
    world.company.lessons.push({ id: 'les_1', day: 2, topic: 'ads', insight: 'x', evidence: 'y', confidence: 0.5, source: 'nora', appliesTo: [], notePath: 'lecons/x.md' });
    world.activity.push(
      { id: 'a1', day: 2, tick: 3, at: 0, agentId: 'ines', kind: 'message', text: 'Inès répond à Paul (score 80/100)' },
      { id: 'a2', day: 2, tick: 4, at: 0, agentId: 'ines', kind: 'message', text: 'Réponse envoyée, score : 60' },
      { id: 'a3', day: 2, tick: 4, at: 0, agentId: 'ines', kind: 'message', text: 'Nouveau message de Karen' },
    );

    const k = computeDailyKpi(world, 2);
    expect(k.revenue).toBe(95);
    expect(k.adSpend).toBe(40);
    expect(k.profit).toBe(95 - 40 - 3.5 - 19 - 15);
    expect(k.cumulativeProfit).toBe(38 - 20 + 17.5);
    expect(k.cash).toBe(500 + 18 + 17.5);
    expect(k.sales).toBe(5);
    expect(k.refunds).toBe(1); // refund + chargeback of the same order count once
    expect(k.impressions).toBe(5000);
    expect(k.clicks).toBe(120);
    expect(k.ctr).toBeCloseTo(0.024, 6);
    expect(k.cvr).toBeCloseTo(0.05, 6);
    expect(k.roas).toBeCloseTo((5 * 19) / 40, 2);
    expect(k.cac).toBe(8);
    expect(k.openTickets).toBe(1);
    expect(k.avgReplyScore).toBe(70);
    expect(k.liveProducts).toBe(1);
    expect(k.tasksDone).toBe(1);
    expect(k.lessonsLearned).toBe(1);

    // same numbers when the sim books costs as positive amounts
    const w2 = makeWorld();
    w2.ledger = world.ledger.map((e) => ({ ...e, amount: Math.abs(e.amount) }));
    w2.market = world.market;
    w2.company.tasks = world.company.tasks;
    w2.company.lessons = world.company.lessons;
    w2.activity = world.activity;
    expect(computeDailyKpi(w2, 2)).toEqual(k);
  });

  it('returns zeros on an empty world', () => {
    const k = computeDailyKpi(makeWorld(), 1);
    expect(k).toMatchObject({ revenue: 0, adSpend: 0, profit: 0, ctr: 0, cvr: 0, roas: 0, cac: 0, sales: 0, avgReplyScore: 0 });
  });
});

// ───────────────────────────── experiments ─────────────────────────────

describe('experiments', () => {
  it('computes CTR per hook style and concludes on sample size', () => {
    const world = makeWorld();
    const e = startExperiment(world, { day: 1, owner: 'emma', hypothesis: 'Le hook histoire bat le chiffre choc', dimension: 'hook_style', variants: ['story', 'stat'], metric: 'ctr' });
    expect(e.status).toBe('running');
    expect(e.results).toEqual({ story: { n: 0, value: 0 }, stat: { n: 0, value: 0 } });
    expect(updateExperiments(world)).toEqual([]);
    world.market.adStats.push(stat(1, 'crt_1', 3500, 140, 100, 4, 20), stat(1, 'crt_2', 3100, 31, 25, 1, 20));
    const done = updateExperiments(world);
    expect(done).toHaveLength(1);
    expect(done[0]!.winner).toBe('story');
    expect(done[0]!.endDay).toBe(1);
    expect(done[0]!.results.story).toEqual({ n: 3500, value: 0.04 });
    expect(updateExperiments(world)).toEqual([]); // already concluded
  });

  it('price experiments use profit per visitor and expire after 7 days', () => {
    const world = makeWorld();
    startExperiment(world, { day: 1, owner: 'emma', hypothesis: '19 € rapporte plus que 9 €', dimension: 'price', variants: ['9', '19'], metric: 'cvr' });
    world.market.adStats.push(stat(1, 'crt_1', 3000, 90, 40, 2, 20));
    world.day = 8;
    const [e] = updateExperiments(world);
    expect(e!.status).toBe('concluded');
    expect(e!.results['19']).toEqual({ n: 40, value: 0.95 });
    expect(e!.results['9']).toEqual({ n: 0, value: 0 });
    expect(e!.winner).toBeNull(); // only one variant has data
  });
});

// ───────────────────────────── retro ─────────────────────────────

describe('runRetro', () => {
  it('learns from the day: lessons, banned word in growth playbooks, journal and lesson notes; dedups', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();

    const lessons = await runRetro(world, stubEngine(), brain, ['Pub « Sommeil garanti en 3 nuits ? » refusée par TikTok']);
    expect(lessons.length).toBeGreaterThanOrEqual(2);
    const banned = lessons.find((l) => l.insight.includes('Ne jamais écrire « garanti »'));
    expect(banned).toBeDefined();
    expect(banned!.topic).toBe('ads');
    expect(banned!.evidence).toMatch(/crt_3/);
    const hook = lessons.find((l) => l.insight.startsWith('Privilégier le hook « story »'));
    expect(hook).toBeDefined();
    expect(hook!.evidence).toMatch(/impressions/);
    expect(hook!.confidence).toBeGreaterThan(0.2);
    expect(hook!.confidence).toBeLessThan(1);

    for (const id of ['leo', 'sarah', 'adam']) {
      const rules = world.company.playbooks[id] ?? [];
      expect(rules.filter((r) => r.includes('Ne jamais écrire « garanti »'))).toHaveLength(1); // seed rule replaced, not duplicated
      expect(banned!.appliesTo).toContain(id);
    }
    expect(world.company.playbooks.sarah).toContain('Le hook tient dans les 2 premières secondes.');
    expect(world.company.playbooks.clara ?? []).not.toContain(banned!.insight);

    // KPI + bandits
    expect(world.company.kpis).toHaveLength(1);
    expect(world.company.kpis[0]!.lessonsLearned).toBe(lessons.length);
    expect(world.company.kpis[0]!.revenue).toBe(133);
    const hooks = armStats(world, 'hook_style:sommeil');
    expect(hooks[0]!.key).toBe('story');
    expect(armStats(world, 'price:sommeil')[0]!.key).toBe('19');
    expect(armStats(world, 'niche')[0]!.key).toBe('sommeil');

    // brain notes
    for (const l of lessons) {
      expect(l.notePath.startsWith('lecons/jour-001-')).toBe(true);
      const n = await brain.read(l.notePath);
      expect(n?.body).toContain(l.insight);
      expect(n?.links).toContain('jour-001');
    }
    const bannedNote = await brain.read(banned!.notePath);
    expect(bannedNote?.links).toContain('Conformité pub TikTok');
    const journal = await brain.read('journal/jour-001.md');
    expect(journal?.title).toBe('Journal — jour 1');
    expect(journal?.body).toContain('| Indicateur | Valeur |');
    expect(journal?.body).toContain('Mémo du jour : on garde le hook histoire.');
    expect(journal?.body).toContain('refusée par TikTok');
    expect(journal?.links.some((x) => x.startsWith('jour-001-'))).toBe(true);
    const sarahNote = await brain.read('playbooks/Sarah.md');
    expect(sarahNote?.body).toContain('Ne jamais écrire « garanti »');
    expect(sarahNote?.links).toContain('Playbook Growth');
    expect(await brain.read('playbooks/Playbook Growth.md')).not.toBeNull();
    const graph = await brain.graph();
    expect(graph.edges).toContainEqual({ from: banned!.notePath, to: 'politiques/Conformité pub TikTok.md' });

    // activity feed
    expect(world.activity.some((a) => a.kind === 'lesson' && a.agentId === 'nora')).toBe(true);
    expect(world.activity.some((a) => a.kind === 'brain_write' && a.agentId === 'nora')).toBe(true);

    // second retro the same evening: nothing new, no double bandit reward
    const pulls = world.company.bandits['hook_style:sommeil']!.reduce((s, a) => s + a.pulls, 0);
    const again = await runRetro(world, stubEngine(), brain, []);
    expect(again).toEqual([]);
    expect(world.company.lessons).toHaveLength(lessons.length);
    expect(world.company.kpis).toHaveLength(1);
    expect(world.company.bandits['hook_style:sommeil']!.reduce((s, a) => s + a.pulls, 0)).toBe(pulls);

    // day 2: the same mistake again → confidence update, not a duplicate
    world.day = 2;
    world.company.creatives.push(creative('crt_4', 'pov', 'Résultat garanti dès ce soir', { status: 'rejected', reason: 'Allégation interdite : « garanti »', day: 2 }));
    world.market.adStats.push(stat(2, 'crt_1', 5000, 190, 140, 5, 25), stat(2, 'crt_2', 5000, 45, 30, 1, 25));
    world.ledger.push(entry(2, 'ad_spend', -50), entry(2, 'revenue', 114));
    const before = banned!.confidence;
    const day2 = await runRetro(world, stubEngine(), brain, []);
    expect(day2.some((l) => l.insight.includes('« garanti »'))).toBe(false);
    expect(world.company.lessons.filter((l) => l.insight.includes('Ne jamais écrire « garanti »'))).toHaveLength(1);
    expect(banned!.confidence).toBeGreaterThan(before);
    expect(banned!.evidence).toMatch(/crt_4/);
    expect((await brain.read(banned!.notePath))?.body).toContain('Confirmation — jour 2');
    expect(world.company.lessons.filter((l) => l.insight.startsWith('Privilégier le hook « story »'))).toHaveLength(1);
    expect(world.company.kpis.map((k) => k.day)).toEqual([1, 2]);
    expect(await brain.read('journal/jour-002.md')).not.toBeNull();
  });

  it('keeps critical heuristic lessons when the engine fails or drops them', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const failing = {
      mode: 'claude',
      async extractLessons() {
        return [{ topic: 'ads', insight: 'Tester trois hooks différents par produit chaque semaine.', evidence: '2 hooks testés seulement.', confidence: 0.6, appliesToRoles: ['Media buyer'] }];
      },
      async dailyMemo() {
        throw new Error('API indisponible');
      },
    } as unknown as ContentEngine;
    const lessons = await runRetro(world, failing, brain, []);
    expect(lessons.some((l) => l.insight === 'Tester trois hooks différents par produit chaque semaine.')).toBe(true);
    expect(lessons.some((l) => l.insight.includes('Ne jamais écrire « garanti »'))).toBe(true); // critical, kept
    expect(lessons.some((l) => l.insight.startsWith('Privilégier le hook'))).toBe(false); // non-critical, engine is final
    const journal = await brain.read('journal/jour-001.md');
    expect(journal?.body).toMatch(/Jour 1 : .* de chiffre d'affaires/); // fallback memo
  });

  it('survives an empty world', async () => {
    const world = makeWorld();
    world.company.creatives = [];
    world.company.products = [];
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const lessons = await runRetro(world, stubEngine(), brain, []);
    expect(lessons).toEqual([]);
    expect(world.company.kpis[0]).toMatchObject({ day: 1, revenue: 0, ctr: 0 });
    expect((await brain.read('journal/jour-001.md'))?.body).toContain('Pas de nouvelle leçon');
  });

  it('preserves journal content written earlier in the day by other agents', async () => {
    const world = makeWorld();
    const paths = await tempPaths();
    const brain = createBrainVault(paths);
    await brain.init();
    await brain.write({ path: 'journal/jour-001.md', title: 'Journal du jour 1', tags: ['journal'], body: '## Rapport de Raphaël\nCTR en hausse.', day: 1 });
    await runRetro(world, stubEngine(), brain, []);
    await runRetro(world, stubEngine(), brain, []);
    const j = await brain.read('journal/jour-001.md');
    expect(j?.title).toBe('Journal du jour 1');
    expect(j?.body).toContain('Rapport de Raphaël');
    expect(j?.body.split('## Rétro du soir')).toHaveLength(2);
  });
});

describe('extractBannedTerm', () => {
  const known = ['garanti', 'sans effort', '100 %'];
  it('finds the offending word in many reason formats', () => {
    expect(extractBannedTerm('Promesse de résultat « garanti » interdite', 'Sommeil garanti', known)).toBe('garanti');
    expect(extractBannedTerm('Mot interdit : sans effort', 'Maigrir sans effort', known)).toBe('sans effort');
    expect(extractBannedTerm('Allégation trompeuse', 'Résultats 100 % sûrs', known)).toBe('100 %');
    expect(extractBannedTerm('Refus "miracle"', 'La méthode miracle', known)).toBe('miracle');
    expect(extractBannedTerm('Refus pour non-conformité', 'Une pub sage', known)).toBeNull();
  });
});

// ───────────────────────────── HR review ─────────────────────────────

describe('performanceReview', () => {
  it('scores agents, promotes the top 3, coaches low performers and writes the review note', async () => {
    const world = makeWorld();
    world.day = 7;
    const set = (id: string, perf: Partial<AgentState['perf']>, xp = 0) => {
      const a = world.company.agents.find((x) => x.id === id)!;
      Object.assign(a.perf, perf);
      a.xp = xp;
    };
    set('leo', { done: 14, approved: 12, rejected: 0, failed: 0 }, 120);
    set('sarah', { done: 10, approved: 9, rejected: 1, failed: 0 }, 80);
    set('elise', { done: 9, approved: 8, rejected: 0, failed: 1 }, 70);
    set('clara', { done: 8, approved: 6, rejected: 1, failed: 0 }, 40);
    set('adam', { done: 2, approved: 1, rejected: 6, failed: 3 }, 30);
    const brain = createBrainVault(await tempPaths());
    await brain.init();

    const lines = await performanceReview(world, brain);
    expect(lines[0]).toMatch(/^Revue RH semaine 1 : score moyen \d+\/100/);
    const promotions = lines.filter((l) => l.startsWith('Promotion :'));
    expect(promotions).toHaveLength(3);
    expect(promotions[0]).toContain('Léo');
    const leo = world.company.agents.find((a) => a.id === 'leo')!;
    expect(leo.level).toBeGreaterThanOrEqual(3);
    expect(leo.perf.score).toBeGreaterThan(80);
    const adam = world.company.agents.find((a) => a.id === 'adam')!;
    expect(adam.perf.score).toBeLessThan(55);
    expect(lines.some((l) => l.startsWith('Coaching : Adam'))).toBe(true);
    expect((world.company.playbooks.adam ?? []).filter((r) => r.startsWith('Coaching RH :'))).toHaveLength(1);
    const note = await brain.read('rh/revue-semaine-1.md');
    expect(note?.title).toBe('Revue RH — semaine 1');
    expect(note?.body).toContain('| Agent |');
    expect(note?.links).toContain('Léo');
    expect(world.activity.some((a) => a.agentId === 'nora' && a.kind === 'meeting')).toBe(true);

    // a second review replaces the coaching rule instead of stacking it
    world.day = 14;
    await performanceReview(world, brain);
    expect((world.company.playbooks.adam ?? []).filter((r) => r.startsWith('Coaching RH :'))).toHaveLength(1);
    expect(await brain.read('rh/revue-semaine-2.md')).not.toBeNull();
  });

  it('handles a world without agents', async () => {
    const world = makeWorld();
    world.company.agents = [];
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    expect(await performanceReview(world, brain)).toEqual(['Revue RH semaine 1 : aucun agent à évaluer.']);
  });
});


// ───────────────────────────── playbooks & robustness ─────────────────────────────

describe('playbook rules', () => {
  it('replaces same directives, keeps 12 rules max and drops the weakest', () => {
    const world = makeWorld();
    world.company.playbooks.clara = ['Niveau de promesse max « 0.6 »', 'Commencer bas pour obtenir les premiers avis.'];
    expect(addRule(world, 'clara', 'Niveau de promesse max « 0.4 » sur les pages de vente : la survente fait rembourser.')).toBe('replaced');
    expect(world.company.playbooks.clara![0]).toMatch(/« 0\.4 »/);
    expect(world.company.playbooks.clara).toHaveLength(2);
    expect(addRule(world, 'clara', 'Niveau de promesse max « 0.4 » sur les pages de vente : la survente fait rembourser.')).toBe('present');

    world.company.lessons.push(
      { id: 'les_a', day: 1, topic: 'pricing', insight: 'Prix cible « 19 » sur « A » : forte preuve.', evidence: '', confidence: 0.9, source: 'nora', appliesTo: [], notePath: 'lecons/a.md' },
      { id: 'les_b', day: 2, topic: 'pricing', insight: 'Prix cible « 24 » sur « B » : faible preuve.', evidence: '', confidence: 0.3, source: 'nora', appliesTo: [], notePath: 'lecons/b.md' },
    );
    expect(addRule(world, 'clara', 'Prix cible « 19 » sur « A » : forte preuve.')).toBe('added');
    expect(addRule(world, 'clara', 'Prix cible « 24 » sur « B » : faible preuve.')).toBe('skipped'); // weaker singleton
    expect(world.company.playbooks.clara!.filter((r) => r.startsWith('Prix cible'))).toHaveLength(1);

    for (let i = 0; i < 15; i++) addRule(world, 'clara', `Règle libre numéro ${i}`);
    const pb = world.company.playbooks.clara!;
    expect(pb).toHaveLength(12);
    expect(pb).toContain('Prix cible « 19 » sur « A » : forte preuve.'); // 0.9 survives the 0.55 seed rules
    expect(pb[pb.length - 1]).toBe('Règle libre numéro 14');
  });

  it('routes process lessons on one task to that team and the CEO', () => {
    const world = makeWorld();
    const ids = agentsForLesson(world, 'process', ['studio'], [], true).map((a) => a.id).sort();
    expect(ids).toEqual(['camille', 'elise']);
    const chiefs = agentsForLesson(world, 'process').map((a) => a.id);
    expect(chiefs).toContain('ines');
    expect(chiefs).not.toContain('sarah');
    expect(agentsForLesson(world, 'ads', [], ['Media buyer']).map((a) => a.id)).toEqual(['leo', 'sarah', 'adam']);
    expect(agentsForLesson(world, 'pricing', [], ['Media buyer']).map((a) => a.id)).toEqual(['adam', 'clara']);
  });
});

describe('runRetro robustness', () => {
  it('still learns when the brain cannot write to disk', async () => {
    const world = makeWorld();
    seedDay1(world);
    const broken: BrainVault = {
      init: async () => {},
      list: async () => [],
      read: async () => null,
      search: async () => [],
      write: async () => { throw new Error('EPERM: fichier verrouillé'); },
      append: async () => { throw new Error('EPERM: fichier verrouillé'); },
      graph: async () => ({ nodes: [], edges: [] }),
    };
    const lessons = await runRetro(world, stubEngine(), broken, []);
    expect(lessons.some((l) => l.insight.includes('Ne jamais écrire « garanti »'))).toBe(true);
    expect(world.company.playbooks.leo?.some((r) => r.includes('« garanti »'))).toBe(true);
    expect(world.activity.some((a) => a.kind === 'thought' && a.text.includes("n'arrive pas à écrire"))).toBe(true);
  });
});

describe('brain vault existence checks', () => {
  it('never resolves an explicit folder path to another folder', async () => {
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await brain.write({ path: 'post-mortems/guide-sommeil.md', title: 'Post-mortem — Guide sommeil', tags: ['post-mortem'], body: 'Tué au jour 9.', day: 9 });
    expect(await brain.read('produits/guide-sommeil.md')).toBeNull();
    expect((await brain.read('guide-sommeil'))?.path).toBe('post-mortems/guide-sommeil.md');
    await brain.append('produits/guide-sommeil.md', '## Ventes (jour 10)\n3 ventes.', 10);
    const created = await brain.read('produits/guide-sommeil.md');
    expect(created?.title).toBe('guide-sommeil');
    expect(created?.body).toBe('## Ventes (jour 10)\n3 ventes.');
  });
});
