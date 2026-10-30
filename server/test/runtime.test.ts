import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DailyKpi, TaskKind } from '../src/shared.js';
import type { BrainVault, ContentEngine, RunPaths } from '../src/contracts.js';
import { AGENTS, DEPARTMENTS, PLAYBOOK_NOTES, SEED_PLAYBOOKS } from '../src/runtime/roster.js';
import { KIND_META, createTask, depState } from '../src/runtime/tasks.js';
import { addPlaybookRule, parsePlaybook, withTone } from '../src/runtime/playbook.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const repo = join(here, '..', '..');
const has = (mod: string) => existsSync(join(src, mod, 'index.ts'));
const simPresent = has('sim');
const modulesPresent = simPresent && has('deliverables') && has('learning') && has('minds');
const ALL_KINDS = Object.keys(KIND_META) as TaskKind[];

describe('roster', () => {
  it('has 31 agents in 11 departments with unique ascii ids', () => {
    expect(AGENTS).toHaveLength(31);
    expect(DEPARTMENTS).toHaveLength(11);
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(31);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    for (const a of AGENTS) {
      expect(a.persona.length).toBeGreaterThan(40);
      expect(a.skills.length).toBeGreaterThanOrEqual(4);
      expect(a.skills.length).toBeLessThanOrEqual(6);
      expect(a.taskKinds.length).toBeGreaterThan(0);
      expect(a.tools).toContain('brain.read');
    }
  });

  it('every department has exactly one chief, and DeptDef.chiefId points to it', () => {
    for (const d of DEPARTMENTS) {
      const chief = AGENTS.find((a) => a.id === d.chiefId);
      expect(chief, d.id).toBeDefined();
      expect(chief!.dept).toBe(d.id);
      expect(chief!.isChief).toBe(true);
      expect(AGENTS.filter((a) => a.dept === d.id && a.isChief)).toHaveLength(1);
    }
  });

  it('every TaskKind can be done by at least one agent', () => {
    for (const kind of ALL_KINDS) expect(AGENTS.some((a) => a.taskKinds.includes(kind)), kind).toBe(true);
  });

  it('islands do not overlap and stay within the 7×7 map, colours are distinct', () => {
    const cells = DEPARTMENTS.map((d) => `${d.grid.col},${d.grid.row}`);
    expect(new Set(cells).size).toBe(11);
    for (const d of DEPARTMENTS) {
      expect(Math.abs(d.grid.col)).toBeLessThanOrEqual(3);
      expect(Math.abs(d.grid.row)).toBeLessThanOrEqual(3);
      expect(d.icon).toBe(d.icon.toUpperCase());
    }
    expect(new Set(DEPARTMENTS.map((d) => d.color)).size).toBe(11);
    expect(DEPARTMENTS.find((d) => d.id === 'direction')!.grid).toEqual({ col: 0, row: 0 });
  });

  it('avatars are diverse', () => {
    expect(new Set(AGENTS.map((a) => a.avatar.skin)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(AGENTS.map((a) => a.avatar.hairStyle)).size).toBe(6);
    expect(new Set(AGENTS.map((a) => a.avatar.accessory)).size).toBe(6);
  });

  it('seeds 2-4 playbook rules per department and ships the 11 playbook notes', () => {
    for (const d of DEPARTMENTS) {
      const rules = SEED_PLAYBOOKS[d.id];
      expect(rules.length).toBeGreaterThanOrEqual(2);
      expect(rules.length).toBeLessThanOrEqual(4);
      const file = join(repo, 'brain', 'playbooks', `${PLAYBOOK_NOTES[d.id]}.md`);
      expect(existsSync(file), file).toBe(true);
      const body = readFileSync(file, 'utf8');
      expect(body.startsWith('---\ntags: [')).toBe(true);
      expect(body).toMatch(/\[\[[^\]]+\]\]/);
    }
    const home = readFileSync(join(repo, 'brain', '00 - Accueil.md'), 'utf8');
    for (const name of Object.values(PLAYBOOK_NOTES)) expect(home).toContain(`[[${name}]]`);
  });
});

describe('playbook directives', () => {
  it('parses the machine-readable patterns', () => {
    const d = parsePlaybook([
      'Ne jamais écrire « garanti »',
      'Ne jamais écrire « sans effort »',
      'Privilégier le hook « mistake »',
      'Privilégier le format « text_slideshow »',
      'Prix cible « 19 »',
      'Niveau de promesse max « 0.4 »',
      'Ton support « concis »',
      'Une règle libre en français.',
    ]);
    expect(d.banned).toEqual(['garanti', 'sans effort']);
    expect(d.hook).toBe('mistake');
    expect(d.format).toBe('text_slideshow');
    expect(d.targetPrice).toBe(19);
    expect(d.maxHype).toBe(0.4);
    expect(d.tone).toBe('concis');
    expect(withTone(['Ton support « formel »', 'x'], 'chaleureux')).toEqual(['x', 'Ton support « chaleureux »']);
  });

  it('scopes « … sur « Niche » » rules to their niche, banned words stay global', () => {
    const rules = [
      'Prix cible « 24 » sur « Propreté du chiot en appartement » : 0,92 € par visiteur contre 0,75 € à 29 €.',
      'Privilégier le hook « pov » (POV) sur « Propreté du chiot en appartement » : CTR 2,6 %.',
      'Ne jamais écrire « miracle »',
    ];
    const chiot = parsePlaybook(rules, 'Propreté du chiot en appartement');
    expect(chiot.targetPrice).toBe(24);
    expect(chiot.hook).toBe('pov');
    const autre = parsePlaybook(rules, 'Batch cooking pour familles');
    expect(autre.targetPrice).toBeNull();
    expect(autre.hook).toBeNull();
    expect(autre.banned).toEqual(['miracle']);
  });

  it('replaces singleton rules, dedups and caps at 12', () => {
    const world = { company: { playbooks: {} as Record<string, string[]> } } as unknown as Parameters<typeof addPlaybookRule>[0];
    expect(addPlaybookRule(world, 'paul', 'Prix cible « 14 »')).toBe(true);
    expect(addPlaybookRule(world, 'paul', 'Prix cible « 24 »')).toBe(true);
    expect(world.company.playbooks.paul).toEqual(['Prix cible « 24 »']);
    expect(addPlaybookRule(world, 'paul', 'Prix cible « 24 »')).toBe(false);
    for (let i = 0; i < 20; i++) addPlaybookRule(world, 'paul', `Règle ${i}`);
    expect(world.company.playbooks.paul).toHaveLength(12);
  });
});

describe('tasks', () => {
  it('creates tasks with per-kind work and resolves dependencies', () => {
    const world = { day: 1, idCounter: 0, company: { tasks: [], missions: [] } } as unknown as Parameters<typeof createTask>[0];
    const a = createTask(world, { kind: 'scan_trends' });
    const b = createTask(world, { kind: 'write_pdf', dependsOn: [a.id] });
    expect(a.workLeft).toBe(2);
    expect(b.workLeft).toBe(4);
    expect(b.reviewer).toBe('samuel');
    expect(depState(world, b)).toBe('waiting');
    a.status = 'done';
    expect(depState(world, b)).toBe('ready');
    a.status = 'failed';
    expect(depState(world, b)).toBe('broken');
  });
});

describe.skipIf(!simPresent)('createWorld', () => {
  it('builds a complete, serialisable world', async () => {
    const { createWorld, defaultScenario } = await import('../src/runtime/index.js');
    const sc = defaultScenario({ seed: 7 });
    expect(sc).toMatchObject({ name: 'Scénario normal', companyName: 'Pixel Agency', startingCash: 500, horizonDays: 60, difficulty: 'normal', mindMode: 'auto', founderApproval: false, chargeCompute: true, maxComputeEur: 3, goal: { targetProfit: 1000, byDay: 60 } });
    const w = createWorld(sc, 'test-run');
    expect(w.version).toBe(1);
    expect(w.day).toBe(1);
    expect(w.tick).toBe(0);
    expect(w.phase).toBe('morning');
    expect(w.status).toBe('running');
    expect(w.company.agents).toHaveLength(31);
    expect(w.company.departments).toHaveLength(11);
    for (const d of w.company.departments) expect(w.company.agents.some((a) => a.id === d.chiefId)).toBe(true);
    for (const kind of ALL_KINDS) expect(w.company.agents.some((a) => a.taskKinds.includes(kind)), kind).toBe(true);
    for (const a of w.company.agents) {
      expect(a.status).toBe('idle');
      expect(a.place).toBe(a.dept);
      expect(a.energy).toBe(100);
      expect(a.level).toBe(1);
      expect(w.company.playbooks[a.id]!.length).toBeGreaterThan(0);
    }
    const capital = w.ledger.find((e) => e.type === 'capital');
    expect(capital?.amount).toBe(500);
    expect(w.activity.length).toBeGreaterThan(0);
    expect(w.market.niches.length).toBeGreaterThan(0);
    expect(() => JSON.parse(JSON.stringify(w))).not.toThrow();
  });
});

describe.skipIf(!modulesPresent)('reviews and founder approvals', () => {
  async function setup() {
    const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
    const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
    const learning = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
    const root = mkdtempSync(join(tmpdir(), 'pixel-agency-review-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const world = createWorld(defaultScenario({ seed: 11, mindMode: 'heuristic' }), 'test-review');
    const company = new Company(world, { paths, engine: minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 11 }), brain: learning.createBrainVault(paths) });
    return { world, company, root };
  }

  function weakProduct(world: Awaited<ReturnType<typeof setup>>['world']) {
    const nicheId = world.market.niches[0]!.id;
    const generic = 'Il est important de noter que chaque personne est différente. Soyez patient. En conclusion, n’hésitez pas à essayer.';
    const chapter = { title: 'Chapitre', intro: generic, paragraphs: [generic], steps: [], example: null, checklist: [], visual: null };
    const product = {
      id: 'prd_test', nicheId, title: 'Guide', subtitle: '', audience: 'tout le monde', problem: 'tout', price: 0, status: 'writing' as const, version: 1,
      content: { title: 'Guide', subtitle: '', audience: 'tout le monde', promise: 'tout changer', introduction: [generic], chapters: [chapter], bonus: chapter, nextStep: { title: '', text: '', upsellProductId: null }, wordCount: 60 },
      design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
      createdDay: 1, launchedDay: null, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
    };
    world.company.products.push(product);
    const task = createTask(world, { kind: 'write_pdf', input: { productId: product.id, nicheId }, assignee: 'theo' });
    task.status = 'review';
    world.tick = 1;
    world.phase = 'work';
    return { product, task };
  }

  it('sends weak work back with notes, then approves after 3 attempts', async () => {
    const { world, company, root } = await setup();
    try {
      const { task } = weakProduct(world);
      await company.step();
      expect(task.reviews.at(-1)?.verdict).toBe('changes');
      expect(task.reviews.at(-1)?.by).toBe('samuel');
      expect(task.reviews.at(-1)?.notes.length).toBeGreaterThan(0);
      expect(task.attempts).toBe(1);
      expect(['pending', 'in_progress']).toContain(task.status);
      expect(world.activity.some((a) => a.kind === 'review' && a.agentId === 'samuel' && a.toAgentId === 'theo')).toBe(true);
      // Third review: approved anyway, with an explicit note.
      task.status = 'review';
      task.attempts = 2;
      await company.step();
      expect(task.status).toBe('done');
      expect(task.reviews.at(-1)?.verdict).toBe('approve');
      expect(task.reviews.at(-1)?.notes.join(' ')).toMatch(/3 tentatives/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('founder approval releases or cancels a gated task', async () => {
    const { world, company, root } = await setup();
    try {
      const a = createTask(world, { kind: 'launch_campaign', input: {}, assignee: 'adam' });
      const b = createTask(world, { kind: 'publish_product', input: {}, assignee: 'clara' });
      for (const t of [a, b]) { t.status = 'awaiting_founder'; world.company.pendingApprovals.push(t.id); }
      company.approve(a.id, true);
      company.approve(b.id, false);
      expect(a.status).toBe('pending');
      expect(a.input.founderApproved).toBe(true);
      expect(b.status).toBe('cancelled');
      expect(world.company.pendingApprovals).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!modulesPresent)('headless company (heuristic minds)', () => {
  it('runs 12 days: product live by day 5 with a real PDF, approved creative, campaign, KPIs and lessons', async () => {
    const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
    const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
    const learning = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
    const root = mkdtempSync(join(tmpdir(), 'pixel-agency-'));
    try {
      const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
      const world = createWorld(defaultScenario({ seed: 42, mindMode: 'heuristic' }), 'test-headless');
      const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 42 });
      const company = new Company(world, { paths, engine, brain: learning.createBrainVault(paths) });
      const kpis: DailyKpi[] = [];
      let liveByDay5 = false;
      for (let d = 1; d <= 12; d++) {
        await company.runDays(1, (k) => kpis.push(k));
        if (d <= 5 && world.company.products.some((p) => p.status === 'live' || p.launchedDay !== null)) liveByDay5 = true;
      }
      expect(kpis.map((k) => k.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(liveByDay5).toBe(true);
      const launched = world.company.products.find((p) => p.launchedDay !== null)!;
      expect(launched.launchedDay!).toBeLessThanOrEqual(5);
      expect(launched.files.pdf).toMatch(/^files\/.+\/v\d+\/guide\.pdf$/);
      const pdf = join(root, ...launched.files.pdf!.split('/'));
      expect(existsSync(pdf)).toBe(true);
      expect(statSync(pdf).size).toBeGreaterThan(5_000);
      expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
      expect(existsSync(join(root, ...launched.files.salesPage!.split('/')))).toBe(true);
      expect(existsSync(join(root, ...launched.files.cover!.split('/')))).toBe(true);
      expect(world.company.creatives.some((c) => c.review.status === 'approved')).toBe(true);
      expect(world.company.campaigns.length).toBeGreaterThanOrEqual(1);
      expect(world.company.lessons.length).toBeGreaterThanOrEqual(1);
      expect(world.company.deliverables.some((d) => d.kind === 'pdf')).toBe(true);
      expect(world.company.missions.length).toBeGreaterThan(0);
      expect(world.company.tasks.filter((t) => t.status === 'done').length).toBeGreaterThan(30);
      expect(world.activity.some((a) => a.kind === 'brain_read')).toBe(true);
      expect(world.activity.some((a) => a.kind === 'delegate' && a.toAgentId)).toBe(true);
      expect(world.activity.some((a) => a.kind === 'review')).toBe(true);
      expect(world.day).toBe(13);
      expect(() => JSON.parse(JSON.stringify(world))).not.toThrow();
      // Founder interaction surfaces.
      const missionId = await company.giveMission('Écris de nouveaux hooks TikTok pour notre guide');
      expect(world.company.missions.find((m) => m.id === missionId)?.from).toBe('founder');
      const reply = await company.chat('camille', 'Où en est-on ?');
      expect(reply.length).toBeGreaterThan(5);
      expect(world.company.chats.camille).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
});

// ───────────────────────────── fix phase: acquisition, organic, minds, compute ─────────────────────────────

describe.skipIf(!modulesPresent)('acquisition policy, organic posts and mind context (regressions)', () => {
  type World = import('../src/shared.js').WorldState;
  type Product = import('../src/shared.js').Product;

  async function setup(seed = 21) {
    const { createWorld, defaultScenario } = await import('../src/runtime/index.js');
    const { sim } = await import('../src/runtime/modules.js');
    const { createRng } = await import('../src/core/index.js');
    const minds = (await import('../src/minds/index.js')) as unknown as { createContentEngine: (o: { mode: 'heuristic'; maxComputeEur: number; seed: number }) => ContentEngine };
    const learning = (await import('../src/learning/index.js')) as unknown as { createBrainVault: (p: RunPaths) => BrainVault };
    const root = mkdtempSync(join(tmpdir(), 'pixel-agency-acq-'));
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const world = createWorld(defaultScenario({ seed, mindMode: 'heuristic' }), 'test-acq');
    const engine = minds.createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });
    const brain = learning.createBrainVault(paths);
    await brain.init();
    const rng = createRng(world.rngState);
    const ctx = { world, engine, brain, tools: sim.createMarketTools(world, rng), rng, paths, incidents: [] as string[], lastMarketNotes: [] as string[] };
    return { world, engine, brain, ctx, root, paths, sim };
  }

  function review(day: number, rating: 1 | 2 | 3 | 4 | 5, i: number) {
    return { id: `rev_${day}_${i}_${rating}`, day, customerId: `cus_r${i}`, rating, text: rating >= 4 ? 'Très utile, merci.' : 'Pas à la hauteur de la promesse.' };
  }

  function addProduct(world: World, id: string, over: Partial<Product> = {}): Product {
    const p: Product = {
      id, nicheId: world.market.niches[0]!.id, title: `Guide ${id}`, subtitle: '', audience: 'Parents de bébés de 6 à 12 mois', problem: 'Bébé se réveille toutes les 2 h',
      price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null },
      quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
      stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
      ...over,
    };
    if (p.stats.reviews.length) p.stats.rating = p.stats.reviews.reduce((s, r) => s + r.rating, 0) / p.stats.reviews.length;
    world.company.products.push(p);
    return p;
  }

  function addOrders(world: World, productId: string, day: number, n: number, refunded = 0) {
    for (let i = 0; i < n; i++) {
      world.market.orders.push({ id: `ord_${productId}_${day}_${i}`, day, customerId: `cus_o${i}`, productId, price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: i < refunded, chargeback: false });
    }
  }

  /** One campaign: `days` days of `spendPerDay` at `roas`, last day = `endDay`. */
  function addCampaign(world: World, productId: string, id: string, endDay: number, days: number, spendPerDay: number, roas: number, status: 'paused' | 'active' = 'paused') {
    const startDay = endDay - days + 1;
    world.company.campaigns.push({ id, productId, name: `Campagne ${id}`, creativeIds: [`cre_${id}`], dailyBudget: spendPerDay, status, targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay, createdBy: 'adam' });
    for (let d = startDay; d <= endDay; d++) {
      world.market.adStats.push({
        day: d, campaignId: id, creativeId: `cre_${id}`, productId, spend: spendPerDay, impressions: 5000, clicks: 100, ctr: 0.02, cpc: spendPerDay / 100, cpm: spendPerDay / 5,
        landingViews: 90, purchases: Math.round((spendPerDay * roas) / 19), revenue: spendPerDay * roas, roas, frequency: 1.4, comments: [],
      });
    }
  }

  it('product health: rating < 3 on ≥ 3 reviews and significant refunds are severe; a reworked version is judged on its own reviews', async () => {
    const { world, root } = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      world.day = 30;
      const two = addProduct(world, 'prd_two', { stats: { views: 0, sales: 5, revenue: 95, refunds: 0, refundAmount: 0, rating: 0, upsellSales: 0, reviews: [review(5, 1, 1), review(6, 2, 2)] } });
      expect(acq.productHealth(world, two).severe).toBeNull(); // 2 reviews: not judged yet
      const bad = addProduct(world, 'prd_bad', { stats: { views: 0, sales: 15, revenue: 285, refunds: 0, refundAmount: 0, rating: 0, upsellSales: 0, reviews: [review(5, 1, 1), review(6, 2, 2), review(7, 3, 3)] } });
      expect(acq.productHealth(world, bad).severe).toMatch(/note 2,0\/5 sur 3 avis/);
      expect(acq.promotionBlock(world, bad)).toMatch(/note/);
      expect(acq.acquisitionCandidates(world).map((c) => c.product.id)).not.toContain('prd_bad');
      // Refunds: 5 of 31 (16 %) is noise in a market of refund hunters; 4 of 10 is not.
      const noisy = addProduct(world, 'prd_noisy');
      addOrders(world, noisy.id, 10, 31, 5);
      expect(acq.productHealth(world, noisy).severe).toBeNull();
      const refunded = addProduct(world, 'prd_refunded');
      addOrders(world, refunded.id, 10, 10, 4);
      expect(acq.productHealth(world, refunded).severe).toMatch(/40 % de remboursements sur 10 ventes/);
      // v2 republished on day 25: the old bad reviews no longer decide… for 10 days.
      const v2 = addProduct(world, 'prd_v2', { version: 2, stats: { views: 0, sales: 15, revenue: 285, refunds: 0, refundAmount: 0, rating: 0, upsellSales: 0, reviews: [review(5, 1, 1), review(6, 1, 2), review(7, 2, 3), review(27, 5, 4)] } });
      const republish = createTask(world, { kind: 'publish_product', input: { productId: v2.id, republish: true } });
      republish.status = 'done';
      republish.dayDone = 25;
      expect(acq.productHealth(world, v2).severe).toBeNull();
      world.day = 36; // 11 days later, still < 3 reviews of its own: the store rating (2,3/5) judges it again
      expect(acq.productHealth(world, v2).severe).toMatch(/note affichée/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cooldown after losing campaigns, "ads-dead" versions, fresh creatives and the stop-loss minimum sample', async () => {
    const { world, root } = await setup();
    try {
      const acq = await import('../src/runtime/acquisition.js');
      const { stopLossReason } = await import('../src/runtime/handlers/growth.js');
      const { campaignMetrics } = await import('../src/runtime/metrics.js');
      world.day = 20;
      const p = addProduct(world, 'prd_ads');
      addCampaign(world, p.id, 'cpg_a', 12, 5, 30, 2.0);
      addCampaign(world, p.id, 'cpg_b', 16, 2, 30, 0.5);
      addCampaign(world, p.id, 'cpg_c', 19, 2, 30, 0.6);
      const h = acq.adHistory(world, p.id);
      expect(h.losers).toBe(2);
      expect(h.lastEndDay).toBe(19);
      const block = acq.productPaidBlock(world, p);
      expect(block).toMatchObject({ hard: false });
      expect(block!.reason).toMatch(/2 campagnes perdantes/);
      world.day = 21;
      expect(acq.productPaidBlock(world, p)).toBeNull(); // 1 day of cooldown only
      addCampaign(world, p.id, 'cpg_d', 22, 1, 35, 0);
      addCampaign(world, p.id, 'cpg_e', 25, 1, 35, 0.3);
      world.day = 27;
      expect(acq.adHistory(world, p.id).losers).toBe(4);
      expect(acq.productPaidBlock(world, p)).toMatchObject({ hard: true });
      world.day = 33; // a week after the last campaign: one fresh test is allowed again
      expect(acq.productPaidBlock(world, p)).toBeNull();
      // Creatives: never shown first; fatigued or money-losing ones are never relaunched.
      const base = {
        productId: p.id, hookStyle: 'question' as const, format: 'text_slideshow' as const, scenes: [], caption: '', hashtags: [], cta: '',
        files: { storyboard: [], preview: null }, quality: null, review: { status: 'approved' as const, reason: null, day: 1 }, createdDay: 1, createdBy: 'chloe',
      };
      world.company.creatives.push({ ...base, id: 'cre_new', hook: 'Neuf' }, { ...base, id: 'cre_cpg_a', hook: 'Usé' }, { ...base, id: 'cre_cpg_d', hook: 'Perdante' });
      for (const s of world.market.adStats) if (s.creativeId === 'cre_cpg_a') s.frequency = 3.4;
      expect(acq.launchableCreatives(world, p.id).map((c) => c.id)).toEqual(['cre_new']);
      // Stop-loss: one day at 37 € and ROAS 0,65 is noise; no traction after 25 € is not; 2 days / 45 € at 0,7 is a loser.
      const metrics = (rows: { day: number; spend: number; revenue: number }[]) => campaignMetrics(rows.map((r) => ({ ...world.market.adStats[0]!, campaignId: 'x', ...r })), 'x');
      const oneDay = metrics([{ day: 10, spend: 37, revenue: 24 }]);
      expect(stopLossReason(oneDay, oneDay)).toBeNull();
      const dead = metrics([{ day: 10, spend: 37, revenue: 0 }]);
      expect(stopLossReason(dead, dead)).toMatch(/aucune traction/);
      const twoDays = metrics([{ day: 10, spend: 22, revenue: 16 }, { day: 11, spend: 23, revenue: 15 }]);
      expect(stopLossReason(twoDays, twoDays)).toMatch(/sur 2 jours/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CEO plan: pauses + reworks a disliked guide, never promotes it, and relaunches the best product even after 5 campaigns', async () => {
    const { world, ctx, root, sim } = await setup();
    try {
      const { buildHeuristicPlan, materialize } = await import('../src/runtime/strategy.js');
      world.day = 55;
      sim.recordLedger(world, { type: 'revenue', amount: 950, memo: 'Ventes (fixture)', ref: null }); // ~1 450 € in cash
      const bad = addProduct(world, 'prd_91', { title: 'Il fait pipi sur le tapis', stats: { views: 0, sales: 15, revenue: 585, refunds: 2, refundAmount: 78, rating: 0, upsellSales: 0, reviews: [review(20, 1, 1), review(30, 1, 2), review(40, 2, 3)] } });
      const best = addProduct(world, 'prd_4058', { title: 'SOS Sommeil', launchedDay: 27, stats: { views: 0, sales: 84, revenue: 3276, refunds: 6, refundAmount: 234, rating: 0, upsellSales: 0, reviews: Array.from({ length: 21 }, (_, i) => review(30 + i, i % 5 === 0 ? 3 : 4, i)) } });
      addOrders(world, best.id, 40, 30, 2);
      // Five campaigns already (the old hard cap): a big winner, then four one-day tests, the last one 3 days ago.
      addCampaign(world, best.id, 'cpg_1', 46, 18, 60, 2.2);
      addCampaign(world, best.id, 'cpg_2', 48, 1, 37, 0);
      addCampaign(world, best.id, 'cpg_3', 49, 1, 33, 0.9);
      addCampaign(world, best.id, 'cpg_4', 50, 1, 35, 1.1);
      addCampaign(world, best.id, 'cpg_5', 52, 1, 30, 0.7);
      for (let i = 0; i < 5; i++) addCampaign(world, bad.id, `cpg_b${i}`, 20 + i, 1, 30, 0.5);
      const plan = await buildHeuristicPlan(ctx);
      // (d) the disliked guide is taken off sale and rewritten, never promoted
      expect(bad.status).toBe('paused');
      expect(plan.items.some((i) => i.kind === 'write_pdf' && i.input.productId === bad.id && i.input.pipeline === 'v2')).toBe(true);
      const promoting = (pid: string) => plan.items.filter((i) => ['post_organic', 'write_ad_hooks', 'launch_campaign', 'find_creators'].includes(i.kind) && i.input.productId === pid);
      expect(promoting(bad.id)).toHaveLength(0);
      // (a)(b) the best product gets concrete acquisition tasks, and the focus names it
      expect(promoting(best.id).filter((i) => i.kind === 'write_ad_hooks' || i.kind === 'launch_campaign')).toHaveLength(1);
      expect(plan.focus).toContain('SOS Sommeil');
      expect(plan.focus).not.toContain('pipi');
      const posts = plan.items.filter((i) => i.kind === 'post_organic');
      expect(posts.length).toBeGreaterThan(0);
      expect(posts.length).toBeLessThanOrEqual(2);
      expect(posts.every((i) => i.input.productId === best.id)).toBe(true);
      const tasks = materialize(ctx, plan.items, { createdBy: 'camille', missionId: null });
      expect(tasks.some((t) => t.kind === 'write_ad_hooks' && t.input.productId === best.id && t.input.launch === true)).toBe(true);
      expect(tasks.some((t) => t.kind === 'write_pdf' && t.input.productId === bad.id)).toBe(true);
      expect(world.activity.some((a) => /retire « Il fait pipi/.test(a.text))).toBe(true);
      // The same items planned again while the tasks are still open are not duplicated (dedup key includes nicheId).
      const again = materialize(ctx, plan.items.filter((i) => i.kind === 'post_organic' || i.kind === 'write_ad_hooks'), { createdBy: 'camille', missionId: null });
      expect(again).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CEO plan: says why nothing launches, and the watchdog restarts acquisition stuck for 2+ days', async () => {
    const { world, ctx, root, sim } = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      world.day = 30;
      sim.recordLedger(world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      const p = addProduct(world, 'prd_ok', { title: 'Potager sur balcon', launchedDay: 5 });
      addOrders(world, p.id, 20, 12);
      addCampaign(world, p.id, 'cpg_old', 26, 10, 30, 1.6);
      // Ad account suspended: no launch, and the reason is said out loud.
      world.market.adAccount = { strikes: 3, banned: true, bannedUntilDay: 34 };
      let plan = await buildHeuristicPlan(ctx);
      expect(plan.items.some((i) => i.kind === 'launch_campaign' || i.kind === 'write_ad_hooks')).toBe(false);
      expect(plan.focus).toMatch(/Pub payante en pause \(compte publicitaire TikTok suspendu jusqu'au jour 34\)/);
      expect(world.activity.some((a) => a.agentId === 'leo' && /pas de nouvelle campagne aujourd'hui — compte publicitaire/.test(a.text))).toBe(true);
      // Ban over, but hook writing has been stuck (unassigned) since day 27: cancelled and restarted.
      world.market.adAccount = { strikes: 0, banned: false, bannedUntilDay: 0 };
      const stuck = createTask(world, { kind: 'write_ad_hooks', input: { productId: p.id, produce: 2 } });
      stuck.dayCreated = 27;
      plan = await buildHeuristicPlan(ctx);
      expect(stuck.status).toBe('cancelled');
      expect(plan.items.some((i) => (i.kind === 'write_ad_hooks' || i.kind === 'launch_campaign') && i.input.productId === p.id)).toBe(true);
      expect(plan.focus).toContain('Potager sur balcon');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('watchdog: when every product is "ads-dead" and nothing ran for 2 days, one minimum-budget test instead of idling', async () => {
    const { world, ctx, root, sim } = await setup();
    try {
      const { buildHeuristicPlan } = await import('../src/runtime/strategy.js');
      world.day = 30;
      sim.recordLedger(world, { type: 'revenue', amount: 800, memo: 'Ventes (fixture)', ref: null });
      const p = addProduct(world, 'prd_dead', { title: 'Chat qui griffe le canapé', launchedDay: 5 });
      addOrders(world, p.id, 10, 12);
      for (let i = 0; i < 4; i++) addCampaign(world, p.id, `cpg_l${i}`, 21 + 2 * i, 1, 35, 0.3); // last loser ended on day 27
      const plan = await buildHeuristicPlan(ctx);
      const test = plan.items.find((i) => (i.kind === 'write_ad_hooks' || i.kind === 'launch_campaign') && i.input.productId === p.id);
      expect(test?.input).toMatchObject({ force: true, test: true });
      expect(test?.priority).toBe(1);
      expect(plan.memo).toMatch(/Garde-fou : 2 jours sans pub, test à petit budget/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('organic: at most 2 posts per product and per day, rotating styles, never the same text twice in 7 days', async () => {
    const { world, ctx, root } = await setup(7);
    try {
      const { HANDLERS } = await import('../src/runtime/handlers/index.js');
      const { hookKey } = await import('../src/runtime/handlers/growth.js');
      const nicheIds = world.market.niches.slice(0, 2).map((n) => n.id);
      const a = addProduct(world, 'prd_a', { nicheId: nicheIds[0]!, title: 'Bébé se réveille la nuit' });
      const b = addProduct(world, 'prd_b', { nicheId: nicheIds[1]!, title: 'Le chiot fait pipi partout' });
      // The original bug: a learned « Privilégier le hook « story » » made Tom post the same generic story hook everywhere.
      world.company.playbooks.tom = [...(world.company.playbooks.tom ?? []), 'Privilégier le hook « story »'];
      const tom = world.company.agents.find((x) => x.id === 'tom')!;
      const skipped: string[] = [];
      for (let day = 2; day <= 15; day++) {
        world.day = day;
        for (const p of [a, b, a, b, a]) {
          const task = createTask(world, { kind: 'post_organic', input: { productId: p.id }, assignee: 'tom' });
          const mind = { agent: tom, playbook: [...world.company.playbooks.tom!], brainNotes: [], lessons: [], day, brand: world.scenario.companyName };
          const out = await HANDLERS.post_organic.run(ctx, task, tom, mind);
          if (out.output?.skipped) skipped.push(String(out.output.reason));
        }
      }
      const posts = world.market.organicPosts;
      expect(posts.length).toBeGreaterThan(40);
      // A 3rd request for the same product the same day is refused; without a fresh hook Tom skips rather than repeats.
      expect(skipped.filter((r) => r === 'quota').length).toBeGreaterThan(0);
      expect(skipped.every((r) => r === 'quota' || r === 'no_fresh_hook')).toBe(true);
      const perDay = new Map<string, number>();
      for (const p of posts) perDay.set(`${p.day}:${p.productId}`, (perDay.get(`${p.day}:${p.productId}`) ?? 0) + 1);
      expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
      const lastSeen = new Map<string, number>();
      for (const p of [...posts].sort((x, y) => x.day - y.day)) {
        const k = hookKey(p.hook);
        const prev = lastSeen.get(k);
        expect(prev === undefined || p.day - prev >= 7, `« ${p.hook} » reposté au jour ${p.day} (déjà le jour ${prev})`).toBe(true);
        lastSeen.set(k, p.day);
      }
      for (const pid of [a.id, b.id]) {
        const mine = posts.filter((p) => p.productId === pid);
        expect(new Set(mine.map((p) => p.hookStyle)).size).toBeGreaterThanOrEqual(4);
        for (const d of new Set(mine.map((p) => p.day))) {
          const styles = mine.filter((p) => p.day === d).map((p) => p.hookStyle);
          expect(new Set(styles).size).toBe(styles.length); // never twice the same style the same day
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('support replies get the customer (name, archetype) and the brand; the CFO envelope lands in company.budget', async () => {
    const { world, ctx, root, engine } = await setup();
    try {
      const { HANDLERS } = await import('../src/runtime/handlers/index.js');
      const seen: { customer: unknown; brand: unknown }[] = [];
      const spy = Object.create(engine) as ContentEngine;
      spy.writeSupportReply = async (input, mind) => { seen.push({ customer: input.customer, brand: mind.brand }); return engine.writeSupportReply(input, mind); };
      ctx.engine = spy;
      const p = addProduct(world, 'prd_s');
      const customer = { id: 'cus_karen', name: 'Karine L.', email: 'k@example.fr', archetype: 'karen' as const, patience: 0.2, orders: [], satisfaction: -0.4 };
      world.market.customers.push(customer);
      world.market.inbox.push({
        id: 'msg_k', day: 3, customerId: customer.id, channel: 'email', subject: 'Inadmissible', body: "Je n'ai toujours rien reçu, c'est inadmissible !", intent: 'non_recu',
        productId: p.id, orderId: null, mood: -0.7, status: 'open', deadlineDay: 5, thread: [], resolution: null,
      });
      world.day = 3;
      const agent = world.company.agents.find((a) => a.taskKinds.includes('reply_inbox'))!;
      const task = createTask(world, { kind: 'reply_inbox', input: { messageIds: ['msg_k'] }, assignee: agent.id });
      await HANDLERS.reply_inbox.run(ctx, task, agent, { agent, playbook: [], brainNotes: [], lessons: [], day: 3, brand: 'Atelier Pixel' });
      expect(seen).toEqual([{ customer: { name: 'Karine L.', archetype: 'karen' }, brand: 'Atelier Pixel' }]);
      const gabriel = world.company.agents.find((a) => a.id === 'gabriel')!;
      await HANDLERS.budget_review.run(ctx, createTask(world, { kind: 'budget_review', assignee: 'gabriel' }), gabriel, { agent: gabriel, playbook: [], brainNotes: [], lessons: [], day: 3 });
      expect(world.company.budget).toMatchObject({ day: 3, survival: false });
      expect(world.company.budget!.adCap).toBeGreaterThan(0);
      expect(world.company.budget!.note).toMatch(/%/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('Company: brand in every mind, chat 404 for an unknown agent, cumulative world.mind and compute booked per delta on a resumed run', async () => {
    const { world, root, paths, engine, brain, sim } = await setup();
    try {
      const { Company } = await import('../src/runtime/index.js');
      world.scenario.companyName = 'Atelier Pixel';
      // Resumed run: 10 calls and 1,50 € already used (and booked) by a previous session.
      world.mind = { mode: 'heuristic', calls: 10, inputTokens: 1000, outputTokens: 500, costEur: 1.5, fallbacks: 1 };
      sim.recordLedger(world, { type: 'compute', amount: -1.5, memo: 'Calcul Claude (session précédente)', ref: null });
      let extraCost = 0;
      const brands: unknown[] = [];
      const fake = Object.create(engine) as ContentEngine;
      fake.usage = () => { const u = engine.usage(); return { ...u, costEur: u.costEur + extraCost }; };
      fake.chat = async (input, mind) => { brands.push(mind.brand); extraCost += 0.4; return engine.chat(input, mind); };
      const company = new Company(world, { paths, engine: fake, brain });
      expect(world.mind.calls).toBe(10);
      await company.chat('camille', 'Où en est-on ?');
      expect(brands).toEqual(['Atelier Pixel']);
      expect(world.mind.costEur).toBeCloseTo(1.9, 5);
      expect(world.mind.calls).toBeGreaterThanOrEqual(11);
      const compute = () => world.ledger.filter((e) => e.type === 'compute');
      expect(compute()).toHaveLength(2);
      expect(compute().reduce((s, e) => s + e.amount, 0)).toBeCloseTo(-1.9, 5);
      await company.chat('camille', 'Et maintenant ?');
      expect(compute().reduce((s, e) => s + e.amount, 0)).toBeCloseTo(-2.3, 5);
      expect(world.mind.costEur).toBeCloseTo(2.3, 5);
      await expect(company.chat('personne', 'Salut')).rejects.toMatchObject({ status: 404 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
