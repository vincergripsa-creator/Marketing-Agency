/**
 * Formal duels and the founder's word on people (talent §6.3, §7.6, org §13). Talent tests 14 and 19, the Done of P3.6:
 * a duel settles on real market rows and the budget goes to the winner.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdCreative, AgentId, AgentState, Campaign, DailyAdStats, Duel, Mission, ProbationPlan, Product, ScenarioConfig, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { buildSnapshot, estimateFinance, godModeOf } from '../src/api/trim.js';
import { streamRng } from '../src/core/index.js';
import { computeDailyKpi, computeExperimentResults, createBrainVault, updateExperiments } from '../src/learning/index.js';
import { indexWorld } from '../src/learning/data.js';
import { detectLessons } from '../src/learning/heuristics.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { activeHolds, addHold, adsHold, firingHold, hiringHold, pinHold } from '../src/runtime/holds.js';
import { orderAction } from '../src/runtime/missions.js';
import { sim } from '../src/runtime/modules.js';
import { CANDIDATES, ROLES } from '../src/runtime/org/catalog.js';
import { checkGates } from '../src/runtime/org/hiring.js';
import { reconcileOrg } from '../src/runtime/org/reconcile.js';
import { runChallenge } from '../src/runtime/talent/challenge.js';
import { onDuelCreative, scheduleDuel, settleDuels } from '../src/runtime/talent/duels.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function mount(world: WorldState): { company: Company; ctx: RuntimeCtx; reload(w: WorldState): Company } {
  const root = mkdtempSync(join(tmpdir(), 'pixel-duels-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain: createBrainVault(paths) };
  const company = new Company(world, opts);
  return { company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reload: (w) => new Company(w, opts) };
}

/** The old team has many writers, which a duel needs: the talent is what is under test here. */
function leagueWorld(over: Partial<ScenarioConfig> = {}, seed = 7): WorldState {
  return createWorld(defaultScenario({ ...LEGACY, seed, mindMode: 'heuristic', maxComputeEur: 0, talent: 'league', ...over }), `test-duels-${seed}`);
}

function leanWorld(over: Partial<ScenarioConfig> = {}, seed = 7): WorldState {
  return createWorld(defaultScenario({ seed, mindMode: 'heuristic', maxComputeEur: 0, ...over }), `test-duels-lean-${seed}`);
}

function liveProduct(world: WorldState): Product {
  const nicheId = world.market.niches[0]!.id;
  const p: Product = {
    id: 'prd_duel', nicheId, title: 'Guide du duel', subtitle: '', audience: 'Parents', problem: 'Un problème précis', price: 19, status: 'live', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 1, launchedDay: 2,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  world.company.products.push(p);
  return p;
}

function creative(world: WorldState, id: string, productId: string, createdBy: AgentId, over: Partial<AdCreative> = {}): AdCreative {
  const c: AdCreative = {
    id, productId, hook: `Hook ${id}`, hookStyle: 'question', format: 'text_slideshow', scenes: [], caption: '', hashtags: [], cta: '', files: { storyboard: [], preview: null },
    quality: null, review: { status: 'approved', reason: null, day: 1 }, createdDay: 1, createdBy, ...over,
  };
  world.company.creatives.push(c);
  return c;
}

function liveCampaign(world: WorldState, productId: string, dailyBudget = 30, creativeIds = ['cre_old']): Campaign {
  for (const id of creativeIds) creative(world, id, productId, world.company.agents[0]!.id);
  const c: Campaign = { id: 'cmp_duel', productId, name: 'Campagne du duel', creativeIds, dailyBudget, status: 'active', targeting: { interests: [], ageMin: 25, ageMax: 45 }, startDay: 1, createdBy: 'system' };
  world.company.campaigns.push(c);
  return c;
}

function adRow(world: WorldState, day: number, c: Campaign, creativeId: string, impressions: number, clicks: number): void {
  const row: DailyAdStats = {
    day, campaignId: c.id, creativeId, productId: c.productId, spend: 10, impressions, clicks, ctr: clicks / impressions, cpc: 0, cpm: 0, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [],
  };
  world.market.adStats.push(row);
}

/** A day 10 with what a duel needs, ordered. */
function ordered(world: WorldState, over: { budget?: number; creativeIds?: string[] } = {}): { ctx: RuntimeCtx; duel: Duel; campaign: Campaign; product: Product } {
  const { ctx } = mount(world);
  world.day = 10;
  const product = liveProduct(world);
  const campaign = liveCampaign(world, product.id, over.budget, over.creativeIds);
  const duel = scheduleDuel(ctx);
  expect(duel).not.toBeNull();
  return { ctx, duel: duel!, campaign, product };
}

/** What `produce_ad` leaves behind, past the review and TikTok. */
function written(world: WorldState, duel: Duel, campaign: Campaign, status: AdCreative['review']['status'] = 'approved'): AdCreative[] {
  return duel.taskIds.map((id, i) => {
    const task = world.company.tasks.find((t) => t.id === id)!;
    const c = creative(world, `cre_${i}`, duel.productId, task.assignee!, { review: { status: i ? status : 'approved', reason: null, day: world.day } });
    task.status = 'done';
    task.dayDone = world.day;
    task.output = { creativeId: c.id };
    if (c.review.status === 'approved') campaign.creativeIds.push(c.id);
    return c;
  });
}

function running(world: WorldState): ReturnType<typeof ordered> & { creatives: AdCreative[] } {
  const s = ordered(world);
  const creatives = written(world, s.duel, s.campaign);
  settleDuels(s.ctx);
  expect(s.duel.status).toBe('running');
  return { ...s, creatives };
}

const copyRating = (world: WorldState, id: AgentId): number => world.company.league!.entries[id]!.ratings.copy?.rating ?? TALENT.rating.par;

function play(world: WorldState, s: { campaign: Campaign; creatives: AdCreative[]; ctx: RuntimeCtx }, ctrA: number, ctrB: number): void {
  for (const [c, ctr] of [[s.creatives[0]!, ctrA], [s.creatives[1]!, ctrB]] as const) adRow(world, world.day, s.campaign, c.id, 3200, Math.round(3200 * ctr));
  updateExperiments(world);
  settleDuels(s.ctx);
}

describe('scheduling a duel', () => {
  it('orders two forced produce_ad tasks on the campaign, with who the company knows least', () => {
    const w = leagueWorld();
    const { duel, campaign, product } = ordered(w);
    const tasks = duel.taskIds.map((id) => w.company.tasks.find((t) => t.id === id)!);
    expect(duel).toMatchObject({ kind: 'formal', skill: 'copy', status: 'ordered', campaignId: campaign.id, productId: product.id, startDay: 10, experimentId: null, result: null });
    expect(tasks.map((t) => t.kind)).toEqual(['produce_ad', 'produce_ad']);
    expect(tasks.map((t) => t.assignee)).toEqual(duel.agents);
    expect(new Set(duel.agents).size).toBe(2);
    for (const t of tasks) {
      expect(t.priority).toBe(1);
      expect(t.title).toMatch(/^Duel : .+ contre .+ — « Guide du duel »$/);
      expect(t.input).toMatchObject({ productId: product.id, nicheId: product.nicheId, attachTo: campaign.id, duelId: duel.id });
    }
    expect(tasks[0]!.input.variant).not.toBe(tasks[1]!.input.variant);
  });

  it('takes the highest rd, and the writer closest to them in rating', () => {
    const w = leagueWorld();
    const { ctx } = mount(w);
    w.day = 10;
    liveCampaign(w, liveProduct(w).id);
    const writers = w.company.agents.filter((a) => a.taskKinds.includes('produce_ad')).map((a) => a.id);
    expect(writers.length).toBeGreaterThan(2);
    const [unknown, near, far] = writers as [string, string, string];
    const set = (id: AgentId, rating: number, rd: number) => {
      w.company.league!.entries[id]!.ratings.copy = { skill: 'copy', rating, rd, n: 5, seasonN: 5, metric: null, history: [] };
    };
    for (const id of writers) set(id, 1800, 80);
    set(unknown, 1500, 190);
    set(near, 1540, 100);
    set(far, 1400, 100);
    expect(scheduleDuel(ctx)!.agents).toEqual([unknown, near]);
  });

  it('asks all the conditions of §6.3', () => {
    const cases: [string, (w: WorldState, c: Campaign) => void][] = [
      ['not the day', (w) => { w.day = 11; }],
      ['budget under 10', (_w, c) => { c.dailyBudget = 9; }],
      ['three creatives already', (w, c) => { for (const id of ['cre_a', 'cre_b']) { creative(w, id, c.productId, 'system'); c.creativeIds.push(id); } }],
      ['campaign paused', (_w, c) => { c.status = 'paused'; }],
      ['product off sale', (w) => { w.company.products[0]!.status = 'paused'; }],
      ['ads held by the founder', (w) => { addHold(w, { kind: 'ads', productId: null, until: null, reason: 'coupé' }); }],
      ['outage announced for tomorrow', (w) => { w.market.events.push({ id: 'evt_o', day: 10, kind: 'platform_outage', text: 'panne', refs: { day: 11 } } as never); }],
      ['a duel is running', (w) => { w.company.league!.duels.push({ id: 'duel_0', kind: 'formal', status: 'running' } as Duel); }],
      ['writers too new', (w) => { for (const a of w.company.agents) a.hiredDay = 6; }],
      ['one writer alone', (w) => { for (const a of w.company.agents.slice(1)) a.taskKinds = a.taskKinds.filter((k) => k !== 'produce_ad'); }],
      ['survival', (w) => { w.ledger.push({ id: 'led_x', day: 9, type: 'ad_spend', amount: -w.ledger.reduce((s, l) => s + l.amount, 0) + 1, memo: 'test', ref: null } as never); }],
    ];
    for (const [name, spoil] of cases) {
      const w = leagueWorld();
      const { ctx } = mount(w);
      w.day = 10;
      const c = liveCampaign(w, liveProduct(w).id);
      spoil(w, c);
      expect(scheduleDuel(ctx), name).toBeNull();
    }
  });

  it('a natural duel in the book does not stop the formal one', () => {
    const w = leagueWorld();
    const { ctx } = mount(w);
    w.day = 10;
    liveCampaign(w, liveProduct(w).id);
    w.company.league!.duels.push({ id: 'duel-n', kind: 'natural', status: 'settled' } as Duel);
    expect(scheduleDuel(ctx)).not.toBeNull();
  });

  it('flat mode never orders one', () => {
    const w = leagueWorld({ talent: 'flat' });
    const { ctx } = mount(w);
    w.day = 10;
    liveCampaign(w, liveProduct(w).id);
    expect(scheduleDuel(ctx)).toBeNull();
  });
});

describe('the experiment of a duel', () => {
  it('starts once both creatives are approved and attached, and three share one budget', () => {
    const w = leagueWorld();
    const { ctx, duel, campaign } = ordered(w, { creativeIds: ['cre_old', 'cre_older'] });
    settleDuels(ctx);
    expect(duel.status).toBe('ordered');
    const [a, b] = written(w, duel, campaign);
    onDuelCreative(ctx, b!);
    expect(duel.status).toBe('running');
    expect(duel.creativeIds).toEqual([a!.id, b!.id]);
    expect(a!.duelId).toBe(duel.id);
    expect(campaign.creativeIds).toEqual(['cre_older', a!.id, b!.id]);
    const e = w.company.experiments.find((x) => x.id === duel.experimentId)!;
    expect(e).toMatchObject({ dimension: 'agent_duel', metric: 'ctr', variants: duel.agents, productId: duel.productId, nicheId: w.company.products[0]!.nicheId, status: 'running' });
    expect(e.hypothesis).toMatch(/^Duel : .+ contre .+ sur « Guide du duel »$/);
  });

  it('counts the creatives of this duel by author, and nothing else', () => {
    const w = leagueWorld();
    const { duel, campaign, creatives } = running(w);
    const e = w.company.experiments.find((x) => x.id === duel.experimentId)!;
    const [a, b] = duel.agents;
    creative(w, 'cre_same_author', duel.productId, a);
    adRow(w, 10, campaign, creatives[0]!.id, 1000, 30);
    adRow(w, 10, campaign, creatives[1]!.id, 2000, 20);
    adRow(w, 10, campaign, 'cre_same_author', 9000, 900);
    adRow(w, 10, campaign, 'cre_old', 9000, 900);
    expect(computeExperimentResults(w, e)).toEqual({ [a]: { n: 1000, value: 0.03 }, [b]: { n: 2000, value: 0.01 } });
  });

  it('is no lesson about the market, and the retro has nothing to say of it', () => {
    const w = leagueWorld();
    const s = running(w);
    for (const [c, clicks] of [[s.creatives[0]!, 200], [s.creatives[1]!, 60]] as const) adRow(w, 10, s.campaign, c.id, 3200, clicks);
    expect(updateExperiments(w)).toEqual([]);
    const e = w.company.experiments.find((x) => x.id === s.duel.experimentId)!;
    expect(e.status).toBe('concluded');
    expect(e.winner).toBe(s.duel.agents[0]);
    const retro = { world: w, day: 10, notes: [], ix: indexWorld(w), kpi: computeDailyKpi(w, 10), concluded: [e] };
    expect(detectLessons(retro as never).filter((d) => d.key.startsWith('experience-'))).toEqual([]);
    const test = { ...e, id: 'exp_hook', dimension: 'hook_style' as const, variants: ['question', 'mistake'], winner: 'question', results: { question: { n: 3000, value: 0.03 }, mistake: { n: 3000, value: 0.01 } } };
    expect(detectLessons({ ...retro, concluded: [test] } as never).filter((d) => d.key.startsWith('experience-'))).toHaveLength(1);
  });
});

describe('settling a duel', () => {
  it('moves both ratings by opposite amounts, on K = 32 (talent 14)', () => {
    const w = leagueWorld();
    const s = running(w);
    const [a, b] = s.duel.agents;
    const before = [copyRating(w, a), copyRating(w, b)];
    play(w, s, 0.03, 0.02);
    expect(s.duel.status).toBe('settled');
    const gainA = copyRating(w, a) - before[0]!;
    const gainB = copyRating(w, b) - before[1]!;
    expect(gainA).toBeGreaterThan(0);
    expect(gainA + gainB).toBeCloseTo(0, 6);
    const { result } = s.duel;
    expect(result).toMatchObject({ ctr: [0.03, 0.02], n: [3200, 3200] });
    expect(result!.delta).toBeCloseTo(gainA, 6);
    expect(result!.delta).toBeCloseTo(32 * (result!.s - 0.5), 0);
    expect(w.company.league!.events.filter((e) => e.source === 'duel').map((e) => [e.agentId, e.w])).toEqual([[a, 1], [b, 1]]);
    expect(w.company.league!.entries[a]!.ratings.copy!.seasonN).toBe(1);
    expect(s.duel.endDay).toBe(10);
  });

  it('a clear loser leaves the campaign, a close one stays, and the feed says it', () => {
    const w = leagueWorld();
    const s = running(w);
    const [a, b] = s.duel.agents.map((id) => w.company.agents.find((x) => x.id === id)!.name);
    play(w, s, 0.02, 0.04);
    expect(s.duel.result!.s).toBeLessThan(0.15);
    expect(s.campaign.creativeIds).toEqual(['cre_old', s.creatives[1]!.id]);
    expect(w.activity.at(-1)!.text).toContain(`${b} bat ${a} : CTR 4,0 % contre 2,0 % sur 6 400 impressions.`);
    expect(w.activity.at(-1)!.text).toContain(`La pub de ${a} sort de la campagne, son budget va à ${b}.`);

    const close = leagueWorld();
    const n = running(close);
    play(close, n, 0.03, 0.0301);
    expect(n.duel.status).toBe('settled');
    expect(n.campaign.creativeIds).toEqual(['cre_old', ...n.creatives.map((c) => c.id)]);
    expect(close.activity.at(-1)!.text).toMatch(/match nul entre .+, l'écart est dans le bruit/);
  });

  it('a duel the market cannot read moves almost nothing', () => {
    const w = leagueWorld();
    const s = running(w);
    const e = w.company.experiments.find((x) => x.id === s.duel.experimentId)!;
    adRow(w, 10, s.campaign, s.creatives[0]!.id, 300, 11);
    adRow(w, 10, s.campaign, s.creatives[1]!.id, 300, 9);
    w.day = e.day + 7;
    updateExperiments(w);
    settleDuels(s.ctx);
    expect(s.duel.status).toBe('settled');
    expect(Math.abs(s.duel.result!.delta)).toBeLessThan(16);
    expect(s.campaign.creativeIds).toHaveLength(3);
  });

  it('a clear winner gets its budget on the next market day', () => {
    const w = leagueWorld();
    const s = running(w);
    const spendOn = (day: number, id: string) => w.market.adStats.filter((r) => r.day === day && r.creativeId === id).reduce((sum, r) => sum + r.spend, 0);
    w.company.products[0]!.salesPage = null;
    w.day = 11;
    sim.tickMarket(w, streamRng(w.scenario.seed, 3, 11));
    const before = spendOn(11, s.creatives[1]!.id);
    expect(before).toBeGreaterThan(0);
    expect(spendOn(11, s.creatives[0]!.id)).toBeCloseTo(before, 0);
    play(w, s, 0.02, 0.04);
    expect(s.duel.status).toBe('settled');
    w.day = 12;
    sim.tickMarket(w, streamRng(w.scenario.seed, 3, 12));
    expect(spendOn(12, s.creatives[0]!.id)).toBe(0);
    // Same budget, one creative fewer to feed: delivery noise is ±10 %, the gain is 50 %.
    expect(spendOn(12, s.creatives[1]!.id)).toBeGreaterThan(before * 1.25);
  });
});

describe('a duel that falls through', () => {
  it('a creative refused by TikTok cancels it, no rating moves, no experiment starts (talent 14)', () => {
    const w = leagueWorld();
    const { ctx, duel, campaign } = ordered(w);
    const before = duel.agents.map((id) => copyRating(w, id));
    written(w, duel, campaign, 'rejected');
    settleDuels(ctx);
    expect(duel).toMatchObject({ status: 'cancelled', endDay: 10, result: null, experimentId: null });
    expect(duel.agents.map((id) => copyRating(w, id))).toEqual(before);
    expect(w.company.experiments).toEqual([]);
    expect(w.company.league!.events.filter((e) => e.source === 'duel')).toEqual([]);
  });

  it('a creative dropped during the test cancels it and stops the experiment', () => {
    const w = leagueWorld();
    const s = running(w);
    const before = s.duel.agents.map((id) => copyRating(w, id));
    s.campaign.creativeIds = s.campaign.creativeIds.filter((id) => id !== s.creatives[0]!.id);
    settleDuels(s.ctx);
    expect(s.duel.status).toBe('cancelled');
    expect(w.company.experiments.find((x) => x.id === s.duel.experimentId)).toMatchObject({ status: 'cancelled', winner: null });
    expect(s.duel.agents.map((id) => copyRating(w, id))).toEqual(before);
  });

  it('a variant without traffic: the experiment cancels itself, the duel follows', () => {
    const w = leagueWorld();
    const s = running(w);
    adRow(w, 10, s.campaign, s.creatives[0]!.id, 3200, 60);
    w.day = 12;
    updateExperiments(w);
    settleDuels(s.ctx);
    expect(s.duel.status).toBe('cancelled');
  });

  it('a task cancelled, a duelist gone, a task taken by someone else, a campaign stopped', () => {
    const spoils: ((w: WorldState, d: Duel, c: Campaign) => void)[] = [
      (w, d) => { w.company.tasks.find((t) => t.id === d.taskIds[0])!.status = 'cancelled'; },
      (w, d) => { w.company.agents = w.company.agents.filter((a) => a.id !== d.agents[1]); },
      (_w, _d, c) => { c.status = 'paused'; },
    ];
    for (const spoil of spoils) {
      const w = leagueWorld();
      const { ctx, duel, campaign } = ordered(w);
      spoil(w, duel, campaign);
      settleDuels(ctx);
      expect(duel.status).toBe('cancelled');
    }
    const w = leagueWorld();
    const { ctx, duel, campaign } = ordered(w);
    const [a] = written(w, duel, campaign);
    a!.createdBy = 'someone_else';
    settleDuels(ctx);
    expect(duel.status).toBe('cancelled');
  });

  it('cannot hold the next one up for ever', () => {
    const w = leagueWorld();
    const { ctx, duel } = ordered(w);
    w.day = 17;
    expect(scheduleDuel(ctx)).toBeNull();
    w.day = 18;
    settleDuels(ctx);
    expect(duel.status).toBe('cancelled');
  });
});

describe('a real company', () => {
  const formal = (w: WorldState) => w.company.league!.duels.filter((d) => d.kind === 'formal');

  it('settles a formal duel through its own tasks and moves the budget to the winner (Done of P3.6)', async () => {
    const w = leagueWorld({}, 11);
    const { company } = mount(w);
    const budgetMoved = () => w.activity.slice(-20).some((a) => a.text.includes('son budget va à'));
    while (w.day <= 60 && !budgetMoved()) await company.step();
    const duel = formal(w).filter((d) => d.status === 'settled').at(-1);
    expect(budgetMoved(), JSON.stringify(formal(w).map((d) => [d.status, d.startDay, d.result?.s]))).toBe(true);
    const [a, b] = duel!.creativeIds;
    const winner = duel!.result!.s > 0.5 ? a! : b!;
    const loser = winner === a ? b! : a!;
    const campaign = w.company.campaigns.find((c) => c.id === duel!.campaignId)!;
    expect(campaign.creativeIds).toContain(winner);
    expect(campaign.creativeIds).not.toContain(loser);
    const next = duel!.endDay! + 1;
    while (w.day === duel!.endDay || (w.day === next && w.tick <= 10)) await company.step();
    const spend = (id: string, day: number) => w.market.adStats.filter((r) => r.creativeId === id && r.day === day).reduce((s, r) => s + r.spend, 0);
    const total = (day: number) => w.market.adStats.filter((r) => r.campaignId === campaign.id && r.day === day).reduce((s, r) => s + r.spend, 0);
    expect(spend(loser, next)).toBe(0);
    expect(total(next)).toBeGreaterThan(0); // the money stayed in the campaign. From here the buyer reads it as usual: the exact gain is in the market test above
  }, 120_000);

  it('a reload at any tick ends like a straight run, duels included', async () => {
    const run = async (reloadEvery: number) => {
      let w = leagueWorld();
      const m = mount(w);
      let { company } = m;
      for (let i = 1; i <= 30 * 12; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          w = JSON.parse(JSON.stringify(w)) as WorldState;
          company = m.reload(w);
        }
      }
      return { duels: JSON.stringify(w.company.league!.duels), formal: formal(w).length, events: JSON.stringify(w.company.league!.events) };
    };
    const straight = await run(0);
    expect(straight.formal).toBeGreaterThan(0);
    expect(await run(7)).toEqual(straight);
  }, 240_000);
});

describe('reading the founder on people', () => {
  it('orders about firing', () => {
    for (const text of ['Ne vire personne', 'ne virez plus personne', 'pas de licenciement', 'Plus de licenciements pour le moment', 'aucun licenciement', 'on ne licencie personne', 'arrête de virer', 'gèle les licenciements', 'gèle les départs']) {
      expect(orderAction(text), text).toBe('stop_firing');
    }
    for (const text of ['tu peux virer', 'Tu peux de nouveau virer', 'vous pouvez licencier', 'les licenciements sont autorisés', 'lève l’interdiction de licencier', 'tu peux virer si besoin']) {
      expect(orderAction(text), text).toBe('allow_firing');
    }
  });

  it('orders about one person', () => {
    for (const text of ['garde Sarah', 'protège Sarah', 'épingle Sarah', 'Garde-moi Tom', 'ne vire pas Sarah', 'ne licencie jamais Tom']) expect(orderAction(text), text).toBe('pin_agent');
    for (const text of ['désépingle Sarah', 'ne protège plus Sarah', 'ne garde plus Tom', 'lève la protection de Sarah', 'plus besoin de protéger Tom']) expect(orderAction(text), text).toBe('unpin_agent');
    for (const text of ['vire Tom', 'Licencie Sarah', 'vire-moi Tom', 'tu peux virer Tom', 'Bon, vire Tom', 'Il faut virer Tom', 'On vire Tom', 'Tu dois licencier Sarah']) expect(orderAction(text), text).toBe('fire_agent');
    expect(orderAction('renvoie Marie vers le support')).toBeNull();
  });

  it('a sentence that refuses a firing protects the person, however it is said', () => {
    for (const text of ['Ne pas virer Sarah', 'Il ne faut pas virer Sarah', 'Faut pas virer Sarah', 'On ne va pas licencier Tom', 'Pas question de virer Nadia', 'Hors de question de virer Nadia', 'Évite de virer Nadia',
      'Je refuse de virer Nadia', 'Il faudrait éviter de licencier Nadia', 'Tu ne dois pas virer Nadia', 'Je ne veux pas licencier Nadia', 'jamais virer Nadia', 'ne vire plus Nadia', 'vire pas Nadia']) {
      expect(orderAction(text), text).toBe('pin_agent');
    }
  });

  it('a question, a doubt or a past tense fires nobody and protects nobody: only a plain order does', () => {
    for (const text of ['Faut-il virer Nadia ?', 'Pourquoi virer Nadia ?', 'On vire Nadia ?', 'Vire Nadia, tu crois ?', 'Pourquoi ne pas virer Nadia ?', 'Si on vire Nadia', 'On pourrait virer Nadia',
      'Tu as viré Nadia', "J'ai viré Nadia", 'On a licencié Tom', 'Qui a viré Nadia']) {
      expect(orderAction(text), text).toBeNull();
    }
  });

  it('orders about hiring', () => {
    for (const text of ['gèle les embauches', 'Arrête les recrutements', 'plus d’embauche', 'plus aucune embauche', 'ne recrute plus', 'n’embauche personne', 'stoppe les embauches', 'gel des embauches', 'arrête d’embaucher']) {
      expect(orderAction(text), text).toBe('stop_hiring');
    }
    for (const text of ['reprends les embauches', 'dégèle les embauches', 'tu peux embaucher', 'tu peux de nouveau recruter', 'lève le gel des embauches']) expect(orderAction(text), text).toBe('resume_hiring');
  });

  it('other sentences keep their meaning', () => {
    expect(orderAction('garde le prix à 19 €')).toBeNull();
    expect(orderAction('protège la marge')).toBeNull();
    expect(orderAction('vire les pubs')).toBeNull();
    expect(orderAction('garde tout')).toBeNull();
    expect(orderAction('coupe toutes les pubs')).toBe('stop_ads');
    expect(orderAction('reprends les pubs')).toBe('resume_ads');
    expect(orderAction('lève tous les ordres')).toBe('resume_all');
    expect(orderAction('embauche un monteur vidéo')).toBeNull();
  });
});

describe('the founder decides', () => {
  const mission = (w: WorldState, id: string): Mission => w.company.missions.find((m) => m.id === id)!;

  /** A second holder of a role: the person can leave at once. */
  function teammate(world: WorldState, id: AgentId): AgentState {
    const { legacyDept: _, ...def } = CANDIDATES[id]!;
    const role = ROLES[def.roleId];
    const agent: AgentState = {
      ...def, dept: role.dept, taskKinds: [...role.core, ...role.assist], avatar: { ...def.avatar }, status: 'idle', place: role.dept, currentTaskId: null, energy: 100, level: 1, xp: 0,
      perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, bubble: null, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null, founder: false,
    };
    world.company.agents.push(agent);
    world.company.playbooks[id] = [];
    reconcileOrg(world);
    return agent;
  }

  it('« ne vire personne » holds until « tu peux virer »', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const id = await company.giveMission('ne vire personne');
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(mission(w, id).outcome).toContain('tu peux virer');
    expect(firingHold(w)).toMatchObject({ kind: 'firing', until: null });
    await company.giveMission('pas de licenciement');
    expect(activeHolds(w).filter((h) => h.kind === 'firing')).toHaveLength(1);
    expect(mission(w, await company.giveMission('tu peux virer')).status).toBe('done');
    expect(firingHold(w)).toBeNull();
    expect(mission(w, await company.giveMission('tu peux virer')).outcome).toMatch(/Rien à lever/);
  });

  /** A live campaign, so that a stop has something to pause. */
  function runningAds(w: WorldState): Campaign {
    return liveCampaign(w, liveProduct(w).id);
  }

  it('« ne pas virer X » leaves X in the team: no departure, no money, and X is protected', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const agent = teammate(w, 'tom');
    const entries = w.ledger.length;
    const id = await company.giveMission(`Ne pas virer ${agent.name}`);
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(w.company.agents.map((a) => a.id)).toContain(agent.id);
    expect(w.company.org!.alumni).toEqual([]);
    expect(w.company.org!.stats.departures).toBe(0);
    expect(w.ledger.length).toBe(entries);
    expect(pinHold(w, agent.id)).toMatchObject({ kind: 'pin', until: null });
  });

  it('a question about a firing changes nothing in the team', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const agent = teammate(w, 'tom');
    await company.giveMission(`Faut-il virer ${agent.name} ?`);
    await company.giveMission(`Tu as viré ${agent.name}`);
    expect(w.company.agents.map((a) => a.id)).toContain(agent.id);
    expect(activeHolds(w)).toEqual([]);
  });

  it.each(['Coupe toutes les pubs et ne vire personne', 'Ne vire personne, coupe toutes les pubs'])('« %s »: both orders run and both are answered', async (text) => {
    const w = leanWorld();
    const { company } = mount(w);
    const campaign = runningAds(w);
    const id = await company.giveMission(text);
    expect(campaign.status).toBe('paused');
    expect(adsHold(w)).not.toBeNull();
    expect(firingHold(w)).not.toBeNull();
    expect(mission(w, id).status).toBe('done');
    expect(mission(w, id).outcome).toMatch(/1 campagne\(s\) en pause/);
    expect(mission(w, id).outcome).toMatch(/personne ne part/);
  });

  it('a stop that shares its words with staff keeps both halves: « coupe les pubs et les embauches »', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const campaign = runningAds(w);
    await company.giveMission('coupe les pubs et les embauches');
    expect(campaign.status).toBe('paused');
    expect(adsHold(w)).not.toBeNull();
    expect(hiringHold(w)).not.toBeNull();
  });

  it('a refused half shows on the mission, and the stop still runs', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const campaign = runningAds(w);
    const id = await company.giveMission('vire Zorglub et coupe toutes les pubs');
    expect(campaign.status).toBe('paused');
    expect(mission(w, id).status).toBe('failed');
    expect(mission(w, id).outcome).toMatch(/1 campagne\(s\) en pause/);
    expect(mission(w, id).outcome).toMatch(/Personne ne s'appelle Zorglub/);
    // The other way round: the money order is refused first, the word on staff still runs and does not hide the refusal.
    const other = await company.giveMission('double le budget et ne vire personne');
    expect(firingHold(w)).not.toBeNull();
    expect(mission(w, other).status).toBe('failed');
    expect(mission(w, other).outcome).toMatch(/Je ne monte pas le budget/);
  });

  it('a lift that names staff across clauses lifts staff only, never every hold', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    await company.giveMission('coupe toutes les pubs');
    await company.giveMission('gèle les embauches');
    await company.giveMission('lève le gel, pour les embauches');
    expect(hiringHold(w)).toBeNull();
    expect(adsHold(w)).not.toBeNull();
  });

  it('two people in one sentence are read one by one', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const a = teammate(w, 'tom');
    const kept = w.company.agents.find((x) => x.roleId === 'cfo')!;
    await company.giveMission(`vire ${a.name} et garde ${kept.name}`);
    expect(w.company.org!.alumni.map((x) => x.id)).toEqual([a.id]);
    expect(pinHold(w, kept.id)).not.toBeNull();
    expect(pinHold(w, a.id)).toBeNull();
  });

  it('media buying said beside a word on staff: the task goes on, the mission stays open for it', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    runningAds(w);
    const id = await company.giveMission('coupe les pubs non rentables et ne vire personne');
    expect(firingHold(w)).not.toBeNull();
    expect(mission(w, id).status).toBe('open');
    expect(mission(w, id).taskIds.map((t) => w.company.tasks.find((x) => x.id === t)?.kind)).toEqual(['optimize_ads']);
  });

  it('lifting the freeze on departures lifts that one: his stop on ads stands', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const campaign = runningAds(w);
    await company.giveMission('Coupe toutes les pubs');
    for (const lift of ['Lève le gel des départs', 'reprends les départs', 'dégèle les départs', 'Annule le blocage des départs']) {
      expect(orderAction(lift), lift).toBe('allow_firing');
      await company.giveMission('Gèle les départs');
      expect(firingHold(w), lift).not.toBeNull();
      expect(mission(w, await company.giveMission(lift)).outcome, lift).toMatch(/ligue reprend/);
      expect(firingHold(w), lift).toBeNull();
      expect(adsHold(w), lift).not.toBeNull();
    }
    expect(campaign.status).toBe('paused');
    expect(orderAction('reprends le guide au départ')).not.toBe('allow_firing');
    expect(orderAction('annule le départ de Tom')).toBeNull();
  });

  it('« garde Sarah » pins a name the company knows, listed with the holds, until he says otherwise', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const agent = w.company.agents.find((a) => a.roleId !== 'ceo')!;
    const id = await company.giveMission(`garde ${agent.name}`);
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(pinHold(w, agent.id)).toMatchObject({ kind: 'pin', agentId: agent.id, until: null });
    expect(activeHolds(w).map((h) => h.agentId)).toContain(agent.id);
    await company.giveMission(`protège ${agent.name}`);
    expect(activeHolds(w).filter((h) => h.kind === 'pin')).toHaveLength(1);
    expect(pinHold(w, w.company.agents.find((a) => a.id !== agent.id)!.id)).toBeNull();
    await company.giveMission(`désépingle ${agent.name}`);
    expect(pinHold(w, agent.id)).toBeNull();
    expect(mission(w, await company.giveMission(`ne protège plus ${agent.name}`))).toMatchObject({ status: 'failed' });
  });

  it('an unknown name is said so, and nothing happens', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    for (const text of ['garde Zorglub', 'vire Zorglub', 'désépingle Zorglub']) {
      const id = await company.giveMission(text);
      expect(mission(w, id), text).toMatchObject({ status: 'failed' });
      expect(mission(w, id).outcome, text).toMatch(/Personne ne s'appelle Zorglub dans l'équipe/);
    }
    expect(activeHolds(w)).toEqual([]);
    expect(w.company.org!.stats.departures).toBe(0);
  });

  it('two people with one first name: the full name decides, D53 names included', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const [a, b] = w.company.agents.filter((x) => x.roleId !== 'ceo');
    a!.name = 'Léa';
    b!.name = 'Léa B.';
    await company.giveMission('garde Léa B.');
    expect(pinHold(w, b!.id)).not.toBeNull();
    expect(pinHold(w, a!.id)).toBeNull();
    await company.giveMission('garde léa');
    expect(pinHold(w, a!.id)).not.toBeNull();
  });

  it('a lowercase word that names nobody is no order', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const id = await company.giveMission('garde confiance');
    expect(activeHolds(w)).toEqual([]);
    expect(mission(w, id).outcome ?? '').not.toMatch(/Personne ne s'appelle/);
  });

  it('« vire X » goes through requestDeparture, and beats his own pin', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const agent = teammate(w, Object.keys(CANDIDATES).find((id) => !CANDIDATES[id]!.founder && CANDIDATES[id]!.roleId === 'cover_designer' ) ?? 'kenji');
    await company.giveMission(`garde ${agent.name}`);
    const id = await company.giveMission(`vire ${agent.name}`);
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(false);
    expect(w.company.org!.alumni.at(-1)).toMatchObject({ id: agent.id, kind: 'founder_order' });
    expect(pinHold(w, agent.id)).toBeNull();
    const again = await company.giveMission(`vire ${agent.name}`);
    expect(mission(w, again)).toMatchObject({ status: 'failed' });
    expect(mission(w, again).outcome).toMatch(/a quitté l'agence le jour/);
  });

  it('the last holder of a founding role stays until a replacement comes, the CEO never goes', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    const founder = w.company.agents.find((a) => a.founder && a.roleId !== 'ceo')!;
    const id = await company.giveMission(`vire ${founder.name}`);
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(mission(w, id).outcome).toMatch(/relève/);
    expect(founder.notice).toMatchObject({ kind: 'founder_order' });
    expect(w.company.org!.positions.at(-1)).toMatchObject({ reason: 'replacement', replaces: founder.id, status: 'open' });
    const ceo = w.company.agents.find((a) => a.roleId === 'ceo')!;
    const no = await company.giveMission(`vire ${ceo.name}`);
    expect(mission(w, no)).toMatchObject({ status: 'failed' });
    expect(w.company.agents.some((a) => a.id === ceo.id)).toBe(true);
  });

  it('the old fixed team is told so', async () => {
    const w = createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', maxComputeEur: 0 }), 'test-duels-legacy');
    const { company } = mount(w);
    const agent = w.company.agents.find((a) => a.roleId !== 'ceo')!;
    const id = await company.giveMission(`vire ${agent.name}`);
    expect(mission(w, id)).toMatchObject({ status: 'failed' });
    expect(w.company.agents).toContain(agent);
  });

  it('« gèle les embauches » stops a hire at the gates until « reprends les embauches »', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    expect(mission(w, await company.giveMission('reprends les embauches')).text).toBe('reprends les embauches'); // nothing held: a normal request
    const id = await company.giveMission('gèle les embauches');
    expect(mission(w, id)).toMatchObject({ status: 'done' });
    expect(hiringHold(w)).toMatchObject({ kind: 'hiring', until: null });
    w.company.org!.lastHireDay = -99;
    expect(checkGates(w, 'community_manager', 'founder').why).toMatch(/gelées/);
    expect(checkGates(w, 'community_manager', 'replacement').ok).toBe(true);
    expect(mission(w, await company.giveMission('reprends les embauches'))).toMatchObject({ status: 'done' });
    expect(hiringHold(w)).toBeNull();
  });

  it('« lève tous les ordres » lifts these too', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    await company.giveMission('ne vire personne');
    await company.giveMission('gèle les embauches');
    await company.giveMission('lève tous les ordres');
    expect(activeHolds(w)).toEqual([]);
  });
});

describe('the founder and a challenge', () => {
  /** A company with a guide on sale, and a writer so weak that any candidate beats them: the challenge has nothing to hide behind. */
  async function forced(over: Partial<ScenarioConfig> = {}): Promise<{ w: WorldState; company: Company; ctx: RuntimeCtx; plan: ProbationPlan; agent: AgentState }> {
    const w = leanWorld(over);
    const { company, ctx } = mount(w);
    while (!w.company.products.some((p) => p.status === 'live' && p.content) && w.day <= 20) await company.step();
    while (w.tick !== 0) await company.step();
    const agent = w.company.agents.find((a) => w.company.league!.entries[a.id]?.primary === 'page')!;
    w.talentTruth!.agents[agent.id]!.talent.page = 0.02;
    const plan: ProbationPlan = { agentId: agent.id, skill: 'page', openedSeason: 1, deadlineDay: w.day, metricLabel: 'Qualité', baseline: 70, target: 73, coachId: null, text: 'Plan', outcome: 'failed' };
    w.company.league!.plans.push(plan);
    return { w, company, ctx, plan, agent };
  }

  const recruiting = (w: WorldState) => w.ledger.filter((l) => l.type === 'recruiting');

  it('the control: without a word from him, the weak writer is replaced', async () => {
    const { w, ctx, plan, agent } = await forced();
    const report = await runChallenge(ctx, plan);
    expect(report.hired).not.toBeNull();
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(false);
  }, 60_000);

  it('« ne vire personne » blocks a forced challenge: nobody sits, nobody leaves, nothing is booked', async () => {
    const { w, company, ctx, plan, agent } = await forced();
    await company.giveMission('ne vire personne');
    const report = await runChallenge(ctx, plan);
    expect(report).toMatchObject({ hired: null, candidates: [] });
    expect(report.reason).toContain(firingHold(w)!.reason);
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(true);
    expect(recruiting(w)).toEqual([]);
    await company.giveMission('tu peux virer');
    expect((await runChallenge(ctx, plan)).hired).not.toBeNull();
  }, 60_000);

  it('« garde X » keeps that person out of the challenge, and only that person', async () => {
    const { w, company, ctx, plan, agent } = await forced();
    await company.giveMission(`garde ${agent.name}`);
    expect((await runChallenge(ctx, plan))).toMatchObject({ hired: null, candidates: [] });
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(true);
  }, 60_000);

  it('approval mode: the swap waits for him, his no pins for 14 days and books nothing (talent 19)', async () => {
    const { w, company, ctx, plan, agent } = await forced();
    w.scenario.founderApproval = true;
    await runChallenge(ctx, plan);
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(true);
    expect(recruiting(w)).toEqual([]);
    const task = w.company.tasks.find((t) => t.kind === 'league_review')!;
    for (let i = 0; i < 12 && task.status !== 'awaiting_founder'; i++) await company.step();
    expect(task.status).toBe('awaiting_founder');
    expect(String(task.input.founderAsk)).toMatch(/^Remplacer .+ par .+ \(.+\/100 contre .+\/100 au test\)/);
    company.approve(task.id, false);
    expect(pinHold(w, agent.id)).toMatchObject({ kind: 'pin', until: w.day + 14 });
    expect(activeHolds(w).map((h) => h.agentId)).toContain(agent.id);
    expect(plan.outcome).toBe('kept_no_better');
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(true);
    expect(recruiting(w)).toEqual([]);
    const day = w.day;
    w.day = day + 15;
    expect(pinHold(w, agent.id)).toBeNull();
    w.day = day;
  }, 60_000);

  it('approval mode: his yes does the swap, booked once', async () => {
    const { w, company, ctx, plan, agent } = await forced({ org: { team: 'lean', autoHire: false, payroll: true } });
    w.scenario.founderApproval = true;
    await runChallenge(ctx, plan);
    const task = w.company.tasks.find((t) => t.kind === 'league_review')!;
    for (let i = 0; i < 12 && task.status !== 'awaiting_founder'; i++) await company.step();
    company.approve(task.id, true);
    for (let i = 0; i < 12 && task.status !== 'done'; i++) await company.step();
    expect(task.status).toBe('done');
    expect(w.company.agents.some((a) => a.id === agent.id)).toBe(false);
    expect(w.company.org!.alumni.filter((a) => a.id === agent.id)).toHaveLength(1);
    expect(recruiting(w).filter((l) => l.ref === `leave:${agent.id}`)).toHaveLength(1);
    expect(recruiting(w).filter((l) => l.ref?.startsWith('hire:'))).toHaveLength(1);
  }, 60_000);
});

describe('god mode', () => {
  it('shows the true talent and its ceiling, to god mode only', () => {
    const w = leanWorld();
    mount(w);
    const id = w.company.agents.find((a) => a.roleId !== 'ceo')!.id;
    const truth = w.talentTruth!.agents[id]!;
    const primary = w.company.league!.entries[id]!.primary!;
    truth.talent[primary] = 0.61237;
    truth.ceiling[primary] = 0.7146;
    const teacher = w.company.agents.find((a) => a.id !== id && w.company.league!.entries[a.id])!;
    truth.lineage = teacher.id;
    expect(godModeOf(w).talent![id]).toEqual({ truth: 0.61237, note: `plafond 0,71, élève de ${teacher.name}` });
    const finance = estimateFinance(w);
    expect(JSON.stringify(buildSnapshot(w, finance, true))).toContain('0.61237');
    const plain = JSON.stringify(buildSnapshot(w, finance, false));
    expect(plain).not.toContain('0.61237');
    expect(plain).not.toContain('plafond');
    expect(plain).not.toContain('talentTruth');
  });

  it('a world without talent shows none', () => {
    const w = leagueWorld({ talent: 'off' });
    mount(w);
    expect(godModeOf(w).talent).toBeUndefined();
    expect(godModeOf(w).niches.length).toBeGreaterThan(0);
  });
});
