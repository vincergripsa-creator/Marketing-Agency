import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  Activity, AgentState, ChapterContent, CompanySnapshot, DailyKpi, FinanceSnapshot, InboxMessage, LedgerEntry, Product, Task, WorldState,
} from '../src/shared.js';
import { buildConfig, mergeEnv, parseEnvFile, parseMindMode } from '../src/api/env.js';
import { isEntryPoint } from '../src/api/entry.js';
import { errorStatus, HttpError, isSafeRelativePath, mimeFor, parseControl, safeResolve, sanitizeScenario } from '../src/api/http.js';
import {
  estimateCashProfit, flushSaves, isValidRunId, listRuns, loadWorld, makeRunId, newRunId, saveWorld, scheduleSave,
} from '../src/api/persist.js';
import { createAgencyServer, devLandingPage, type SessionLike } from '../src/api/server.js';
import { SseHub, sseFrame, type SnapshotSource } from '../src/api/sse.js';
import {
  buildSnapshot, DEFAULT_LIMITS, estimateFinance, LIVE_LIMITS, serializeLiveSnapshot, serializeSnapshot, shrinkValue, SNAPSHOT_BUDGET_BYTES, taskStatsOf, TIGHT_LIMITS, trimContent, trimInbox, trimTasks,
} from '../src/api/trim.js';
import { LEAN_ORG, LEGACY_ORG } from '../src/runtime/org/constants.js';
import { minRunCash } from '../src/runtime/org/payroll.js';
import { FEES, minStartingCash } from '../src/sim/balance.js';
import { banditInsights, CliError, fmtEur, kpiRow, parseCliArgs, tableHeader, verdict } from '../src/cli.js';

// ───────────────────────────── module doubles for the live session ─────────────────────────────
// The session is tested against contract-shaped fakes of runtime/sim/learning/minds, and core's
// paths point to a temp folder so nothing is written into the repo's runs/.

const fake = vi.hoisted(() => ({
  tmp: `${process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'}/agency-session-${process.pid}`,
  failSteps: 0,
  stepDelayMs: 4,
  inFlight: 0,
  maxInFlight: 0,
  steps: 0,
  missions: [] as string[],
  approvals: [] as string[],
  makeWorld: null as null | ((runId: string) => WorldState),
}));

vi.mock('../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/index.js')>();
  const { join: j } = await import('node:path');
  return {
    ...actual,
    repoRoot: () => fake.tmp,
    runPaths: (runId: string) => ({ root: j(fake.tmp, 'runs', runId), brain: j(fake.tmp, 'runs', runId, 'brain'), files: j(fake.tmp, 'runs', runId, 'files') }),
  };
});

vi.mock('../src/runtime/index.js', () => {
  const PHASES = ['morning', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'market', 'evening'] as const;
  class Company {
    readonly world: WorldState;
    constructor(world: WorldState, _opts: unknown) { this.world = world; }
    async step() {
      fake.inFlight++;
      fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
      try {
        await new Promise((r) => setTimeout(r, fake.stepDelayMs));
        if (fake.failSteps > 0) { fake.failSteps--; throw new Error('panne simulée'); }
        const w = this.world;
        const phase = PHASES[w.tick]!;
        w.phase = phase;
        w.tick += 1;
        if (w.tick >= 12) { w.tick = 0; w.day += 1; w.phase = 'morning'; }
        fake.steps++;
        return { day: w.day, tick: w.tick, phase, status: w.status, activities: 0 };
      } finally {
        fake.inFlight--;
      }
    }
    async runDays(n: number) { for (let i = 0; i < n * 12; i++) await this.step(); }
    skipTick() { this.world.tick += 1; }
    async giveMission(text: string) { fake.missions.push(text); return 'mis_42'; }
    async chat(_agentId: string, text: string) { return `Bien reçu : ${text}`; }
    approve(taskId: string, ok: boolean) { fake.approvals.push(`${taskId}:${ok}`); }
  }
  return {
    Company,
    defaultScenario: (o: Record<string, unknown> = {}) => ({
      name: 'Défaut', companyName: 'Pixel Agency', seed: 42, startingCash: 500, horizonDays: 60, difficulty: 'normal', mindMode: 'auto',
      founderApproval: false, chargeCompute: true, maxComputeEur: 3, goal: { targetProfit: 1000, byDay: 60 }, ...o,
    }),
    createWorld: (scenario: WorldState['scenario'], runId: string) => {
      const w = fake.makeWorld!(runId);
      return { ...w, scenario, day: 1, tick: 0, phase: 'morning', status: 'paused', activity: [] };
    },
  };
});

vi.mock('../src/sim/index.js', async () => {
  // Not through api/trim.js, as it was: that module reads the runtime now (ui §3.2), which binds this very mock, and the two would wait for each other.
  const { summarizeLedger } = await import('../src/core/ledger.js');
  const { announcedOutageDays } = await import('../src/sim/outage.js');
  return {
    financeSnapshot: (w: WorldState) => {
      const { capital: _capital, ...finance } = summarizeLedger(w.ledger ?? [], w.day ?? 0, announcedOutageDays(w));
      return finance;
    },
    recordLedger: (w: WorldState, e: { type: LedgerEntry['type']; amount: number; memo: string; ref?: string | null }) => {
      const entry = { id: `led_x${w.ledger.length}`, day: w.day, type: e.type, amount: -Math.abs(e.amount), memo: e.memo, ref: e.ref ?? null };
      w.ledger.push(entry);
      return entry;
    },
  };
});

vi.mock('../src/learning/index.js', () => ({
  createBrainVault: () => {
    const notes = new Map<string, { path: string; title: string; tags: string[]; body: string; links: string[]; updatedDay: number }>();
    notes.set('00 - Accueil.md', { path: '00 - Accueil.md', title: 'Cerveau', tags: ['index'], body: '# Cerveau', links: ['Règle du un'], updatedDay: 0 });
    return {
      init: async () => undefined,
      list: async () => [...notes.values()],
      read: async (p: string) => notes.get(p) ?? null,
      search: async () => [],
      write: async () => undefined,
      append: async () => undefined,
      graph: async () => ({ nodes: [{ id: '00 - Accueil', title: 'Cerveau', group: 'index' }], edges: [] }),
    };
  },
}));

vi.mock('../src/minds/index.js', () => ({
  createContentEngine: (opts: { mode: string; maxComputeEur: number; onUsage?: (u: unknown) => void }) => {
    let calls = 0;
    let cost = 0;
    return {
      mode: opts.mode === 'claude' ? 'claude' : 'heuristic',
      maxComputeEur: opts.maxComputeEur,
      usage: () => ({ calls, inputTokens: calls * 100, outputTokens: calls * 50, costEur: cost, fallbacks: 0 }),
      /** test hook: pretend a Claude call happened */
      fakeCall: (eur: number) => {
        calls++;
        cost += eur;
        opts.onUsage?.({ tier: 'haiku', model: 'm', inputTokens: 100, outputTokens: 50, costEur: eur, purpose: 'test' });
      },
    };
  },
}));

// ───────────────────────────── fixture ─────────────────────────────

function chapter(i: number): ChapterContent {
  return {
    title: `Étape ${i + 1} : le rituel du soir`,
    intro: `Pourquoi l'étape ${i + 1} change tout pour les parents épuisés.`,
    paragraphs: Array.from({ length: 6 }, (_, k) => `Paragraphe ${k + 1} du chapitre ${i + 1}, avec des détails concrets tirés des commentaires.`),
    steps: ['Baisser la lumière à 19 h', 'Bain tiède de 5 minutes', 'Même berceuse chaque soir'],
    example: 'Julie, maman de Léo (9 mois), a gagné 2 h de sommeil en 10 jours.',
    checklist: ['Lumière tamisée', 'Chambre à 19 °C'],
    visual: { type: 'timeline', title: 'La soirée type', labels: ['19 h', '19 h 30', '20 h'], values: [] },
  };
}

function product(id: string, sales: number): Product {
  return {
    id, nicheId: 'niche_sommeil', title: `Bébé dort enfin (${id})`, subtitle: 'La méthode douce pour les 6-12 mois', audience: 'Parents de bébés de 6 à 12 mois',
    problem: 'Bébé se réveille toutes les 2 h', price: 19, status: 'live', version: 1,
    content: {
      title: 'Bébé dort enfin', subtitle: 'La méthode douce', audience: 'Parents de bébés de 6 à 12 mois', promise: 'Des nuits de 6 h en 3 semaines',
      introduction: ['Tu te lèves 4 fois par nuit.', 'Ce guide a été fait pour toi.', 'Voici ce que tu auras à la fin.', 'Quatrième paragraphe.'],
      chapters: Array.from({ length: 5 }, (_, i) => chapter(i)),
      bonus: chapter(9),
      nextStep: { title: 'La suite est ici', text: 'Le guide des siestes.', upsellProductId: null },
      wordCount: 5400,
    },
    design: null, salesPage: null, files: { pdf: `files/${id}/v1/guide.pdf`, cover: `files/${id}/v1/cover.svg`, salesPage: `files/${id}/v1/sales-page.html` },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: 2, launchedDay: 4,
    stats: {
      views: 900, sales, revenue: sales * 19, refunds: 1, refundAmount: 19, rating: 4.4, upsellSales: 0,
      reviews: Array.from({ length: 40 }, (_, k) => ({ id: `rev_${k}`, day: 5, customerId: `cus_${k}`, rating: 5 as const, text: 'Enfin des nuits complètes !' })),
    },
    priceHistory: [{ day: 4, price: 14 }, { day: 8, price: 19 }],
  };
}

function agent(id: string, name: string): AgentState {
  return {
    id, name, role: 'Rédactrice', dept: 'studio', isChief: false, tier: 'sonnet', persona: 'Précise et chaleureuse.', skills: ['rédaction'],
    tools: ['brain.read'], taskKinds: ['write_pdf'],
    avatar: { skin: '#f1c27d', hair: '#3b2a1a', shirt: '#7c5cff', pants: '#222', hairStyle: 1, accessory: 'glasses' },
    status: 'idle', place: 'studio', currentTaskId: null, energy: 80, level: 2, xp: 120,
    perf: { done: 3, approved: 3, rejected: 0, failed: 0, score: 82 }, bubble: null,
    roleId: 'ghostwriter', gender: 'f', founder: false, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null,
  };
}

function task(i: number, status: Task['status'], dayDone: number | null): Task {
  return {
    id: `tsk_${i}`, kind: 'write_pdf', title: `Tâche ${i}`, dept: 'studio', assignee: 'ag_margaux', createdBy: 'system', missionId: null,
    dependsOn: [], status, priority: 2, dayCreated: 1, dayDone, progress: status === 'done' ? 1 : 0.3, workLeft: 0, attempts: 1,
    reviewer: null, reviews: [], input: { productId: 'prd_1', blob: 'x'.repeat(5000) }, output: status === 'done' ? { ok: true, words: Array.from({ length: 50 }, (_, k) => `m${k}`) } : null,
    deliverableIds: [], log: Array.from({ length: 30 }, (_, k) => `ligne ${k}`),
  };
}

function inboxMsg(i: number, status: InboxMessage['status']): InboxMessage {
  return {
    id: `msg_${i}`, day: 1 + Math.floor(i / 10), customerId: `cus_${i}`, channel: 'email', subject: `Sujet ${i}`, body: 'Bonjour, je n\'ai pas reçu le PDF.',
    intent: 'non_recu', productId: 'prd_1', orderId: null, mood: -0.2, status, deadlineDay: 9,
    thread: Array.from({ length: 20 }, (_, k) => ({ from: 'customer' as const, text: `message ${k}`, day: 2 })), resolution: null,
  };
}

function kpi(day: number): DailyKpi {
  return {
    day, cash: 500 + day * 10, revenue: 57, adSpend: 20, profit: 10, cumulativeProfit: day * 10, sales: 3, refunds: 0, impressions: 4000,
    clicks: 80, ctr: 0.02, cvr: 0.04, roas: 2.85, cac: 6.6, openTickets: 2, avgReplyScore: 74, liveProducts: 1, tasksDone: 12, lessonsLearned: 1,
  };
}

function makeWorld(runId = 'run-20261030-120000'): WorldState {
  const day = 30;
  const tasks: Task[] = [];
  for (let i = 0; i < 500; i++) tasks.push(task(i, i % 2 ? 'done' : 'failed', 1 + (i % 29)));
  for (let i = 500; i < 520; i++) tasks.push(task(i, 'pending', null));
  const ledger: LedgerEntry[] = [{ id: 'led_0', day: 1, type: 'capital', amount: 500, memo: 'Capital de départ', ref: null }];
  for (let i = 1; i < 300; i++) {
    ledger.push(i % 3 === 0
      ? { id: `led_${i}`, day: 1 + (i % 29), type: 'ad_spend', amount: -5, memo: 'Pub TikTok', ref: null }
      : { id: `led_${i}`, day: 1 + (i % 29), type: 'revenue', amount: 19, memo: 'Vente', ref: null });
  }
  const activity: Activity[] = Array.from({ length: 450 }, (_, i) => ({ id: `act_${i}`, day: 1 + (i % 30), tick: i % 12, at: 1_700_000_000_000 + i, agentId: null, kind: 'thought', text: `Activité ${i}` }));
  return {
    version: 2, runId, createdAt: '2026-10-30T12:00:00.000Z',
    scenario: {
      name: 'Test', companyName: 'Pixel Agency', seed: 42, startingCash: 500, horizonDays: 60, difficulty: 'normal', mindMode: 'heuristic',
      founderApproval: false, chargeCompute: false, maxComputeEur: 3, goal: { targetProfit: 1000, byDay: 60 },
    },
    day, tick: 3, phase: 'work', rngState: 123, idCounter: 9999,
    mind: { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    status: 'running',
    company: {
      name: 'Pixel Agency',
      agents: [agent('ag_margaux', 'Margaux'), agent('ag_noam', 'Noam')],
      departments: [],
      tasks,
      missions: Array.from({ length: 100 }, (_, i) => ({ id: `mis_${i}`, day: 1, from: 'ag_noam', text: `Mission ${i}`, ownerId: 'ag_noam', taskIds: [], status: i === 3 ? 'open' as const : 'done' as const })),
      products: [product('prd_1', 34), product('prd_2', 5)],
      creatives: [], campaigns: [],
      deliverables: Array.from({ length: 400 }, (_, i) => ({ id: `dlv_${i}`, kind: i % 40 === 0 ? 'pdf' as const : 'ad_storyboard' as const, title: `Livrable ${i}`, productId: 'prd_1', creativeId: null, path: `files/prd_1/v1/guide.pdf`, createdBy: 'ag_margaux', day: 1, quality: 80 })),
      research: { trends: [{ nicheId: 'niche_sommeil', name: 'Sommeil de bébé', audience: 'Parents', category: 'parentalité', searchInterest: 70, tiktokBuzz: 60, competitionHint: 'moyenne', sampleTitles: [] }], voc: {}, competitors: {}, shortlist: [] },
      lessons: Array.from({ length: 300 }, (_, i) => ({ id: `les_${i}`, day: 1 + (i % 30), topic: 'ads' as const, insight: `Le hook « stat » bat « question » (${i})`, evidence: 'CTR 3,1 % vs 1,4 %', confidence: (i % 10) / 10, source: 'ag_noam', appliesTo: [], notePath: `lecons/l-${i}.md` })),
      experiments: [],
      bandits: { 'hook_style:niche_sommeil': [{ key: 'stat', alpha: 9, beta: 3, pulls: 10, reward: 7 }, { key: 'question', alpha: 3, beta: 8, pulls: 9, reward: 2 }] },
      playbooks: { ag_margaux: ['Ne jamais écrire « chaque bébé est différent »'] },
      kpis: Array.from({ length: day }, (_, i) => kpi(i + 1)),
      chats: { ag_margaux: Array.from({ length: 60 }, (_, i) => ({ id: `cht_${i}`, day: 1, from: i % 2 ? 'founder' as const : 'ag_margaux', text: `Message ${i}`, at: i })) },
      pendingApprovals: [],
    },
    market: {
      niches: [{
        id: 'niche_sommeil', name: 'Sommeil de bébé', audience: 'Parents', problem: 'Réveils nocturnes', category: 'parentalité', keywords: ['sommeil'],
        demand: 0.7, wtp: { min: 9, sweet: 19, max: 29 }, competition: 0.4, tiktokAffinity: 0.8, cpmBase: 7, hookAffinity: { stat: 1.5 }, formatAffinity: {},
        refundSensitivity: 0.3, complianceRisk: 0.4, seasonality: [1, 1, 1, 1, 1, 1, 1],
        voc: { nicheId: 'niche_sommeil', depth: 'deep', pains: [], phrases: [], objections: [], desiredOutcomes: [], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [] },
        competitors: [],
      }],
      customers: Array.from({ length: 77 }, (_, i) => ({ id: `cus_${i}`, name: `Client ${i}`, email: `c${i}@exemple.fr`, archetype: 'normal' as const, patience: 0.5, orders: [], satisfaction: 0 })),
      orders: Array.from({ length: 250 }, (_, i) => ({ id: `ord_${i}`, day: 1 + (i % 30), customerId: 'cus_1', productId: 'prd_1', price: 19, source: 'ads' as const, campaignId: null, creatorId: null, refunded: false, chargeback: false })),
      inbox: [...Array.from({ length: 140 }, (_, i) => inboxMsg(i, 'resolved')), inboxMsg(140, 'open'), inboxMsg(141, 'open')].map((m, i) => (i === 5 ? { ...m, status: 'open' as const } : m)),
      adStats: Array.from({ length: 30 }, (_, i) => ({
        day: i + 1, campaignId: 'cmp_1', creativeId: 'crv_1', productId: 'prd_1', spend: 10, impressions: 1500, clicks: 30, ctr: 0.02, cpc: 0.33, cpm: 6.6,
        landingViews: 25, purchases: 1, revenue: 19, roas: 1.9, frequency: 1.2,
        comments: Array.from({ length: 15 }, (_, k) => ({ author: `@user${k}`, text: 'Génial', tone: 'positive' as const })),
      })),
      organicPosts: Array.from({ length: 50 }, (_, i) => ({ id: `org_${i}`, day: 1 + (i % 30), productId: 'prd_1', hook: 'POV : il est 3 h du matin', hookStyle: 'pov' as const, format: 'text_slideshow' as const, views: 1000, likes: 50, clicks: 5, sales: 0, viral: false })),
      creators: [], partnerships: [],
      events: Array.from({ length: 60 }, (_, i) => ({ id: `evt_${i}`, day: 1 + (i % 30), kind: 'cpm_spike' as const, title: 'CPM en hausse', description: 'Les enchères montent.', severity: 'warn' as const })),
      modifiers: { cpmMultiplier: 1, cpmUntilDay: 0, paymentHoldUntilDay: 0, outageDay: 0 },
      adAccount: { strikes: 1, banned: false, bannedUntilDay: 0 },
      creativeImpressions: {},
    },
    ledger,
    activity,
  };
}

fake.makeWorld = makeWorld;

const FINANCE: FinanceSnapshot = {
  cash: 3000, revenue: 3800, refunds: 19, adSpend: 500, fees: 40, compute: 0, otherCosts: 0, profit: 2500, profit7d: 300,
  burn7d: 0, runwayDays: null, roas7d: 1.9, bankrupt: false,
};

// ───────────────────────────── env ─────────────────────────────

describe('env', () => {
  it('parses KEY=VALUE lines, comments, quotes, export and CRLF', () => {
    const vars = parseEnvFile([
      '\uFEFF# commentaire',
      'ANTHROPIC_API_KEY=sk-test-123',
      '',
      'export MIND_MODE = heuristic  # inline',
      'MODEL_OPUS="claude-opus-x # pas un commentaire"',
      "MODEL_HAIKU='haiku-y'",
      'PORT=5000\r',
      'EMPTY=',
      'not a line',
      'URL=http://x.test/#ancre',
    ].join('\n'));
    expect(vars).toEqual({
      ANTHROPIC_API_KEY: 'sk-test-123', MIND_MODE: 'heuristic', MODEL_OPUS: 'claude-opus-x # pas un commentaire',
      MODEL_HAIKU: 'haiku-y', PORT: '5000', EMPTY: '', URL: 'http://x.test/#ancre',
    });
  });

  it('lets process.env win over the file', () => {
    const merged = mergeEnv({ PORT: '5000', MIND_MODE: 'claude' }, { PORT: '6000', OTHER: undefined });
    expect(merged.PORT).toBe('6000');
    expect(merged.MIND_MODE).toBe('claude');
  });

  it('builds a config with defaults and rejects invalid values', () => {
    expect(buildConfig({})).toEqual({ port: 4317, apiKey: undefined, mindMode: 'auto', maxComputeEur: 3, models: {} });
    const c = buildConfig({ PORT: 'abc', ANTHROPIC_API_KEY: '  ', MIND_MODE: 'CLAUDE', MAX_COMPUTE_EUR: '1,5', MODEL_SONNET: 'sonnet-z' });
    expect(c.port).toBe(4317);
    expect(c.apiKey).toBeUndefined();
    expect(c.mindMode).toBe('claude');
    expect(c.maxComputeEur).toBe(1.5);
    expect(c.models).toEqual({ sonnet: 'sonnet-z' });
    expect(buildConfig({ PORT: '70000', MAX_COMPUTE_EUR: '-2' })).toMatchObject({ port: 4317, maxComputeEur: 3 });
    expect(parseMindMode('n importe quoi')).toBe('auto');
  });
});

// ───────────────────────────── http helpers ─────────────────────────────

describe('path traversal protection', () => {
  const base = resolve(tmpdir(), 'agency-base', 'run-1');

  it('resolves normal paths inside the base', () => {
    expect(safeResolve(base, 'files/prd_1/v1/guide.pdf')).toBe(join(base, 'files', 'prd_1', 'v1', 'guide.pdf'));
    expect(safeResolve(base, '/files/a%20b.svg')).toBe(join(base, 'files', 'a b.svg'));
    expect(safeResolve(base, 'files/./x.md')).toBe(join(base, 'files', 'x.md'));
  });

  it('rejects anything that escapes the base', () => {
    for (const bad of [
      '../world.json', 'files/../../secret.txt', '..%2F..%2Fsecret', '%2e%2e/%2e%2e/x', 'files\\..\\..\\x', 'C:/Windows/win.ini',
      'c:\\boot.ini', '/../x', 'a%00.pdf', '%E0%A4%A', '', '/', '..', 'files/..',
    ]) {
      expect(safeResolve(base, bad), bad).toBeNull();
    }
  });

  it('validates brain note paths and run ids', () => {
    expect(isSafeRelativePath('lecons/hook-stat.md')).toBe(true);
    expect(isSafeRelativePath('00 - Accueil.md')).toBe(true);
    expect(isSafeRelativePath('../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/abs.md')).toBe(false);
    expect(isSafeRelativePath('C:\\x.md')).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
    expect(isValidRunId('run-20261030-101500')).toBe(true);
    expect(isValidRunId('run-2-3')).toBe(true);
    expect(isValidRunId('../run')).toBe(false);
    expect(isValidRunId('a..b')).toBe(false);
    expect(isValidRunId('')).toBe(false);
  });

  it('maps mime types', () => {
    expect(mimeFor('guide.PDF')).toBe('application/pdf');
    expect(mimeFor('cover.svg')).toBe('image/svg+xml');
    expect(mimeFor('sales-page.html')).toContain('text/html');
    expect(mimeFor('note.md')).toContain('text/markdown');
    expect(mimeFor('x.png')).toBe('image/png');
    expect(mimeFor('x.json')).toContain('application/json');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
    expect(mimeFor('a.mp4')).toBe('video/mp4');
    expect(mimeFor('a.webm')).toBe('video/webm');
    expect(mimeFor('a.vtt')).toBe('text/vtt; charset=utf-8');
    expect(mimeFor('a.m4a')).toBe('audio/mp4');
    expect(mimeFor('a.mp3')).toBe('audio/mpeg');
    expect(mimeFor('a.wav')).toBe('audio/wav');
  });

  it('sanitises scenario bodies and control actions', () => {
    const s = sanitizeScenario({ startingCash: '1e9', difficulty: 'cauchemar', mindMode: 'claude', seed: 12.7, horizonDays: 3, evil: 'x', goal: { targetProfit: 2000, byDay: 45 }, founderApproval: 'yes' });
    expect(s).toEqual({ startingCash: 1_000_000, difficulty: 'cauchemar', mindMode: 'claude', seed: 12, horizonDays: 7, goal: { targetProfit: 2000, byDay: 45 } });
    expect(sanitizeScenario({ difficulty: 'impossible', companyName: '   ' })).toEqual({});
    expect(sanitizeScenario({ startingCash: minRunCash({ org: LEAN_ORG }) })).toEqual({ startingCash: minRunCash({ org: LEAN_ORG }) });
    expect(parseControl({ action: 'play', speed: 4 })).toEqual({ action: 'play', speed: 4 });
    expect(parseControl({ action: 'pause' })).toEqual({ action: 'pause' });
    expect(() => parseControl({ action: 'rewind' })).toThrow(HttpError);
    expect(() => parseControl({ action: 'play', speed: 3 })).toThrow(/Vitesse/);
  });

  it('refuses a budget that cannot pay the launch and a month of fixed costs and founders, in French', () => {
    const fixed = 30 * (FEES.boutiqueDaily + FEES.toolsDaily);
    expect(minStartingCash()).toBeGreaterThanOrEqual(FEES.setupCost + fixed);
    expect(minRunCash({ org: LEAN_ORG })).toBeGreaterThanOrEqual(FEES.setupCost + fixed + 30 * 5.7);
    expect(minRunCash({ org: LEAN_ORG })).toBe(280);
    for (const startingCash of [0, 50, 279.99, '40', -5]) {
      expect(() => sanitizeScenario({ startingCash })).toThrow(HttpError);
      expect(() => sanitizeScenario({ startingCash })).toThrow(/Budget de départ trop bas : il faut au moins 280 €/);
    }
    expect(() => sanitizeScenario({ startingCash: 40 })).toThrow(/60 € de frais de démarrage et 220 € de frais fixes et de salaires pour 30 jours/);
    expect(() => parseCliArgs(['--budget', '40'])).toThrow(/Budget de départ trop bas : il faut au moins 280 €/);
    expect(parseCliArgs(['--budget', '280']).budget).toBe(280);
  });

  it('keeps the old floor of 110 € for a team nobody pays', () => {
    expect(minRunCash({ org: LEGACY_ORG })).toBe(110);
    expect(minRunCash({ org: { ...LEAN_ORG, payroll: false } })).toBe(110);
    expect(minRunCash({})).toBe(110); // an older save, which is the legacy team
    expect(minRunCash({ org: { ...LEGACY_ORG, payroll: true } })).toBe(280); // the floor pays founders, and nobody else, on any team
    expect(sanitizeScenario({ startingCash: 110, org: { payroll: false } })).toEqual({ startingCash: 110, org: { ...LEAN_ORG, payroll: false } });
    expect(() => sanitizeScenario({ startingCash: 109, org: { payroll: false } })).toThrow(/il faut au moins 110 € \(60 € de frais de démarrage et 50 € de frais fixes pour 30 jours\)/);
    expect(() => sanitizeScenario({ startingCash: 110, org: 'gratuit' })).toThrow(/il faut au moins 280 €/);
    expect(parseCliArgs(['--budget', '110', '--no-payroll']).budget).toBe(110); // whichever comes first on the line
    expect(parseCliArgs(['--no-payroll', '--budget', '110']).budget).toBe(110);
    expect(() => parseCliArgs(['--budget', '110'])).toThrow(/il faut au moins 280 €/);
  });

  it('takes the V1 switches of a new scenario and never a control arm', () => {
    expect(sanitizeScenario({ org: { team: 'legacy31', autoHire: false, payroll: false, salary: 9 } })).toEqual({ org: LEGACY_ORG });
    expect(sanitizeScenario({ org: { team: 'mega', autoHire: 'non' } })).toEqual({ org: LEAN_ORG });
    expect(sanitizeScenario({ org: [] })).toEqual({});
    expect(sanitizeScenario({ talent: 'flat', openEnded: true })).toEqual({ talent: 'flat', openEnded: true });
    expect(sanitizeScenario({ talent: 'divin', openEnded: 'oui' })).toEqual({});
    expect(sanitizeScenario({ control: { noLearning: true } })).toEqual({});
  });

  it('detects the process entry module', () => {
    const file = resolve('src/api/server.ts');
    const url = pathToFileURL(file).href;
    expect(isEntryPoint(url, file)).toBe(true);
    expect(isEntryPoint(url, resolve('src/cli.ts'))).toBe(false);
    expect(isEntryPoint(url, undefined)).toBe(false);
  });
});

// ───────────────────────────── snapshot trimming ─────────────────────────────

describe('snapshot trimming', () => {
  const world = makeWorld();

  it('keeps unfinished tasks + the 200 most recent finished ones', () => {
    const tasks = trimTasks(world.company.tasks);
    expect(tasks.filter((t) => t.status === 'pending')).toHaveLength(20);
    const finished = tasks.filter((t) => t.status === 'done' || t.status === 'failed');
    expect(finished).toHaveLength(200);
    const minKept = Math.min(...finished.map((t) => t.dayDone ?? 0));
    const dropped = world.company.tasks.filter((t) => t.dayDone !== null && !tasks.some((k) => k.id === t.id));
    expect(Math.max(...dropped.map((t) => t.dayDone ?? 0))).toBeLessThanOrEqual(minKept);
    // original order preserved, logs and big inputs bounded
    const ids = tasks.map((t) => Number(t.id.slice(4)));
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(tasks[0]!.log.length).toBeLessThanOrEqual(DEFAULT_LIMITS.taskLog);
    expect(String(tasks[0]!.input.blob).length).toBeLessThanOrEqual(DEFAULT_LIMITS.stringMax + 1);
    expect(tasks[0]!.input.productId).toBe('prd_1');
  });

  it('applies every documented limit and never leaks the hidden truth', () => {
    const snap = buildSnapshot(world, FINANCE);
    expect(snap.company.deliverables.filter((d) => d.kind === 'ad_storyboard')).toHaveLength(250);
    expect(snap.company.deliverables.at(-1)!.id).toBe('dlv_399');
    expect(snap.company.lessons).toHaveLength(150);
    expect(snap.company.lessons.at(-1)!.id).toBe('les_299');
    expect(snap.company.chats.ag_margaux).toHaveLength(30);
    expect(snap.company.chats.ag_margaux!.at(-1)!.id).toBe('cht_59');
    expect(snap.company.missions.some((m) => m.id === 'mis_3')).toBe(true); // old but open
    expect(snap.market.inbox).toHaveLength(80);
    expect(snap.market.inbox.some((m) => m.id === 'msg_5')).toBe(true); // old but open
    expect(snap.market.inbox.at(-1)!.id).toBe('msg_141');
    expect(snap.market.inbox[0]!.thread.length).toBeLessThanOrEqual(DEFAULT_LIMITS.threadPerMessage);
    expect(new Set(snap.market.adStats.map((s) => s.day))).toEqual(new Set(Array.from({ length: 14 }, (_, i) => 17 + i)));
    expect(snap.market.organicPosts).toHaveLength(30);
    expect(snap.market.events).toHaveLength(40);
    expect(snap.market.orders).toHaveLength(100);
    expect(snap.market.customersCount).toBe(77);
    expect(snap.market.adAccount.strikes).toBe(1);
    expect(snap.ledger).toHaveLength(150);
    expect(snap.activity).toHaveLength(200);
    expect(snap.activity.at(-1)!.id).toBe('act_449');
    expect(snap.finance).toBe(FINANCE);
    expect(snap.godMode).toBeUndefined();
    expect('niches' in snap.market).toBe(false);
    expect('customers' in snap.market).toBe(false);
    expect(JSON.stringify(snap)).not.toContain('cpmBase');
  });

  it('trims product content to titles + intros (full text only for chapter 1)', () => {
    const snap = buildSnapshot(world, FINANCE);
    const c = snap.company.products[0]!.content!;
    expect(c.title).toBe('Bébé dort enfin');
    expect(c.promise).toBe('Des nuits de 6 h en 3 semaines');
    expect(c.chapters).toHaveLength(5);
    expect(c.chapters[0]!.paragraphs).toHaveLength(6);
    expect(c.chapters[0]!.steps).toHaveLength(3);
    for (const ch of c.chapters.slice(1)) {
      expect(ch.title).toMatch(/^Étape/);
      expect(ch.intro).not.toBe('');
      expect(ch.paragraphs).toEqual([]);
      expect(ch.steps).toEqual([]);
    }
    expect(c.bonus.paragraphs).toEqual([]);
    expect(c.introduction).toHaveLength(3);
    expect(snap.company.products[0]!.stats.reviews.length).toBeLessThanOrEqual(DEFAULT_LIMITS.reviewsPerProduct);
    // the world itself is untouched
    expect(world.company.products[0]!.content!.chapters[3]!.paragraphs).toHaveLength(6);
    expect(trimContent(null)).toBeNull();
  });

  it('adds godMode niches only when asked', () => {
    const snap = buildSnapshot(world, FINANCE, true);
    expect(snap.godMode!.niches).toEqual([{
      id: 'niche_sommeil', name: 'Sommeil de bébé', demand: 0.7, wtp: { min: 9, sweet: 19, max: 29 }, competition: 0.4, tiktokAffinity: 0.8, hookAffinity: { stat: 1.5 },
    }]);
  });

  it('stays under the size budget and tightens limits when needed', () => {
    const json = serializeSnapshot(world, FINANCE, false, { session: { playing: true } });
    expect(json.length).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
    expect(JSON.parse(json).session).toEqual({ playing: true });
    const huge = makeWorld();
    huge.activity = Array.from({ length: 600 }, (_, i) => ({ id: `act_${i}`, day: 1, tick: 0, at: i, agentId: null, kind: 'thought' as const, text: 'é'.repeat(3000) }));
    const tight = JSON.parse(serializeSnapshot(huge, FINANCE));
    expect(tight.activity.length).toBeLessThan(200);
  });

  it('survives an almost empty world', () => {
    const w = makeWorld();
    w.company.tasks = [];
    w.company.products = [];
    w.company.chats = {};
    w.market.inbox = [];
    w.market.adStats = [];
    w.ledger = [];
    w.activity = [];
    const snap = buildSnapshot(w, estimateFinance(w));
    expect(snap.company.tasks).toEqual([]);
    expect(snap.finance.cash).toBe(0);
    expect(snap.finance.roas7d).toBe(0);
    expect(trimInbox([])).toEqual([]);
    expect(shrinkValue({ a: { b: { c: { d: { e: 1 } } } } }, 10)).toEqual({ a: { b: { c: { d: '{…}' } } } });
  });

  it('estimates finance from the ledger', () => {
    const w = makeWorld();
    // 1..299: 99 multiples of 3 are ad spend (-5), the other 200 are sales (+19)
    expect(estimateCashProfit(w)).toEqual({ cash: 500 + 200 * 19 - 99 * 5, profit: 200 * 19 - 99 * 5, capital: 500 });
    const f = estimateFinance(w);
    expect(f.adSpend).toBe(495);
    expect(f.revenue).toBe(3800);
  });

  /** A run with a payment reserve still held, a released one, and a creator scam: payout, reversal, loss. */
  function moneyWorld(): WorldState {
    const w = makeWorld();
    const entry = (id: string, day: number, type: LedgerEntry['type'], amount: number, ref: string | null = null): LedgerEntry => ({ id, day, type, amount, memo: '', ref });
    w.day = 12;
    w.market.events = [];
    w.ledger = [
      entry('a', 1, 'capital', 500),
      entry('b', 1, 'tool_subscription', -60, 'setup'),
      entry('c', 3, 'revenue', 300),
      entry('d', 3, 'ad_spend', -40),
      entry('e', 3, 'payment_fee', -5),
      entry('f', 4, 'platform_fee', -30, 'hold:4'),
      entry('g', 8, 'platform_fee', 30, 'hold:4'),
      entry('h', 5, 'creator_payout', -100, 'prt_1'),
      entry('i', 5, 'creator_payout', 100, 'reversal:prt_1'),
      entry('j', 5, 'scam_loss', -100, 'prt_1'),
      entry('k', 9, 'refund', -19),
      entry('l', 10, 'platform_fee', -0.97, 'fixed:10'),
      entry('m', 11, 'platform_fee', -143.1, 'hold:11'),
    ];
    return w;
  }

  it('the ledger fallbacks read holds and reversals like the sim: a hold is never a cost, a reversal cancels its payout', async () => {
    const { financeSnapshot } = await vi.importActual<typeof import('../src/sim/finance.js')>('../src/sim/finance.js');
    const w = moneyWorld();
    const sim = financeSnapshot(w);
    expect(estimateFinance(w)).toEqual(sim);
    expect(sim).toMatchObject({ otherCosts: 160, fees: 5.97, refunds: 19, adSpend: 40, revenue: 300 });
    // 143,10 € held today: the cash is down by that much, the profit is not
    expect(sim.profit).toBe(75.03);
    expect(sim.cash).toBe(431.93);
    expect(estimateCashProfit(w)).toEqual({ cash: 431.93, profit: 75.03, capital: 500 });
    // once the reserve is released nothing is left of it
    w.ledger.push({ id: 'n', day: 12, type: 'platform_fee', amount: 143.1, memo: '', ref: 'hold:11' });
    expect(estimateFinance(w)).toEqual(financeSnapshot(w));
    expect(estimateFinance(w)).toMatchObject({ fees: 5.97, profit: 75.03, cash: 575.03 });
  });

  it('a snapshot that falls back on the ledger shows the same finance as the sim, outage days included', async () => {
    const { financeSnapshot } = await vi.importActual<typeof import('../src/sim/finance.js')>('../src/sim/finance.js');
    const w = moneyWorld();
    w.market.events = [{ id: 'evt_1', day: 2, kind: 'platform_outage', title: 'x', description: 'x', severity: 'warn', refs: { day: 3 } }];
    expect(estimateFinance(w)).toEqual(financeSnapshot(w));
  });
});

describe('what the UI may see', () => {
  const world = makeWorld();

  it('the inbox of a normal snapshot has no ground truth; god mode serves it apart', () => {
    const snap = buildSnapshot(world, FINANCE);
    expect(JSON.stringify(snap.market.inbox)).not.toContain('"intent"');
    expect(snap.godMode).toBeUndefined();
    const god = buildSnapshot(world, FINANCE, true);
    expect(JSON.stringify(god.market.inbox)).not.toContain('"intent"');
    expect(Object.keys(god.godMode!.intents)).toHaveLength(god.market.inbox.length);
    const first = world.market.inbox.find((m) => m.id === god.market.inbox[0]!.id)!;
    expect(god.godMode!.intents[first.id]).toBe(first.intent);
  });

  it('the live snapshot keeps open tasks whole, drops the payload of finished ones and the text of guides and ads', () => {
    const w = makeWorld();
    const open = w.company.tasks[0]!;
    open.status = 'awaiting_founder';
    open.input = { productId: 'prd_1', founderAsk: 'Payer '.repeat(30) };
    const done = w.company.tasks.find((t) => t.status === 'done')!;
    w.company.tasks.push({ ...done, id: 'tsk_recent', dayDone: 99, input: { productId: 'prd_1', blob: 'x'.repeat(500), nested: { a: 1 } }, output: { adCap: 12, note: 'n'.repeat(500), outline: { chapters: [] } } });
    w.company.products[0]!.salesPage = { headline: 'h', subheadline: 's', painBullets: [], solution: 'x'.repeat(900), chapterBlurbs: [], bonusBlurb: '', objections: [], guarantee: '', cta: 'c', hypeLevel: 0.4 };
    const live = JSON.parse(serializeLiveSnapshot(w, FINANCE)) as CompanySnapshot;
    expect(String(live.company.tasks.find((t) => t.id === open.id)!.input.founderAsk).length).toBeGreaterThan(100);
    const finished = live.company.tasks.find((t) => t.id === 'tsk_recent')!;
    expect(finished.input).toEqual({ productId: 'prd_1' });
    expect(finished.output).toEqual({ adCap: 12 });
    const p = live.company.products[0]!;
    expect(p.salesPage).toBeNull();
    expect(p.content!.chapters).toEqual([]);
    expect(p.content!.nextStep).toEqual(w.company.products[0]!.content!.nextStep);
    expect(serializeLiveSnapshot(w, FINANCE).length).toBeLessThan(serializeSnapshot(w, FINANCE).length);
  });

  it('keeps the hooks and feedback of a product in the world: no panel reads them, and at their caps they weigh 9 KB a product', () => {
    const w = makeWorld();
    const p = w.company.products[0]!;
    p.hooks = Array.from({ length: 60 }, (_, i) => ({ hook: `Accroche ${i}`, hookStyle: 'question' }));
    p.feedback = Array.from({ length: 30 }, (_, i) => ({ day: i, text: `Plainte ${i}`, quality: true }));
    const snapshots = [buildSnapshot(w, FINANCE), JSON.parse(serializeSnapshot(w, FINANCE)) as CompanySnapshot, JSON.parse(serializeLiveSnapshot(w, FINANCE)) as CompanySnapshot];
    for (const snap of snapshots) {
      expect(snap.company.products[0]).not.toHaveProperty('hooks');
      expect(snap.company.products[0]).not.toHaveProperty('feedback');
    }
    expect(p.hooks).toHaveLength(60);
    expect(p.feedback).toHaveLength(30);
  });

  it('counts tasks on the whole list, whatever the snapshot keeps of it', () => {
    const base = makeWorld().company.tasks[0]!;
    const task = (id: string, dept: Task['dept'], status: Task['status'], dayCreated: number, dayDone: number | null, kind: Task['kind'] = 'write_pdf'): Task => ({ ...base, id, dept, status, dayCreated, dayDone, kind });
    const tasks = [
      ...Array.from({ length: 500 }, (_, i) => task(`tsk_${i}`, 'studio', 'done', 1, 2)),
      task('a', 'growth', 'failed', 19, 20, 'produce_ad'),
      task('b', 'growth', 'cancelled', 20, 20, 'produce_ad'),
      task('c', 'growth', 'pending', 20, null, 'launch_campaign'),
      task('d', 'growth', 'done', 18, 20, 'launch_campaign'),
    ];
    const stats = taskStatsOf(tasks, 20);
    expect(stats.days.find((d) => d.day === 2)).toEqual({ day: 2, created: 0, done: 500, failed: 0, cancelled: 0 });
    expect(stats.days.at(-1)).toEqual({ day: 20, created: 2, done: 1, failed: 1, cancelled: 1 });
    expect(stats.days.map((d) => d.day)).toEqual([1, 2, 18, 19, 20]);
    expect(stats.depts.studio).toMatchObject({ days: [], kinds7d: {}, done: 500, avgDelayDays: 1 });
    expect(stats.depts.growth).toMatchObject({ done: 1, avgDelayDays: 2, kinds7d: { produce_ad: 2, launch_campaign: 2 } });
    expect(stats.depts.growth!.days.at(-1)).toEqual({ day: 20, created: 2, done: 1, failed: 1, cancelled: 1 });
    const w = makeWorld();
    w.company.tasks = tasks;
    const snap = buildSnapshot(w, FINANCE, false, TIGHT_LIMITS);
    expect(snap.company.tasks.filter((t) => t.status === 'done').length).toBeLessThanOrEqual(TIGHT_LIMITS.doneTasks);
    expect(snap.taskStats!.days.find((d) => d.day === 2)!.done).toBe(500);
  });
});

describe('what light views keep (scale §7.1, ui §3.1)', () => {
  const report = { overall: 82, specificity: 80, structure: 80, actionability: 80, humanTone: 80, design: 80, promiseMatch: 80, compliance: 90, issues: ['Une remarque.'], evaluator: 'heuristic' as const };
  const design = { palette: { bg: '#fff', primary: '#333', secondary: '#666', accent: '#f90', ink: '#111', soft: '#eee' }, motif: 'moon' as const, coverLayout: 'centered' as const, titleFont: 'Helvetica-Bold' as const, bodyFont: 'Helvetica' as const, seed: 1 };

  it('a guide on sale keeps what its card reads: the next step, the palette, the scores and its remarks', () => {
    const w = makeWorld();
    const p = w.company.products[0]!;
    Object.assign(p, { status: 'live', design, quality: report, salesQuality: report, brief: { angle: 'Le brief' }, pagePrint: 'empreinte' });
    for (const limits of [TIGHT_LIMITS, LIVE_LIMITS]) {
      const card = buildSnapshot(w, FINANCE, false, limits).company.products[0]!;
      expect(card.content!.nextStep).toEqual(p.content!.nextStep);
      expect(card.design).toEqual({ palette: design.palette });
      expect(card.quality).toMatchObject({ overall: 82, issues: ['Une remarque.'] });
      expect(card.quality).not.toHaveProperty('promiseMatch');
      expect(card.salesQuality).toBeNull();
      expect(card).not.toHaveProperty('brief');
      expect(card).not.toHaveProperty('pagePrint');
      expect(card.content!.title).toBe('');
    }
    expect(buildSnapshot(w, FINANCE, false, DEFAULT_LIMITS).company.products[0]).toMatchObject({ design, quality: report, salesQuality: report });
  });

  it('what a reviewer cannot let through stays on the card', () => {
    const w = makeWorld();
    const blocking = [{ dimension: 'compliance' as const, text: 'Promesse de santé.' }];
    Object.assign(w.company.products[0]!, { status: 'live', quality: { ...report, blocking } });
    expect(buildSnapshot(w, FINANCE, false, TIGHT_LIMITS).company.products[0]!.quality).toMatchObject({ overall: 82, issues: ['Une remarque.'], blocking });
  });

  it('a card keeps the six scores its bars draw, and nothing else of the report', () => {
    const w = makeWorld();
    const full = { ...report, specificity: 81, structure: 72, actionability: 63, humanTone: 54, design: 45, compliance: 36, promiseMatch: 90, evaluator: 'heuristic' as const };
    Object.assign(w.company.products[0]!, { status: 'live', quality: full });
    expect(buildSnapshot(w, FINANCE, false, TIGHT_LIMITS).company.products[0]!.quality).toEqual({ overall: full.overall, specificity: 81, structure: 72, actionability: 63, humanTone: 54, design: 45, compliance: 36, issues: full.issues });
    expect(buildSnapshot(w, FINANCE, false, LIVE_LIMITS).company.products[0]!.quality).toMatchObject({ specificity: 81, compliance: 36 });
  });

  it('the stream leaves the playbooks to the panel, GET /api/state keeps them', () => {
    const w = makeWorld();
    expect(w.company.playbooks).not.toEqual({});
    expect(buildSnapshot(w, FINANCE, false, LIVE_LIMITS).company.playbooks).toEqual({});
    expect(buildSnapshot(w, FINANCE, false, TIGHT_LIMITS).company.playbooks).toEqual(w.company.playbooks);
    expect(buildSnapshot(w, FINANCE, false, DEFAULT_LIMITS).company.playbooks).toEqual(w.company.playbooks);
  });

  it('no light view carries the VoC or the competitors: no panel reads them, the full view keeps them', () => {
    const w = makeWorld();
    w.company.research.voc = { niche_sommeil: { nicheId: 'niche_sommeil' } } as unknown as WorldState['company']['research']['voc'];
    w.company.research.competitors = { niche_sommeil: [] } as unknown as WorldState['company']['research']['competitors'];
    for (const limits of [TIGHT_LIMITS, LIVE_LIMITS]) {
      const { research } = buildSnapshot(w, FINANCE, false, limits).company;
      expect([research.voc, research.competitors]).toEqual([{}, {}]);
    }
    const { research } = buildSnapshot(w, FINANCE, false, DEFAULT_LIMITS).company;
    expect(research.voc).toEqual(w.company.research.voc);
    expect(research.competitors).toEqual(w.company.research.competitors);
  });

  it('guides, covers and reports stop at 120 in a light view, the latest ones, and leave the ad frames their own bound', () => {
    const w = makeWorld();
    const row = (id: string, kind: 'pdf' | 'ad_preview') => ({ id, kind, title: id, productId: 'prd_1', creativeId: null, path: 'files/x.pdf', createdBy: 'ag_margaux', day: 1, quality: 80 });
    w.company.deliverables = [...Array.from({ length: 300 }, (_, i) => row(`dlv_${i}`, 'pdf')), ...Array.from({ length: 200 }, (_, i) => row(`adf_${i}`, 'ad_preview'))];
    const shown = buildSnapshot(w, FINANCE, false, TIGHT_LIMITS).company.deliverables;
    expect(shown.filter((d) => d.kind === 'pdf')).toHaveLength(120);
    expect(shown.filter((d) => d.kind === 'pdf').at(-1)!.id).toBe('dlv_299');
    expect(shown.filter((d) => d.kind === 'ad_preview')).toHaveLength(TIGHT_LIMITS.deliverables);
    expect(buildSnapshot(w, FINANCE, false, LIVE_LIMITS).company.deliverables).toHaveLength(120);
    expect(buildSnapshot(w, FINANCE, false, DEFAULT_LIMITS).company.deliverables.filter((d) => d.kind === 'pdf')).toHaveLength(300);
  });

  const feed = (rows: number, chars: number): WorldState['activity'] => Array.from({ length: rows }, (_, i) => ({ id: `act_${i}`, day: 1, tick: 0, at: i, agentId: null, kind: 'thought' as const, text: 'x'.repeat(chars) }));

  it('a company of a year fits the tight limits: it keeps its playbooks and is never served the live view (scale §7.1)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = makeWorld('run-tight-fits');
    w.company.playbooks = { clara: ['Une règle apprise.'] };
    w.activity = feed(120, 9_000);
    expect((JSON.parse(serializeSnapshot(w, FINANCE)) as CompanySnapshot).company.playbooks).toEqual(w.company.playbooks);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('the budget is in bytes: French text over it in bytes goes to the next limits, even under it in characters', () => {
    const w = makeWorld('run-bytes');
    w.company.playbooks = { clara: ['Une règle apprise.'] };
    const budget = serializeSnapshot(w, FINANCE).length + 6000;
    const heavy = serializeSnapshot(w, FINANCE, false, { note: 'é'.repeat(4000) }, budget);
    expect(Buffer.byteLength(heavy)).toBeLessThanOrEqual(budget);
  });

  it('a world that still falls to the live view says so in the log, once a run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = makeWorld('run-too-big');
    w.activity = feed(60, 14_000);
    for (let i = 0; i < 3; i++) serializeSnapshot(w, FINANCE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('GET /api/state');
    expect(warn.mock.calls[0]![0]).toContain('octets');
    const next = makeWorld('run-too-big-too');
    next.activity = w.activity;
    serializeSnapshot(next, FINANCE);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('what the snapshot keeps of the run', () => {
  const finance = FINANCE;
  const adRow = (day: number, creativeId: string, spend = 10): WorldState['market']['adStats'][number] => ({ day, campaignId: 'cmp_1', creativeId, productId: 'prd_1', spend, impressions: 1000, clicks: 20, ctr: 0.02, cpc: 0.5, cpm: 10, landingViews: 15, purchases: 1, revenue: 19, roas: 1.9, frequency: 1.2, comments: [] });
  const creative = (id: string) => ({ id, productId: 'prd_1', hook: id, hookStyle: 'question', format: 'carousel', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy: 'ag_noam' }) as unknown as WorldState['company']['creatives'][number];

  it('a creative keeps its figures once its rows leave the window, and the chart is the same in both snapshots', () => {
    const w = makeWorld();
    w.day = 61;
    w.company.creatives = [creative('old'), creative('recent')];
    w.market.adStats = [...Array.from({ length: 10 }, (_, i) => adRow(20 + i, 'old')), adRow(60, 'recent', 7), adRow(60, 'gone', 3)];
    for (const snap of [buildSnapshot(w, finance, false, TIGHT_LIMITS), buildSnapshot(w, finance, false, DEFAULT_LIMITS)]) {
      expect(snap.market.adStats.some((s) => s.creativeId === 'old')).toBe(false);
      expect(snap.adTotals!.creatives.old).toEqual({ spend: 100, impressions: 10_000, clicks: 200, purchases: 10, revenue: 190, lastDay: 29 });
      expect(snap.adTotals!.days).toHaveLength(11);
      expect(snap.adTotals!.days.at(-1)).toEqual({ day: 60, spend: 10, revenue: 38 });
      expect(snap.adTotals!.creatives.gone).toBeUndefined(); // only the creatives of this snapshot: its size stays bounded
    }
  });

  it('rows the market retired still count in the whole life of a creative', () => {
    const w = makeWorld();
    w.company.creatives = [creative('old')];
    w.market.retiredAdTotals = { old: { spend: 40, impressions: 5000, clicks: 90, purchases: 3, revenue: 57, lastDay: 12 } };
    w.market.adStats = [adRow(29, 'old')];
    const snap = buildSnapshot(w, finance, false, TIGHT_LIMITS);
    expect(snap.adTotals!.creatives.old).toEqual({ spend: 50, impressions: 6000, clicks: 110, purchases: 4, revenue: 76, lastDay: 29 });
    expect(w.market.retiredAdTotals.old!.spend).toBe(40); // a snapshot reads the world, it never adds to it
  });

  it('every mission of the founder stays, with its progress counted on the whole task list', () => {
    const w = makeWorld();
    const done = w.company.tasks.filter((t) => t.status === 'done').slice(0, 3).map((t) => t.id);
    const failed = w.company.tasks.find((t) => t.status === 'failed')!.id;
    w.company.missions.unshift({ id: 'mis_founder', day: 1, from: 'founder', text: 'Lance un guide', ownerId: 'ag_noam', taskIds: [...done, failed], status: 'done', outcome: 'En ligne.', productId: 'prd_1' });
    const snap = buildSnapshot(w, finance, false, TIGHT_LIMITS);
    const m = snap.company.missions.find((x) => x.id === 'mis_founder');
    expect(m).toMatchObject({ outcome: 'En ligne.', productId: 'prd_1', doneTasks: 3 });
    expect(snap.company.tasks.some((t) => t.id === done[0])).toBe(false); // the oldest tasks left the list, not the count
    expect(snap.company.missions.filter((x) => x.from !== 'founder' && x.status !== 'open')).toHaveLength(TIGHT_LIMITS.missions);
  });

  it('guides and covers are never pushed out by ad frames, and the counts are the run\'s', () => {
    const w = makeWorld();
    const snap = buildSnapshot(w, finance, false, TIGHT_LIMITS);
    expect(snap.company.deliverables.filter((d) => d.kind === 'pdf')).toHaveLength(10);
    expect(snap.company.deliverables.filter((d) => d.kind === 'ad_storyboard')).toHaveLength(TIGHT_LIMITS.deliverables);
    expect(snap.deliverableCounts).toEqual({ pdf: 10, ad_storyboard: 390 });
  });

  it('failed and cancelled tasks are counted per team on the whole run', () => {
    const w = makeWorld();
    const stats = taskStatsOf([
      { ...w.company.tasks[0]!, dept: 'growth', status: 'failed', dayCreated: 1, dayDone: 1 },
      { ...w.company.tasks[0]!, dept: 'growth', status: 'cancelled', dayCreated: 2, dayDone: 2 },
      { ...w.company.tasks[0]!, dept: 'growth', status: 'done', dayCreated: 2, dayDone: 2 },
    ], 90);
    expect(stats.depts.growth).toMatchObject({ done: 1, failed: 2, days: [] });
  });
});

describe('SSE pacing', () => {
  function stream(source: SnapshotSource, sse: ConstructorParameters<typeof SseHub>[1]) {
    const frames: string[] = [];
    const req = Object.assign(new EventEmitter(), { socket: { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} } }) as unknown as IncomingMessage;
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write: (f: string) => { frames.push(f); return true; }, end() {} }) as unknown as ServerResponse;
    const hub = new SseHub(source, { heartbeatMs: 60_000, ...sse });
    hub.attach(req, res, false);
    return { hub, count: (type: string) => frames.filter((f) => f.startsWith(`data: {"type":"${type}"`)).length, frames };
  }

  it('sends a tick event for every tick but at most one full snapshot per interval, the light one when there is one', async () => {
    let day = 1;
    const source: SnapshotSource = { snapshotJson: () => '{"full":true}', liveSnapshotJson: () => '{"live":true}', tickJson: () => JSON.stringify({ type: 'tick', day }) };
    const start = Date.now();
    const s = stream(source, { snapshotMinIntervalMs: 120 });
    expect(s.frames.at(-1)).toContain('"live":true');
    for (let i = 0; i < 12; i++) { s.hub.tick(); await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 150));
    const elapsed = Date.now() - start;
    expect(s.count('tick')).toBe(12);
    const snapshots = s.count('snapshot');
    expect(snapshots).toBeGreaterThanOrEqual(3);
    // One per interval, over the time the loop really took (5 at full speed): with a worker per core, timers run late.
    expect(snapshots).toBeLessThanOrEqual(Math.ceil(elapsed / 120) + 1);
    expect(s.frames.some((f) => f.includes('"full":true'))).toBe(false);
    // a new day does not wait for the interval
    s.hub.tick();
    await new Promise((r) => setTimeout(r, 15));
    const before = s.count('snapshot');
    day = 2;
    s.hub.tick();
    await new Promise((r) => setTimeout(r, 15));
    expect(s.count('snapshot')).toBe(before + 1);
    s.hub.close();
  });

  it('defaults to about one snapshot per second', () => {
    const hub = new SseHub({ snapshotJson: () => '{}', tickJson: () => '{}' });
    expect((hub as unknown as { opts: { snapshotMinIntervalMs: number } }).opts.snapshotMinIntervalMs).toBe(1000);
    hub.close();
  });
});

// ───────────────────────────── persistence ─────────────────────────────

describe('persistence', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'agency-runs-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('the run list never counts a payment reserve as a loss', async () => {
    const w = makeWorld('run-20261030-120000');
    w.ledger = [
      { id: 'a', day: 1, type: 'capital', amount: 500, memo: '', ref: null },
      { id: 'b', day: 2, type: 'revenue', amount: 393.1, memo: '', ref: null },
      { id: 'c', day: 3, type: 'platform_fee', amount: -143.1, memo: '', ref: 'hold:3' },
    ];
    const own = join(dir, 'reserve');
    await saveWorld(w, { dir: own });
    expect((await listRuns({ dir: own })).find((r) => r.runId === w.runId)).toMatchObject({ cash: 750, profit: 393.1 });
  });

  it('reads the finance of a save when it serialises, not when it was asked for', async () => {
    const w = makeWorld('run-20261030-121000');
    let profit = 1;
    const own = join(dir, 'differe');
    scheduleSave(w, 10_000, { dir: own, finance: () => ({ cash: 10, profit }) });
    profit = 2;
    await flushSaves();
    expect((await listRuns({ dir: own })).find((r) => r.runId === w.runId)).toMatchObject({ cash: 10, profit: 2 });
  });

  it('formats run ids', () => {
    expect(makeRunId(new Date(2026, 9, 3, 7, 5, 9))).toBe('run-20261003-070509');
  });

  it('round-trips a world atomically and lists runs by mtime', async () => {
    const a = makeWorld('run-20261030-100000');
    const b = makeWorld('run-20261030-110000');
    b.day = 12;
    b.status = 'paused';
    const file = await saveWorld(a, { dir, finance: { cash: 1234.5, profit: 734.5 } });
    expect(file).toBe(join(dir, a.runId, 'world.json'));
    await new Promise((r) => setTimeout(r, 30));
    await saveWorld(b, { dir });
    const loaded = await loadWorld(a.runId, { dir });
    expect(loaded).toEqual(a);
    expect((await readdir(join(dir, a.runId))).sort()).toEqual(['meta.json', 'world.json']); // no tmp leftovers
    const runs = await listRuns({ dir });
    expect(runs.map((r) => r.runId)).toEqual([b.runId, a.runId]);
    expect(runs[1]).toMatchObject({ companyName: 'Pixel Agency', day: 30, status: 'running', cash: 1234.5, profit: 734.5, createdAt: a.createdAt });
    expect(runs[0]).toMatchObject({ day: 12, status: 'paused', cash: estimateCashProfit(b).cash });
    expect(Date.parse(runs[0]!.mtime)).toBeGreaterThan(0);
  });

  it('debounces saves and flushes them on demand', async () => {
    const w = makeWorld('run-20261030-130000');
    for (let i = 0; i < 5; i++) { w.day = 40 + i; scheduleSave(w, 10_000, { dir }); }
    expect(await loadWorld(w.runId, { dir })).toBeNull();
    await flushSaves();
    expect((await loadWorld(w.runId, { dir }))!.day).toBe(44);
  });

  it('serialises concurrent saves of the same run', async () => {
    const w = makeWorld('run-20261030-140000');
    const jobs = Array.from({ length: 6 }, (_, i) => { w.day = 100 + i; return saveWorld(w, { dir }); });
    await Promise.all(jobs);
    expect((await loadWorld(w.runId, { dir }))!.day).toBe(105);
  });

  it('ignores missing, corrupt and foreign folders', async () => {
    expect(await loadWorld('run-absent', { dir })).toBeNull();
    expect(await loadWorld('../etc', { dir })).toBeNull();
    await mkdir(join(dir, 'run-corrompu'), { recursive: true });
    await writeFile(join(dir, 'run-corrompu', 'world.json'), '{ pas du json');
    await mkdir(join(dir, 'pas-un-run'), { recursive: true });
    await writeFile(join(dir, '.gitkeep'), '');
    expect(await loadWorld('run-corrompu', { dir })).toBeNull();
    const ids = (await listRuns({ dir })).map((r) => r.runId);
    expect(ids).not.toContain('run-corrompu');
    expect(ids).not.toContain('pas-un-run');
    expect(await listRuns({ dir: join(dir, 'nexiste-pas') })).toEqual([]);
    expect(newRunId(dir, new Date(2026, 9, 30, 10, 0, 0))).toBe('run-20261030-100000-2');
  });

  it('rejects invalid run ids on save', async () => {
    const w = makeWorld('../evil');
    await expect(saveWorld(w, { dir })).rejects.toThrow(/invalide/);
  });
});

// ───────────────────────────── HTTP server (fake session) ─────────────────────────────

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }

function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolveRes, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolveRes({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const MP4 = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(33 + (i % 90))).join('');

describe('HTTP server', () => {
  let dir: string;
  let port: number;
  let close: () => Promise<void>;
  let pushActivity: (a: Activity) => void;
  let tick: () => void;
  const calls: string[] = [];
  const world = makeWorld('run-20261030-150000');

  const fake: SessionLike = {
    info: () => ({ runId: world.runId, playing: true, speed: 2, mindMode: 'heuristic' }),
    status: () => world.status,
    snapshotJson: (god) => serializeSnapshot(world, FINANCE, god, { session: { playing: true } }),
    tickJson: () => JSON.stringify({ type: 'tick', day: world.day, tick: world.tick, phase: world.phase, finance: FINANCE }),
    control: async (action, speed) => { calls.push(`control:${action}:${speed ?? ''}`); return { runId: world.runId, playing: action === 'play', speed: speed ?? 2, mindMode: 'heuristic' }; },
    newRun: async (p) => { calls.push(`newRun:${JSON.stringify(p)}`); },
    loadRun: async (id) => { calls.push(`load:${id}`); if (id === 'run-absent') throw new HttpError(404, 'Run introuvable'); },
    mission: async (text, agentId) => { calls.push(`mission:${text}:${agentId ?? ''}`); return 'mis_77'; },
    chat: async (agentId, text) => { if (agentId !== 'ag_margaux') throw new HttpError(404, 'Agent inconnu'); return `Margaux : bien reçu « ${text} »`; },
    approve: async (taskId, ok) => { calls.push(`approve:${taskId}:${ok}`); },
    brainList: async () => [{ path: 'lecons/a.md', title: 'A', tags: [], links: [], updatedDay: 1 }],
    brainNote: async (p) => (p === 'lecons/a.md' ? { path: p, title: 'A', tags: [], body: '# A', links: [], updatedDay: 1 } : null),
    brainGraph: async () => ({ nodes: [], edges: [] }),
    listRuns: async () => [{ runId: world.runId, current: true }],
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agency-http-'));
    const files = join(dir, 'runs', world.runId, 'files', 'prd_1', 'v1');
    await mkdir(files, { recursive: true });
    await writeFile(join(files, 'guide.pdf'), '%PDF-1.4 faux pdf');
    await writeFile(join(files, 'cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(files, 'ad.mp4'), MP4);
    await writeFile(join(dir, 'runs', world.runId, 'world.json'), '{"secret":true}');
    await writeFile(join(dir, 'secret.txt'), 'top secret');
    const app = createAgencyServer({ session: fake, runsRoot: join(dir, 'runs'), webDist: join(dir, 'no-dist'), sse: { activityThrottleMs: 20, heartbeatMs: 60_000, snapshotMinIntervalMs: 0 } });
    pushActivity = (a) => app.hub.pushActivity(a);
    tick = () => app.hub.tick();
    close = app.close;
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
    port = (app.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the snapshot (god mode on demand)', async () => {
    const res = await call(port, 'GET', '/api/state');
    expect(res.status).toBe(200);
    const snap = JSON.parse(res.body);
    expect(snap.runId).toBe(world.runId);
    expect(snap.godMode).toBeUndefined();
    expect(snap.session.playing).toBe(true);
    const god = JSON.parse((await call(port, 'GET', '/api/state?god=1')).body);
    expect(god.godMode.niches[0].id).toBe('niche_sommeil');
  });

  it('routes control, scenario, mission, chat, approve, brain, runs and load', async () => {
    const ctl = await call(port, 'POST', '/api/control', JSON.stringify({ action: 'play', speed: 8 }));
    expect(ctl.status).toBe(200);
    expect(JSON.parse(ctl.body)).toMatchObject({ ok: true, status: 'running', speed: 8 });
    expect((await call(port, 'POST', '/api/control', JSON.stringify({ action: 'fly' }))).status).toBe(400);
    const sc = await call(port, 'POST', '/api/scenario', JSON.stringify({ startingCash: 800, difficulty: 'facile' }));
    expect(sc.status).toBe(200);
    expect(JSON.parse(sc.body).runId).toBe(world.runId);
    const poor = await call(port, 'POST', '/api/scenario', JSON.stringify({ startingCash: 50 }));
    expect(poor.status).toBe(400);
    expect(JSON.parse(poor.body).error).toMatch(/il faut au moins 280 €/);
    const created = JSON.parse(calls.find((c) => c.startsWith('newRun:'))!.slice(7));
    expect(created).toMatchObject({ startingCash: 800, difficulty: 'facile' });
    expect(typeof created.seed).toBe('number');
    expect(JSON.parse((await call(port, 'POST', '/api/mission', JSON.stringify({ text: 'Lance un 2e PDF', agentId: 'ag_noam' }))).body)).toEqual({ ok: true, missionId: 'mis_77' });
    // The company's answer travels with the mission: a refused subject is known at once.
    fake.missionState = (id) => (id === 'mis_77' ? { status: 'failed', message: 'Je ne lance rien sur « apiculture ».' } : {});
    expect(JSON.parse((await call(port, 'POST', '/api/mission', JSON.stringify({ text: 'Lance un guide sur l’apiculture' }))).body)).toEqual({ ok: true, missionId: 'mis_77', status: 'failed', message: 'Je ne lance rien sur « apiculture ».' });
    delete fake.missionState;
    expect((await call(port, 'POST', '/api/mission', JSON.stringify({ text: '   ' }))).status).toBe(400);
    expect(JSON.parse((await call(port, 'POST', '/api/chat', JSON.stringify({ agentId: 'ag_margaux', text: 'Salut' }))).body).reply).toContain('Salut');
    const unknown = await call(port, 'POST', '/api/chat', JSON.stringify({ agentId: 'ag_x', text: 'Salut' }));
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body).error).toBe('Agent inconnu');
    expect((await call(port, 'POST', '/api/approve', JSON.stringify({ taskId: 'tsk_1', approved: false }))).status).toBe(200);
    expect(calls).toContain('approve:tsk_1:false');
    expect((await call(port, 'POST', '/api/approve', JSON.stringify({ taskId: 'tsk_1', approved: 'oui' }))).status).toBe(400);
    expect(JSON.parse((await call(port, 'GET', '/api/brain')).body)).toHaveLength(1);
    expect(JSON.parse((await call(port, 'GET', '/api/brain/note?path=lecons%2Fa.md')).body).body).toBe('# A');
    expect((await call(port, 'GET', '/api/brain/note?path=nope.md')).status).toBe(404);
    const noJournal = await call(port, 'GET', '/api/brain/note?path=journal%2Fjour-999.md');
    expect([noJournal.status, noJournal.body]).toEqual([200, 'null']);
    expect((await call(port, 'GET', '/api/brain/note?path=..%2F..%2Fsecret.txt')).status).toBe(400);
    expect(JSON.parse((await call(port, 'GET', '/api/brain/graph')).body)).toEqual({ nodes: [], edges: [] });
    expect(JSON.parse((await call(port, 'GET', '/api/runs')).body)[0].current).toBe(true);
    expect((await call(port, 'POST', '/api/load', JSON.stringify({ runId: world.runId }))).status).toBe(200);
    expect((await call(port, 'POST', '/api/load', JSON.stringify({ runId: 'run-absent' }))).status).toBe(404);
    expect((await call(port, 'POST', '/api/load', JSON.stringify({ runId: '../x' }))).status).toBe(400);
  });

  it('answers errors as JSON without crashing', async () => {
    const r404 = await call(port, 'GET', '/api/nope');
    expect(r404.status).toBe(404);
    expect(JSON.parse(r404.body).error).toMatch(/Route inconnue/);
    expect((await call(port, 'GET', '/api/control')).status).toBe(405);
    expect((await call(port, 'POST', '/api/mission', '{oups')).status).toBe(400);
    expect((await call(port, 'POST', '/api/mission', '[1,2]')).status).toBe(400);
    expect((await call(port, 'POST', '/api/mission', JSON.stringify({ text: 'x'.repeat(1_100_000) }))).status).toBe(413);
    expect((await call(port, 'GET', '/api/health')).status).toBe(200);
  });

  it('sends CORS headers to localhost origins only', async () => {
    const pre = await call(port, 'OPTIONS', '/api/control', undefined, { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const foreign = await call(port, 'GET', '/api/health', undefined, { Origin: 'https://evil.example' });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves run files with the right mime types and blocks traversal', async () => {
    const pdf = await call(port, 'GET', `/runs/${world.runId}/files/prd_1/v1/guide.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe('inline; filename="guide.pdf"');
    expect(pdf.body).toContain('%PDF');
    const svg = await call(port, 'GET', `/runs/${world.runId}/files/prd_1/v1/cover.svg`);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect((await call(port, 'HEAD', `/runs/${world.runId}/files/prd_1/v1/cover.svg`)).body).toBe('');
    expect((await call(port, 'GET', `/runs/${world.runId}/world.json`)).status).toBe(403);
    expect((await call(port, 'GET', `/runs/${world.runId}/files/absent.pdf`)).status).toBe(404);
    expect((await call(port, 'GET', `/runs/${world.runId}/..%2F..%2Fsecret.txt`)).status).toBe(403);
    expect((await call(port, 'GET', `/runs/${world.runId}/files/..%5C..%5C..%5Csecret.txt`)).status).toBe(403);
    expect((await call(port, 'GET', `/runs/${world.runId}/../../secret.txt`)).status).toBe(403);
    expect((await call(port, 'GET', '/runs/..%2F/secret.txt')).status).toBe(404);
    expect((await call(port, 'POST', `/runs/${world.runId}/files/prd_1/v1/guide.pdf`)).status).toBe(405);
  });

  describe('byte ranges (ui §3.3): a <video> cannot seek without them', () => {
    const mp4 = () => `/runs/${world.runId}/files/prd_1/v1/ad.mp4`;

    it('bytes=0-99 answers 206 with its Content-Range and exactly those 100 bytes', async () => {
      const res = await call(port, 'GET', mp4(), undefined, { Range: 'bytes=0-99' });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 0-99/${MP4.length}`);
      expect(res.headers['content-length']).toBe('100');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body).toBe(MP4.slice(0, 100));
    });

    it('a range past the end is refused with 416 and the real size', async () => {
      const res = await call(port, 'GET', mp4(), undefined, { Range: 'bytes=999999-' });
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${MP4.length}`);
      expect(res.body).toBe('');
    });

    it('without a Range header, the whole file and Accept-Ranges', async () => {
      const res = await call(port, 'GET', mp4());
      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body).toBe(MP4);
    });

    it('takes an open end, a suffix and an end past the file; anything else gets the whole file', async () => {
      const tail = await call(port, 'GET', mp4(), undefined, { Range: `bytes=${MP4.length - 10}-` });
      expect([tail.status, tail.body, tail.headers['content-range']]).toEqual([206, MP4.slice(-10), `bytes ${MP4.length - 10}-${MP4.length - 1}/${MP4.length}`]);
      const suffix = await call(port, 'GET', mp4(), undefined, { Range: 'bytes=-20' });
      expect([suffix.status, suffix.body]).toEqual([206, MP4.slice(-20)]);
      const clipped = await call(port, 'GET', mp4(), undefined, { Range: `bytes=5-${MP4.length * 2}` });
      expect([clipped.status, clipped.body]).toEqual([206, MP4.slice(5)]);
      for (const range of ['bytes=abc', 'items=0-5', 'bytes=-', 'bytes=0-1,4-5']) {
        const whole = await call(port, 'GET', mp4(), undefined, { Range: range });
        expect([range, whole.status, whole.body.length]).toEqual([range, 200, MP4.length]);
      }
    });

    it('HEAD with a range answers its headers, no body', async () => {
      const res = await call(port, 'HEAD', mp4(), undefined, { Range: 'bytes=10-19' });
      expect([res.status, res.headers['content-range'], res.body]).toEqual([206, `bytes 10-19/${MP4.length}`, '']);
    });

    it('a range never opens what the guard refuses: /runs/<id>/world.json stays closed', async () => {
      expect((await call(port, 'GET', `/runs/${world.runId}/world.json`, undefined, { Range: 'bytes=0-5' })).status).toBe(403);
      expect((await call(port, 'GET', `/runs/${world.runId}/world.json`)).status).toBe(403);
    });
  });

  it('shows the French dev landing page when web/dist is missing', async () => {
    const res = await call(port, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('npm run dev');
    expect(res.body).toContain('http://localhost:5173');
    expect((await call(port, 'GET', '/onglet/finance')).body).toContain('npm run dev');
    expect((await call(port, 'GET', '/assets/app.js')).status).toBe(404);
    expect(devLandingPage(1234)).toContain('1234');
  });

  it('streams snapshots, ticks and activity batches over SSE', async () => {
    const received: string[] = [];
    const done = new Promise<void>((resolveDone, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/stream' }, (res) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        let buf = '';
        res.on('data', (c: Buffer) => {
          buf += c.toString('utf8');
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!data) continue;
            const ev = JSON.parse(data.slice(6));
            received.push(ev.type);
            if (received.length === 1) {
              expect(ev.snapshot.runId).toBe(world.runId);
              pushActivity({ id: 'act_x1', day: 30, tick: 3, at: 1, agentId: null, kind: 'thought', text: 'Je relis le cerveau.' });
              pushActivity({ id: 'act_x2', day: 30, tick: 3, at: 2, agentId: null, kind: 'brain_read', text: 'Lecture : Règle du un' });
            } else if (ev.type === 'activity') {
              expect(ev.activity.map((a: Activity) => a.id)).toEqual(['act_x1', 'act_x2']);
              tick();
            } else if (ev.type === 'snapshot' && received.includes('tick')) {
              req.destroy();
              resolveDone();
            }
          }
        });
      });
      req.on('error', (err) => { if (!received.includes('tick')) reject(err); });
      req.end();
    });
    await done;
    expect(received.slice(0, 4)).toEqual(['snapshot', 'activity', 'tick', 'snapshot']);
    expect(sseFrame('{"a":1}')).toBe('data: {"a":1}\n\n');
  });
});

describe('HTTP errors raised below the HTTP layer', () => {
  it('maps a numeric 4xx status to the HTTP status, everything else to 500', () => {
    expect(errorStatus(new HttpError(409, 'x'))).toBe(409);
    expect(errorStatus(Object.assign(new Error('Agent inconnu : zz'), { status: 404 }))).toBe(404);
    expect(errorStatus(Object.assign(new Error('x'), { statusCode: 400 }))).toBe(400);
    expect(errorStatus(Object.assign(new Error('x'), { status: 503 }))).toBe(500);
    expect(errorStatus(new Error('boom'))).toBe(500);
    expect(errorStatus('boom')).toBe(500);
  });

  it('answers 404 JSON (not 500) when the runtime says the agent is unknown', async () => {
    const world = makeWorld('run-20261030-170000');
    const session: SessionLike = {
      info: () => ({ runId: world.runId, playing: false, speed: 1, mindMode: 'heuristic' }),
      status: () => world.status,
      snapshotJson: () => '{}',
      tickJson: () => '{}',
      control: async () => ({ runId: world.runId, playing: false, speed: 1, mindMode: 'heuristic' }),
      newRun: async () => undefined,
      loadRun: async () => undefined,
      mission: async () => { throw new Error('panne interne'); },
      chat: async (agentId) => { throw Object.assign(new Error(`Agent inconnu : ${agentId}`), { status: 404 }); },
      approve: async () => undefined,
      brainList: async () => [],
      brainNote: async () => null,
      brainGraph: async () => ({ nodes: [], edges: [] }),
      listRuns: async () => [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'agency-http-404-'));
    const app = createAgencyServer({ session, runsRoot: join(dir, 'runs'), webDist: join(dir, 'no-dist'), sse: { activityThrottleMs: 20, heartbeatMs: 60_000, snapshotMinIntervalMs: 0 } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
      const port = (app.server.address() as AddressInfo).port;
      const res = await call(port, 'POST', '/api/chat', JSON.stringify({ agentId: 'zz', text: 'Salut' }));
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(JSON.parse(res.body)).toEqual({ error: 'Agent inconnu : zz' });
      const boom = await call(port, 'POST', '/api/mission', JSON.stringify({ text: 'Fais quelque chose' }));
      expect(boom.status).toBe(500);
      expect(JSON.parse(boom.body).error).toMatch(/Erreur interne du serveur : panne interne/);
    } finally {
      errors.mockRestore();
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────── CLI helpers ─────────────────────────────

describe('cli', () => {
  it('parses flags', () => {
    expect(parseCliArgs(['--days', '45', '--budget=800', '--difficulty', 'cauchemar', '--seed', '7', '--mind', 'heuristic', '--run-id', 'demo-1', '--quiet'])).toMatchObject({
      days: 45, budget: 800, difficulty: 'cauchemar', seed: 7, mind: 'heuristic', mindExplicit: true, runId: 'demo-1', quiet: true, verbose: false,
    });
    expect(parseCliArgs([])).toMatchObject({ days: 30, budget: 500, difficulty: 'normal', seed: 42, mind: 'heuristic', mindExplicit: false, runId: null });
    expect(() => parseCliArgs(['--days', 'zero'])).toThrow(CliError);
    expect(() => parseCliArgs(['--difficulty', 'dur'])).toThrow(/facile/);
    expect(() => parseCliArgs(['--run-id', '../x'])).toThrow(CliError);
    expect(() => parseCliArgs(['--wat'])).toThrow(/inconnue/);
    expect(() => parseCliArgs(['--days'])).toThrow(/valeur/);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('runs for ten years, with no end, and without the growth decisions', () => {
    expect(parseCliArgs([])).toMatchObject({ open: false, scaling: true });
    expect(parseCliArgs(['--days', '3650', '--open', '--no-scaling'])).toMatchObject({ days: 3650, open: true, scaling: false });
    expect(() => parseCliArgs(['--days', '3651'])).toThrow(/3650/);
  });

  it('picks the team, the same flags as the benchmark', () => {
    expect(parseCliArgs([]).org).toEqual(LEAN_ORG);
    expect(parseCliArgs(['--team', 'legacy31']).org).toEqual({ team: 'legacy31', autoHire: true, payroll: true });
    expect(parseCliArgs(['--team=legacy31', '--no-hire', '--no-payroll']).org).toEqual(LEGACY_ORG);
    expect(parseCliArgs(['--no-hire']).org).toEqual({ team: 'lean', autoHire: false, payroll: true });
    expect(() => parseCliArgs(['--team', 'mega'])).toThrow(/lean ou legacy31/);
    expect(LEAN_ORG).toEqual({ team: 'lean', autoHire: true, payroll: true }); // a parse never writes on the shared default
  });

  it('formats the daily table and the verdict in French', () => {
    expect(fmtEur(1234.5)).toBe('1 234,50 €');
    expect(fmtEur(-12)).toBe('-12,00 €');
    expect(fmtEur(3, true)).toBe('+3,00 €');
    expect(tableHeader()).toContain('Profit cumulé');
    const line = kpiRow(kpi(3));
    expect(line).toContain('530,00 €');
    expect(line).toContain('2,85');
    const w = makeWorld();
    expect(banditInsights(w)[0]).toContain('Style de hook (Sommeil de bébé) : stat');
    const text = verdict({ world: w, finance: FINANCE, daysRun: 30, filesDir: 'runs/x/files', brainDir: 'runs/x/brain', worldFile: 'runs/x/world.json' });
    expect(text).toContain('OBJECTIF ATTEINT');
    expect(text).toContain('Meilleur produit : « Bébé dort enfin (prd_1) »');
    expect(text).toContain('Leçons clés');
    expect(text).toContain('runs/x/files');
    const lateWorld = { ...w, status: 'goal_reached' as const, market: { ...w.market, events: [{ id: 'e', day: 31, kind: 'goal_reached' as const, title: '', description: '', severity: 'info' as const }] } };
    const late = verdict({ world: { ...lateWorld, scenario: { ...w.scenario, goal: { targetProfit: 1000, byDay: 20 } } }, finance: { ...FINANCE, profit: 1100 }, daysRun: 40, filesDir: 'f', brainDir: 'b', worldFile: 'w' });
    expect(late).toContain("OBJECTIF ATTEINT APRÈS L'ÉCHÉANCE");
    expect(late).toContain('avant le jour 20, atteint au jour 31');
    const poor = verdict({ world: { ...w, company: { ...w.company, products: [], lessons: [] } }, finance: { ...FINANCE, profit: -120, profit7d: -30 }, daysRun: 10, filesDir: 'f', brainDir: 'b', worldFile: 'w' });
    expect(poor).toContain('PAS ENCORE RENTABLE');
    expect(poor).toContain('aucune vente');
    expect(poor).not.toContain('salaires');
    const paid = verdict({ world: w, finance: { ...FINANCE, payroll: 456 }, daysRun: 60, filesDir: 'f', brainDir: 'b', worldFile: 'w' });
    expect(paid).toContain('salaires 456,00 €');
  });
});

// ───────────────────────────── live session (ticker, saves, founder actions) ─────────────────────────────

async function until(cond: () => boolean, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('condition non atteinte à temps');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('live session', () => {
  afterAll(async () => { await rm(fake.tmp, { recursive: true, force: true }); });

  it('boots a new run, plays alone, never overlaps ticks, saves and pauses', async () => {
    await rm(fake.tmp, { recursive: true, force: true });
    const { AgencySession } = await import('../src/api/session.js');
    const persist = await import('../src/api/persist.js');
    expect(persist.runsDir()).toBe(join(fake.tmp, 'runs'));
    const s = new AgencySession();
    await s.start();
    const first = s.world.runId;
    expect(first).toMatch(/^run-\d{8}-\d{6}/);
    expect(s.info()).toMatchObject({ playing: true, speed: 1, status: 'running', mindMode: 'heuristic' });
    expect(s.world.mind.mode).toBe('heuristic');
    expect(await persist.loadWorld(first)).not.toBeNull(); // saved right away

    s.setSpeed(8);
    await until(() => fake.steps >= 3);
    expect(fake.maxInFlight).toBe(1);

    s.pause();
    await s.step(); // queued behind the pause job: exactly one manual tick
    const frozen = `${s.world.day}:${s.world.tick}`;
    await new Promise((r) => setTimeout(r, 350));
    expect(`${s.world.day}:${s.world.tick}`).toBe(frozen);
    expect(s.world.status).toBe('paused');
    expect((await persist.loadWorld(first))!.status).toBe('paused');

    // 'day' runs until the next morning; the evening tick saves the world
    const day = s.world.day;
    const info = await s.control('day');
    expect(info.playing).toBe(false);
    await until(() => s.world.day === day + 1 && !s.info().busy);
    expect(s.world.tick).toBe(0);
    expect((await persist.loadWorld(first))!.day).toBe(day + 1);
    expect(fake.maxInFlight).toBe(1);

    // founder actions
    expect(await s.mission('Lance un 2e PDF sur la niche sommeil')).toBe('mis_42');
    await expect(s.mission('x', 'ag_inconnu')).rejects.toMatchObject({ status: 404 });
    expect(await s.chat('ag_margaux', 'Salut')).toBe('Bien reçu : Salut');
    await expect(s.chat('ag_inconnu', 'Salut')).rejects.toBeInstanceOf(HttpError);
    await expect(s.chat('ag_inconnu', 'Salut')).rejects.toMatchObject({ status: 404 });
    expect(await s.chat('Margaux', 'Coucou')).toBe('Bien reçu : Coucou'); // a first name works too
    expect(await s.mission('Écris des hooks', 'noam')).toBe('mis_42');
    // the live session info carries every SessionInfo field the UI reads
    expect(Object.keys(s.info()).sort()).toEqual(['backoffMs', 'busy', 'claudeReady', 'day', 'intervalMs', 'lastError', 'minStartingCash', 'mindMode', 'pace', 'playing', 'runId', 'speed', 'status', 'tick', 'watchers']);
    await s.approve('tsk_1', true);
    expect(fake.approvals).toContain('tsk_1:true');
    await expect(s.approve('tsk_absent', true)).rejects.toMatchObject({ status: 404 });
    expect((await s.brainList())[0]).not.toHaveProperty('body');
    expect((await s.brainNote('00 - Accueil.md'))!.body).toBe('# Cerveau');
    expect((await s.brainGraph()).nodes).toHaveLength(1);

    // snapshot JSON carries the session state, never the hidden truth
    const snap = JSON.parse(s.snapshotJson(false));
    expect(snap.session).toMatchObject({ runId: first, playing: false });
    expect(snap.godMode).toBeUndefined();
    expect(JSON.parse(s.snapshotJson(true)).godMode.niches).toHaveLength(1);
    expect(JSON.parse(s.tickJson())).toMatchObject({ type: 'tick', day: s.world.day });

    // Claude usage → world.mind (the runtime books the 'compute' ledger lines, never the session)
    const engine = (s as unknown as { run: { engine: { fakeCall(eur: number): void } } }).run.engine;
    engine.fakeCall(0.12);
    engine.fakeCall(0.08);
    expect(s.world.mind).toMatchObject({ calls: 2, costEur: 0.2, mode: 'heuristic' });
    s.world.mind = { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 }; // runtime replaces the object
    await s.step();
    expect(s.world.mind.calls).toBe(2);
    expect(s.world.ledger.filter((e) => e.type === 'compute')).toHaveLength(0);

    // a new run, then back to the first one
    await new Promise((r) => setTimeout(r, 1100)); // second-based run ids
    const second = await s.newRun({ startingCash: 900, difficulty: 'cauchemar' }, false);
    expect(second.runId).not.toBe(first);
    expect(s.world.scenario).toMatchObject({ startingCash: 900, difficulty: 'cauchemar', maxComputeEur: 3, openEnded: true });
    expect(s.info().minStartingCash).toBe(280);
    const runs = await s.listRuns();
    expect(runs.find((r) => r.current)!.runId).toBe(second.runId);
    expect(runs.map((r) => r.runId)).toContain(first);
    await s.loadRun(first);
    expect(s.world.runId).toBe(first);
    expect(s.world.mind.calls).toBe(2); // usage of a resumed run is kept
    await expect(s.loadRun('run-absent')).rejects.toMatchObject({ status: 404 });
    await expect(s.loadRun('../../x')).rejects.toMatchObject({ status: 400 });
    await s.shutdown();
  });

  it('contains tick errors and plays on, survives bankruptcy, stops when finished', async () => {
    const { AgencySession } = await import('../src/api/session.js');
    const s = new AgencySession();
    await s.start(); // resumes the run the app last played
    s.setSpeed(8);
    fake.failSteps = 2; // the wait starts at three: alwaysOn.test.ts
    await until(() => s.info().lastError !== null);
    expect(s.info().lastError).toBe('panne simulée');
    expect(s.world.activity.some((a) => a.text.includes('Incident technique'))).toBe(true);
    const before = fake.steps;
    await until(() => fake.steps > before + 1);
    expect(s.playing).toBe(true);
    expect(s.world.status).toBe('running');
    expect(s.info().lastError).toBeNull();
    // bankruptcy is a state the company works through (survival mode), not a stop
    s.world.status = 'bankrupt';
    const atBankrupt = fake.steps;
    await until(() => fake.steps > atBankrupt + 1);
    expect(s.playing).toBe(true);
    s.pause();
    await s.step();
    expect(s.world.status).toBe('bankrupt'); // pause never hides it
    s.play(8);
    s.world.status = 'finished';
    await until(() => !s.playing);
    expect(() => s.play()).toThrow(/terminé/);
    await expect(s.control('play')).rejects.toMatchObject({ status: 409 });
    // nothing can happen in a finished run: no « Compris », no task that will never run
    const stepsAtEnd = fake.steps;
    const missionsAtEnd = s.world.company.missions.length;
    await expect(s.control('step')).rejects.toMatchObject({ status: 409 });
    await expect(s.control('day')).rejects.toMatchObject({ status: 409 });
    await expect(s.mission('Lance un guide sur le sommeil du bébé')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('continue-le sans fin') });
    s.world.company.tasks.push({ id: 'tsk_end' } as WorldState['company']['tasks'][number]);
    await expect(s.approve('tsk_end', true)).rejects.toMatchObject({ status: 409 });
    s.world.company.tasks.pop();
    expect(fake.steps).toBe(stepsAtEnd);
    expect(s.world.company.missions).toHaveLength(missionsAtEnd);
    await expect(s.control('pause')).resolves.toBeTruthy();
    expect(fake.maxInFlight).toBe(1);
    const finishedId = s.world.runId;
    await s.shutdown();
    // next boot opens the run the app last played, finished or not: its end banner offers to go on
    const next = new AgencySession();
    await next.start();
    expect(next.world.runId).toBe(finishedId);
    expect(next.playing).toBe(false);
    await next.shutdown();
    // with no current run the scan applies: it skips the finished run and resumes the other unfinished one
    await rm(join(fake.tmp, 'runs', 'current.json'));
    const scan = new AgencySession();
    await scan.start();
    expect(scan.world.runId).not.toBe(finishedId);
    expect(scan.playing).toBe(true);
    // « Continuer sans fin »: the same run, no end, playing
    await scan.loadRun(finishedId);
    expect(scan.playing).toBe(false);
    const stepsBefore = fake.steps;
    expect(await scan.extendRun()).toMatchObject({ runId: finishedId, playing: true, status: 'running' });
    expect(scan.world.scenario.openEnded).toBe(true);
    expect(scan.world.activity.at(-1)!.text).toContain('sans fin');
    await until(() => fake.steps > stepsBefore + 1);
    await scan.shutdown();
  });
});

