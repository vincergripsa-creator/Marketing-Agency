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
