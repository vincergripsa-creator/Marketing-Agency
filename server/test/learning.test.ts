import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { BrainVault, ContentEngine, LessonDraft, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import type {
  AdCreative, AgentState, DailyAdStats, DailyKpi, DeptId, LedgerEntry, Order, Product, Task, WorldState,
} from '../src/shared.js';
import {
  armStats, chooseArm, computeDailyKpi, createBrainVault, performanceReview, rewardArm, runRetro, startExperiment,
  updateExperiments,
} from '../src/learning/index.js';
import { sampleBeta } from '../src/learning/bandits.js';
import { addRule, agentsForLesson, DEPT_RULES_SECTION, directiveKind, MAX_RULES, syncDirective } from '../src/learning/playbooks.js';
import { extractBannedTerm, FINANCE_KEY } from '../src/learning/heuristics.js';
import { applyDailyRewards, conclusionOf, MAX_NEW_LESSONS_PER_RETRO } from '../src/learning/retro.js';
import { financeView } from '../src/learning/data.js';
import { parsePlaybook } from '../src/runtime/playbook.js';
import { financeSnapshot, recordLedger } from '../src/sim/index.js';
import { parseNote, serializeNote } from '../src/learning/markdown.js';
import { round, slugify, safeFileName, tokenize } from '../src/learning/text.js';

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
      { id: 'msg_2', day: 2, customerId: 'c2', channel: 'email', subject: 'Merci', body: '…', intent: 'compliment', productId: 'prd_1', orderId: null, mood: 0.8, status: 'resolved', deadlineDay: 3, thread: [], resolution: 'ok', replyScore: 80, repliedDay: 2 },
      { id: 'msg_3', day: 1, customerId: 'c3', channel: 'email', subject: 'Question', body: '…', intent: 'question', productId: 'prd_1', orderId: null, mood: 0, status: 'replied', deadlineDay: 3, thread: [], resolution: null, replyScore: 60, repliedDay: 2 },
      { id: 'msg_4', day: 1, customerId: 'c4', channel: 'email', subject: 'Hier', body: '…', intent: 'question', productId: 'prd_1', orderId: null, mood: 0, status: 'resolved', deadlineDay: 2, thread: [], resolution: null, replyScore: 10, repliedDay: 1 },
    );
    const t: Task = {
      id: 'tsk_1', kind: 'write_pdf', title: 'Rédiger', dept: 'studio', assignee: 'elise', createdBy: 'system', missionId: null, dependsOn: [], status: 'done',
      priority: 2, dayCreated: 1, dayDone: 2, progress: 1, workLeft: 0, attempts: 1, reviewer: null, reviews: [], input: {}, output: null, deliverableIds: [], log: [],
    };
    world.company.tasks.push(t, { ...t, id: 'tsk_2', dayDone: 1 });
    world.company.lessons.push({ id: 'les_1', day: 2, topic: 'ads', insight: 'x', evidence: 'y', confidence: 0.5, source: 'nora', appliesTo: [], notePath: 'lecons/x.md' });
    // activity text is never parsed any more (a score in a feed line must not count)
    world.activity.push({ id: 'a1', day: 2, tick: 3, at: 0, agentId: 'ines', kind: 'message', text: 'Inès répond à Paul (score 5/100)' });

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
  });

  it('sums the STORED signed amounts: payment holds move cash only, reversals keep their sign (cauchemar day 46/53 bug)', () => {
    const world = makeWorld();
    const sim = { recordLedger, financeSnapshot };
    world.day = 1;
    sim.recordLedger(world, { type: 'capital', amount: 500, memo: 'capital' });
    sim.recordLedger(world, { type: 'revenue', amount: 900, memo: 'ventes' });
    world.day = 46;
    sim.recordLedger(world, { type: 'ad_spend', amount: -187.08, memo: 'pub' });
    sim.recordLedger(world, { type: 'platform_fee', amount: -607.2, memo: 'réserve', ref: 'hold:evt_8478' });
    const k46 = computeDailyKpi(world, 46);
    expect(k46.profit).toBeCloseTo(-187.08, 2); // the hold is not a loss
    expect(k46.cash).toBeCloseTo(500 + 900 - 187.08 - 607.2, 2); // …but the cash is frozen
    expect(k46.cash).toBeCloseTo(sim.financeSnapshot(world).cash, 2);
    expect(k46.cumulativeProfit).toBeCloseTo(sim.financeSnapshot(world).profit, 2);
    world.day = 50;
    sim.recordLedger(world, { type: 'creator_payout', amount: 120, memo: 'requalification', ref: 'reversal:prt_1' });
    sim.recordLedger(world, { type: 'scam_loss', amount: -120, memo: 'arnaque', ref: 'prt_1' });
    expect(computeDailyKpi(world, 50).profit).toBeCloseTo(0, 2); // the 120 € left exactly once
    world.day = 53;
    sim.recordLedger(world, { type: 'revenue', amount: 39, memo: 'vente' });
    sim.recordLedger(world, { type: 'platform_fee', amount: 607.2, memo: 'libération', ref: 'hold:release:53' });
    const k53 = computeDailyKpi(world, 53);
    expect(k53.profit).toBeCloseTo(39, 2); // the release is not a gain either (was −603,20 €)
    expect(k53.revenue).toBe(39);
    expect(k53.cash).toBeCloseTo(sim.financeSnapshot(world).cash, 2); // was 1 214,40 € below the CFO's cash
    expect(k53.cash).toBeCloseTo(500 + 900 - 187.08 + 39, 2);
    expect(k53.cumulativeProfit).toBeCloseTo(900 - 187.08 + 39, 2);
    expect(computeDailyKpi(world, 46).cash).toBeCloseTo(k46.cash, 2); // a past day keeps its close
  });

  it('attributes refunds by Order.refundedDay and reads reply scores from the messages (fallback: support task output)', () => {
    const world = makeWorld();
    world.market.orders.push(
      { ...order('ord_a', 1), refunded: true, refundedDay: 3 },
      { ...order('ord_b', 2), refunded: true, chargeback: true, refundedDay: 3 },
      { ...order('ord_c', 2), refunded: true, refundedDay: 4 },
    );
    world.ledger.push(entry(3, 'refund', -19, 'ord_a'), entry(3, 'refund', -19, 'ord_b'), entry(3, 'chargeback', -34, 'ord_b'), entry(4, 'refund', -19, 'ord_c'));
    expect(computeDailyKpi(world, 3).refunds).toBe(2);
    expect(computeDailyKpi(world, 4).refunds).toBe(1);
    expect(computeDailyKpi(world, 2).refunds).toBe(0);
    // older saves (no replyScore on messages): the reply_inbox task output of the day
    const t: Task = {
      id: 'tsk_r', kind: 'reply_inbox', title: 'Répondre', dept: 'support', assignee: 'ines', createdBy: 'system', missionId: null, dependsOn: [], status: 'done',
      priority: 2, dayCreated: 5, dayDone: 5, progress: 1, workLeft: 0, attempts: 1, reviewer: null, reviews: [], input: {},
      output: { replies: [{ messageId: 'm1', tone: 'concis', score: 90 }, { messageId: 'm2', tone: 'chaleureux', score: 70 }] }, deliverableIds: [], log: [],
    };
    world.company.tasks.push(t);
    expect(computeDailyKpi(world, 5).avgReplyScore).toBe(80);
    expect(computeDailyKpi(world, 6).avgReplyScore).toBe(0);
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
    expect(updateExperiments(world)).toEqual([]); // nothing to conclude: only one variant has data
    const e = world.company.experiments[0]!;
    expect(e.status).toBe('cancelled');
    expect(e.results['19']).toEqual({ n: 40, value: 0.95 });
    expect(e.results['9']).toEqual({ n: 0, value: 0 });
    expect(e.winner).toBeNull();
  });

  it('expires after 7 days with data on every variant, even short of the sample', () => {
    const world = makeWorld();
    startExperiment(world, { day: 1, owner: 'emma', hypothesis: '19 € rapporte plus que 9 €', dimension: 'price', variants: ['9', '19'], metric: 'cvr' });
    world.company.products[0]!.priceHistory = [{ day: 1, price: 9 }, { day: 2, price: 19 }];
    world.market.adStats.push(stat(1, 'crt_1', 3000, 90, 40, 2, 20), stat(2, 'crt_1', 3000, 90, 40, 2, 40));
    world.day = 8;
    const [e] = updateExperiments(world);
    expect(e!.status).toBe('concluded');
    expect(e!.endDay).toBe(8);
  });

  it('scopes product experiments to their niche (explicit or inferred from the hypothesis)', () => {
    const world = makeWorld();
    const other: Product = { ...product(), id: 'prd_2', nicheId: 'chiot', title: 'Propreté du chiot en 14 jours' };
    world.company.products.push(other);
    world.company.creatives.push({ ...creative('crt_9', 'stat', 'Chiot propre en 14 jours', { status: 'approved', reason: null, day: 1 }), productId: 'prd_2' });
    const inferred = startExperiment(world, { day: 1, owner: 'emma', hypothesis: `Sur « ${product().title} », le hook histoire bat le hook chiffre choc en CTR`, dimension: 'hook_style', variants: ['story', 'stat'], metric: 'ctr' });
    expect(inferred.nicheId).toBe('sommeil');
    const explicit = startExperiment(world, { day: 1, owner: 'emma', nicheId: 'chiot', hypothesis: 'Le hook chiffre choc bat histoire', dimension: 'hook_style', variants: ['story', 'stat'], metric: 'ctr' });
    expect(explicit.nicheId).toBe('chiot');
    expect(startExperiment(world, { day: 1, owner: 'emma', hypothesis: 'Un ton concis résout mieux', dimension: 'support_tone', variants: ['concis', 'chaleureux'], metric: 'resolution' }).nicheId).toBeNull();
    // the other niche's "stat" ad is huge: it must not leak into the sommeil experiment
    world.market.adStats.push(stat(1, 'crt_1', 3500, 140, 100, 4, 20), stat(1, 'crt_2', 3100, 31, 25, 1, 20), { ...stat(1, 'crt_9', 20000, 2000, 1500, 60, 50), productId: 'prd_2' });
    updateExperiments(world);
    expect(inferred.results.stat).toEqual({ n: 3100, value: 0.01 });
    expect(inferred.winner).toBe('story');
    expect(explicit.results.stat).toEqual({ n: 20000, value: 0.1 });
    expect(explicit.results.story!.n).toBe(0);
    // an old save without the field: inferred at compute time
    const legacy = { ...inferred, id: 'exp_old', status: 'running' as const, winner: null, endDay: null };
    delete (legacy as { nicheId?: string | null }).nicheId;
    world.company.experiments.push(legacy);
    updateExperiments(world);
    expect(legacy.results.stat!.n).toBe(3100);
  });

  it('support-tone experiments only count the replies sent since they started, with the tone actually used', () => {
    const world = makeWorld();
    world.day = 10;
    // all-time bandit: lots of old "chaleureux" replies (the old code reused these and concluded on day one)
    world.company.bandits.support_tone = [
      { key: 'chaleureux', alpha: 80, beta: 5, pulls: 82, reward: 78 },
      { key: 'concis', alpha: 40, beta: 15, pulls: 52, reward: 40 },
    ];
    const e = startExperiment(world, { day: 10, owner: 'emma', hypothesis: 'Un ton concis résout mieux les tickets', dimension: 'support_tone', variants: ['concis', 'chaleureux'], metric: 'resolution' });
    expect(updateExperiments(world)).toEqual([]);
    expect(e.results).toEqual({ concis: { n: 0, value: 0 }, chaleureux: { n: 0, value: 0 } });
    const replies: { messageId: string; tone: string; score: number }[] = [];
    for (let i = 0; i < 24; i++) {
      const tone = i % 2 === 0 ? 'concis' : 'chaleureux';
      const score = tone === 'concis' ? 90 : 70;
      const day = i < 4 ? 9 : 10 + (i % 3); // 4 replies before the start must be ignored
      replies.push({ messageId: `m${i}`, tone, score });
      world.market.inbox.push({
        id: `m${i}`, day, customerId: `c${i}`, channel: 'email', subject: 'Q', body: '…', intent: 'question', productId: 'prd_1', orderId: null,
        mood: 0, status: 'resolved', deadlineDay: day + 2, thread: [], resolution: null, replyScore: score, repliedDay: day,
      });
    }
    world.company.tasks.push({
      id: 'tsk_reply', kind: 'reply_inbox', title: 'Répondre', dept: 'support', assignee: 'ines', createdBy: 'system', missionId: null, dependsOn: [], status: 'done',
      priority: 2, dayCreated: 9, dayDone: 12, progress: 1, workLeft: 0, attempts: 1, reviewer: null, reviews: [], input: {}, output: { replies }, deliverableIds: [], log: [],
    });
    world.day = 12;
    updateExperiments(world);
    expect(e.results.concis).toEqual({ n: 10, value: 90 });
    expect(e.results.chaleureux).toEqual({ n: 10, value: 70 });
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
    // the confirmed lesson's insight numbers are refreshed (not only its evidence), in the playbooks too
    const hookLesson = world.company.lessons.find((l) => l.insight.startsWith('Privilégier le hook « story »'))!;
    expect(hookLesson.key).toBe('pub-hook-sommeil');
    expect(hookLesson.insight).toContain('3,90 %'); // (200 + 190) / 10 000 impressions
    expect(hookLesson.insight).not.toContain('4,00 %');
    expect(hookLesson.evidence).toMatch(/jours 1 à 2/);
    expect(hookLesson).toMatchObject({ day: 1, changedDay: 2 }); // learned on day 1, what it says now dates from day 2
    expect(world.company.playbooks.sarah).toContain(hookLesson.insight);
    expect(world.company.playbooks.sarah!.some((r) => r.includes('4,00 %'))).toBe(false);
    const hookNote = await brain.read(hookLesson.notePath);
    expect(hookNote?.body.startsWith(`> ${hookLesson.insight}`)).toBe(true);
    expect(hookNote?.body).toContain('## Historique');
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

describe('runRetro: idempotence, playbook notes and lesson hygiene', () => {
  const pullsOf = (w: WorldState) => Object.values(w.company.bandits).flat().reduce((s, a) => s + a.pulls, 0);

  it('never re-rewards the bandits for a day already retro-ed, even after a save / reload (lastRetroDay)', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    expect(world.company.lastRetroDay).toBe(1);
    const pulls = pullsOf(world);
    expect(pulls).toBeGreaterThan(0);
    const reloaded = JSON.parse(JSON.stringify(world)) as WorldState; // a WeakMap keyed on the object would not survive this
    await runRetro(reloaded, stubEngine(), brain, []);
    expect(pullsOf(reloaded)).toBe(pulls);
    expect(reloaded.company.lessons).toHaveLength(world.company.lessons.length);
  });

  it('keeps the seed department notes and maintains a "Règles en vigueur" section; writes every agent note', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const seed = (await brain.read('playbooks/Playbook Growth.md'))!;
    expect(seed.body).toContain('## Règles de départ');
    expect(seed.body).not.toContain(DEPT_RULES_SECTION);
    await runRetro(world, stubEngine(), brain, []);
    const day1 = (await brain.read('playbooks/Playbook Growth.md'))!;
    expect(day1.title).toBe(seed.title);
    expect(day1.tags).toEqual(expect.arrayContaining(seed.tags));
    expect(day1.body.startsWith(seed.body.trimEnd())).toBe(true); // seed text untouched, section below it
    expect(day1.body).toContain(DEPT_RULES_SECTION);
    expect(day1.body).toContain('Ne jamais écrire « garanti »');
    expect(day1.links).toEqual(expect.arrayContaining(['Léo', 'Sarah', 'Adam', "Canaux d'acquisition"]));
    // the seed vault ships department notes only: every agent still gets playbooks/<Prénom>.md on the first retro
    for (const a of world.company.agents) expect(await brain.read(`playbooks/${a.name}.md`), a.name).not.toBeNull();
    // day 2: the section is replaced, never stacked, and the seed is still there
    world.day = 2;
    world.company.creatives.push(creative('crt_5', 'pov', 'Sommeil miracle', { status: 'rejected', reason: 'Allégation interdite : « miracle »', day: 2 }));
    await runRetro(world, stubEngine(), brain, []);
    const day2 = (await brain.read('playbooks/Playbook Growth.md'))!;
    expect(day2.body.split(DEPT_RULES_SECTION)).toHaveLength(2);
    expect(day2.body.startsWith(seed.body.trimEnd())).toBe(true);
    expect(day2.body).toContain('Ne jamais écrire « miracle »');
    expect(day2.body).toContain('(jour 2)');
  });

  it('caps new lessons per evening, stores Lesson.key and never duplicates a key', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const words = [
      'Planifier les briefs créatifs le lundi matin', 'Archiver chaque storyboard validé dans le cerveau', 'Relire les titres à voix haute avant publication',
      'Grouper les réponses clients par intention', 'Vérifier les liens de téléchargement chaque semaine', 'Comparer deux couvertures avant impression',
      'Noter les objections entendues pendant les appels', 'Limiter les réunions quotidiennes à quinze minutes', 'Documenter chaque refus de modération',
      'Préparer un modèle de rapport hebdomadaire',
    ];
    const chatty = {
      mode: 'claude',
      async extractLessons(input: { heuristicLessons: LessonDraft[] }) {
        return [
          ...input.heuristicLessons,
          ...words.map((w, i) => ({ topic: 'process', insight: `${w}.`, evidence: `${i + 2} essais`, confidence: 0.5, appliesToRoles: [] })),
        ];
      },
      async dailyMemo() { return 'Mémo.'; },
    } as unknown as ContentEngine;
    const day1 = await runRetro(world, chatty, brain, []);
    expect(day1.length).toBeLessThanOrEqual(MAX_NEW_LESSONS_PER_RETRO + 1);
    expect(day1.some((l) => l.insight.includes('« garanti »'))).toBe(true); // critical first
    expect(world.company.lessons.every((l) => typeof l.key === 'string' && l.key.length > 0)).toBe(true);
    for (let d = 2; d <= 5; d++) {
      world.day = d;
      const fresh = await runRetro(world, chatty, brain, []);
      expect(fresh.length).toBeLessThanOrEqual(MAX_NEW_LESSONS_PER_RETRO + 1);
    }
    const keys = world.company.lessons.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(world.company.lessons.filter((l) => words.some((w) => l.insight === `${w}.`))).toHaveLength(words.length); // all of them, spread over evenings
  });

  it('tells a revision (new conclusion) from a confirmation (fresher numbers, another runner-up)', () => {
    const hook = (w: string, l: string, a: string, b: string) => `Privilégier le hook « ${w} » (x) sur « Sommeil » : CTR ${a} % contre ${b} % pour « ${l} » (y).`;
    expect(conclusionOf(hook('mistake', 'pov', '3,99', '1,81'))).toBe(conclusionOf(hook('mistake', 'before_after', '3,78', '2,15')));
    expect(conclusionOf(hook('mistake', 'pov', '3,99', '1,81'))).not.toBe(conclusionOf(hook('story', 'pov', '3,99', '1,81')));
    expect(conclusionOf('Prix cible « 29 » sur « A » : 0,59 € par visiteur contre 0,10 € à 39 €.')).not.toBe(conclusionOf('Prix cible « 24 » sur « A » : 0,61 € par visiteur.'));
    expect(conclusionOf('Prix cible « 29 » sur « A » : 0,59 € par visiteur.')).toBe(conclusionOf('Prix cible « 29 » sur « A » : 0,71 € par visiteur contre 0,47 €.'));
    expect(conclusionOf('Mode survie : trésorerie sous 30 %.')).not.toBe(conclusionOf('Rentable sur 7 jours : augmenter les budgets.'));
  });

  it('keeps one finance-state lesson, revised when the situation changes (no contradictory rules)', async () => {
    const world = makeWorld();
    world.company.creatives = [];
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    world.day = 3;
    world.ledger.push(entry(1, 'capital', 500), entry(3, 'ad_spend', -400));
    await runRetro(world, stubEngine(), brain, []);
    const survival = world.company.lessons.find((l) => l.key === FINANCE_KEY)!;
    expect(survival.insight).toMatch(/^Mode survie/);
    expect(world.company.playbooks.gabriel).toContain(survival.insight);
    world.day = 10;
    world.ledger.push(entry(10, 'revenue', 2000));
    await runRetro(world, stubEngine(), brain, []);
    const finance = world.company.lessons.filter((l) => l.key === FINANCE_KEY);
    expect(finance).toHaveLength(1);
    expect(finance[0]!.insight).toMatch(/^Rentable sur 7 jours/);
    expect(world.company.playbooks.gabriel!.some((r) => r.startsWith('Mode survie'))).toBe(false);
    expect(world.company.playbooks.gabriel).toContain(finance[0]!.insight);
    expect((await brain.read(finance[0]!.notePath))?.body).toContain('Révision — jour 10');
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

  it('promotions follow one level scale: reviewed work only, never down, skipped at the cap, not twice in a row', async () => {
    const { levelForXp, MAX_LEVEL } = await import('../src/learning/review.js');
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(1_000_000)).toBe(MAX_LEVEL);
    const world = makeWorld();
    world.day = 7;
    const reviewed = (assignee: string, count: number) => {
      for (let i = 0; i < count; i++) {
        world.company.tasks.push({
          id: `tsk_${assignee}_${i}`, kind: 'write_sales_page', title: 'Page', dept: 'boutique', assignee, createdBy: 'camille', missionId: null, dependsOn: [], status: 'done', priority: 2,
          dayCreated: 6, dayDone: 6, progress: 1, workLeft: 0, attempts: 0, reviewer: 'clara', reviews: [{ by: 'clara', day: 6, verdict: 'approve', notes: [] }], input: {}, output: null, deliverableIds: [], log: [],
        });
      }
    };
    const set = (id: string, perf: Partial<AgentState['perf']>, over: Partial<AgentState> = {}) => {
      const a = world.company.agents.find((x) => x.id === id)!;
      Object.assign(a.perf, perf);
      Object.assign(a, over);
      return a;
    };
    // Raw volume: 130 tasks nobody reviewed, best score of the team.
    const volume = set('adam', { done: 130, approved: 0, rejected: 0, failed: 0, score: 100 }, { level: 4 });
    for (let i = 0; i < 12; i++) {
      world.company.tasks.push({
        id: `tsk_vol_${i}`, kind: 'post_organic', title: 'Post', dept: 'growth', assignee: 'adam', createdBy: 'camille', missionId: null, dependsOn: [], status: 'done', priority: 3,
        dayCreated: 6, dayDone: 6, progress: 1, workLeft: 0, attempts: 0, reviewer: null, reviews: [], input: {}, output: null, deliverableIds: [], log: [],
      });
    }
    const worker = set('sarah', { done: 6, approved: 6, rejected: 0, failed: 0 }, { level: 3 });
    reviewed('sarah', 6);
    // An old save above the scale, and an agent at the cap: neither moves.
    const veteran = set('leo', { done: 40, approved: 30, rejected: 0, failed: 0 }, { level: 22, xp: 2400 });
    const capped = set('elise', { done: 40, approved: 30, rejected: 0, failed: 0 }, { level: MAX_LEVEL, xp: 2300 });
    const brain = createBrainVault(await tempPaths());
    await brain.init();

    const lines = await performanceReview(world, brain);
    const promotions = lines.filter((l) => l.startsWith('Promotion :'));
    expect(promotions.some((l) => l.includes('Sarah'))).toBe(true);
    expect(promotions.some((l) => l.includes('6 livrables validés'))).toBe(true);
    expect(promotions.some((l) => /Adam|Léo|Élise/.test(l))).toBe(false);
    expect(volume.level).toBe(4);
    expect(worker.level).toBe(4);
    expect(veteran.level).toBe(22);
    expect(capped.level).toBe(MAX_LEVEL);
    // The next week the same agent waits: promotions go to whoever earned one since.
    world.day = 14;
    reviewed('sarah', 0);
    for (const t of world.company.tasks) if (t.assignee === 'sarah') { t.dayDone = 13; t.reviews[0]!.day = 13; }
    set('sarah', { approved: 12 });
    const next = (await performanceReview(world, brain)).filter((l) => l.startsWith('Promotion :'));
    expect(next.some((l) => l.includes('Sarah'))).toBe(false);
    const note = await brain.read('rh/revue-semaine-2.md');
    expect(note?.body).toMatch(/validés en relecture depuis la dernière promotion/);
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
  it('replaces same directives, keeps MAX_RULES at most and drops the weakest', () => {
    const world = makeWorld();
    world.company.playbooks.clara = ['Niveau de promesse max « 0.6 »', 'Commencer bas pour obtenir les premiers avis.'];
    expect(addRule(world, 'clara', 'Niveau de promesse max « 0.4 » sur les pages de vente : la survente fait rembourser.')).toBe('replaced');
    expect(world.company.playbooks.clara![0]).toMatch(/« 0\.4 »/);
    expect(world.company.playbooks.clara).toHaveLength(2);
    expect(addRule(world, 'clara', 'Niveau de promesse max « 0.4 » sur les pages de vente : la survente fait rembourser.')).toBe('present');

    world.company.lessons.push(
      { id: 'les_a', day: 1, topic: 'pricing', insight: 'Prix cible « 19 » sur « A » : forte preuve.', evidence: '', confidence: 0.9, source: 'nora', appliesTo: [], notePath: 'lecons/a.md' },
      { id: 'les_b', day: 2, topic: 'pricing', insight: 'Prix cible « 24 » sur « A » : faible preuve.', evidence: '', confidence: 0.3, source: 'nora', appliesTo: [], notePath: 'lecons/b.md' },
    );
    expect(addRule(world, 'clara', 'Prix cible « 19 » sur « A » : forte preuve.')).toBe('added');
    expect(addRule(world, 'clara', 'Prix cible « 24 » sur « A » : faible preuve.')).toBe('skipped'); // weaker rule of the same niche
    expect(world.company.playbooks.clara!.filter((r) => r.startsWith('Prix cible'))).toHaveLength(1);

    for (let i = 0; i < MAX_RULES + 3; i++) addRule(world, 'clara', `Règle libre numéro ${i}`);
    const pb = world.company.playbooks.clara!;
    expect(pb).toHaveLength(MAX_RULES);
    expect(pb).toContain('Prix cible « 19 » sur « A » : forte preuve.'); // 0.9 survives the 0.55 seed rules
    expect(pb[pb.length - 1]).toBe(`Règle libre numéro ${MAX_RULES + 2}`);
  });

  it('an overflow drops prose before a directive, even a better-supported prose', () => {
    const world = makeWorld();
    const rules = Array.from({ length: MAX_RULES }, (_, i) => `Privilégier le hook « pov » sur « Niche ${i} »`);
    world.company.playbooks.leo = [...rules];
    world.company.lessons.push({ id: 'les_p', day: 1, topic: 'ads', insight: 'Une observation sûre, sans directive.', evidence: '', confidence: 0.7, source: 'nora', appliesTo: ['leo'], notePath: 'lecons/p.md' });
    world.company.playbooks.leo.unshift('Une observation sûre, sans directive.');
    addRule(world, 'leo', 'Une autre règle libre.');
    expect(world.company.playbooks.leo).toHaveLength(MAX_RULES);
    expect(world.company.playbooks.leo).not.toContain('Une observation sûre, sans directive.');
    expect(world.company.playbooks.leo.filter((r) => r.startsWith('Privilégier')).length).toBeGreaterThanOrEqual(MAX_RULES - 1);
    expect(world.company.lessons.at(-1)!.appliesTo).not.toContain('leo'); // evicted: it can come back when confirmed
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

// ───────────────────────────── KPI ↔ ledger invariant on a real headless company ─────────────────────────────

describe('KPI / ledger invariant over a real 60-day headless company', () => {
  const RUNS: { difficulty: 'cauchemar' | 'normal' | 'facile'; seed: number }[] = [
    { difficulty: 'cauchemar', seed: 1 }, // the lead's run: payment hold on day 46, released day 53
    { difficulty: 'normal', seed: 7 },
    { difficulty: 'facile', seed: 42 },
  ];

  for (const { difficulty, seed } of RUNS) {
    it(`${difficulty} seed ${seed}: kpi.cash = Σ ledger, cumulativeProfit = Σ non-capital non-hold entries, no NaN`, async () => {
      const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
      const minds = (await import('../src/minds/index.js')) as unknown as {
        createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine;
      };
      const paths = await tempPaths();
      const world = createWorld(defaultScenario({ seed, difficulty, mindMode: 'heuristic', horizonDays: 60 }), `test-invariant-${difficulty}-${seed}`);
      const company = new Company(world, { paths, engine: minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed }), brain: createBrainVault(paths) });
      const closes = new Map<number, number>();
      let forced = false;
      await company.runDays(60, (kpi) => {
        // the day is closed: what the CFO sees now is that day's close
        closes.set(kpi.day, financeSnapshot(world).cash);
        // every run must go through a payment hold and its release: force one if the market did not roll it
        if (kpi.day === 25 && !world.ledger.some((e) => e.ref?.startsWith('hold:')) && !forced) {
          forced = true;
          world.market.modifiers.paymentHoldUntilDay = world.day + 7;
          recordLedger(world, { type: 'platform_fee', amount: -Math.max(5, Math.round(financeSnapshot(world).cash * 0.3)), memo: 'Réserve (test)', ref: 'hold:test' });
        }
      });
      const kpis = world.company.kpis;
      expect(kpis.length).toBeGreaterThanOrEqual(55);
      const holds = world.ledger.filter((e) => e.ref?.startsWith('hold:'));
      expect(holds.some((e) => e.amount < 0)).toBe(true);
      expect(holds.some((e) => e.amount > 0)).toBe(true); // released
      expect(world.ledger.every((e) => Number.isFinite(e.amount))).toBe(true);
      for (const k of kpis) {
        for (const [field, v] of Object.entries(k)) expect(Number.isFinite(v), `jour ${k.day} ${field}`).toBe(true);
        const upTo = world.ledger.filter((e) => e.day <= k.day);
        const cash = upTo.reduce((s, e) => s + e.amount, 0);
        const profit = upTo.filter((e) => e.type !== 'capital' && !e.ref?.startsWith('hold:')).reduce((s, e) => s + e.amount, 0);
        const dayProfit = upTo.filter((e) => e.day === k.day && e.type !== 'capital' && !e.ref?.startsWith('hold:')).reduce((s, e) => s + e.amount, 0);
        expect(Math.abs(k.cash - cash), `jour ${k.day} trésorerie`).toBeLessThanOrEqual(0.011);
        expect(Math.abs(k.cumulativeProfit - profit), `jour ${k.day} profit cumulé`).toBeLessThanOrEqual(0.011);
        expect(Math.abs(k.profit - dayProfit), `jour ${k.day} profit du jour`).toBeLessThanOrEqual(0.011);
        const close = closes.get(k.day);
        if (close !== undefined) expect(Math.abs(k.cash - close), `jour ${k.day} = financeSnapshot à la clôture`).toBeLessThanOrEqual(0.011);
      }
      const f = financeSnapshot(world);
      for (const v of [f.cash, f.revenue, f.refunds, f.adSpend, f.fees, f.compute, f.otherCosts, f.profit, f.profit7d, f.burn7d, f.roas7d]) expect(Number.isFinite(v)).toBe(true);
      const last = kpis.at(-1)!;
      expect(Math.abs(last.cumulativeProfit - f.profit)).toBeLessThanOrEqual(0.011);
      // lessons stay readable: few per evening, unique keys
      const perDay = new Map<number, number>();
      for (const l of world.company.lessons) perDay.set(l.day, (perDay.get(l.day) ?? 0) + 1);
      for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(MAX_NEW_LESSONS_PER_RETRO + 1);
      const keys = world.company.lessons.map((l) => l.key);
      expect(new Set(keys).size).toBe(keys.length);
    }, 240_000);
  }
});

// ───────────────────────────── directives: one value per slot ─────────────────────────────

describe('directive slots', () => {
  it('gives each niche its own slot, and the support tone a single one', () => {
    const world = makeWorld();
    const a = 'Privilégier le hook « pov » (POV) sur « Chat qui griffe » : CTR 3 %.';
    const b = 'Privilégier le hook « mistake » (Erreur) sur « Propreté du chiot » : CTR 5 %.';
    expect(directiveKind(a)).not.toBe(directiveKind(b));
    expect(addRule(world, 'sarah', a)).toBe('added');
    expect(addRule(world, 'sarah', b)).toBe('added');
    expect(world.company.playbooks.sarah).toEqual(expect.arrayContaining([a, b]));
    // same niche: same slot
    const c = 'Privilégier le hook « story » (Histoire) sur « Chat qui griffe » : CTR 4 %.';
    expect(addRule(world, 'sarah', c)).toBe('replaced');
    expect(world.company.playbooks.sarah).not.toContain(a);
    expect(world.company.playbooks.sarah).toEqual(expect.arrayContaining([b, c]));
    // another directive on the same niche has its own slot, a rule without scope too
    expect(directiveKind('Privilégier le format « carousel » (x) sur « Chat qui griffe » : CTR 4 %.')).not.toBe(directiveKind(c));
    expect(directiveKind('Privilégier le hook « story »')).not.toBe(directiveKind(c));
    // the tone never has a scope
    expect(directiveKind('Ton support « concis » : score 80/100.')).toBe(directiveKind('Ton support « chaleureux » : il gagne l’expérience.'));
    // « sur les pages de vente » is not a niche
    expect(directiveKind('Niveau de promesse max « 0.4 » sur les pages de vente : x.')).toBe(directiveKind('Niveau de promesse max « 0.6 »'));
  });

  it('reads a niche exactly like the runtime, including a price still to test', () => {
    const toTest = 'Prix cible « 29 » sur « Sommeil » à tester : 7 % des visiteurs achètent déjà à 24 €.';
    expect(directiveKind(toTest)).toBe(directiveKind('Prix cible « 24 » sur « Sommeil » : 0,60 € par visiteur.'));
    expect(parsePlaybook([toTest], 'Sommeil').targetPrice).toBe(29);
    expect(parsePlaybook([toTest], 'Chiot').targetPrice).toBeNull();
  });

  it('a price lesson still to test applies to its niche only', async () => {
    const world = makeWorld();
    world.company.creatives = world.company.creatives.filter((c) => c.review.status === 'approved');
    world.market.adStats.push(stat(1, 'crt_1', 9000, 300, 200, 16, 50));
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const lessons = await runRetro(world, stubEngine(), brain, []);
    const price = lessons.find((l) => l.key === 'prix-sommeil')!;
    expect(price.insight).toMatch(/^Prix cible « 24 » sur « Sommeil de bébé \(6-12 mois\) » à tester : /);
    expect(parsePlaybook([price.insight], 'Propreté du chiot').targetPrice).toBeNull();
    expect(parsePlaybook([price.insight], 'Sommeil de bébé (6-12 mois)').targetPrice).toBe(24);
  });

  it('syncDirective leaves one value of a slot across every playbook', () => {
    const world = makeWorld();
    const rule = 'Ton support « chaleureux » : il gagne l’expérience.';
    world.company.playbooks = {
      ines: ['Répondre vite.', 'Ton support « concis » : score 80/100.', 'Ton support « formel »'],
      clara: ['Ton support « formel »'],
      leo: ['Rien à voir.', 'Privilégier le hook « story »'],
      adam: [rule, 'Ton support « concis »'],
    };
    expect(syncDirective(world, rule).sort()).toEqual(['adam', 'clara', 'ines']);
    expect(world.company.playbooks).toEqual({
      ines: ['Répondre vite.', rule],
      clara: [rule],
      leo: ['Rien à voir.', 'Privilégier le hook « story »'],
      adam: [rule],
    });
    expect(syncDirective(world, 'Une règle libre')).toEqual([]);
  });
});

describe('runRetro: an experiment settles a directive', () => {
  const hookRules = (world: WorldState) => Object.values(world.company.playbooks).flat().filter((r) => r.startsWith('Privilégier le hook'));

  it('retires the observational lesson of the same niche and dimension, and observations cannot reopen it', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const observed = world.company.lessons.find((l) => l.key === 'pub-hook-sommeil')!;
    expect(observed.insight).toMatch(/« story »/);
    expect(world.company.playbooks.sarah).toContain(observed.insight);

    // the A/B test says the opposite, while the 14-day window of the observation still favours « story »
    world.day = 2;
    const e = startExperiment(world, { day: 2, owner: 'emma', nicheId: 'sommeil', hypothesis: 'Le chiffre choc bat l’histoire', dimension: 'hook_style', variants: ['story', 'stat'], metric: 'ctr' });
    world.market.adStats.push(stat(2, 'crt_1', 3500, 70, 50, 2, 20), stat(2, 'crt_2', 3500, 175, 120, 5, 20));
    await runRetro(world, stubEngine(), brain, []);
    expect(e.winner).toBe('stat');
    const active = world.company.lessons.filter((l) => l.insight.startsWith('Privilégier le hook'));
    expect(active).toHaveLength(1);
    expect(active[0]!.insight).toMatch(/^Privilégier le hook « stat »/);
    expect(world.company.retiredLessons?.map((l) => l.id)).toEqual([observed.id]);
    expect(observed).toMatchObject({ supersededBy: active[0]!.id, retiredDay: 2 });
    expect(new Set(hookRules(world))).toEqual(new Set([active[0]!.insight]));
    expect(world.company.playbooks.sarah).toContain(active[0]!.insight);
    const note = (await brain.read(observed.notePath))!;
    expect(note.body).toContain('Leçon retirée le jour 2');
    expect(note.body).toContain('Retirée — jour 2');
    expect((await brain.read('journal/jour-002.md'))?.body).toContain('### Leçons retirées');
    expect(world.activity.some((a) => a.kind === 'lesson' && a.text.startsWith('Leçon retirée'))).toBe(true);

    // the observation keeps saying « story » on day 3: it does not come back
    world.day = 3;
    world.market.adStats.push(stat(3, 'crt_1', 5000, 200, 150, 6, 25), stat(3, 'crt_2', 5000, 40, 30, 1, 25));
    await runRetro(world, stubEngine(), brain, []);
    expect(world.company.lessons.filter((l) => l.insight.startsWith('Privilégier le hook'))).toHaveLength(1);
    expect(new Set(hookRules(world))).toEqual(new Set([active[0]!.insight]));
    expect(world.company.retiredLessons).toHaveLength(1); // no lesson created then retired again every evening
  });

  it('another niche keeps its own conclusion', async () => {
    const world = makeWorld();
    seedDay1(world);
    world.company.lessons.push({ key: 'pub-hook-chat', id: 'les_chat', day: 1, topic: 'ads', insight: 'Privilégier le hook « pov » (POV) sur « Chat qui griffe » : CTR 5 %.', evidence: '', confidence: 0.8, source: 'nora', appliesTo: ['sarah'], notePath: 'lecons/chat.md' });
    world.company.playbooks.sarah!.push('Privilégier le hook « pov » (POV) sur « Chat qui griffe » : CTR 5 %.');
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    expect(world.company.retiredLessons ?? []).toEqual([]);
    expect(world.company.playbooks.sarah!.filter((r) => r.startsWith('Privilégier le hook'))).toHaveLength(2);
  });

  it('the support tone stays one value: the experiment replaces the bandit lesson and the seed rules everywhere', async () => {
    const world = makeWorld();
    world.company.creatives = [];
    world.day = 5;
    world.company.bandits.support_tone = [
      { key: 'concis', alpha: 30, beta: 5, pulls: 30, reward: 27 },
      { key: 'chaleureux', alpha: 20, beta: 15, pulls: 30, reward: 18 },
    ];
    world.company.playbooks.clara = ['Ton support « formel »'];
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const bandit = world.company.lessons.find((l) => l.key === 'support-ton')!;
    expect(bandit.insight).toMatch(/^Ton support « concis »/);
    expect(world.company.playbooks.ines).toContain(bandit.insight);

    world.day = 6;
    const e = startExperiment(world, { day: 6, owner: 'emma', hypothesis: 'Un ton chaleureux résout mieux', dimension: 'support_tone', variants: ['concis', 'chaleureux'], metric: 'resolution' });
    const replies = Array.from({ length: 44 }, (_, i) => ({ messageId: `m${i}`, tone: i % 2 ? 'concis' : 'chaleureux', score: i % 2 ? 70 : 90 }));
    for (const r of replies) {
      world.market.inbox.push({
        id: r.messageId, day: 6, customerId: `c_${r.messageId}`, channel: 'email', subject: 'Q', body: '…', intent: 'question', productId: 'prd_1', orderId: null,
        mood: 0, status: 'resolved', deadlineDay: 8, thread: [], resolution: null, replyScore: r.score, repliedDay: 6,
      });
    }
    world.company.tasks.push({
      id: 'tsk_reply', kind: 'reply_inbox', title: 'Répondre', dept: 'support', assignee: 'ines', createdBy: 'system', missionId: null, dependsOn: [], status: 'done',
      priority: 2, dayCreated: 6, dayDone: 6, progress: 1, workLeft: 0, attempts: 1, reviewer: null, reviews: [], input: {}, output: { replies }, deliverableIds: [], log: [],
    });
    await runRetro(world, stubEngine(), brain, []);
    expect(e.winner).toBe('chaleureux');
    const tones = world.company.lessons.filter((l) => l.insight.startsWith('Ton support'));
    expect(tones).toHaveLength(1);
    expect(tones[0]!.insight).toMatch(/^Ton support « chaleureux »/);
    expect(world.company.retiredLessons?.map((l) => l.key)).toEqual(['support-ton']);
    const rules = Object.values(world.company.playbooks).flat().filter((r) => r.startsWith('Ton support'));
    expect(new Set(rules)).toEqual(new Set([tones[0]!.insight]));
    expect(rules.length).toBeGreaterThanOrEqual(2); // Inès and Clara
  });
});

// ───────────────────────────── announced outage days ─────────────────────────────

describe('announced outage days', () => {
  /** Days 1-2 sell well (ROAS 1.52), day 3 is an announced outage: lots of traffic, nothing can sell. */
  function outageWorld(): WorldState {
    const world = makeWorld();
    world.day = 3;
    world.company.creatives = world.company.creatives.filter((c) => c.review.status === 'approved');
    world.market.events.push({ id: 'evt_o', day: 2, kind: 'platform_outage', title: 'Panne de la boutique annoncée', description: 'Panne du paiement le jour 3.', severity: 'danger', refs: { day: 3 } });
    world.market.adStats.push(stat(1, 'crt_1', 3000, 90, 60, 2, 25), stat(2, 'crt_1', 3000, 90, 60, 2, 25), stat(3, 'crt_1', 12000, 480, 400, 0, 60));
    world.ledger.push(entry(1, 'capital', 500), entry(1, 'ad_spend', -25), entry(1, 'revenue', 38), entry(2, 'ad_spend', -25), entry(2, 'revenue', 38), entry(3, 'ad_spend', -60));
    return world;
  }

  it('stay out of the conversion, ROAS and niche windows: no performance lesson, the evidence says so', async () => {
    const world = outageWorld();
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    const lessons = await runRetro(world, stubEngine(), brain, []);
    expect(lessons.some((l) => /Réécrire la page|Couper les pubs/.test(l.insight))).toBe(false);
    const niche = lessons.find((l) => l.topic === 'niche')!;
    expect(niche.insight).toMatch(/^Garder et intensifier/);
    expect(niche.evidence).toContain('jours 1 à 3 (hors panne du jour 3)');
    // the day's own KPI stays what happened
    expect(world.company.kpis[0]).toMatchObject({ day: 3, revenue: 0, adSpend: 60 });
  });

  it('pay no bandit reward', async () => {
    const world = outageWorld();
    expect(applyDailyRewards(world, 3)).toBe(0);
    expect(world.company.lastRetroDay).toBe(3);
    expect(Object.values(world.company.bandits).flat().reduce((s, a) => s + a.pulls, 0)).toBe(0);
    world.company.lastRetroDay = 0;
    expect(applyDailyRewards(world, 2)).toBeGreaterThan(0); // a normal day still does
  });

  it('do not count in experiments', () => {
    const world = outageWorld();
    const e = startExperiment(world, { day: 1, owner: 'emma', nicheId: 'sommeil', hypothesis: 'Promesse', dimension: 'hook_style', variants: ['story', 'stat'], metric: 'cvr' });
    updateExperiments(world);
    expect(e.results.story).toEqual({ n: 120, value: round(4 / 120, 4) });
  });

  it('leave an « incident externe » note, a factual memo, and keep the day away from the engine', async () => {
    const world = outageWorld();
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    let seen: DailyKpi[] = [];
    let incidents: string[] = [];
    const engine = {
      mode: 'claude',
      async extractLessons(input: { kpis: DailyKpi[]; incidents: string[]; heuristicLessons: LessonDraft[] }) {
        seen = input.kpis;
        incidents = input.incidents;
        return input.heuristicLessons;
      },
      async dailyMemo() {
        return 'Priorité de demain : couper les pubs sous ROAS 0,8.';
      },
    } as unknown as ContentEngine;
    await runRetro(world, engine, brain, []);
    expect(seen.map((k) => k.day)).toEqual([]);
    expect(incidents[0]).toMatch(/^Incident externe : panne de paiement du jour 3, annoncée le jour 2/);
    const note = (await brain.read('journal/incident-externe-jour-003.md'))!;
    expect(note.title).toBe('Incident externe — panne de paiement du jour 3');
    expect(note.tags).toContain('incident-externe');
    expect(note.body).toContain('60,00');
    expect(note.body).toContain('400');
    expect(note.body).toContain('évitables'); // the outage is not our fault, running ads through it is
    expect(note.links).toContain('jour-003');
    const journal = (await brain.read('journal/jour-003.md'))!.body;
    expect(journal).toContain('Incident externe');
    expect(journal).toContain('[[incident-externe-jour-003]]');
    expect(journal).not.toContain('couper les pubs sous ROAS');
    expect(world.activity.some((a) => a.text.includes('en incident externe'))).toBe(true);
    // the lesson of the evening stays on the days that could sell
    expect(world.company.lessons.every((l) => !/jour 3\b/.test(l.insight))).toBe(true);
  });

  it('a normal day writes no incident note', async () => {
    const world = makeWorld();
    seedDay1(world);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    expect(await brain.read('journal/incident-externe-jour-001.md')).toBeNull();
  });
});

// ───────────────────────────── runway ─────────────────────────────

describe('runway in lessons', () => {
  it('is never negative, and the launch costs are not a burn', async () => {
    const world = makeWorld();
    world.company.creatives = [];
    world.day = 5;
    world.ledger.push(entry(1, 'capital', 100), entry(5, 'ad_spend', -300));
    expect(financeView(world, 5).runwayDays).toBe(0);
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const lesson = world.company.lessons.find((l) => l.key === FINANCE_KEY)!;
    expect(lesson.evidence).toContain('runway 0 jours');
    expect(lesson.evidence).not.toMatch(/runway -/);

    const fresh = makeWorld();
    fresh.ledger.push(entry(1, 'capital', 500), entry(1, 'tool_subscription', -60, 'setup'), entry(1, 'platform_fee', -1, 'fixed:1'));
    expect(financeView(fresh, 1)).toMatchObject({ burn7d: 1, runwayDays: 439 });
  });
});

// ───────────────────────────── scam lessons ─────────────────────────────

describe('hidden truth in lessons', () => {
  it('an escalated message is described by what we can read, never by its hidden intent', async () => {
    const world = makeWorld();
    world.day = 3;
    world.market.inbox.push({
      id: 'm1', day: 1, customerId: 'c1', channel: 'email', subject: 'Débité deux fois', body: '…', intent: 'arnaque', productId: 'prd_1', orderId: 'ord_1',
      mood: -0.4, status: 'escalated', deadlineDay: 3, thread: [], resolution: null,
    });
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const lesson = world.company.lessons.find((l) => l.key === 'support-delai')!;
    expect(lesson.evidence).toContain('Débité deux fois');
    expect(lesson.evidence).not.toContain('arnaque');
  });
});

describe('scam lessons', () => {
  it('a false claim paid to a real buyer teaches to check the order, a stranger scam stays a stranger scam', async () => {
    const world = makeWorld();
    world.market.orders.push(order('ord_f', 1));
    world.ledger.push(entry(1, 'capital', 500), { ...entry(1, 'scam_loss', -19, 'ord_f'), memo: 'Fausse réclamation payée : Débité deux fois' });
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const lesson = world.company.lessons.find((l) => l.key === 'support-fausse-reclamation')!;
    expect(lesson.insight).toMatch(/^Vérifier la commande avant de rembourser/);
    expect(lesson.evidence).toContain('Débité deux fois');
    expect(world.company.lessons.some((l) => l.key === 'support-arnaque')).toBe(false);

    world.day = 2;
    world.ledger.push({ ...entry(2, 'scam_loss', -49, 'msg_1'), memo: 'Arnaque au support' });
    await runRetro(world, stubEngine(), brain, []);
    expect(world.company.lessons.some((l) => l.key === 'support-arnaque')).toBe(true);
  });

  it('a scammer without a red flag leaves the numbers to watch, never a harmless flag as a rule', async () => {
    const world = makeWorld();
    world.market.creators.push({ id: 'crt_s', handle: 'woof_clean', nicheId: 'sommeil', followers: 42000, avgViews: 2100, engagement: 0.02, askUpfront: 105, askCommission: 0.15, redFlags: ['répond surtout le soir'] });
    world.market.partnerships.push({ id: 'prt_s', creatorId: 'crt_s', productId: 'prd_1', day: 1, upfront: 105, commission: 0.15, status: 'scam', sales: 0, revenue: 0 });
    const brain = createBrainVault(await tempPaths());
    await brain.init();
    await runRetro(world, stubEngine(), brain, []);
    const lesson = world.company.lessons.find((l) => l.key === 'partenariat-arnaque')!;
    expect(lesson.insight).toMatch(/^Ne jamais verser d'avance/);
    expect(lesson.insight).not.toContain('répond surtout le soir');
    expect(lesson.evidence).toContain('5 % de vues par abonné');
    expect(lesson.evidence).toContain('50 € pour 1 000 vues');
  });
});
