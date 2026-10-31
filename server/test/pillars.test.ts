/**
 * The seams every later package builds on: the pillar hooks fire once, in order, where §2.5 says; the kinds still without
 * a handler are named; a stub answers like today's company (D47); a save from before the contract loads and plays.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { AgentState, Candidate, InboxMessage, Order, Product, ScenarioConfig, Task, TaskKind, WorldState } from '../src/shared.js';
import type { ArchiveBatch, Craft, RunPaths } from '../src/contracts.js';
import { createRng, streamRng } from '../src/core/index.js';
import { hashString } from '../src/core/ids.js';
import { hashString as textHash } from '../src/deliverables/text.js';
import { effortFor } from '../src/deliverables/effort.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { loadWorld, migrateWorld } from '../src/api/persist.js';
import { toSnapshot } from '../src/api/snapshot.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { versionSince } from '../src/runtime/acquisition.js';
import { allocationMorning, planTarget } from '../src/runtime/allocator.js';
import { channelsPillar, creditOf, multiChannel, openChannels } from '../src/runtime/channels.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { speak } from '../src/runtime/ctx.js';
import { compactWorld } from '../src/runtime/compaction.js';
import { desksPillar } from '../src/runtime/desks.js';
import { logDecision, weekRollup } from '../src/runtime/digest.js';
import { emptyGrowth, growthPillar } from '../src/runtime/growthPillar.js';
import { hookPool } from '../src/runtime/handlers/growth.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { adsHold } from '../src/runtime/holds.js';
import { detectedComplaints } from '../src/runtime/metrics.js';
import { CANDIDATES } from '../src/runtime/org/catalog.js';
import { LEAN_ORG, LEGACY_ORG } from '../src/runtime/org/constants.js';
import { canLeave, layoffsEvening, requestDeparture } from '../src/runtime/org/departure.js';
import { drawCandidates, headcountEvening, openPosition, requestRole } from '../src/runtime/org/hiring.js';
import { orgPillar } from '../src/runtime/org/index.js';
import { LEGACY_OFFICES, officerId, officerOf } from '../src/runtime/org/officers.js';
import { bookPayroll, minRunCash, payOf, payrollToday } from '../src/runtime/org/payroll.js';
import { auditOrg, deptFor, fitOf, legacyOrgState, speedFor, workFor } from '../src/runtime/org/reconcile.js';
import { PILLARS, type Pillar, type Worked } from '../src/runtime/pillars.js';
import { growthOn } from '../src/runtime/stages.js';
import { customerFeedback } from '../src/runtime/strategy.js';
import { STREAM } from '../src/runtime/streams.js';
import { armSharp, bestDraft, craftFor, effectiveT, pruneRead, routeBonus, scoreCandidates, shrunkRoas, talentMode, talentPillar } from '../src/runtime/talent/index.js';
import { ALL_KINDS, closeMissions, createTask, KIND_META } from '../src/runtime/tasks.js';
import { minStartingCash } from '../src/sim/balance.js';
import { DAY_PHASES } from '../src/sim/tick.js';
import { nichePool } from '../src/sim/capacity.js';
import { runOne } from '../scripts/balanceLib.js';
import { FIXTURE_FILE, GOLDEN } from '../scripts/golden.js';
import { LEGACY } from './legacy.js';

// The body is a stub until P9.2: only a spy tells a call from no call. It keeps the real body.
vi.mock('../src/runtime/compaction.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/runtime/compaction.js')>();
  return { ...real, compactWorld: vi.fn(real.compactWorld) };
});

/** Shrinks as packages land: P5.1 and P5.2 the channels, P11.1 and P11.2 the rest. Empty at the end. */
const NOT_LANDED: TaskKind[] = [
  'open_channel', 'adapt_creative', 'write_search_ads', 'reconcile_channels', 'allocate_channels',
  'write_lead_magnet', 'write_email_sequence', 'send_broadcast', 'design_bump', 'portfolio_review',
];

const roots: string[] = [];
const installed: Pillar[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pixel-pillars-'));
  roots.push(root);
  return root;
}

function pathsOf(root: string): RunPaths {
  return { root, brain: join(root, 'brain'), files: join(root, 'files') };
}

function mount(world: WorldState, archive?: (b: ArchiveBatch) => Promise<void>): Company {
  const paths = pathsOf(tmpRoot());
  const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed });
  return new Company(world, { paths, engine, brain: createBrainVault(paths), ...(archive ? { archive } : {}) });
}

function legacyWorld(seed = 7, over: Partial<ScenarioConfig> = {}): WorldState {
  return createWorld(defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic', maxComputeEur: 0, ...over }), `test-pillars-${seed}`);
}

function install(p: Pillar): void {
  (PILLARS as Pillar[]).push(p);
  installed.push(p);
}

function addLiveProduct(world: WorldState): Product {
  const p: Product = {
    id: 'prd_refus', nicheId: world.market.niches[0]!.id, title: 'Guide', subtitle: '', audience: 'Parents', problem: 'Un problème précis', price: 19, status: 'live', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: 1, price: 19 }],
  };
  world.company.products.push(p);
  return p;
}

afterEach(() => {
  for (const p of installed.splice(0)) (PILLARS as Pillar[]).splice(PILLARS.indexOf(p), 1);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('the pillar seam', () => {
  it('calls five pillars in the fixed order of the plan', () => {
    expect(PILLARS).toEqual([orgPillar, growthPillar, channelsPillar, talentPillar, desksPillar]);
  });

  it('a recording pillar sees each hook of a day once, in order, each where §2.5 puts it', async () => {
    const log: string[] = [];
    const seen: Record<string, unknown> = {};
    const workedTicks: { tick: number; list: Worked[] }[] = [];
    const ends: number[] = [];
    const nora = (w: WorldState): AgentState => w.company.agents.find((a) => a.id === 'nora')!;
    const today = (w: WorldState, kind: TaskKind): Task | undefined => w.company.tasks.find((t) => t.kind === kind && t.dayCreated === w.day);
    install({
      mount(w) { log.push('mount'); seen.mount = { tick: w.tick, memory: !!w.memory }; },
      async morning(ctx) {
        log.push('morning');
        seen.morning = { budget: today(ctx.world, 'budget_review')?.status, plan: today(ctx.world, 'plan_day') };
      },
      worked(ctx, list) { log.push('worked'); workedTicks.push({ tick: ctx.world.tick, list }); },
      marketClosed(ctx) {
        log.push('marketClosed');
        seen.market = { fixed: ctx.world.ledger.some((e) => e.ref === `fixed:${ctx.world.day}`), told: ctx.world.activity.some((a) => a.text.startsWith('Clôture du marché')) };
      },
      async evening(ctx) {
        log.push('evening');
        seen.evening = { retro: today(ctx.world, 'retro')?.status, kpi: ctx.world.company.kpis.some((k) => k.day === ctx.world.day), nora: nora(ctx.world).status };
      },
      async eveningEnd(ctx) { log.push('eveningEnd'); seen.eveningEnd = nora(ctx.world).status; },
      stepEnd(w) { log.push('stepEnd'); ends.push(w.tick); },
    });
    const world = legacyWorld();
    const company = mount(world);
    expect(log).toEqual(['mount']);
    for (let i = 0; i < 12; i++) await company.step();
    expect(log).toEqual([
      'mount', 'morning', 'stepEnd',
      ...Array.from({ length: 9 }, () => ['worked', 'stepEnd']).flat(),
      'marketClosed', 'stepEnd', 'evening', 'eveningEnd', 'stepEnd',
    ]);
    expect(seen.mount).toEqual({ tick: 0, memory: true });
    expect(seen.morning).toEqual({ budget: 'done', plan: undefined });
    expect(seen.market).toEqual({ fixed: true, told: false });
    expect(seen.evening).toEqual({ retro: 'done', kpi: true, nora: 'meeting' });
    expect(seen.eveningEnd).toBe('idle');
    expect(ends).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
    expect(workedTicks.map((w) => w.tick)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(workedTicks.flatMap((w) => w.list).length).toBeGreaterThan(0);
  }, 60_000);

  it('evening runs after the weekly review and before the missions close', async () => {
    const seen: { review: string | undefined; closable: number }[] = [];
    install({
      async evening(ctx) {
        const w = ctx.world;
        seen.push({ review: w.company.tasks.find((t) => t.kind === 'performance_review' && t.dayCreated === w.day)?.status, closable: closeMissions(structuredClone(w)).length });
      },
    });
    const world = legacyWorld();
    await mount(world).runDays(7);
    expect(seen.map((s) => s.review)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, 'done']);
    expect(seen.reduce((n, s) => n + s.closable, 0)).toBeGreaterThan(0); // closeMissions has not run yet: a later call would find nothing
  }, 60_000);

  it('reviewed comes before the verdict, taskDone before onDone, worked counts the reviewer, mind reaches the handler', async () => {
    const log: string[] = [];
    const craft = { skill: 'copy' } as Craft;
    const reviewed: { id: string; status: string; reviews: number; tick: number }[] = [];
    const workedReviews: Worked[] = [];
    const minds: { kind: TaskKind; craft: Craft | undefined }[] = [];
    const restore: (() => void)[] = [];
    for (const kind of ALL_KINDS) {
      const spec = HANDLERS[kind];
      if (!spec) continue;
      const { run, onDone } = spec;
      spec.run = (ctx, task, agent, mind) => { minds.push({ kind: task.kind, craft: mind.craft }); return run.call(spec, ctx, task, agent, mind); };
      if (onDone) spec.onDone = (ctx, task) => { log.push(`onDone:${task.id}`); return onDone.call(spec, ctx, task); };
      restore.push(() => { spec.run = run; spec.onDone = onDone; });
    }
    install({
      reviewed(ctx, task, res) {
        expect(typeof res.verdict).toBe('string');
        reviewed.push({ id: task.id, status: task.status, reviews: task.reviews.length, tick: ctx.world.tick });
      },
      taskDone(_ctx, task) { log.push(`taskDone:${task.id}:${task.status}`); },
      mind() { return { craft }; },
      worked(_ctx, list) { workedReviews.push(...list.filter((w) => w.review)); },
    });
    try {
      const world = legacyWorld();
      await mount(world).runDays(4);
      expect(reviewed.length).toBeGreaterThan(0);
      for (const r of reviewed) {
        expect(r.status).toBe('review');
        expect(world.company.tasks.find((t) => t.id === r.id)!.reviews.length).toBeGreaterThan(r.reviews);
      }
      expect(workedReviews.map((w) => w.taskId)).toEqual(reviewed.map((r) => r.id));
      for (const w of workedReviews) expect(world.company.tasks.find((t) => t.id === w.taskId)!.reviews.some((n) => n.by === w.agentId)).toBe(true);
      const dones = log.filter((l) => l.startsWith('onDone:'));
      expect(dones.length).toBeGreaterThan(0);
      for (const d of dones) expect(log[log.indexOf(d) - 1]).toBe(`taskDone:${d.slice('onDone:'.length)}:done`);
      // A ritual has no runHandler, so no hook: every other run went through it.
      const handled = minds.filter((m) => !['budget_review', 'retro', 'performance_review'].includes(m.kind));
      expect(handled.length).toBeGreaterThan(0);
      for (const m of handled) expect(m.craft).toBe(craft);
    } finally {
      for (const undo of restore) undo();
    }
  }, 120_000);

  it('refused runs after honourRefusal, on a refusal only', () => {
    const calls: { kind: TaskKind; held: boolean; status: string }[] = [];
    install({ refused(ctx, task) { calls.push({ kind: task.kind, held: !!adsHold(ctx.world, String(task.input.productId)), status: task.status }); } });
    const world = legacyWorld();
    const company = mount(world);
    const product = addLiveProduct(world);
    const ask = (): Task => {
      const t = createTask(world, { kind: 'launch_campaign', input: { productId: product.id }, assignee: 'adam' });
      t.status = 'awaiting_founder';
      world.company.pendingApprovals.push(t.id);
      return t;
    };
    company.approve(ask().id, true);
    expect(calls).toEqual([]);
    company.approve(ask().id, false);
    expect(calls).toEqual([{ kind: 'launch_campaign', held: true, status: 'cancelled' }]);
  });

  it('ctx.ritual runs a landed kind, stays quiet on one without a handler, and channelRng follows its stream', async () => {
    let tasks: { before: number; quiet: number; done: Task | undefined } | null = null;
    const draws: { rng: number; expected: number }[] = [];
    const draw = (ctx: RuntimeCtx): void => {
      const w = ctx.world;
      draws.push({ rng: ctx.channelRng.int(0, 1_000_000), expected: streamRng(w.scenario.seed, STREAM.channels, w.day, w.tick).int(0, 1_000_000) });
    };
    install({
      async morning(ctx) {
        const w = ctx.world;
        const before = w.company.tasks.length;
        await ctx.ritual('portfolio_review', 'camille', 'Pas encore de savoir-faire');
        const quiet = w.company.tasks.length;
        await ctx.ritual('budget_review', 'gabriel', 'Rituel de test');
        tasks = { before, quiet, done: w.company.tasks.find((t) => t.title === 'Rituel de test') };
        draw(ctx);
      },
      worked: draw,
    });
    const world = legacyWorld();
    const company = mount(world);
    for (let i = 0; i < 3; i++) await company.step();
    expect(tasks!.quiet).toBe(tasks!.before);
    expect(tasks!.done?.status).toBe('done');
    expect(draws).toHaveLength(3);
    for (const d of draws) expect(d.rng).toBe(d.expected);
    expect(new Set(draws.map((d) => d.rng)).size).toBe(3);
  }, 60_000);

  it('a week closes on the growth pillar, in both arms, and compaction goes to ctx.archive', async () => {
    const batches: ArchiveBatch[] = [];
    const world = legacyWorld();
    const ctx = { world, archive: async (b: ArchiveBatch) => { batches.push(b); } } as unknown as RuntimeCtx;
    const compact = vi.mocked(compactWorld);
    compact.mockClear();
    world.day = 6;
    await growthPillar.eveningEnd!(ctx);
    expect(batches).toEqual([]);
    expect(compact).not.toHaveBeenCalled();
    world.day = 7;
    await growthPillar.eveningEnd!(ctx);
    expect(batches).toEqual([compactWorld(world)]);
    compact.mockClear();
    await growthPillar.eveningEnd!({ world } as unknown as RuntimeCtx); // the bench passes nothing: its rows drop, the world still compacts
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledWith(world);
    mount(world);
    expect(world.company.growth).toEqual(emptyGrowth(world));
  });

  it('mounts org and growth on a fresh world, and a second mount leaves them alone', () => {
    const world = legacyWorld();
    expect(world.version).toBe(2);
    mount(world);
    expect(world.company.org!.offices.cfo).toBe('gabriel');
    expect(world.company.growth!.stage).toBe('survie');
    const org = world.company.org;
    const growth = world.company.growth;
    mount(world);
    expect(world.company.org).toBe(org);
    expect(world.company.growth).toBe(growth);
    expect(toSnapshot(world).company).not.toHaveProperty('org'); // D34, until P12.1 trims what the tabs read
  });
});

describe('handlers', () => {
  it('the kinds without a handler are exactly the allow-list', () => {
    expect(ALL_KINDS.filter((k) => !HANDLERS[k])).toEqual(NOT_LANDED);
  });
});

describe('streams', () => {
  it('keeps every stream number apart', () => {
    const values = Object.values(STREAM);
    expect(new Set(values).size).toBe(values.length);
    expect(STREAM).toMatchObject({ company: 1, tools: 2, market: 3, idleBreak: 4, channels: 9 });
  });

  it('runs the 19 phases of a close in the table of §2.6', () => {
    expect(DAY_PHASES.map((p) => p.stream)).toEqual([0, 1, 2, 3, 100, 4, 102, 103, 5, 6, 7, 8, 9, 10, 1004, null, 11, 1005, 101]);
  });

  it('moves hashString to core and keeps it on deliverables/text', () => {
    expect(textHash).toBe(hashString);
        expect(hashString('pixel')).toBe(1109892760);
  });
});

describe('stubs answer like today (D47)', () => {
  const world = legacyWorld();
  const agent = world.company.agents[0]!;
  const ctx = { world, rng: createRng(1) } as unknown as RuntimeCtx;

  it('talent off answers like today', async () => {
    expect(talentMode(world)).toBe('off');
    expect(effectiveT(world, agent, 'copy')).toBeUndefined();
    expect(craftFor(world, agent, 'produce_ad')).toBeUndefined();
    expect(routeBonus(world, agent, 'produce_ad')).toBe(0);
    expect(armSharp(ctx, agent, {} as never, 'hook')).toBeUndefined();
    expect(pruneRead([], ['a', 'b'], 0.8)).toEqual([]);
    expect(shrunkRoas(30, 10, 0)).toBe(3);
    expect(shrunkRoas(30, 0, 0)).toBe(0);
    const out = await bestDraft(ctx, agent, {} as never, 'test', async () => 'brouillon', () => 72);
    expect(out).toEqual({ draft: 'brouillon', drawn: 1, realScore: 72 });
    const candidates = [{ interview: 0, deliverable: 'x' }] as unknown as Candidate[];
    await scoreCandidates(ctx, 'ceo', candidates);
    expect(candidates[0]).toMatchObject({ interview: 50, deliverable: null });
  });

  it('TikTok alone, last click, no plan', async () => {
    expect(openChannels(world)).toEqual(['tiktok']);
    expect(multiChannel(world)).toBe(false);
    expect(creditOf(world, 'meta', 'n')).toBe(1);
    expect(planTarget(world, {} as never)).toBeNull();
    await expect(allocationMorning(ctx)).resolves.toBeUndefined();
  });

  it('no growth, and a decision is handed back unsaved, with no id spent', () => {
    expect(growthOn(legacyWorld(7, { scaling: true }))).toBe(false);
    const counter = world.idCounter;
    const d = logDecision(world, { kind: 'stage', who: 'system', text: 'x', why: 'y' });
    expect(d).toMatchObject({ day: world.day, kind: 'stage', who: 'system' });
    expect(world.idCounter).toBe(counter);
    expect(world.company.growth?.decisions ?? []).toEqual([]);
    expect(weekRollup(world, 1, 7)).toBeNull();
  });

  it('the org changes nothing: full speed, home department, nobody hired, nobody leaves, nobody paid', async () => {
    expect(fitOf(agent, 'plan_day')).toBe('core');
    expect(fitOf({ ...agent, hatKinds: ['plan_day'] }, 'plan_day')).toBe('hat');
    expect(speedFor(world, agent, 'write_pdf')).toBe(1);
    for (const kind of ALL_KINDS) {
      expect(workFor(world, kind)).toBe(KIND_META[kind].work);
      expect(deptFor(world, kind)).toBe(KIND_META[kind].dept);
    }
    expect(auditOrg(world)).toEqual([]);
    expect(requestRole(ctx, 'media_buyer_meta', 'channel', 'x')).toBeNull();
    expect(openPosition(ctx, 'media_buyer_meta', 'channel', 'x')).toBeNull();
    expect(drawCandidates(ctx, 'media_buyer_meta', 0, 3)).toEqual([]);
    expect(canLeave(world, 'zoe').ok).toBe(false);
    expect(await requestDeparture(ctx, 'zoe', 'x', 'nora', 'fired')).toBe('refused');
    expect(payrollToday(world)).toBe(0);
    expect(minRunCash({ org: LEGACY_ORG })).toBe(minStartingCash());
    const before = world.ledger.length;
    bookPayroll(ctx);
    await headcountEvening(ctx);
    await layoffsEvening(ctx);
    expect(world.ledger).toHaveLength(before);
  });

  it('numbers the specs give already hold', () => {
    expect(LEGACY).toMatchObject({ org: LEGACY_ORG });
    expect(LEAN_ORG).toEqual({ team: 'lean', autoHire: true, payroll: true });
    expect(payOf({ ...agent, tier: 'sonnet', level: 1 })).toBe(0.8);
    expect(effortFor(1)).toEqual({ covers: 8, layouts: 24, taste: 1, finish: 2 });
    const n = world.market.niches[0]!;
    expect(nichePool(world, n)).toBeGreaterThan(0);
  });

  it('offices fall back on the legacy holders, and speak says who talks', () => {
    const bare = legacyWorld();
    delete bare.company.org; // createWorld fills it: only a hand-built world goes without
    expect(bare.company.org).toBeUndefined();
    expect(officerId(bare, 'cfo')).toBe('gabriel');
    for (const o of Object.keys(LEGACY_OFFICES) as (keyof typeof LEGACY_OFFICES)[]) expect(officerOf(bare, o).id).toBe(LEGACY_OFFICES[o]);
    const line = speak({ world: bare } as unknown as RuntimeCtx, 'cfo', 'on tient le budget');
    expect(line).toMatchObject({ agentId: 'gabriel', kind: 'thought' });
    expect(line.text).toBe('Gabriel : on tient le budget');
    const moved = legacyOrgState(bare);
    moved.offices.cfo = 'alice';
    bare.company.org = moved;
    expect(officerId(bare, 'cfo')).toBe('alice');
  });
});

describe('RunSpec.scenario', () => {
  it('reaches the world of the run, over the benchmark defaults', async () => {
    const r = await runOne({ difficulty: 'normal', seed: 7, days: 1, budget: 500, scenario: { ...LEGACY, horizonDays: 1 } });
    expect(r.finalStatus).toBe('finished');
  }, 60_000);
});

describe('a save from before the contract', () => {
  function loadFixture(): WorldState {
    return JSON.parse(gunzipSync(readFileSync(FIXTURE_FILE)).toString('utf8')) as WorldState;
  }

  it('migrates once: scenario off, agents filled, products read from their tasks', () => {
    const raw = loadFixture();
    const w = migrateWorld(loadFixture());
    expect(w.version).toBe(2);
    expect(w.scenario).toMatchObject({ org: LEGACY_ORG, talent: 'off', channelControl: 'tiktok_only', videoModel: 'off', visualModel: 'off', scaling: false, openEnded: false });
    expect(w.company.agents).toHaveLength(31);
    for (const a of w.company.agents) {
      expect(a).toMatchObject({ roleId: CANDIDATES[a.id]!.roleId, gender: CANDIDATES[a.id]!.gender, founder: CANDIDATES[a.id]!.founder, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null });
    }
    const sold = w.company.products.filter((p) => p.launchedDay != null);
    expect(sold.length).toBeGreaterThan(0);
    for (const p of sold) expect(p.versionDay).toBeGreaterThanOrEqual(p.launchedDay!);
    for (const p of w.company.products) {
      expect(p.stats.ratingCount).toBe(p.stats.reviews.length);
      expect(p.stats.ratingSum).toBe(p.stats.reviews.reduce((s, r) => s + r.rating, 0));
      expect(p.hooks!.length).toBeLessThanOrEqual(60);
      expect(p.feedback!.length).toBeLessThanOrEqual(30);
    }
    expect(w.company.products.flatMap((p) => p.hooks!).length).toBeGreaterThan(0);
    for (const p of w.company.products) for (const h of p.hooks!) expect(Object.keys(h).sort()).toEqual(['hook', 'hookStyle']);
    // « Once »: a version 2 world is never read from its tasks again.
    const first = w.company.products[0]!;
    delete first.hooks;
    expect(migrateWorld(w).company.products[0]!.hooks).toBeUndefined();
    // Nothing the run decides on was touched.
    expect(w.ledger).toEqual(raw.ledger);
    expect(w.company.tasks).toEqual(raw.company.tasks);
    expect(w.market).toEqual(raw.market);
    expect(w.idCounter).toBe(raw.idCounter);
  });

  // Rows the day-20 fixture never met: a republished guide, buyers' complaints, a filled hook pool. §2.8 reads them once.
  it('reads a product from the rows its readers use, before compaction takes them', () => {
    const w = legacyWorld();
    w.version = 1;
    const p = addLiveProduct(w);
    const other: Product = { ...structuredClone(p), id: 'prd_autre' };
    const draft: Product = { ...structuredClone(p), id: 'prd_brouillon', status: 'idea', launchedDay: null };
    w.company.products.push(other, draft);
    const done = (kind: TaskKind, input: Record<string, unknown>, day: number, output: Record<string, unknown>): void => {
      const t = createTask(w, { kind, input });
      t.status = 'done';
      t.dayDone = day;
      t.output = output;
    };
    const message = (id: string, orderId: string | null) => ({ id, orderId }) as InboxMessage;
    w.market.orders.push({ id: 'ord_p', productId: p.id } as Order, { id: 'ord_o', productId: other.id } as Order);
    w.market.inbox.push(message('msg_p', 'ord_p'), message('msg_o', 'ord_o'), message('msg_troll', null));

    done('publish_product', { productId: p.id }, 3, {});
    done('publish_product', { productId: p.id, republish: true }, 12, {});
    done('publish_product', { productId: other.id, republish: true }, 20, {});
    createTask(w, { kind: 'publish_product', input: { productId: p.id, republish: true } }); // still to run: no new version yet

    const quality = { productId: p.id, detected: 'plainte_qualite' };
    done('reply_inbox', {}, 8, { replies: [
      { ...quality, messageId: 'msg_p', complaint: 'Il y a des répétitions partout.' },
      { ...quality, messageId: 'msg_p', complaint: null },
      { ...quality, messageId: 'msg_troll', complaint: "J'ai pas acheté mais ça a l'air nul." },
      { ...quality, messageId: 'msg_o', complaint: "L'acheteur d'un autre guide." },
      { productId: p.id, detected: 'question', messageId: 'msg_p', complaint: null },
    ] });
    done('reply_inbox', {}, 15, { replies: [{ productId: p.id, detected: 'remboursement', messageId: 'msg_p', complaint: 'Trop court pour le prix.' }] });
    createTask(w, { kind: 'reply_inbox', input: {} }).output = { replies: [{ ...quality, messageId: 'msg_p', complaint: 'Pas encore répondu.' }] };
    done('reply_inbox', {}, 16, { replies: Array.from({ length: 35 }, (_, i) => ({ productId: other.id, detected: 'plainte_qualite', messageId: 'msg_o', complaint: `Plainte ${i}` })) });

    done('write_ad_hooks', { productId: p.id }, 4, { hooks: [{ hook: 'Ancienne', hookStyle: 'story', angle: 'x' }, { hook: 'Style inconnu', hookStyle: 'mystere' }] });
    done('write_ad_hooks', { productId: p.id }, 9, { hooks: [{ hook: 'Récente', hookStyle: 'question' }] });
    done('write_ad_hooks', { productId: other.id }, 5, { hooks: Array.from({ length: 70 }, (_, i) => ({ hook: `Accroche ${i}`, hookStyle: 'stat' })) });

    migrateWorld(w);
    const ctx = { world: w } as unknown as RuntimeCtx;
    expect(p.versionDay).toBe(12);
    expect(p.versionDay).toBe(versionSince(w, p));
    expect(other.versionDay).toBe(20);
    expect(draft.versionDay).toBeUndefined();

    expect(p.feedback).toEqual([
      { day: 8, text: 'Il y a des répétitions partout.', quality: true },
      { day: 8, text: '', quality: true },
      { day: 15, text: 'Trop court pour le prix.', quality: false },
    ]);
    expect(p.feedback!.filter((f) => f.quality)).toHaveLength(detectedComplaints(w, p.id));
    expect(p.feedback!.map((f) => f.text).filter(Boolean)).toEqual(customerFeedback(ctx, p, 1));
    expect(other.feedback!.map((f) => f.text)).toEqual(Array.from({ length: 30 }, (_, i) => `Plainte ${i + 5}`)); // cap 30: the newest stay
    expect(draft.feedback).toEqual([]);

    expect(p.hooks).toEqual([{ hook: 'Récente', hookStyle: 'question' }, { hook: 'Ancienne', hookStyle: 'story' }]);
    expect(p.hooks).toEqual(hookPool(ctx, p.id));
    expect(other.hooks).toHaveLength(60);
    expect(other.hooks).toEqual(hookPool(ctx, other.id).slice(0, 60)); // cap 60, from the head of the pool
  });

  it('loads through loadWorld and plays 2 days on the mounted seams', async () => {
    const dir = tmpRoot();
    mkdirSync(join(dir, 'run-ancien'), { recursive: true });
    writeFileSync(join(dir, 'run-ancien', 'world.json'), gunzipSync(readFileSync(FIXTURE_FILE)));
    const world = (await loadWorld('run-ancien', { dir }))!;
    expect(world.version).toBe(2);
    expect(world.day).toBe(GOLDEN.fixtureDay + 1);
    const tasksBefore = world.company.tasks.length;
    const company = mount(world);
    expect(world.company.org!.offices.ceo).toBe('camille');
    expect(world.company.growth).toBeDefined();
    await company.runDays(2);
    expect(world.day).toBe(GOLDEN.fixtureDay + 3);
    expect(world.status).not.toBe('bankrupt');
    expect(world.company.tasks.length).toBeGreaterThan(tasksBefore);
    expect(world.company.kpis.map((k) => k.day)).toEqual(expect.arrayContaining([GOLDEN.fixtureDay + 1, GOLDEN.fixtureDay + 2]));
    const cash = Math.round(world.ledger.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    expect(world.company.kpis.at(-1)!.cash).toBeCloseTo(cash, 1);
    expect(world.company.tasks.filter((t) => t.log.some((l) => l.includes('erreur technique')))).toEqual([]);
  }, 120_000);
});
