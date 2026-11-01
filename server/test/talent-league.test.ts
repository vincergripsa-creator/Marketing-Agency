/**
 * Seasons, plans and the challenge (talent §6.1, §7, D13 to D20, D48, D49). The rules are arithmetic over observed
 * numbers, so most of this runs on a world built by hand. The test a candidate sits is the real one unless a case swaps
 * its row: a row with fixed scores says exactly who wins, and the rules are what is being read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, AgentState, Product, ProbationPlan, RoleId, ScenarioConfig, Skill, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { nextId } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { toSnapshot } from '../src/api/snapshot.js';
import { reconcileDay } from '../src/runtime/accounting.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { addHold, pinHold } from '../src/runtime/holds.js';
import { sim } from '../src/runtime/modules.js';
import { ROLES } from '../src/runtime/org/catalog.js';
import { completeDeparture, requestDeparture } from '../src/runtime/org/departure.js';
import { drawCandidates, hireAgent, openPosition } from '../src/runtime/org/hiring.js';
import { reviewerFor, roleHolders } from '../src/runtime/org/officers.js';
import { auditOrg } from '../src/runtime/org/reconcile.js';
import { benchFor, closeEntry, decidedSwap, runChallenge, scoreCandidates, spearman, swapRefused, TEST_BY_SKILL, testDeliverable } from '../src/runtime/talent/challenge.js';
import type { SkillTest, TestResult } from '../src/runtime/talent/challenge.js';
import { MIN_SEASON_N, TALENT } from '../src/runtime/talent/constants.js';
import { craftFor } from '../src/runtime/talent/craft.js';
import { talentPillar } from '../src/runtime/talent/index.js';
import { closeSeason, dueSeasonClose, openPlans, reviewPlans } from '../src/runtime/talent/season.js';
import { createTask, KIND_META } from '../src/runtime/tasks.js';
import { mean } from '../src/runtime/util.js';

const roots: string[] = [];
const rows = new Map<Skill, SkillTest | undefined>();

afterEach(() => {
  for (const [skill, row] of rows) {
    if (row) TEST_BY_SKILL[skill] = row;
    else delete TEST_BY_SKILL[skill];
  }
  rows.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; root: string; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-league');
  const root = mkdtempSync(join(tmpdir(), 'pixel-league-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, root, reopen: (w) => new Company(w, opts) };
}

const league = (w: WorldState) => w.company.league!;
const holder = (w: WorldState, role: RoleId): AgentState => roleHolders(w, role)[0]!;
const cash = (w: WorldState): number => w.ledger.reduce((s, e) => s + e.amount, 0);

/** The evening of a close: `seasons` already closed behind it. */
function atClose(w: WorldState, day: number): void {
  w.day = day;
  const closed = Math.floor(day / TALENT.seasonDays) - 1;
  Object.assign(league(w), { closedSeasons: closed, season: closed + 1, seasonStartDay: day - TALENT.seasonDays + 1 });
}

function rate(w: WorldState, a: AgentState, numbers: { rating: number; rd?: number; seasonN?: number; metric?: number | null; n?: number }, skill: Skill = league(w).entries[a.id]!.primary!): void {
  const { rating, rd = 80, seasonN = 10, metric = 70, n = 20 } = numbers;
  league(w).entries[a.id]!.ratings[skill] = {
    skill, rating, rd, n, seasonN, metric, history: [{ day: 0, rating: TALENT.rating.par }],
    ...(metric === null ? {} : { metricBase: { season: league(w).season, sum: metric, w: 1 } }),
  };
}

/** Someone who already failed, with what a failed plan leaves behind. */
function failing(w: WorldState, a: AgentState, skill: Skill = league(w).entries[a.id]!.primary!): ProbationPlan {
  rate(w, a, { rating: 1400 }, skill);
  const plan: ProbationPlan = { agentId: a.id, skill, openedSeason: league(w).season - 1, deadlineDay: w.day, metricLabel: 'mesure', baseline: 70, target: 73, coachId: null, text: 'Plan', outcome: 'failed' };
  league(w).plans.push(plan);
  league(w).entries[a.id]!.status = 'probation';
  return plan;
}

/** A row that hands out scores: everyone sits it, nothing is written. */
function fixedRow(skill: Skill, score: (sitter: AgentState) => number): void {
  if (!rows.has(skill)) rows.set(skill, TEST_BY_SKILL[skill]);
  TEST_BY_SKILL[skill] = { par: () => 80, sit: async (_b, sitter) => ({ score: score(sitter), deliverable: 'Un test', work: [] }) };
}

/** Every skill of the five founders the league can judge: the incumbent scores `own`, whoever else `others`. */
function fixedRows(w: WorldState, own: number, others: number): void {
  const here = new Set(w.company.agents.map((a) => a.id));
  for (const skill of ['copy', 'longform', 'design', 'page', 'research', 'buying'] as const) fixedRow(skill, (s) => (here.has(s.id) ? own : others));
}

async function liveProduct(ctx: RuntimeCtx): Promise<Product> {
  const w = ctx.world;
  const niche = w.market.niches[0]!;
  const brief = ctx.tools.nicheBrief(niche.id)!;
  const voc = ctx.tools.minePains(niche.id, 'deep');
  w.company.research.voc[niche.id] = voc;
  const mind = { agent: w.company.agents[0]!, playbook: [], brainNotes: [], lessons: [], day: w.day };
  const outline = await ctx.engine.writeOutline({ title: brief.name, niche: brief, voc }, mind);
  const content = await ctx.engine.writePdfContent({ title: brief.name, outline, niche: brief, voc, upsellTitle: null }, mind);
  const product: Product = {
    id: nextId(w, 'prd'), nicheId: niche.id, title: brief.name, subtitle: content.subtitle ?? '', audience: brief.audience, problem: brief.problem, price: 19,
    status: 'live', version: 1, content, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null,
    createdDay: 1, launchedDay: 1, stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  w.company.products.push(product);
  return product;
}

/** A second person on a role: a family has someone to be lowest against. */
async function hireInto(ctx: RuntimeCtx, role: RoleId): Promise<AgentState> {
  const position = openPosition(ctx, role, 'founder', 'Pour le test')!;
  const candidate = drawCandidates(ctx, role, ctx.world.company.org!.positions.indexOf(position), 1)[0]!;
  return hireAgent(ctx, position, candidate);
}

describe('the calendar of a season', () => {
  it('is due on day 14 and 28, once, and an announced outage only pushes it to the next evening', async () => {
    const { world: w, ctx } = await lab();
    w.day = 13;
    expect(dueSeasonClose(w)).toBe(false);
    w.day = 14;
    expect(dueSeasonClose(w)).toBe(true);
    w.market.events.push({ id: 'evt_x', day: 13, kind: 'platform_outage', title: 'Panne', description: '', severity: 'warn', refs: { day: 14 } });
    expect(dueSeasonClose(w)).toBe(false);
    w.day = 15;
    expect(dueSeasonClose(w)).toBe(true);
    await closeSeason(ctx);
    expect(league(w).closedSeasons).toBe(1);
    expect(league(w).season).toBe(2);
    expect(dueSeasonClose(w)).toBe(false);
    w.day = 27;
    expect(dueSeasonClose(w)).toBe(false);
    w.day = 28;
    expect(dueSeasonClose(w)).toBe(true);
  }, 30_000);

  it('never in a world without a league', async () => {
    const { world: w } = await lab({ talent: 'off' });
    w.day = 14;
    expect(w.company.league).toBeUndefined();
    expect(dueSeasonClose(w)).toBe(false);
  });

  it('runs as a ritual of the talent pillar: one close, however many evenings', async () => {
    const { world: w, ctx } = await lab();
    w.day = 14;
    await talentPillar.evening!(ctx);
    await talentPillar.evening!(ctx);
    const tasks = w.company.tasks.filter((t) => t.kind === 'league_review');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'done', assignee: holder(w, 'hr_lead').id, reviewer: null, output: { season: 1 } });
    expect(league(w).seasons.map((s) => s.season)).toEqual([1]);
  }, 30_000);

  it('decays rd, keeps the sample in the report, and starts the next sample at zero', async () => {
    const { world: w, ctx } = await lab({ talent: 'flat' });
    atClose(w, 14);
    const a = holder(w, 'growth_lead');
    rate(w, a, { rating: 1560, rd: 100, seasonN: 6, metric: 92 });
    const report = await closeSeason(ctx);
    const r = league(w).entries[a.id]!.ratings.copy!;
    expect(r.rd).toBeCloseTo(100 * TALENT.rating.rdSeasonGrowth, 6);
    expect(r.seasonN).toBe(0);
    expect(report.tables.copy).toEqual([{ agentId: a.id, name: a.name, rating: 1560, delta: 60, metric: 92, n: 6, status: 'active' }]);
    expect(league(w).seasons[0]).toBe(report);
  }, 30_000);
});

describe('flat is a control', () => {
  it('stores the tables and the report, opens no plan, names nobody, replaces nobody', async () => {
    const { world: w, ctx } = await lab({ talent: 'flat' });
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, { rating: 1300 });
    const b = holder(w, 'shop_lead');
    rate(w, b, { rating: 1700 });
    const c = holder(w, 'editor_in_chief');
    failing(w, c);
    const headcount = w.company.agents.length;
    const report = await closeSeason(ctx);
    expect(report.tables.copy?.[0]?.rating).toBe(1300);
    expect(report.employee).toBeNull();
    expect(report.probations).toEqual([]);
    expect(league(w).plans.map((p) => p.outcome)).toEqual(['failed']);
    expect(league(w).perks).toEqual([]);
    expect(w.company.agents).toHaveLength(headcount);
  }, 30_000);
});

describe('who enters a plan (talent 15)', () => {
  const report = (w: WorldState) => ({ season: league(w).season, fromDay: 1, toDay: w.day, tables: {}, employee: null, probations: [] as string[], dismissals: [], hires: [], notes: [] as string[], disruptedDays: 0 });
  /** Under the gate on a full sample: the person the rules should catch. */
  const weak = { rating: 1400, rd: 80, seasonN: 10, metric: 81 };

  it('someone confidently under par, with the numbers said out loud', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 14);
    league(w).season = 2;
    const a = holder(w, 'growth_lead');
    rate(w, a, weak);
    league(w).closedSeasons = 1;
    openPlans(ctx, report(w));
    const plan = league(w).plans[0]!;
    expect(plan).toMatchObject({ agentId: a.id, skill: 'copy', openedSeason: 2, deadlineDay: 28, baseline: 81, target: 81 + 0.5 * TALENT.sd['copy:qa']!, outcome: 'open' });
    expect(plan.text).toContain(a.name);
    expect(plan.text).toContain('81/100');
    expect(plan.text).toContain('84/100');
    expect(plan.text).toContain('14 jours');
    expect(league(w).entries[a.id]!.status).toBe('probation');
  });

  it('not before 14 days in the job', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, weak);
    league(w).entries[a.id]!.hiredDay = 15;
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
    league(w).entries[a.id]!.hiredDay = 14;
    openPlans(ctx, report(w));
    expect(league(w).plans).toHaveLength(1);
  });

  it('not under the sample, whatever the rating says, and the report says why', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, { ...weak, rating: 1200, seasonN: MIN_SEASON_N.copy - 0.5 });
    const r = report(w);
    openPlans(ctx, r);
    expect(league(w).plans).toEqual([]);
    expect(r.notes.join(' ')).toContain('échantillon insuffisant');
  });

  it('not on a rating the uncertainty could explain: rating + 0,75 rd stays under par', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, { ...weak, rating: 1460, rd: 60 });
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
    rate(w, a, { ...weak, rating: 1454, rd: 60 });
    openPlans(ctx, report(w));
    expect(league(w).plans).toHaveLength(1);
  });

  it('only the lowest of a family, one per family, three a season', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    league(w).entries[writer.id]!.hiredDay = 0;
    rate(w, lead, { ...weak, rating: 1420 });
    rate(w, writer, { ...weak, rating: 1380 });
    for (const role of ['editor_in_chief', 'shop_lead', 'research_lead'] as const) rate(w, holder(w, role), weak);
    openPlans(ctx, report(w));
    const plans = league(w).plans;
    expect(plans).toHaveLength(TALENT.plan.perSeason);
    expect(plans.filter((p) => p.skill === 'copy').map((p) => p.agentId)).toEqual([writer.id]);
  }, 30_000);

  it('a colleague rated lower but still unsure keeps the person out: the lowest of the family is the one judged', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    league(w).entries[writer.id]!.hiredDay = 0;
    rate(w, lead, { ...weak, rating: 1420, rd: 80 });
    rate(w, writer, { ...weak, rating: 1380, rd: 200 });
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
  }, 30_000);

  it('two people level at the bottom of a family: one plan, not two', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    league(w).entries[writer.id]!.hiredDay = 0;
    rate(w, lead, weak);
    rate(w, writer, weak);
    openPlans(ctx, report(w));
    expect(league(w).plans).toHaveLength(TALENT.plan.perFamily);
  }, 30_000);

  it('never the CEO, who is out of the league (D13), whatever a hat brought her', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const ceo = holder(w, 'ceo');
    expect(league(w).entries[ceo.id]).toBeUndefined();
    league(w).entries[ceo.id] = { ...league(w).entries[holder(w, 'growth_lead').id]!, agentId: ceo.id, primary: null };
    rate(w, ceo, { ...weak, rating: 1100 }, 'research');
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
  });

  it('never on a hat: the art director is judged on design, not on the ads she wears (D14)', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const zoe = holder(w, 'art_director');
    expect(league(w).entries[zoe.id]!.primary).toBe('design');
    rate(w, zoe, { ...weak, rating: 1100 }, 'copy');
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
  });

  it('nobody pinned, nobody under a firing hold', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, weak);
    addHold(w, { kind: 'pin', productId: null, agentId: a.id, until: null, reason: 'garde' });
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
    w.company.holds = [];
    addHold(w, { kind: 'firing', productId: null, until: null, reason: 'ne vire personne' });
    openPlans(ctx, report(w));
    expect(league(w).plans).toEqual([]);
  });

  it('nobody in the last 10 days of a run with an end, and an open-ended run has none (D20)', async () => {
    const closing = await lab({ horizonDays: 90 });
    atClose(closing.world, 84);
    rate(closing.world, holder(closing.world, 'growth_lead'), weak);
    openPlans(closing.ctx, report(closing.world));
    expect(league(closing.world).plans).toEqual([]);
    const open = await lab({ horizonDays: 90, openEnded: true });
    atClose(open.world, 84);
    rate(open.world, holder(open.world, 'growth_lead'), weak);
    openPlans(open.ctx, report(open.world));
    expect(league(open.world).plans).toHaveLength(1);
  });

  it('the coach is the best colleague on the skill, else the chief, never the person', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    league(w).entries[writer.id]!.hiredDay = 0;
    rate(w, writer, { ...weak, rating: 1380 });
    rate(w, lead, { rating: 1600, metric: 92 });
    openPlans(ctx, report(w));
    expect(league(w).plans[0]).toMatchObject({ agentId: writer.id, coachId: lead.id });
    expect(league(w).plans[0]!.text).toContain(`Coach : ${lead.name} (92/100)`);
  }, 30_000);
});

describe('the end of a plan (§7.2)', () => {
  const report = (w: WorldState) => ({ season: league(w).season, fromDay: 15, toDay: w.day, tables: {}, employee: null, probations: [] as string[], dismissals: [], hires: [], notes: [] as string[], disruptedDays: 0 });
  const open = (w: WorldState, a: AgentState): ProbationPlan => {
    const plan = failing(w, a);
    plan.outcome = 'open';
    plan.target = 84;
    return plan;
  };

  it('met on the season\'s number', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = open(w, a);
    rate(w, a, { rating: 1420, metric: 84 });
    reviewPlans(ctx, report(w));
    expect(plan.outcome).toBe('met');
    expect(league(w).entries[a.id]!.status).toBe('active');
  });

  it('met on a rating back near par', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = open(w, a);
    rate(w, a, { rating: TALENT.plan.metRating, metric: 70 });
    reviewPlans(ctx, report(w));
    expect(plan.outcome).toBe('met');
  });

  it('failed otherwise, and an older season\'s number proves nothing', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = open(w, a);
    rate(w, a, { rating: 1420, metric: 95 });
    league(w).entries[a.id]!.ratings.copy!.metricBase!.season = league(w).season - 1;
    reviewPlans(ctx, report(w));
    expect(plan.outcome).toBe('failed');
    expect(league(w).entries[a.id]!.status).toBe('probation');
  });

  it('a sample too small can fail nobody: one more season, once, then the plan closes', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = open(w, a);
    plan.openedSeason = 1;
    league(w).seasons.push({ season: 1, fromDay: 1, toDay: 14, tables: {}, employee: null, probations: [], dismissals: [], hires: [], notes: [], disruptedDays: 0 });
    plan.deadlineDay = 28;
    rate(w, a, { rating: 1420, metric: 70, seasonN: 1 });
    reviewPlans(ctx, report(w));
    expect(plan).toMatchObject({ outcome: 'open', deadlineDay: 42 });
    atClose(w, 42);
    rate(w, a, { rating: 1420, metric: 70, seasonN: 1 });
    const r = report(w);
    reviewPlans(ctx, r);
    expect(plan.outcome).toBe('met');
    expect(r.notes.join(' ')).toContain('échantillon insuffisant');
  });

  it('waits for its deadline', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = open(w, a);
    plan.deadlineDay = 42;
    rate(w, a, { rating: 1420, metric: 70 });
    reviewPlans(ctx, report(w));
    expect(plan.outcome).toBe('open');
  });
});

describe('the test everyone sits (D16)', () => {
  it('writes nothing to the world', async () => {
    const { world: w, ctx } = await lab();
    await liveProduct(ctx);
    w.day = 10;
    const a = holder(w, 'growth_lead');
    for (const [skill, sitter] of [['copy', a], ['longform', holder(w, 'editor_in_chief')], ['polish', holder(w, 'editor_in_chief')], ['page', holder(w, 'shop_lead')]] as const) {
      const before = JSON.stringify(w);
      const result = await testDeliverable(benchFor(ctx, skill, sitter), { ...sitter }, 0);
      expect(result?.score).toBeGreaterThan(0);
      expect(JSON.stringify(w)).toBe(before);
    }
  }, 60_000);

  it('gives the same score to the same person the same day, and a stronger talent scores higher', async () => {
    const { world: w, ctx } = await lab();
    await liveProduct(ctx);
    w.day = 10;
    const a = holder(w, 'growth_lead');
    const bench = benchFor(ctx, 'copy', a);
    const once = await testDeliverable(bench, { ...a }, 0);
    expect((await testDeliverable(bench, { ...a }, 0))?.score).toBe(once?.score);
    const scoreAt = async (t: number): Promise<number> => {
      let total = 0;
      for (let day = 1; day <= 12; day++) {
        w.day = day;
        const truth = w.talentTruth!.agents[a.id]!;
        Object.assign(truth.talent, { copy: t });
        total += (await testDeliverable(bench, { ...a }, 0))!.score;
      }
      return total / 12;
    };
    expect(await scoreAt(0.9)).toBeGreaterThan(await scoreAt(0.1));
  }, 60_000);

  it('candidates of a role with a skill get the scorer\'s number and what they wrote', async () => {
    const { world: w, ctx } = await lab();
    await liveProduct(ctx);
    const candidates = drawCandidates(ctx, 'hook_writer', 0, 3);
    const before = JSON.stringify(w);
    await scoreCandidates(ctx, 'hook_writer', candidates);
    expect(JSON.stringify(w)).toBe(before);
    for (const c of candidates) {
      expect(c.interview).toBeGreaterThan(50);
      expect(c.deliverable).toContain('pubs');
    }
    expect(new Set(candidates.map((c) => c.interview)).size).toBeGreaterThan(1);
  }, 30_000);

  it('50 for a role without a skill, with no live product, with talent off, and for video and design until their rows land', async () => {
    const noProduct = await lab();
    const first = drawCandidates(noProduct.ctx, 'hook_writer', 0, 2);
    await scoreCandidates(noProduct.ctx, 'hook_writer', first);
    expect(first.map((c) => c.interview)).toEqual([50, 50]);

    const live = await lab();
    await liveProduct(live.ctx);
    for (const role of ['accountant', 'motion_designer', 'cover_designer'] as const) {
      const candidates = drawCandidates(live.ctx, role, 1, 2);
      await scoreCandidates(live.ctx, role, candidates);
      expect(candidates.map((c) => [c.interview, c.deliverable])).toEqual([[50, null], [50, null]]);
    }

    const off = await lab({ talent: 'off' });
    await liveProduct(off.ctx);
    const quiet = drawCandidates(off.ctx, 'hook_writer', 0, 2);
    await scoreCandidates(off.ctx, 'hook_writer', quiet);
    expect(quiet.map((c) => c.interview)).toEqual([50, 50]);
  }, 60_000);

  it('a hire arrives with a truth and a rating that starts from the test (hireAgent)', async () => {
    const { world: w, ctx } = await lab();
    await liveProduct(ctx);
    const position = openPosition(ctx, 'hook_writer', 'founder', 'Pour le test')!;
    const c = drawCandidates(ctx, 'hook_writer', 0, 1)[0]!;
    await scoreCandidates(ctx, 'hook_writer', [c]);
    const hire = await hireAgent(ctx, position, c);
    const entry = league(w).entries[hire.id]!;
    const expected = TALENT.rating.par + Math.max(-TALENT.rating.hireSpread, Math.min(TALENT.rating.hireSpread, (c.interview - TALENT.par['copy:qa']!) * TALENT.rating.hirePerPoint));
    expect(w.talentTruth!.agents[hire.id]?.talent.copy).toBeDefined();
    expect(entry).toMatchObject({ primary: 'copy', status: 'active', hiredDay: w.day, lineage: null });
    expect(entry.ratings.copy?.rating).toBeCloseTo(expected, 1);
    expect(entry.ratings.copy?.rd).toBe(TALENT.rating.hireRd);
    expect(entry.ratings.copy?.history).toEqual([{ day: w.day, rating: entry.ratings.copy?.rating }]);
  }, 30_000);

  it('a hire on a role with no test, or who sat none, starts at par', async () => {
    const { world: w, ctx } = await lab();
    const position = openPosition(ctx, 'hook_writer', 'founder', 'Pour le test')!;
    const c = drawCandidates(ctx, 'hook_writer', 0, 1)[0]!;
    const hire = await hireAgent(ctx, position, c);
    expect(league(w).entries[hire.id]?.ratings.copy?.rating).toBe(TALENT.rating.par);
    const accountant = await hireInto(ctx, 'accountant');
    expect(league(w).entries[accountant.id]).toBeUndefined();
    expect(w.talentTruth!.agents[accountant.id]).toBeDefined();
  }, 30_000);

  it('the buyer\'s test replays the real rows: a strong reading keeps the better creatives, the row is a CTR x 1000', async () => {
    const { world: w, ctx } = await lab();
    await liveProduct(ctx);
    w.day = 20;
    const buyer = holder(w, 'growth_lead');
    const row = (creativeId: string, impressions: number, clicks: number) => ({ day: 19, campaignId: 'cmp_1', creativeId, productId: 'p', spend: 5, impressions, clicks, ctr: clicks / impressions, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [] });
    w.market.adStats.push(row('good', 1500, 45), row('bad', 1500, 15));
    const bench = benchFor(ctx, 'buying', buyer);
    const scoreAt = async (t: number): Promise<number> => {
      w.talentTruth!.agents[buyer.id]!.talent.buying = t;
      return (await testDeliverable(bench, { ...buyer }, 0))!.score;
    };
    expect(await scoreAt(0.2)).toBe(20);     // both kept: 60 clicks on 3 000
    expect(await scoreAt(0.8)).toBe(30);     // the worse one dropped: 45 on 1 500
    w.market.adStats.length = 0;
    expect(await testDeliverable(bench, { ...buyer }, 0)).toBeNull();
  }, 30_000);

  it('support answers the last 12 closed messages, the scorer\'s mean', async () => {
    const { world: w, ctx } = await lab();
    const agent = holder(w, 'shop_lead');
    const bench = benchFor(ctx, 'support', agent);
    expect(await testDeliverable(bench, { ...agent }, 0)).toBeNull();
    const message = (i: number, status: 'open' | 'resolved') => ({ id: `msg_${i}`, day: 2, customerId: 'c', channel: 'email' as const, subject: 'Où est mon guide ?', body: 'Bonjour, je n\'ai pas reçu mon PDF après mon achat.', intent: 'non_recu' as const, productId: null, orderId: null, mood: -0.2, status, deadlineDay: 5, thread: [], resolution: null });
    for (let i = 0; i < 14; i++) w.market.inbox.push(message(i, 'resolved'));
    w.market.inbox.push(message(99, 'open'));
    const result = (await testDeliverable(bench, { ...agent }, 0))!;
    expect(result.work).toHaveLength(12);
    expect(result.score).toBeGreaterThan(0);
    expect(result.deliverable).toContain('12 réponses');
  }, 30_000);

  it('research is ranked against what each niche really earned, not under 3 niches', async () => {
    const { world: w, ctx } = await lab();
    const agent = holder(w, 'research_lead');
    w.day = 20;
    const bench = benchFor(ctx, 'research', agent);
    expect(await testDeliverable(bench, { ...agent }, 0)).toBeNull();
    const { research } = w.company;
    research.trends = ctx.tools.searchTrends();
    const niches = research.trends.slice(0, 4);
    expect(niches.length).toBeGreaterThanOrEqual(3);
    const stats = { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 };
    for (const [i, n] of niches.entries()) {
      w.company.products.push({ id: `prd_${i}`, nicheId: n.nicheId, title: n.name, subtitle: '', audience: '', problem: '', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 1, stats, priceHistory: [] });
      sim.recordLedger(w, { type: 'revenue', amount: 100 * (i + 1), memo: 'Ventes', ref: `prd_${i}` });
    }
    const result = (await testDeliverable(bench, { ...agent }, 0))!;
    expect(result.deliverable).toContain('niches contre leur profit');
    const ranked = result.work as { nicheId: string }[];
    const earned = new Map(niches.map((n, i) => [n.nicheId, 100 * (i + 1)]));
    expect(result.score).toBeCloseTo(50 + 50 * spearman(ranked.map((_, i) => -i), ranked.map((r) => earned.get(r.nicheId)!)), 1);
  }, 30_000);

  it('spearman reads a ranking', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
  });
});

describe('the challenge (talent 16)', () => {
  it('each score is the scorer\'s, recomputed on what was written, incumbent first', async () => {
    const { world: w, ctx } = await lab();
    const product = await liveProduct(ctx);
    w.day = 28;
    const a = holder(w, 'growth_lead');
    const plan = failing(w, a);
    const real = TEST_BY_SKILL.copy!;
    const written = new Map<string, TestResult>();
    rows.set('copy', real);
    TEST_BY_SKILL.copy = { par: real.par, sit: async (b, sitter, i) => {
      const result = await real.sit(b, sitter, i);
      if (result) written.set(sitter.id, result);
      return result;
    } };
    const voc = w.company.research.voc[product.nicheId];
    const report = await runChallenge(ctx, plan);
    expect(report.candidates.map((c) => c.isIncumbent)).toEqual([true, false, false, false]);
    expect(report.candidates[0]!.id).toBe(a.id);
    expect(report.candidates.map((c) => c.deliverable).every(Boolean)).toBe(true);
    for (const entry of report.candidates) {
      const creatives = written.get(entry.id)!.work as AdCreative[];
      expect(creatives).toHaveLength(2);
      expect(entry.score).toBeCloseTo(mean(creatives.map((c) => sim.scoreCreative(c, product, voc).overall)), 1);
    }
  }, 30_000);

  it('the incumbent stays when nobody beats them by 3 (2,9 is not enough), and is left alone for a season', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = failing(w, a);
    fixedRow('copy', (s) => (s.id === a.id ? 80 : 82.9));
    const headcount = w.company.agents.length;
    const report = await runChallenge(ctx, plan);
    expect(report.hired).toBeNull();
    expect(plan.outcome).toBe('kept_no_better');
    expect(report.reason).toContain(`${a.name} reste`);
    expect(league(w).entries[a.id]!.status).toBe('active');
    expect(league(w).hires).toEqual([report]);
    expect(w.company.agents).toHaveLength(headcount);
    expect(w.company.org!.positions).toEqual([]);

    rate(w, a, { rating: 1350 });
    w.day = 42;
    Object.assign(league(w), { closedSeasons: 2, season: 3 });
    openPlans(ctx, { season: 3, fromDay: 29, toDay: 42, tables: {}, employee: null, probations: [], dismissals: [], hires: [], notes: [], disruptedDays: 0 });
    expect(league(w).plans.filter((p) => p.outcome === 'open')).toEqual([]);
    w.day = 56;
    Object.assign(league(w), { closedSeasons: 3, season: 4 });
    rate(w, a, { rating: 1350 });
    openPlans(ctx, { season: 4, fromDay: 43, toDay: 56, tables: {}, employee: null, probations: [], dismissals: [], hires: [], notes: [], disruptedDays: 0 });
    expect(league(w).plans.filter((p) => p.outcome === 'open')).toHaveLength(1);
  }, 30_000);

  it('a candidate exactly 3 ahead takes the job, and every score beats the rule of A10', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    fixedRow('copy', (s) => (s.id === a.id ? 80 : 83));
    const report = await runChallenge(ctx, failing(w, a));
    expect(report.hired).not.toBeNull();
    const own = report.candidates.find((c) => c.isIncumbent)!.score;
    expect(report.candidates.find((c) => c.id === report.hired)!.score - own).toBeGreaterThanOrEqual(TALENT.challenge.margin);
  }, 30_000);

  it('no test possible: the seat is kept', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'research_lead');
    const plan = failing(w, a);
    const report = await runChallenge(ctx, plan);
    expect(report.hired).toBeNull();
    expect(plan.outcome).toBe('kept_no_better');
    expect(report.candidates).toEqual([]);
  }, 30_000);

  it('two from the market and a clone of the best colleague, who inherits from their teacher (lineage)', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    rate(w, lead, { rating: TALENT.challenge.cloneRating, seasonN: MIN_SEASON_N.copy });
    w.talentTruth!.agents[lead.id]!.talent.copy = 0.9;
    let clone: string | undefined;
    fixedRow('copy', (s) => {
      const lineage = w.talentTruth!.agents[s.id]?.lineage;
      if (lineage) clone = s.id;
      return lineage ? 95 : 70;
    });
    const report = await runChallenge(ctx, failing(w, writer));
    const entry = report.candidates.find((c) => c.lineage)!;
    expect(entry).toMatchObject({ id: clone, lineage: lead.id, isIncumbent: false });
    expect(report.hired).toBe(clone);
    expect(league(w).entries[clone!]!.lineage).toBe(lead.id);
    const truth = w.talentTruth!.agents[clone!]!;
    expect(truth.lineage).toBe(lead.id);
    expect(truth.talent.copy).toBeGreaterThan(0.7);
    expect(w.company.agents.find((a) => a.id === clone)?.persona).toContain(`Élève de ${lead.name}`);
  }, 30_000);

  it('three from the market without a top performer, and a sample too thin teaches nobody', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    const writer = await hireInto(ctx, 'hook_writer');
    rate(w, lead, { rating: 1700, seasonN: MIN_SEASON_N.copy - 1 });
    fixedRow('copy', () => 70);
    const report = await runChallenge(ctx, failing(w, writer));
    expect(report.candidates).toHaveLength(4);
    expect(report.candidates.every((c) => c.lineage === null)).toBe(true);
  }, 30_000);

  it('a candidate turned down leaves no truth and no entry', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const known = Object.keys(w.talentTruth!.agents);
    fixedRow('copy', (s) => (s.id === a.id ? 80 : 81));
    await runChallenge(ctx, failing(w, a));
    expect(Object.keys(w.talentTruth!.agents)).toEqual(known);
    expect(Object.keys(league(w).entries)).not.toContain(league(w).hires[0]!.candidates[1]!.id);
  }, 30_000);

  it('holds stop it before anyone sits', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = failing(w, a);
    let sat = 0;
    rows.set('copy', TEST_BY_SKILL.copy);
    TEST_BY_SKILL.copy = { par: () => 80, sit: async () => { sat += 1; return { score: 90, deliverable: 'x', work: [] }; } };
    addHold(w, { kind: 'firing', productId: null, until: null, reason: 'ne vire personne' });
    expect((await runChallenge(ctx, plan)).hired).toBeNull();
    w.company.holds = [];
    addHold(w, { kind: 'pin', productId: null, agentId: a.id, until: null, reason: 'garde' });
    expect((await runChallenge(ctx, plan)).hired).toBeNull();
    expect(sat).toBe(0);
    expect(plan.outcome).toBe('failed');
    expect(league(w).hires).toEqual([]);
  }, 30_000);
});

describe('who can be replaced at a close (talent 15)', () => {
  const founders = ['growth_lead', 'editor_in_chief', 'shop_lead', 'research_lead', 'art_director'] as const;

  it('at most 2 a season, even with 5 forced failures, and the others wait for the next close', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    for (const role of founders) failing(w, holder(w, role));
    fixedRows(w, 60, 90);
    const report = await closeSeason(ctx);
    expect(report.hires).toHaveLength(TALENT.challenge.replacementsPerSeason);
    expect(report.dismissals).toHaveLength(TALENT.challenge.replacementsPerSeason);
    expect(w.company.org!.alumni).toHaveLength(2);
    expect(league(w).plans.filter((p) => p.outcome === 'failed' && w.company.agents.some((a) => a.id === p.agentId))).toHaveLength(3);
    atClose(w, 42);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    expect(w.company.org!.alumni).toHaveLength(4);
  }, 60_000);

  it('at most 1 a family', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const writer = await hireInto(ctx, 'hook_writer');
    failing(w, holder(w, 'growth_lead'));
    failing(w, writer);
    fixedRows(w, 60, 90);
    const report = await closeSeason(ctx);
    expect(report.hires).toHaveLength(1);
  }, 30_000);

  it('at least 28 days between two replacements of a role', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'growth_lead');
    failing(w, lead);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    const next = holder(w, 'growth_lead');
    atClose(w, 42);
    failing(w, next);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    expect(holder(w, 'growth_lead').id).toBe(next.id);
    atClose(w, 56);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    expect(holder(w, 'growth_lead').id).not.toBe(next.id);
  }, 60_000);

  it('nobody under a firing hold, nobody pinned', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const b = holder(w, 'shop_lead');
    failing(w, a);
    failing(w, b);
    fixedRows(w, 60, 90);
    addHold(w, { kind: 'firing', productId: null, until: null, reason: 'ne vire personne' });
    const held = await closeSeason(ctx);
    expect(held.hires).toEqual([]);
    expect(held.notes.join(' ')).toContain('ne vire personne');
    w.company.holds = [];
    atClose(w, 42);
    addHold(w, { kind: 'pin', productId: null, agentId: a.id, until: null, reason: 'garde' });
    fixedRows(w, 60, 90);
    const pinned = await closeSeason(ctx);
    expect(pinned.notes.join(' ')).toContain('Pas de remplacement : garde');
    expect(w.company.agents.some((x) => x.id === a.id)).toBe(true);
    expect(w.company.agents.some((x) => x.id === b.id)).toBe(false);
  }, 30_000);

  it('none in the last 10 days, except in a run with no end (D20)', async () => {
    const closing = await lab({ horizonDays: 90 });
    atClose(closing.world, 84);
    failing(closing.world, holder(closing.world, 'growth_lead'));
    fixedRows(closing.world, 60, 90);
    expect((await closeSeason(closing.ctx)).hires).toEqual([]);
    const open = await lab({ horizonDays: 90, openEnded: true });
    atClose(open.world, 84);
    failing(open.world, holder(open.world, 'growth_lead'));
    fixedRows(open.world, 60, 90);
    expect((await closeSeason(open.ctx)).hires).toHaveLength(1);
  }, 30_000);

  it('none on a season over 3 disrupted days: the plan fails and waits for the next close', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const plan = failing(w, a);
    plan.outcome = 'open';
    w.market.events.push({ id: 'evt_ban', day: 18, kind: 'ad_account_banned', title: 'Compte suspendu', description: '', severity: 'danger' });
    fixedRows(w, 60, 90);
    const first = await closeSeason(ctx);
    expect(first.disruptedDays).toBe(7);
    expect(first.hires).toEqual([]);
    expect(plan.outcome).toBe('failed');
    atClose(w, 42);
    fixedRows(w, 60, 90);
    const second = await closeSeason(ctx);
    expect(second.disruptedDays).toBe(0);
    expect(second.hires).toHaveLength(1);
  }, 30_000);

  it('3 disrupted days change nothing', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    failing(w, holder(w, 'growth_lead'));
    for (const day of [16, 18, 20]) w.market.events.push({ id: `evt_${day}`, day: day - 1, kind: 'platform_outage', title: 'Panne', description: '', severity: 'warn', refs: { day } });
    fixedRows(w, 60, 90);
    const report = await closeSeason(ctx);
    expect(report.disruptedDays).toBe(3);
    expect(report.hires).toHaveLength(1);
  }, 30_000);

  it('founders other than the CEO can go (D18), with the last holder replaced, never removed', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const lead = holder(w, 'editor_in_chief');
    expect(lead.founder).toBe(true);
    failing(w, lead);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    expect(roleHolders(w, 'editor_in_chief')).toHaveLength(1);
    expect(holder(w, 'editor_in_chief').id).not.toBe(lead.id);
    expect(auditOrg(w)).toEqual([]);
  }, 30_000);
});

describe('a replacement is one tick (talent 17, D1, D17)', () => {
  it('the old person is in the alumni, the new one holds the role, the team is the same size', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    const headcount = w.company.agents.length;
    const assigned = createTask(w, { kind: 'optimize_ads', title: 'Une tâche en cours', assignee: old.id, createdBy: old.id });
    assigned.status = 'in_progress';
    const before = w.activity.length;
    fixedRows(w, 60, 90);
    const tick = w.tick;
    const report = await runChallenge(ctx, failing(w, old));
    const hired = report.hired!;

    expect(w.tick).toBe(tick);
    expect(w.company.agents).toHaveLength(headcount);
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(false);
    expect(w.company.org!.alumni).toHaveLength(1);
    expect(w.company.org!.alumni[0]).toMatchObject({ id: old.id, kind: 'fired', leftDay: w.day, replacedBy: hired, founder: true });
    expect(roleHolders(w, 'growth_lead').map((a) => a.id)).toEqual([hired]);
    expect(league(w).entries[old.id]).toMatchObject({ status: 'gone', leftDay: w.day });
    expect(league(w).entries[hired]).toMatchObject({ status: 'active', hiredDay: w.day });
    expect(league(w).hires).toEqual([report]);

    expect(assigned.assignee).not.toBe(old.id);
    expect(assigned.status).toBe('pending');
    expect(reviewerFor(w, 'produce_ad')).toBeTruthy();
    expect(w.company.agents.some((a) => a.id === reviewerFor(w, 'produce_ad'))).toBe(true);
    expect(auditOrg(w)).toEqual([]);

    const position = w.company.org!.positions.at(-1)!;
    expect(position).toMatchObject({ reason: 'replacement', status: 'filled', replaces: old.id, hiredId: hired, taskId: null });
    expect(position.candidates).toHaveLength(3);
    expect(w.company.tasks.filter((t) => t.kind === 'recruit')).toEqual([]);

    const said = w.activity.slice(before).map((a) => a.text).join('\n');
    expect(said).toContain(`${old.name} quitte l'agence`);
    expect(said).toContain('reprend le poste');
  }, 30_000);

  it('leftBecause says it with numbers: metric, target, rating, coach, who takes over', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    const plan = failing(w, old);
    plan.target = 84;
    plan.coachId = holder(w, 'shop_lead').id;
    rate(w, old, { rating: 1412, metric: 79 });
    fixedRow('copy', (s) => (s.id === old.id ? 60 : 91));
    await runChallenge(ctx, plan);
    const why = league(w).entries[old.id]!.leftBecause!;
    for (const part of ['79/100', '84/100', '1 412', holder(w, 'shop_lead').name, 'pendant 14 jours', '91/100 au test', 'reprend le poste']) expect(why).toContain(part);
    expect(w.company.org!.alumni[0]!.reason).toBe(why);
  }, 30_000);

  it('talentTruth.swaps keeps what the proof cannot rebuild later (D58), and it stays hidden', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    w.talentTruth!.agents[old.id]!.talent.copy = 0.1234567;
    fixedRow('copy', (s) => (s.id === old.id ? 60 : 91));
    const report = await runChallenge(ctx, failing(w, old));
    const swap = w.talentTruth!.swaps[0]!;
    expect(swap).toMatchObject({ day: 28, skill: 'copy', replaced: old.id, hired: report.hired, tReplaced: 0.1234567 });
    expect(swap.tHired).toBe(w.talentTruth!.agents[report.hired!]!.talent.copy);
    expect(swap.familyMean).toBeCloseTo(0.1234567, 6);
    const snapshot = JSON.stringify(toSnapshot(w, false));
    expect(snapshot).not.toContain('1234567');
    expect(JSON.stringify(w.company)).not.toContain('1234567');
  }, 30_000);

  it('a leaver plays no more: a late result moves no rating', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    fixedRow('copy', (s) => (s.id === old.id ? 60 : 91));
    await runChallenge(ctx, failing(w, old));
    const before = JSON.stringify(league(w).entries[old.id]);
    ctx.world.company.league!.events.length = 0;
    const { recordEvidence } = await import('../src/runtime/talent/evidence.js');
    recordEvidence(w, old.id, 'copy', 'qa', 1, 1, 'Trop tard', undefined, 99);
    expect(JSON.stringify(league(w).entries[old.id])).toBe(before);
  }, 30_000);

  it('every departure closes the entry, a layoff as much as a firing', async () => {
    const { world: w, ctx } = await lab();
    const writer = await hireInto(ctx, 'hook_writer');
    league(w).plans.push({ agentId: writer.id, skill: 'copy', openedSeason: 1, deadlineDay: 28, metricLabel: 'x', baseline: 70, target: 73, coachId: null, text: 'Plan', outcome: 'open' });
    await requestDeparture(ctx, writer.id, 'licenciement, 12 € en caisse', holder(w, 'hr_lead').id, 'layoff');
    expect(league(w).entries[writer.id]).toMatchObject({ status: 'gone', leftDay: w.day, leftBecause: 'licenciement, 12 € en caisse' });
    expect(league(w).plans[0]!.outcome).toBe('failed');
    expect(() => closeEntry(w, 'personne', 'x')).not.toThrow();
  }, 30_000);
});

describe('the money of a replacement (talent 18, D6)', () => {
  it('books the hire\'s week and the leaver\'s week, once each, and the books stay right', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    fixedRow('copy', (s) => (s.id === old.id ? 60 : 91));
    const report = await runChallenge(ctx, failing(w, old));
    const lines = w.ledger.filter((e) => e.type === 'recruiting');
    expect(lines.map((e) => e.ref)).toEqual([`hire:${report.hired}`, `leave:${old.id}`]);
    expect(lines.every((e) => e.amount < 0)).toBe(true);
    expect(w.company.org!.stats).toMatchObject({ hires: 1, departures: 1 });
    expect(cash(w)).toBeCloseTo(sim.financeSnapshot(w).cash, 2);
    expect(reconcileDay(w, w.day).gaps).toEqual([]);
  }, 30_000);

  it('a closed season books nothing when nobody moves', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const before = w.ledger.length;
    await closeSeason(ctx);
    expect(w.ledger).toHaveLength(before);
  }, 30_000);

  it('no hire in survival: the plan waits for the next close, and the CFO says so', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    const plan = failing(w, old);
    sim.recordLedger(w, { type: 'ad_spend', amount: -420, memo: 'Pub', ref: null });
    fixedRows(w, 60, 90);
    const report = await closeSeason(ctx);
    expect(report.hires).toEqual([]);
    expect(report.notes.join(' ')).toContain('trésorerie');
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(true);
    expect(plan.outcome).toBe('failed');
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
  }, 30_000);
});

describe('employee of the season (§6.4, D19)', () => {
  it('the highest (rating - par) / rd on a real sample: a trophy, a perk for next season, a draft more', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    const b = holder(w, 'shop_lead');
    const c = holder(w, 'editor_in_chief');
    rate(w, a, { rating: 1600, rd: 100 });          // 1,00
    rate(w, b, { rating: 1580, rd: 70 });           // 1,14
    rate(w, c, { rating: 1700, rd: 70, seasonN: 1 }); // the best number, no sample
    w.talentTruth!.agents[b.id]!.talent.page = 0.5;
    const without = craftFor(w, b, 'write_sales_page')!.draws;
    const report = await closeSeason(ctx);
    expect(report.employee).toMatchObject({ agentId: b.id, name: b.name, skill: 'page' });
    expect(league(w).entries[b.id]!.trophies).toEqual([{ season: 2, title: b.gender === 'f' ? 'Employée de la saison' : 'Employé de la saison' }]);
    expect(league(w).perks).toEqual([{ agentId: b.id, season: 3 }]);
    expect(league(w).season).toBe(3);
    expect(craftFor(w, b, 'write_sales_page')!.draws).toBe(without + 1);
  }, 30_000);

  it('nobody on a plan, nobody without a sample: the title can stay empty', async () => {
    const { world: w, ctx } = await lab();
    atClose(w, 28);
    expect((await closeSeason(ctx)).employee).toBeNull();
  }, 30_000);
});

describe('the founder signs (D17, D48, D49)', () => {
  /** A close that decided a replacement, in approval mode. */
  async function decided() {
    const l = await lab({ founderApproval: true });
    const { world: w, ctx } = l;
    atClose(w, 28);
    const old = holder(w, 'growth_lead');
    const plan = failing(w, old);
    fixedRows(w, 60, 90);
    const report = await closeSeason(ctx);
    const task = w.company.tasks.find((t) => t.kind === 'league_review' && decidedSwap(t))!;
    return { ...l, old, plan, report, task };
  }

  /** The world of these cases stands before the morning: the gate is a work tick away. */
  const until = async (company: Company, done: () => boolean): Promise<void> => {
    for (let i = 0; i < 4 && !done(); i++) await company.step();
    expect(done()).toBe(true);
  };

  const run = async (l: { ctx: RuntimeCtx }, task: Parameters<NonNullable<(typeof HANDLERS)['league_review']['run']>>[1]) => {
    const hr = holder(l.ctx.world, 'hr_lead');
    return HANDLERS.league_review.run(l.ctx, task, hr, { agent: hr, playbook: [], brainNotes: [], lessons: [], day: l.ctx.world.day });
  };

  it('stops before any money and any move, with a task of its kind that carries the decision', async () => {
    const l = await decided();
    const { world: w, old, task, report } = l;
    expect(report.hires).toEqual([]);
    expect(report.notes.join(' ')).toContain('En attente du fondateur');
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(true);
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
    expect(w.company.org!.positions).toEqual([]);
    expect(league(w).hires).toEqual([]);
    expect(task).toMatchObject({ status: 'pending', reviewer: null, workLeft: 0, assignee: holder(w, 'hr_lead').id });
    const outcome = await run(l, task);
    expect(outcome.awaitFounder).toContain(`Remplacer ${old.name} par`);
    expect(outcome.awaitFounder).toContain('90/100 contre 60/100 au test');
    expect(outcome.awaitFounder).toMatch(/\d.* €$/);
  }, 30_000);

  it('runs through the real gate: the task waits, his yes makes the swap, once, and the season stays closed', async () => {
    const l = await decided();
    const { world: w, company, old, task } = l;
    const seasons = league(w).seasons.length;
    await until(company, () => task.status === 'awaiting_founder');
    expect(w.company.pendingApprovals).toContain(task.id);
    company.approve(task.id, true);
    await until(company, () => task.status === 'done');
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(false);
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toHaveLength(2);
    expect(league(w).hires).toHaveLength(1);
    expect(league(w).seasons).toHaveLength(seasons);
    expect(w.company.org!.alumni).toHaveLength(1);
  }, 30_000);

  it('his no pins the person for 14 days, books nothing, and the plan ends there', async () => {
    const l = await decided();
    const { world: w, company, old, plan, task } = l;
    await until(company, () => task.status === 'awaiting_founder');
    company.approve(task.id, false);
    expect(task.status).toBe('cancelled');
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(true);
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
    expect(plan.outcome).toBe('kept_no_better');
    expect(pinHold(w, old.id)).toMatchObject({ kind: 'pin', until: w.day + TALENT.challenge.refusalPinDays });
    expect(league(w).entries[old.id]!.status).toBe('active');
    expect(league(w).hires.at(-1)).toMatchObject({ incumbent: old.id, hired: null });
    expect(Object.keys(w.talentTruth!.agents)).not.toContain(task.input.swap && decidedSwap(task)!.winner.id);
  }, 30_000);

  it('a second close does not ask twice', async () => {
    const l = await decided();
    const { world: w, ctx } = l;
    atClose(w, 42);
    fixedRows(w, 60, 90);
    await closeSeason(ctx);
    expect(w.company.tasks.filter((t) => t.kind === 'league_review' && decidedSwap(t))).toHaveLength(1);
  }, 30_000);

  it('his yes comes too late when the person left meanwhile', async () => {
    const l = await decided();
    const { world: w, company, ctx, old, task } = l;
    await until(company, () => task.status === 'awaiting_founder');
    await completeDeparture(ctx, old.id);
    company.approve(task.id, true);
    await until(company, () => task.status === 'done');
    expect(task.log.join(' ')).toContain('sans objet');
    expect(task.output?.hired).toBeNull();
    expect(w.ledger.filter((e) => e.ref === `hire:${decidedSwap(task)!.winner.id}`)).toEqual([]);
  }, 30_000);

  it('his yes hires nobody once the cash is gone: no hire in survival, whoever signed', async () => {
    const l = await decided();
    const { world: w, company, old, task } = l;
    await until(company, () => task.status === 'awaiting_founder');
    sim.recordLedger(w, { type: 'ad_spend', amount: -420, memo: 'Pub', ref: null });
    company.approve(task.id, true);
    await until(company, () => task.status === 'done');
    expect(task.output?.hired).toBeNull();
    expect(w.company.agents.some((a) => a.id === old.id)).toBe(true);
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
  }, 30_000);

  it('swapRefused ignores a ritual, which carries nothing', async () => {
    const { world: w, ctx } = await lab();
    const ritual = createTask(w, { kind: 'league_review', title: 'Clôture' });
    expect(() => swapRefused(ctx, ritual)).not.toThrow();
    expect(KIND_META.league_review.dept).toBe('rh');
    expect(ROLES.hr_lead.core).toContain('league_review');
  });
});

describe('the whole cycle, on a real run of seed 8 (talent 4)', () => {
  const TICKS_A_DAY = 12;
  const MAX_DAYS = 180; // a limit, not a target: the run stops at the firing
  /** Everything the run decided: only the wall clock, and what it stamps in a PDF, may differ. */
  const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  /**
   * The first copywriter hired is forced low, on the same tick of both runs, and no number of the league is touched:
   * the rest is the company's own evidence. Runs `ticks` ticks, or until that person has left, and says how many it took.
   */
  async function play(reloadEvery: number, ticks: number): Promise<{ world: WorldState; ticks: number; dump: string; audit: string[] }> {
    // TikTok alone: this pins seed 8's road through a firing, and buyers change who gets hired, and when (D23). The growth pillar changes it too, and so does what a cut holds (D79).
    const m = await lab({ seed: 8, openEnded: true, channelControl: 'tiktok_only', scaling: false });
    let { world, company } = m;
    let target: string | undefined;
    const audit: string[] = [];
    let i = 0;
    while (i < ticks) {
      await company.step();
      i += 1;
      target ??= world.company.agents.find((a) => !a.founder && league(world).entries[a.id]?.primary === 'copy')?.id;
      const truth = target ? world.talentTruth!.agents[target] : undefined;
      if (truth) Object.assign(truth, { talent: { ...truth.talent, copy: 0.05 }, ceiling: { ...truth.ceiling, copy: 0.05 } });
      if (world.tick === 0) audit.push(...auditOrg(world));
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = m.reopen(world);
      }
      if (ticks === MAX_DAYS * TICKS_A_DAY && target && world.company.org!.alumni.some((a) => a.id === target)) break;
    }
    return { world, ticks: i, dump: decisions(world), audit };
  }

  it('plan, failed plan, challenge, hire and departure in one tick, and a reload at any tick ends the same', async () => {
    const straight = await play(0, MAX_DAYS * TICKS_A_DAY);
    const w = straight.world;
    const gone = w.company.org!.alumni[0]!;
    expect(gone).toMatchObject({ kind: 'fired' });

    const plans = league(w).plans.filter((p) => p.agentId === gone.id);
    expect(plans.at(-1)!.outcome).toBe('failed');
    expect(plans.at(-1)!.text).toContain("Plan d'amélioration de");
    const report = league(w).hires.find((h) => h.incumbent === gone.id)!;
    expect(report.hired).toBe(gone.replacedBy);
    expect(report.candidates).toHaveLength(4);
    expect(report.candidates.find((c) => c.id === report.hired)!.score - report.candidates.find((c) => c.isIncumbent)!.score).toBeGreaterThanOrEqual(TALENT.challenge.margin);

    const hire = w.company.agents.find((a) => a.id === report.hired)!;
    const position = w.company.org!.positions.find((p) => p.replaces === gone.id)!;
    expect([hire.hiredDay, position.openedDay, position.closedDay, report.day]).toEqual([gone.leftDay, gone.leftDay, gone.leftDay, gone.leftDay]);
    expect(position.taskId).toBeNull();
    const season = league(w).seasons.find((s) => s.toDay === gone.leftDay)!;
    expect(season.dismissals).toHaveLength(1);
    expect(season.dismissals[0]).toContain(gone.reason);
    expect(league(w).entries[gone.id]).toMatchObject({ status: 'gone', leftDay: gone.leftDay, leftBecause: gone.reason });
    expect(gone.reason).toMatch(/\d+\/100 pour un objectif de \d+\/100, classement \d/);

    expect(w.ledger.filter((e) => e.ref === `leave:${gone.id}`)).toHaveLength(1);
    expect(w.ledger.filter((e) => e.ref === `hire:${hire.id}`)).toHaveLength(1);
    expect(cash(w)).toBeCloseTo(sim.financeSnapshot(w).cash, 2);
    expect(straight.audit).toEqual([]);
    expect(w.company.org!.stats.violations).toBe(0);

    const reloaded = await play(7, straight.ticks); // 7 and 12 share no divisor: reloads fall on every tick of the day
    expect(reloaded.dump === straight.dump).toBe(true);
  }, 600_000);
});

describe('what a season leaves', () => {
  it('a report, a brain note and a feed line, and nothing of the truth in any of them (A21)', async () => {
    const { world: w, ctx, root } = await lab();
    atClose(w, 28);
    const a = holder(w, 'growth_lead');
    rate(w, a, { rating: 1400, metric: 81 });
    for (const t of Object.values(w.talentTruth!.agents)) t.talent.copy = 0.1234567;
    const report = await closeSeason(ctx);
    const note = readFileSync(join(root, 'brain', 'rh', `saison-${report.season}.md`), 'utf8');
    expect(note).toContain(a.name);
    expect(note).toContain('1 400');
    expect(`${note}${JSON.stringify(league(w))}`).not.toContain('1234567');
    expect(w.activity.map((x) => x.text).join('\n')).toContain(`saison ${report.season} close`);
  }, 30_000);
});
