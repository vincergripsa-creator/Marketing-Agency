/**
 * Research and support levers (talent §4.6, §4.7) and the support evidence (§5.2). A lever is read on a planted `craft`:
 * these tests say what a t changes, whichever way it got there. `craftFor` and `armSharp` are fakes, so a test can name
 * whose read reached the bandit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, CompetitorProduct, InboxMessage, ReplyOutcome, TaskKind, TrendSignal, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { Craft, LearningModule, MindContext, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { heuristicRanking } from '../src/minds/heuristic/research.js';
import { guessIntent, heuristicSupportReply } from '../src/minds/heuristic/support.js';
import { seededRng } from '../src/minds/util.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { supportHandlers } from '../src/runtime/handlers/support.js';
import { claimedMessageIds } from '../src/runtime/metrics.js';
import { learning } from '../src/runtime/modules.js';
import { emptyLeague } from '../src/runtime/talent/truth.js';
import { createTask } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const spy = vi.hoisted(() => ({
  sharpAsked: [] as { agent: string; t: number | undefined; purpose: string }[],
  armsRead: [] as { dimension: string; samples: number | undefined }[],
  craft: (t: number) => ({ skill: 'support', t, flaw: 0, draws: 1, eye: 0, sharp: 1 + Math.round(4 * t), passes: 1, reach: 1 }) as Craft,
  ceoT: 0.9,
}));

vi.mock('../src/runtime/talent/craft.js', async (original) => ({
  ...(await original<typeof import('../src/runtime/talent/craft.js')>()),
  craftFor: (_w: WorldState, a: AgentState) => (a.id === 'camille' ? spy.craft(spy.ceoT) : undefined),
  armSharp: (_ctx: RuntimeCtx, a: AgentState, mind: MindContext, purpose: string) => {
    spy.sharpAsked.push({ agent: a.id, t: mind.craft?.t, purpose });
    return mind.craft ? { samples: mind.craft.sharp, rng: createRng(1) } : undefined;
  },
}));

vi.mock('../src/learning/bandits.js', async (original) => {
  const real = await original<typeof import('../src/learning/bandits.js')>();
  return {
    ...real,
    chooseArm: (...args: Parameters<LearningModule['chooseArm']>) => {
      spy.armsRead.push({ dimension: args[1], samples: args[4]?.samples });
      return (real.chooseArm as LearningModule['chooseArm'])(...args);
    },
  };
});

const roots: string[] = [];

beforeEach(() => {
  spy.sharpAsked.length = 0;
  spy.armsRead.length = 0;
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

async function lab(): Promise<{ world: WorldState; ctx: RuntimeCtx }> {
  const world = createWorld(defaultScenario({ ...LEGACY, seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90 }), 'test-levers2');
  const root = mkdtempSync(join(tmpdir(), 'pixel-levers2-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const company = new Company(world, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain });
  return { world, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx };
}

const owner = (w: WorldState, kind: TaskKind): AgentState => w.company.agents.find((a) => a.taskKinds.includes(kind))!;
const mindOf = (agent: AgentState, day: number, t?: number): MindContext => ({ agent, playbook: [], brainNotes: [], lessons: [], day, brand: 'Pixel', ...(t === undefined ? {} : { craft: spy.craft(t) }) });

// ───────────────────────────── research ─────────────────────────────

const signal = (nicheId: string, buzz: number): TrendSignal => ({ nicheId, name: nicheId, audience: 'un public', category: 'c', searchInterest: buzz, tiktokBuzz: buzz, competitionHint: 'faible', sampleTitles: [] });
const rivals = (nicheId: string, prices: number[]): CompetitorProduct[] => prices.map((price, i) => ({ id: `${nicheId}_${i}`, nicheId, title: `Guide ${i}`, price, reviews: 10, rating: 4.2, ageDays: 30, platform: 'gumroad', weaknesses: [] }));
const voc = (nicheId: string, priceAnchors: number[]): VoiceOfCustomer => ({
  nicheId, depth: 'quick', pains: [], phrases: [], objections: [], desiredOutcomes: [],
  knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors, bannedClaims: [],
});

type Ranking = Parameters<typeof heuristicRanking>[0];

/** A niche with the bigger buzz and a small price, against a quieter one where people pay. */
const twoNiches: Ranking = {
  signals: [signal('bruyante', 80), signal('payante', 70)],
  competitors: { bruyante: rivals('bruyante', [9, 14, 14]), payante: rivals('payante', [39, 39, 49]) },
  voc: {},
  excludeNicheIds: [],
};

describe('research lever (talent §4.6)', () => {
  it('valueWeight picks the niche with the better known price', () => {
    const first = (opts?: { valueWeight: number }) => heuristicRanking(twoNiches, null, opts).ranked[0]!.nicheId;
    expect(first()).toBe('bruyante');
    expect(first({ valueWeight: 1.2 * 0.2 })).toBe('bruyante');
    expect(first({ valueWeight: 1.2 * 0.8 })).toBe('payante');
  });

  it('the company\'s own anchors stand before competitors\' prices; an unknown price moves nothing', () => {
    const score = (input: Partial<Ranking>, valueWeight?: number) =>
      heuristicRanking({ signals: [signal('n', 60)], competitors: {}, voc: {}, excludeNicheIds: [], ...input }, null, valueWeight === undefined ? undefined : { valueWeight }).ranked[0]!.score;
    const anchored = { competitors: { n: rivals('n', [9]) }, voc: { n: voc('n', [39]) } };
    expect(score(anchored, 1) - score(anchored)).toBe(39 - 19);
    const rivalsOnly = { competitors: { n: rivals('n', [29]) } };
    expect(score(rivalsOnly, 1) - score(rivalsOnly)).toBe(29 - 19);
    expect(score({}, 1)).toBe(score({}));
  });

  it('the engine ranks with the talent of whoever prepares the pick, and as today without one', async () => {
    const { world } = await lab();
    const nadia = owner(world, 'pick_opportunity');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
    const strong = await engine.rankOpportunities(twoNiches, mindOf(nadia, 1, 0.8));
    expect(strong.ranked[0]!.nicheId).toBe('payante');
    const off = await engine.rankOpportunities(twoNiches, mindOf(nadia, 1));
    expect(off).toEqual(heuristicRanking(twoNiches, null));
    expect(off.ranked[0]!.nicheId).toBe('bruyante');
  });

  it('a better researcher follows up on more niches', async () => {
    const top = async (t?: number): Promise<{ picked: string[]; mined: number }> => {
      const { world, ctx } = await lab();
      const task = createTask(world, { kind: 'scan_trends' });
      const out = await HANDLERS.scan_trends.run(ctx, task, owner(world, 'scan_trends'), mindOf(owner(world, 'scan_trends'), world.day, t));
      task.output = out.output ?? null;
      await HANDLERS.scan_trends.onDone!(ctx, task);
      const niches = new Set(world.company.tasks.filter((x) => x.kind === 'mine_pains').map((x) => x.input.nicheId));
      return { picked: out.output!.top as string[], mined: niches.size };
    };
    const [off, weak, strong] = [await top(), await top(0.2), await top(0.8)];
    expect(off.picked).toHaveLength(3);
    expect(weak.picked).toHaveLength(3);
    expect(strong.picked).toHaveLength(5);
    expect(strong.picked.slice(0, 3)).toEqual(off.picked); // the same scan, read further
    expect(strong.mined).toBeGreaterThan(off.mined);
  });

  it('the CEO signs the pick: the bandit is read with her sharpness, not the researcher\'s', async () => {
    const { world, ctx } = await lab();
    world.company.research.trends = ctx.tools.searchTrends();
    for (const s of world.company.research.trends) learning.rewardArm(world, 'niche', s.nicheId, 0.5);
    const nadia = owner(world, 'pick_opportunity');
    await HANDLERS.pick_opportunity.run(ctx, createTask(world, { kind: 'pick_opportunity' }), nadia, mindOf(nadia, world.day, 0.1));
    expect(spy.sharpAsked).toEqual([{ agent: 'camille', t: spy.ceoT, purpose: 'niche' }]);
    expect(spy.armsRead.filter((a) => a.dimension === 'niche')).toEqual([{ dimension: 'niche', samples: spy.craft(spy.ceoT).sharp }]);
  });
});

// ───────────────────────────── support ─────────────────────────────

function message(world: WorldState, i: number, over: Partial<InboxMessage> = {}): InboxMessage {
  const body = `Comment lire le guide sur ma tablette ? (${i})`;
  const m = {
    id: `msg_${i}`, day: world.day, customerId: 'cus_1', channel: 'email', subject: `Question ${i}`, body, intent: 'question', productId: null, orderId: null,
    mood: 0, status: 'open', deadlineDay: world.day + 2, thread: [{ from: 'customer', text: body, day: world.day }], resolution: null, ...over,
  } as InboxMessage;
  world.market.inbox.push(m);
  return m;
}

async function answer(ctx: RuntimeCtx, world: WorldState, input: Record<string, unknown>, t?: number): Promise<string[]> {
  const agent = owner(world, 'reply_inbox');
  const task = createTask(world, { kind: 'reply_inbox', input });
  const out = await supportHandlers.reply_inbox!.run(ctx, task, agent, mindOf(agent, world.day, t));
  task.status = 'done';
  return (out.output!.replies as { messageId: string }[]).map((r) => r.messageId);
}

async function inbox(n: number): Promise<{ world: WorldState; ctx: RuntimeCtx; ids: string[] }> {
  const { world, ctx } = await lab();
  return { world, ctx, ids: Array.from({ length: n }, (_, i) => message(world, i).id) };
}

describe('support lever (talent §4.7)', () => {
  it('t=.8 clears a bigger batch than t=.2', async () => {
    const cleared = async (t?: number) => { const { world, ctx } = await inbox(12); return (await answer(ctx, world, {}, t)).length; };
    expect(await cleared(0.2)).toBe(5);
    expect(await cleared(0.8)).toBe(7);
    expect(await cleared()).toBe(6); // talent off: today's batch
  });

  it('talent off answers the plan\'s batch as it stands, whatever else waits', async () => {
    const { world, ctx, ids } = await inbox(12);
    expect(await answer(ctx, world, { messageIds: ids.slice(0, 6) })).toEqual(ids.slice(0, 6));
  });

  it('a weak agent leaves the end of a planned batch, which is free to plan again', async () => {
    const { world, ctx, ids } = await inbox(6);
    expect(await answer(ctx, world, { messageIds: ids }, 0.2)).toEqual(ids.slice(0, 5));
    const left = world.market.inbox.find((m) => m.id === ids[5])!;
    expect(left.status).toBe('open');
    expect(claimedMessageIds(world).has(left.id)).toBe(false);
  });

  it('a strong agent goes past a planned batch: its plan first, then what waits', async () => {
    const { world, ctx, ids } = await inbox(12);
    const done = await answer(ctx, world, { messageIds: ids.slice(0, 6) }, 0.8);
    expect(done).toHaveLength(7);
    expect(done.slice(0, 6)).toEqual(ids.slice(0, 6));
  });

  it('it may clear a reply task that has not started, never one under way or a refund', async () => {
    const { world, ctx, ids } = await inbox(9);
    const later = createTask(world, { kind: 'reply_inbox', input: { messageIds: [ids[6]!] } });
    const underWay = createTask(world, { kind: 'reply_inbox', input: { messageIds: [ids[7]!] } });
    underWay.status = 'in_progress';
    createTask(world, { kind: 'handle_refund', input: { messageId: ids[8]! } });
    const done = await answer(ctx, world, { messageIds: ids.slice(0, 6) }, 1);
    expect(done).toEqual(ids.slice(0, 7));
    const agent = owner(world, 'reply_inbox');
    const out = await supportHandlers.reply_inbox!.run(ctx, later, agent, mindOf(agent, world.day));
    expect(out.output!.replies).toEqual([]); // nothing left in the task it emptied
  });

  it('a misread is less likely as t grows, on one draw, and stays at 10 % with no talent', () => {
    const chances = (t?: number): number[] => {
      const seen: number[] = [];
      const rng = { ...seededRng(1, 'misread'), chance: (p: number) => { seen.push(p); return false; } };
      const msg = { subject: '', body: 'Comment ça marche ?', channel: 'email', mood: 0 } as InboxMessage;
      expect(guessIntent(msg).ambiguous).toBe(true);
      heuristicSupportReply({ message: msg, product: null, order: null, policy: [] }, rng, { tone: 'concis', agent: 'A', brand: 'B', playbook: [], t });
      return seen;
    };
    expect(chances()).toEqual([0.1]);
    expect(chances(0.2)).toEqual([0.22 * 0.8]);
    expect(chances(0.8)[0]).toBeCloseTo(0.22 * 0.2, 12);
    expect(chances(0.55)[0]).toBeCloseTo(0.099, 12);
  });

  it('the engine misreads with the agent\'s talent', async () => {
    const { world } = await lab();
    const agent = owner(world, 'reply_inbox');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
    const misreads = async (t: number): Promise<number> => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const message = { id: 'm', subject: '', body: `Comment ça marche ? Merci ${i}`, channel: 'email', mood: 0 } as InboxMessage;
        const reply = await engine.writeSupportReply({ message, product: null, order: null, policy: [] }, mindOf(agent, 3, t));
        if (reply.detectedIntent !== guessIntent(message).intent) n++;
      }
      return n;
    };
    const [weak, strong] = [await misreads(0.05), await misreads(0.95)];
    expect(strong).toBeLessThan(weak);
    expect(weak).toBeGreaterThan(30); // about 21 %
    expect(strong).toBeLessThan(15);  // about 1 %
  });

  it('tone reads the bandit with the agent\'s sharpness, and with none when talent is off', async () => {
    const read = async (t?: number) => {
      spy.armsRead.length = 0;
      const { world, ctx } = await inbox(2);
      await answer(ctx, world, {}, t);
      return spy.armsRead.filter((a) => a.dimension === 'support_tone').map((a) => a.samples);
    };
    expect(await read(0.8)).toEqual([spy.craft(0.8).sharp, spy.craft(0.8).sharp]);
    expect(await read()).toEqual([undefined, undefined]);
  });
});

describe('support evidence (talent §5.2)', () => {
  const faking = (ctx: RuntimeCtx, score: number, consequence: ReplyOutcome['consequence'] = 'none'): RuntimeCtx => ({
    ...ctx,
    tools: { ...ctx.tools, replyToMessage: (messageId: string): ReplyOutcome => ({ messageId, score, customerReaction: 'Merci.', newMood: 0, resolved: true, consequence, cost: 0 }) },
  });
  /** One message answered in a league, and what the book of evidence holds after it. */
  const played = async (score: number, consequence: ReplyOutcome['consequence'], t?: number) => {
    const { world, ctx } = await inbox(1);
    const league = (world.company.league = emptyLeague(world));
    await answer(faking(ctx, score, consequence), world, {}, t);
    return { league, agentId: owner(world, 'reply_inbox').id, events: (source: string) => league.events.filter((e) => e.source === source) };
  };

  it('each reply is a game against par, and weighs little', async () => {
    const { league, agentId, events } = await played(100, 'none', 0.5);
    const [reply] = events('reply');
    expect(reply).toMatchObject({ agentId, skill: 'support', w: 0.25 });
    expect(reply!.s).toBeCloseTo(0.8413, 3); // Φ(1)
    expect(reply!.label).toMatch(/Question 0/);
    expect(league.parStats['support:reply']).toEqual({ n: 1, sum: 100, sq: 10_000 }); // what S14 sets the par from
    expect(events('chargeback')).toEqual([]);
  });

  it('par is a coin flip, and a bad reply says so', async () => {
    expect((await played(85, 'none', 0.5)).events('reply')[0]!.s).toBeCloseTo(0.5, 3);
    expect((await played(40, 'none', 0.5)).events('reply')[0]!.s).toBe(0.0013); // Φ(-3), as the ring rounds it
  });

  it('a chargeback after a reply is a lost game on top of it', async () => {
    const { agentId, events } = await played(90, 'chargeback', 0.5);
    expect(events('reply')).toHaveLength(1);
    expect(events('chargeback')).toEqual([expect.objectContaining({ agentId, skill: 'support', s: 0, w: 0.5 })]);
  });

  it('talent off records nothing, not even on a chargeback', async () => {
    const { league } = await played(90, 'chargeback');
    expect(league.events).toEqual([]);
    expect(league.parStats).toEqual({});
  });
});
