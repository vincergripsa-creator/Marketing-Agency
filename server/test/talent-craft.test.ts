/**
 * Truth and craft (talent §2 to §4.1, §4.8 to §4.10): who has how much talent, what it is worth as a way of working, and
 * that none of it shows. Levers on real text sit in talent-levers.test.ts. Numbered tests are those of talent §11.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentState, BanditArm, DailyAdStats, HookStyle, Product, ScenarioConfig, Skill, TaskKind, VoiceOfCustomer, WorldState } from '../src/shared.js';
import type { ContentEngine, Craft, MindContext, RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { hashString } from '../src/core/ids.js';
import { liveSnapshotJson, toSnapshot } from '../src/api/snapshot.js';
import { createBrainVault } from '../src/learning/index.js';
import { chooseArm, sampleBeta } from '../src/learning/bandits.js';
import { addRule, replaceRuleEverywhere, syncDirective } from '../src/learning/playbooks.js';
import { createContentEngine, type ClaudeClientLike } from '../src/minds/index.js';
import { systemBlocks } from '../src/minds/claude/prompts.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { STREAM } from '../src/runtime/streams.js';
import { streamRng } from '../src/core/index.js';
import {
  armSharp, bestDraft, coachTick, craftFor, craftOf, drawPerson, effectiveT, emptyLeague, familyOf, KIND_SKILL, leagueSeats, MIN_SEASON_N, practice, primaryOf, primarySkill, pruneRead, rampOf,
  roleSkills, sampleTalent, seedTruth, shrunkRoas, SKILLS, skillOf, TALENT, talentMode, truthOf,
} from '../src/runtime/talent/index.js';
import { talentPillar } from '../src/runtime/talent/index.js';
import { ALL_KINDS } from '../src/runtime/tasks.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function scenario(over: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return defaultScenario({ seed: 7, talent: 'flat', mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over });
}

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}, wrap: (e: ContentEngine) => ContentEngine = (e) => e): Promise<Lab> {
  const world = createWorld(scenario(over), 'test-talent-craft');
  const root = mkdtempSync(join(tmpdir(), 'pixel-talent-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: wrap(createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed })), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w) => new Company(w, opts) };
}

/** Every call an engine receives, by what its context carried. */
function recording(seen: { method: string; ctx: MindContext }[]) {
  return (engine: ContentEngine): ContentEngine => new Proxy(engine, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (args[1]) seen.push({ method: String(key), ctx: args[1] as MindContext });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

const agentOf = (w: WorldState, id: string): AgentState => w.company.agents.find((a) => a.id === id)!;

/** Every skill: a lever test forces the skills it reads, these tests want every draw told apart. */
const forced = (value: number): Partial<ScenarioConfig> => ({ control: { talentOverride: { skills: [...SKILLS], value } } });

const VOC: VoiceOfCustomer = {
  nicheId: 'sommeil-bebe', depth: 'deep',
  pains: ['Bébé se réveille toutes les 2 heures la nuit', 'Je suis épuisée, je n’ai pas dormi plus de 3 h d’affilée depuis des mois'],
  phrases: ['il se réveille toutes les 2h', 'je n’en peux plus', 'on a tout essayé'],
  objections: ['Je n’ai pas le temps de lire 50 pages'], desires: [], priceAnchors: [19], bannedClaims: [],
} as unknown as VoiceOfCustomer;

const PRODUCT = { id: 'prd_1', nicheId: 'sommeil-bebe', title: 'Des nuits complètes en 14 jours', price: 19, problem: VOC.pains[0], audience: 'Parents épuisés' } as unknown as Product;

function mindOf(over: Partial<MindContext> = {}): MindContext {
  const agent = createWorld(scenario({ ...LEGACY }), 'mind').company.agents.find((a) => a.id === 'sarah')!;
  return { agent, playbook: [], brainNotes: [], lessons: [], day: 3, ...over };
}

describe('1. off is today', () => {
  it('leaves no truth, no league and no craft on any call of a run', async () => {
    const seen: { method: string; ctx: MindContext }[] = [];
    const { world, company } = await lab({ ...LEGACY }, recording(seen));
    await company.runDays(4);
    expect(talentMode(world)).toBe('off');
    expect(world.talentTruth).toBeUndefined();
    expect(world.company.league).toBeUndefined();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((c) => 'craft' in c.ctx || c.ctx.draw !== undefined)).toEqual([]);
  }, 60_000);

  it('hands a craft to the kinds with a skill, and only those, once talent is on', async () => {
    const seen: { method: string; ctx: MindContext }[] = [];
    const { world, company } = await lab({ ...LEGACY, talent: 'flat' }, recording(seen));
    await company.runDays(4);
    expect(talentMode(world)).toBe('flat');
    expect(world.talentTruth).toBeDefined();
    expect(world.company.league).toBeDefined();
    const crafted = seen.filter((c) => c.ctx.craft);
    expect(new Set(crafted.map((c) => c.ctx.craft!.skill)).has('research')).toBe(true);
    expect(seen.some((c) => !c.ctx.craft)).toBe(true); // planDay, the rituals, a chat: nobody's talent
    for (const c of crafted) expect(c.ctx.craft!.t).toBeCloseTo(effectiveT(world, agentOf(world, c.ctx.agent.id), c.ctx.craft!.skill)!, 1);
  }, 60_000);

  it('chooseArm without sharp draws what it always drew, from the same rng', () => {
    const world = createWorld(scenario({ ...LEGACY }), 'arms');
    world.company.bandits.hook = [
      { key: 'a', alpha: 3, beta: 2, pulls: 3, reward: 2 },
      { key: 'b', alpha: 2, beta: 4, pulls: 4, reward: 1 },
      { key: 'c', alpha: 1, beta: 1, pulls: 0, reward: 0 },
    ];
    const before = (rng: ReturnType<typeof createRng>): string => {
      let best = 'a';
      let top = -1;
      for (const arm of world.company.bandits.hook as BanditArm[]) {
        const draw = sampleBeta(arm.alpha, arm.beta, rng);
        if (draw > top) { top = draw; best = arm.key; }
      }
      return best;
    };
    const now = createRng(11);
    const then = createRng(11);
    const flat = createRng(11);
    const spare = createRng(5);
    for (let i = 0; i < 200; i++) {
      const arm = before(then);
      expect(chooseArm(world, 'hook', ['a', 'b', 'c'], now)).toBe(arm);
      expect(chooseArm(world, 'hook', ['a', 'b', 'c'], flat, { samples: 1, rng: spare })).toBe(arm);
    }
    expect(now.state()).toBe(then.state());
    expect(spare.state()).toBe(createRng(5).state()); // one sample is today: the spare stream never moves
  });

  it('a sharp read takes each first sample from the same rng: the arm may change, what the main rng drew may not', () => {
    const world = createWorld(scenario({ ...LEGACY }), 'arms');
    const plain = createRng(3);
    const sharp = createRng(3);
    for (let i = 0; i < 50; i++) {
      chooseArm(world, 'format', ['a', 'b'], plain);
      chooseArm(world, 'format', ['a', 'b'], sharp, { samples: 5, rng: createRng(100 + i) });
    }
    expect(sharp.state()).toBe(plain.state());
  });
});

describe('2. draw 0 is the text of today', () => {
  const input = { product: PRODUCT, voc: VOC, hook: 'Tu n’as pas dormi depuis des mois ?', hookStyle: 'question' as HookStyle, format: 'faceless_voiceover' as const, bannedClaims: [] };

  it('writes the same ad with no draw, with draw 0, and another with draw 1', async () => {
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
    const plain = await engine.writeAd(input, mindOf());
    expect(await engine.writeAd(input, mindOf({ draw: 0 }))).toEqual(plain);
    const hooks = (ctx: MindContext) => engine.writeAdHooks({ product: PRODUCT, voc: VOC, styles: ['question', 'mistake', 'pov', 'story', 'stat'] }, ctx);
    expect(await hooks(mindOf({ draw: 0 }))).toEqual(await hooks(mindOf()));
    const seeds = await Promise.all([1, 2, 3, 4, 5].map((draw) => hooks(mindOf({ draw }))));
    expect(seeds.some((h) => JSON.stringify(h) !== JSON.stringify(seeds[0]))).toBe(true); // the key really moved
  });
});

describe('3. the secret stays secret', () => {
  const MARK = '0.7654321';
  const TOP = '0.8765432';

  async function planted(): Promise<Lab> {
    const l = await lab({ talent: 'league' });
    const truth = l.world.talentTruth!.agents[l.world.company.agents[0]!.id]!;
    truth.talent.copy = Number(MARK);
    truth.ceiling.copy = Number(TOP);
    return l;
  }

  it('keeps a planted talent out of the snapshots, out of company and out of the system prompt', async () => {
    const { world } = await planted();
    expect(JSON.stringify(world.talentTruth)).toContain(MARK); // the sentinel is really there
    for (const json of [JSON.stringify(toSnapshot(world, false)), liveSnapshotJson(world), JSON.stringify(world.company)]) {
      expect(json).not.toContain('talentTruth');
      expect(json).not.toContain('ceiling');
      expect(json).not.toContain(MARK);
      expect(json).not.toContain(TOP);
    }
    const craft: Craft = { ...craftOf('copy', Number(MARK), 'sonnet'), t: Number(MARK), flaw: Number(TOP) };
    const blocks = JSON.stringify(systemBlocks({ ...mindOf(), craft }, 'Pixel Agency'));
    expect(blocks).not.toContain(MARK);
    expect(blocks).not.toContain(TOP);
    expect(blocks).not.toContain('craft');
  });

  it('a craft in use leaves no trace in the snapshot or the brain', async () => {
    const { world, company, ctx } = await planted();
    await company.runDays(3);
    const json = JSON.stringify(toSnapshot(world, false));
    for (const word of ['"flaw"', '"sharp"', '"reach"', 'practicedLevel', 'meanLeague', MARK]) expect(json).not.toContain(word);
    expect(JSON.stringify(await ctx.brain.list())).not.toContain(MARK);
  }, 60_000);
});

describe('who has talent', () => {
  it('draws on-role skills at the mean of their kind of person, everything else at the off-role mean (D15)', () => {
    const on: number[] = [];
    const off: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const world = createWorld(scenario({ seed }), 'draw');
      const truth = seedTruth(world);
      for (const a of world.company.agents) {
        const mine = roleSkills(a.roleId);
        for (const s of SKILLS) (mine.includes(s) ? on : off).push(truth.agents[a.id]!.talent[s]!);
      }
    }
    const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
    expect(mean(on)).toBeGreaterThan(TALENT.founderMean - 0.03);
    expect(mean(on)).toBeLessThan(TALENT.founderMean + 0.03);
    expect(mean(off)).toBeGreaterThan(TALENT.offRoleMean - 0.03);
    expect(mean(off)).toBeLessThan(TALENT.offRoleMean + 0.03);
    expect(Math.min(...on, ...off)).toBeGreaterThanOrEqual(TALENT.founderFloor);
    expect(Math.max(...on, ...off)).toBeLessThanOrEqual(TALENT.cap);
  });

  it('keeps a hire under the founders, and every talent under its ceiling', () => {
    const world = createWorld(scenario(), 'draw');
    const hires = Array.from({ length: 300 }, (_, i) => drawPerson(world, { id: `recrue-${i}`, roleId: 'sales_copywriter', founder: false }));
    const page = hires.map((h) => h.talent.page!);
    const mean = page.reduce((x, y) => x + y, 0) / page.length;
    expect(mean).toBeGreaterThan(TALENT.marketMean - 0.03);
    expect(mean).toBeLessThan(TALENT.marketMean + 0.03);
    for (const h of hires) {
      expect(h.ceiling.page).toBeCloseTo(Math.min(TALENT.ceilingCap, h.talent.page! + TALENT.ceilingGain), 9);
      expect(h.start).toEqual(h.talent);
    }
  });

  it('a person is a function of the seed and their id: paired arms share their founders, and the keys are the plan\'s', () => {
    const lean = createWorld(scenario(), 'a');
    const legacy = createWorld(scenario({ ...LEGACY, talent: 'flat' }), 'b');
    const other = createWorld(scenario({ seed: 8 }), 'c');
    const a = seedTruth(lean).agents.camille!;
    expect(seedTruth(legacy).agents.camille!.talent).toEqual(a.talent);
    expect(seedTruth(other).agents.camille!.talent).not.toEqual(a.talent);
    const g = streamRng(7, STREAM.seedTalent, hashString('camille'), SKILLS.length).normal(0, TALENT.personSd);
    const e = streamRng(7, STREAM.seedTalent, hashString('camille'), SKILLS.indexOf('research')).normal(0, TALENT.skillSd);
    expect(a.talent.research).toBeCloseTo(Math.min(TALENT.cap, Math.max(TALENT.founderFloor, TALENT.founderMean + g + e)), 12);
  });

  it('control.talentOverride forces every agent, hires too, and practice leaves a forced skill where it is', () => {
    const world = createWorld(scenario({ control: { talentOverride: { skills: ['copy', 'page'], value: 0.25 } } }), 'forced');
    const truth = (world.talentTruth = seedTruth(world));
    for (const a of world.company.agents) {
      expect(truth.agents[a.id]!.talent.copy).toBe(0.25);
      expect(truth.agents[a.id]!.talent.page).toBe(0.25);
    }
    expect(drawPerson(world, { id: 'recrue', roleId: 'hook_writer', founder: false }).talent.copy).toBe(0.25);
    const a = world.company.agents[0]!;
    expect(truth.agents[a.id]!.talent.research).not.toBe(0.25);
    a.level = 4;
    a.taskKinds = ['produce_ad'];
    practice(world);
    expect(truth.agents[a.id]!.talent.copy).toBe(0.25);
  });

  it('forces the two control skills the same way', () => {
    const world = createWorld(scenario({ control: { videoSkill: 0.9, designTalent: 0.25 } }), 'forced');
    const t = seedTruth(world).agents.zoe!.talent;
    expect(t.video).toBe(0.9);
    expect(t.design).toBe(0.25);
  });

  it('truthOf seeds a person it has not met, the same whoever asks first', () => {
    const world = createWorld(scenario(), 't');
    world.talentTruth = seedTruth(world);
    const a = { ...world.company.agents[1]!, id: 'yanis', roleId: 'hook_writer' as const, founder: false, hiredDay: 3 };
    const direct = drawPerson(world, a);
    expect(truthOf(world, a)).toEqual(direct);
    expect(world.talentTruth.agents.yanis).toEqual(direct);
  });

  it('a clone starts from its teacher (§7.4)', () => {
    const world = createWorld(scenario(), 't');
    world.talentTruth = seedTruth(world);
    const teacher = world.talentTruth.agents.leo!;
    const gaps = Array.from({ length: 200 }, (_, i) => drawPerson(world, { id: `eleve-${i}`, roleId: 'hook_writer', founder: false }, 'leo'))
      .map((c) => { expect(c.lineage).toBe('leo'); return c.talent.copy! - teacher.talent.copy!; });
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    expect(mean).toBeGreaterThan(-0.04);
    expect(mean).toBeLessThan(0);
  });

  it('maps every kind of D12 to its skill, and leaves the others without one', () => {
    expect(KIND_SKILL.adapt_creative).toBe('video');
    expect(KIND_SKILL.write_search_ads).toBe('copy');
    expect(KIND_SKILL.produce_ad).toBe('copy');
    expect([KIND_SKILL.design_cover, KIND_SKILL.render_pdf]).toEqual(['design', 'design']);
    expect(KIND_SKILL.humanize_pdf).toBe('polish');
    expect(Object.keys(KIND_SKILL).every((k) => ALL_KINDS.includes(k as TaskKind))).toBe(true);
    expect(skillOf('plan_day')).toBeNull();
    expect(MIN_SEASON_N).toMatchObject({ video: 4, design: 2 });
    expect(Object.keys(MIN_SEASON_N).sort()).toEqual([...SKILLS].sort());
  });

  it('an older save takes the primary of today on mount', () => {
    const world = createWorld(scenario(), 't');
    world.company.league = emptyLeague(world);
    world.company.league.entries.leo!.primary = 'copy';
    talentPillar.mount!(world);
    expect(world.company.league.entries.leo!.primary).toBe('buying');
  });

  it('primary is the first core kind whose skill has an evidence route, never a hat, and the CEO is out of the league (D13, D14)', () => {
    const world = createWorld(scenario(), 't');
    const zoe = agentOf(world, 'zoe');
    zoe.taskKinds = ['produce_ad', ...zoe.taskKinds];
    zoe.hatKinds = ['produce_ad'];
    expect(primarySkill(world, 'zoe')).toBe('design');
    expect(primaryOf('ceo')).toBeNull();
    expect(primaryOf('fact_checker')).toBeNull();
    expect(primaryOf('video_editor')).toBe('copy');
    expect(primaryOf('motion_designer')).toBe('video');
    expect(primaryOf('hook_writer')).toBe('copy');        // a hook is read through the ad of the same hand
    expect(primaryOf('growth_lead')).toBe('buying');      // the growth lead writes hooks, no ad: they are read on their campaigns
    expect(primaryOf('media_buyer_tiktok')).toBe('buying');
    expect(primaryOf('cover_designer')).toBe('design');   // no route: the first skill stays, unrated, and the hire test with it (D16)
    expect(primarySkill(world, 'leo')).toBe('buying');
    expect(emptyLeague(world).entries.leo!.primary).toBe('buying');
    const seats = leagueSeats(world).map((a) => a.id);
    expect(seats).not.toContain('camille');
    expect(seats).not.toContain('gabriel');
    expect(seats).toEqual(expect.arrayContaining(['zoe', 'leo', 'elise', 'clara', 'nadia']));
    expect(familyOf(world, 'design').map((a) => a.id)).toEqual(['zoe']);
    expect(Object.keys(emptyLeague(world).entries).sort()).toEqual([...seats].sort());
    expect(emptyLeague(world)).toMatchObject({ season: 1, seasonStartDay: 1, closedSeasons: 0, lastEvidenceDay: 0, parStats: {} });
  });
});

describe('craft', () => {
  it('turns a talent into the numbers of §4', () => {
    const at = (t: number) => craftOf('copy', t, 'sonnet');
    expect(at(0.2).flaw).toBeCloseTo(0.358, 3);
    expect(at(0.4).flaw).toBeCloseTo(0.232, 3);
    expect(at(0.56).flaw).toBeCloseTo(0.146, 3);
    expect(at(0.8).flaw).toBeCloseTo(0.045, 3);
    expect([at(0).draws, at(0.34).draws, at(0.67).draws, at(1).draws]).toEqual([1, 2, 3, 4]);
    expect([at(0).sharp, at(0.5).sharp, at(1).sharp]).toEqual([1, 3, 5]);
    expect([at(0.3).passes, at(0.5).passes, at(0.79).passes, at(0.8).passes]).toEqual([1, 2, 2, 3]);
    expect(at(0.3).reach).toBeCloseTo(0.58, 9);
    expect(at(0.9).eye).toBeCloseTo(0.8, 9);
  });

  it('a hire ramps over a week, the team of day 1 never does (D10)', () => {
    expect(rampOf({ hiredDay: 0 }, 2)).toBe(1);
    expect(rampOf({ hiredDay: 10 }, 10)).toBeCloseTo(0.7, 9);
    expect(rampOf({ hiredDay: 10 }, 13)).toBeCloseTo(0.7 + 0.3 * 3 / 7, 9);
    expect(rampOf({ hiredDay: 10 }, 17)).toBe(1);
    const world = createWorld(scenario(), 't');
    world.talentTruth = seedTruth(world);
    world.day = 10;
    const leo = agentOf(world, 'leo');
    const full = effectiveT(world, leo, 'copy')!;
    expect(full).toBe(world.talentTruth.agents.leo!.talent.copy);
    leo.hiredDay = 10;
    expect(effectiveT(world, leo, 'copy')).toBeCloseTo(full * 0.7, 9);
  });

  it('a kind with no skill has no craft, and the perk of the season is one more draft', () => {
    const world = createWorld(scenario(), 't');
    world.talentTruth = seedTruth(world);
    world.company.league = emptyLeague(world);
    const leo = agentOf(world, 'leo');
    expect(craftFor(world, leo, 'plan_day')).toBeUndefined();
    const plain = craftFor(world, leo, 'produce_ad')!;
    expect(plain.skill).toBe('copy');
    world.company.league.perks.push({ agentId: 'leo', season: 1 });
    expect(craftFor(world, leo, 'produce_ad')!.draws).toBe(plain.draws + 1);
    world.company.league.perks[0]!.season = 2;
    expect(craftFor(world, leo, 'produce_ad')!.draws).toBe(plain.draws);
  });

  it('bestDraft keeps what the agent believes is best: a good eye finds the best draft, draw 0 goes first', async () => {
    const { ctx, world } = await lab();
    const agent = world.company.agents[0]!;
    const asked: (number | undefined)[] = [];
    const drafts = async (t: number, day: number) => {
      world.day = day;
      const craft = craftOf('copy', t, agent.tier);
      return bestDraft(ctx, agent, { ...mindOf(), craft }, 'test', async (m) => { asked.push(m.draw); return m.draw ?? 0; }, (d) => [70, 80, 90, 95][d]!);
    };
    const sharp = await drafts(1, 2);
    expect(asked).toEqual([undefined, 1, 2, 3]);
    expect(sharp).toEqual({ draft: 3, drawn: 4, realScore: 95 }); // no eye noise at t = 1
    const single = await drafts(0, 3);
    expect(single).toEqual({ draft: 0, drawn: 1, realScore: 70 });
    let wrong = 0;
    for (let day = 10; day < 60; day++) if ((await drafts(0.34, day)).draft !== 1) wrong += 1; // two drafts 10 apart read with an sd of 5,3: misjudged now and then
    expect(wrong).toBeGreaterThan(0);
    expect(wrong).toBeLessThan(25);
  });

  it('bestDraft writes 1 draft on Claude, 2 from the top of the table (§4.9)', async () => {
    const world = createWorld(scenario(), 't');
    const ctx = { world, engine: { mode: 'claude' } } as unknown as RuntimeCtx;
    const agent = world.company.agents[0]!;
    const count = async (t: number) => (await bestDraft(ctx, agent, { ...mindOf(), craft: craftOf('copy', t, 'sonnet') }, 'x', async () => 1, () => 1)).drawn;
    expect([await count(0.2), await count(0.5), await count(0.7), await count(0.95)]).toEqual([1, 1, 2, 2]);
  });

  it('armSharp gives no read without a craft, and the talent stream of the plan with one', async () => {
    const { ctx, world } = await lab();
    const agent = world.company.agents[0]!;
    expect(armSharp(ctx, agent, mindOf(), 'hook')).toBeUndefined();
    const craft = craftOf('copy', 0.8, 'sonnet');
    const read = armSharp(ctx, agent, { ...mindOf(), craft }, 'hook')!;
    expect(read.samples).toBe(craft.sharp);
    const again = armSharp(ctx, agent, { ...mindOf(), craft }, 'hook')!;
    expect(again.rng.next()).toBe(read.rng.next());
    expect(armSharp(ctx, agent, { ...mindOf(), craft }, 'format')!.rng.next()).not.toBe(armSharp(ctx, agent, { ...mindOf(), craft }, 'hook')!.rng.next());
  });
});

describe('5. talent has its own streams', () => {
  it('the same market at t = .25 and t = .8', async () => {
    const low = await lab(forced(0.25));
    const high = await lab(forced(0.8));
    expect(low.world.talentTruth!.agents.leo!.talent.copy).toBe(0.25);
    expect(high.world.talentTruth!.agents.leo!.talent.copy).toBe(0.8);
    await low.company.runDays(12);
    await high.company.runDays(12);
    // ids and product refs come from the world's one counter: they follow what the company did, the market's draws do not
    const drawn = (l: Lab) => l.world.market.events.map(({ day, kind, title, description, severity }) => ({ day, kind, title, description, severity }));
    expect(drawn(low).length).toBeGreaterThan(0);
    expect(drawn(high)).toEqual(drawn(low));
    // the talent really acted: the same days, two companies
    expect(JSON.stringify(high.world.company.creatives)).not.toBe(JSON.stringify(low.world.company.creatives));
  }, 120_000);

  it('drafting and reading a bandit move no generator of the company', async () => {
    const { ctx, world } = await lab();
    const agent = world.company.agents[0]!;
    const before = [ctx.rng.state(), ctx.channelRng.state()];
    const craft = craftOf('copy', 0.7, 'sonnet');
    await bestDraft(ctx, agent, { ...mindOf(), craft }, 'test', async () => 'x', () => 1);
    armSharp(ctx, agent, { ...mindOf(), craft }, 'hook')!.rng.next();
    expect([ctx.rng.state(), ctx.channelRng.state()]).toEqual(before);
  });
});

describe('11. a sharper read of a bandit', () => {
  const wins = (arms: BanditArm[], samples: number): number => {
    const world = createWorld(scenario(), 't');
    world.company.bandits.hook = arms;
    const rng = createRng(21);
    const extra = createRng(22);
    let good = 0;
    for (let i = 0; i < 2000; i++) if (chooseArm(world, 'hook', ['good', 'bad'], rng, { samples, rng: extra }) === 'good') good += 1;
    return good;
  };
  const arm = (key: string, alpha: number, beta: number): BanditArm => ({ key, alpha, beta, pulls: alpha + beta, reward: alpha });

  it('exploits what the company learned', () => {
    expect(wins([arm('good', 30, 10), arm('bad', 10, 30)], 5)).toBeGreaterThanOrEqual(wins([arm('good', 30, 10), arm('bad', 10, 30)], 1));
    const close = [arm('good', 30, 10), arm('bad', 25, 15)]; // 30/10 against 10/30 never loses at 2 000 draws: nothing to tell apart
    expect(wins(close, 5)).toBeGreaterThan(wins(close, 1) + 100);
  });
});

describe('control.noLearning', () => {
  it('chooseArm picks at random, whatever the arms say', () => {
    const world = createWorld(scenario({ control: { noLearning: true } }), 't');
    world.company.bandits.hook = [{ key: 'good', alpha: 90, beta: 1, pulls: 90, reward: 90 }, { key: 'bad', alpha: 1, beta: 90, pulls: 90, reward: 0 }];
    const rng = createRng(4);
    const picks = Array.from({ length: 400 }, () => chooseArm(world, 'hook', ['good', 'bad'], rng));
    const good = picks.filter((p) => p === 'good').length;
    expect(good).toBeGreaterThan(150);
    expect(good).toBeLessThan(250);
  });

  it('playbooks stay as they are', () => {
    const world = createWorld(scenario({ control: { noLearning: true } }), 't');
    const old = 'Privilégier le hook « question »';
    world.company.playbooks.leo = [old];
    world.company.playbooks.sarah = ['Privilégier le hook « story »'];
    expect(addRule(world, 'leo', 'Ne jamais écrire « miracle »')).toBe('skipped');
    expect(replaceRuleEverywhere(world, old, 'Privilégier le hook « stat »')).toEqual([]);
    expect(syncDirective(world, old)).toEqual([]);
    expect(world.company.playbooks).toMatchObject({ leo: [old], sarah: ['Privilégier le hook « story »'] });
    world.scenario.control = {};
    expect(addRule(world, 'leo', 'Ne jamais écrire « miracle »')).toBe('added');
    expect(syncDirective(world, old)).toEqual(['sarah']);
  });
});

describe('12. a level is real', () => {
  it('raises the truth on the skills in use, never over the ceiling, each gain under the last', () => {
    const world = createWorld(scenario(), 't');
    const truth = (world.talentTruth = seedTruth(world)).agents.leo!;
    const leo = agentOf(world, 'leo');
    const used = KIND_SKILL[leo.taskKinds[0]!] as Skill;
    expect(used).toBe('copy');
    Object.assign(truth.talent, { copy: 0.5 });
    Object.assign(truth.ceiling, { copy: 0.62 });
    const offRole = truth.talent.support;
    const gains: number[] = [];
    let t = 0.5;
    for (let level = 2; level <= 7; level++) {
      leo.level = level;
      practice(world);
      gains.push(truth.talent.copy! - t);
      t = truth.talent.copy!;
      expect(t).toBeLessThanOrEqual(truth.ceiling.copy!);
      expect(truth.practicedLevel).toBe(level);
    }
    expect(gains[0]).toBeCloseTo(0.03, 9);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]!).toBeGreaterThan(0);
      expect(gains[i]!).toBeLessThan(gains[i - 1]!);
    }
    expect(truth.talent.support).toBe(offRole);
    practice(world);
    expect(truth.talent.copy).toBe(t); // no new level, no new gain
  });

  it('comes from delivered work, in flat too, through a real run', async () => {
    const { world, company } = await lab({ ...LEGACY, talent: 'flat' });
    const before = JSON.parse(JSON.stringify(world.talentTruth!.agents)) as NonNullable<WorldState['talentTruth']>['agents'];
    await company.runDays(14);
    const grown = world.company.agents.filter((a) => a.level > 1);
    expect(grown.length).toBeGreaterThan(0);
    const moved = grown.filter((a) => JSON.stringify(before[a.id]!.talent) !== JSON.stringify(world.talentTruth!.agents[a.id]!.talent));
    expect(moved.length).toBeGreaterThan(0);
    for (const a of world.company.agents) if (a.level === 1) expect(world.talentTruth!.agents[a.id]!.talent).toEqual(before[a.id]!.talent);
  }, 120_000);
});

describe('coaching', () => {
  function planned(over: Partial<ScenarioConfig> = { talent: 'league' }) {
    const world = createWorld(scenario(over), 't');
    world.talentTruth = seedTruth(world);
    world.company.league = emptyLeague(world);
    world.company.league.plans.push({ agentId: 'clara', skill: 'page', openedSeason: 1, deadlineDay: 28, metricLabel: 'm', baseline: 70, target: 73, coachId: 'leo', text: 'x', outcome: 'open' });
    const truth = world.talentTruth.agents;
    Object.assign(truth.clara!.talent, { page: 0.4 });
    Object.assign(truth.clara!.ceiling, { page: 0.5 });
    Object.assign(truth.leo!.talent, { page: 0.6 });
    return { world, clara: truth.clara!, leo: agentOf(world, 'leo') };
  }

  it('the coach pays each morning, the pupil gains each week', () => {
    const { world, clara, leo } = planned();
    world.day = 13;
    coachTick(world);
    expect(leo.energy).toBe(100 - TALENT.coach.energy);
    expect(clara.talent.page).toBe(0.4);
    world.day = 14;
    coachTick(world);
    expect(leo.energy).toBe(100 - 2 * TALENT.coach.energy);
    expect(clara.talent.page).toBeCloseTo(0.42, 9);
  });

  it('stops at the ceiling plus .05, and a coach who is no better teaches nothing', () => {
    const { world, clara } = planned();
    world.day = 14;
    Object.assign(clara.talent, { page: 0.54 });
    coachTick(world);
    expect(clara.talent.page).toBeCloseTo(0.55, 9);
    coachTick(world);
    expect(clara.talent.page).toBeCloseTo(0.55, 9);
    Object.assign(world.talentTruth!.agents.leo!.talent, { page: 0.3 });
    Object.assign(clara.talent, { page: 0.4 });
    coachTick(world);
    expect(clara.talent.page).toBe(0.4);
  });

  it('does nothing in flat, nor on a closed plan', () => {
    const flat = planned({ talent: 'flat' });
    flat.world.day = 14;
    coachTick(flat.world);
    expect(flat.leo.energy).toBe(100);
    const closed = planned();
    closed.world.day = 14;
    closed.world.company.league!.plans[0]!.outcome = 'met';
    coachTick(closed.world);
    expect(closed.clara.talent.page).toBe(0.4);
  });
});

describe('the proof reads its own numbers', () => {
  it('one sample per evening, in flat too', async () => {
    const { world, company } = await lab();
    await company.runDays(3);
    const samples = world.talentTruth!.samples;
    expect(samples.map((s) => s.day)).toEqual([1, 2, 3]);
    for (const s of samples) {
      expect(s.meanLeague).toBeGreaterThan(0);
      expect(s.workWeighted).toBeGreaterThan(0);
    }
  }, 60_000);

  it('work weighs by who did it', () => {
    const world = createWorld(scenario(), 't');
    world.talentTruth = seedTruth(world);
    const task = (assignee: string, kind: TaskKind) => ({ assignee, kind, status: 'done', dayDone: world.day }) as WorldState['company']['tasks'][number];
    world.company.tasks = [task('leo', 'write_ad_hooks'), task('leo', 'write_ad_hooks'), task('clara', 'write_sales_page'), task('nora', 'retro')];
    sampleTalent(world);
    const t = world.talentTruth.agents;
    const [s] = world.talentTruth.samples;
    expect(s!.workWeighted).toBeCloseTo((2 * t.leo!.talent.copy! + t.clara!.talent.page!) / 3, 9);
    const seats = leagueSeats(world);
    expect(s!.meanLeague).toBeCloseTo(seats.reduce((sum, a) => sum + t[a.id]!.talent[primaryOf(a.roleId)!]!, 0) / seats.length, 9);
  });
});

describe('a reload', () => {
  const decisions = (w: unknown) => JSON.stringify(w, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  it('ends like an uninterrupted run with talent on', async () => {
    const play = async (reloadEvery: number) => {
      const l = await lab({ talent: 'league' });
      let { world, company } = l;
      for (let i = 1; i <= 6 * 12; i++) {
        await company.step();
        if (reloadEvery && i % reloadEvery === 0) {
          world = JSON.parse(JSON.stringify(world)) as WorldState;
          company = l.reopen(world);
        }
      }
      return decisions(world);
    };
    expect(await play(5) === await play(0)).toBe(true);
  }, 180_000);
});

describe('21. talent reaches Claude as a tier and an effort', () => {
  function fake() {
    const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: ClaudeClientLike = {
      messages: {
        create: async (body) => {
          bodies.push(body);
          return { content: [{ type: 'text', text: JSON.stringify({ titles: ['Un titre', 'Un autre', 'Un dernier'] }), citations: null }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } as unknown as Anthropic.Message;
        },
      },
    };
    return { bodies, engine: createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, log: () => {} }) };
  }

  const NICHE = { nicheId: 'sommeil-bebe', name: 'Sommeil', audience: 'Parents', problem: 'Bébé se réveille', category: 'parentalité', keywords: ['sommeil'] };

  it('t = .2 on a sonnet seat calls haiku with low effort', async () => {
    const { bodies, engine } = fake();
    const mind = mindOf();
    expect(mind.agent.tier).toBe('sonnet');
    await engine.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, { ...mind, craft: craftOf('longform', 0.2, mind.agent.tier) });
    expect(bodies[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
  });

  it('the middle keeps the seat and the call, the top asks for high, opus falls to sonnet', async () => {
    const { bodies, engine } = fake();
    const mind = mindOf();
    await engine.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, { ...mind, craft: craftOf('longform', 0.5, 'sonnet') });
    await engine.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, { ...mind, craft: craftOf('longform', 0.7, 'sonnet') });
    await engine.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, { ...mind, agent: { ...mind.agent, tier: 'opus' }, craft: craftOf('longform', 0.2, 'opus') });
    await engine.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, mind);
    expect(bodies[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: bodies[3]!.output_config!.effort } });
    expect(bodies[1]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'high' } });
    expect(bodies[2]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
    expect(bodies[3]).toMatchObject({ model: 'claude-sonnet-5-5' });
  });
});

describe('reading a campaign', () => {
  const row = (creativeId: string, day: number, impressions: number, ctr: number): DailyAdStats =>
    ({ day, creativeId, campaignId: 'c', productId: 'p', impressions, clicks: Math.round(impressions * ctr), spend: 10, ctr, cpc: 1, cpm: 5, landingViews: 0, purchases: 0, revenue: 0, roas: 0, frequency: 1, comments: [] });

  it('a strong buyer drops the loser a weak one cannot read, and the best stays', () => {
    const rows = [row('a', 5, 1500, 0.03), row('b', 5, 1500, 0.01)];
    expect(pruneRead(rows, ['a', 'b'], 0.8)).toEqual(['b']);
    expect(pruneRead(rows, ['a', 'b'], 0.2)).toEqual([]);
  });

  it('reads the last 4 days only, and never a close call', () => {
    expect(pruneRead([row('a', 1, 5000, 0.03), row('b', 1, 5000, 0.01), row('a', 9, 500, 0.03)], ['a', 'b'], 0.8)).toEqual([]);
    expect(pruneRead([row('a', 5, 3000, 0.03), row('b', 5, 3000, 0.028)], ['a', 'b'], 0.8)).toEqual([]);
    expect(pruneRead([row('a', 5, 4000, 0.03)], ['a', 'b'], 0.8)).toEqual([]);
  });

  it('shrinks a lucky day, more for a strong buyer; t = 0 is the raw number', () => {
    expect(shrunkRoas(30, 10, 0)).toBe(3);
    expect(shrunkRoas(0, 0, 0)).toBe(0);
    expect(shrunkRoas(30, 10, 0.8)).toBeCloseTo((30 + 20 * 1.3) / 30, 9);
    expect(shrunkRoas(30, 10, 0.8)).toBeLessThan(shrunkRoas(30, 10, 0.2));
  });
});
