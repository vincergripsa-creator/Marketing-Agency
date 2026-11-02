/**
 * Leaving (org §10, §11): who can go, what they leave behind, who is laid off, what the brain keeps. Tests 2, 14, 15, 21,
 * 22 of org §12, on the lean company.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentId, AgentState, KindLoadDay, Lesson, ScenarioConfig, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createRng } from '../src/core/index.js';
import { computeDailyKpi, createBrainVault } from '../src/learning/index.js';
import { agentsForLesson, addRule, deptRulesSection, TOPIC_DEPTS } from '../src/learning/playbooks.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { addHold, pinHold } from '../src/runtime/holds.js';
import { sim } from '../src/runtime/modules.js';
import { CANDIDATES, ROLES } from '../src/runtime/org/catalog.js';
import { ORG } from '../src/runtime/org/constants.js';
import { canLeave, completeDeparture, decidedLayoff, layoffRefused, layoffsEvening, requestDeparture } from '../src/runtime/org/departure.js';
import { drawCandidates, hireAgent } from '../src/runtime/org/hiring.js';
import { writeWeekNote } from '../src/runtime/org/notes.js';
import { officerId } from '../src/runtime/org/officers.js';
import { payOf, payrollToday } from '../src/runtime/org/payroll.js';
import { auditOrg, reconcileOrg } from '../src/runtime/org/reconcile.js';
import { ALL_KINDS, createTask, depState, isOpen } from '../src/runtime/tasks.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { primaryOf } from '../src/runtime/talent/skills.js';
import { leagueEntry } from '../src/runtime/talent/truth.js';
import { dec } from '../src/runtime/util.js';
import { LEGACY } from './legacy.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots: string[] = [];

function leanWorld(seed = 7, over: Partial<ScenarioConfig> = {}): WorldState {
  return createWorld(defaultScenario({ seed, mindMode: 'heuristic', maxComputeEur: 0, ...over }), `test-leaving-${seed}`);
}

function mount(world: WorldState): { company: Company; ctx: RuntimeCtx; reload(w: WorldState): Company } {
  const root = mkdtempSync(join(tmpdir(), 'pixel-leaving-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain: createBrainVault(paths) };
  const company = new Company(world, opts);
  return { company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reload: (w) => new Company(w, opts) };
}

/** A company that already hired: same state as hireAgent leaves, without the gates. */
function hired(world: WorldState, id: AgentId, hiredDay = 0): AgentState {
  const { legacyDept: _, ...def } = CANDIDATES[id]!;
  const role = ROLES[def.roleId];
  const agent: AgentState = {
    ...def, dept: role.dept, taskKinds: [...role.core, ...role.assist], avatar: { ...def.avatar }, status: 'idle', place: role.dept, currentTaskId: null, energy: 100, level: 1, xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, bubble: null, hatKinds: [], hatDepts: [], hiredDay, rampUntilDay: 0, notice: null,
  };
  world.company.agents.push(agent);
  world.company.playbooks[id] = [];
  reconcileOrg(world);
  return agent;
}

const agent = (w: WorldState, id: AgentId): AgentState | undefined => w.company.agents.find((a) => a.id === id);
const org = (w: WorldState) => w.company.org!;
const leaveLines = (w: WorldState, id: AgentId) => w.ledger.filter((e) => e.ref === `leave:${id}`);
const everyKindHeld = (w: WorldState): boolean => ALL_KINDS.every((k) => w.company.agents.some((a) => a.taskKinds.includes(k)));

/** A load row where each named agent worked `busy` ticks. */
function loadDay(day: number, busy: Record<AgentId, number>): KindLoadDay {
  return { day, wait: {}, reviewWait: {}, work: {}, busy, headcount: 0, payroll: 0 };
}

/** Empties the till but for `cash`: a company that can pay for nothing. */
function setCash(w: WorldState, cash: number): void {
  sim.recordLedger(w, { type: 'tool_subscription', amount: -(sim.financeSnapshot(w).cash - cash), memo: 'test', ref: null });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('who can leave', () => {
  it('the CEO is refused, and stays exactly as she was (org 15, D13)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    expect(canLeave(w, 'camille')).toEqual({ ok: false, blockers: ROLES.ceo.core });
    expect(await requestDeparture(ctx, 'camille', 'test', 'nora', 'fired')).toBe('refused');
    expect(agent(w, 'camille')!.notice).toBeNull();
    expect(org(w).alumni).toEqual([]);
    expect(org(w).positions).toEqual([]);
  });

  it('a founder with no replacement goes on notice, stays and is paid; the hire ends it; every kind stays held (org 14, D17)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    expect(canLeave(w, 'zoe')).toEqual({ ok: false, blockers: ROLES.art_director.core });
    const pay = payrollToday(w);

    expect(await requestDeparture(ctx, 'zoe', 'rendement', 'nora', 'fired')).toBe('notice');
    expect(agent(w, 'zoe')!.notice).toMatchObject({ day: w.day, reason: 'rendement', by: 'nora', kind: 'fired' });
    expect(payrollToday(w)).toBe(pay);
    expect(everyKindHeld(w)).toBe(true);
    expect(leaveLines(w, 'zoe')).toEqual([]);
    const position = org(w).positions.at(-1)!;
    expect(position).toMatchObject({ roleId: 'art_director', reason: 'replacement', replaces: 'zoe', status: 'open' });

    // Asked again, the art director is already on the way out: no second position.
    expect(await requestDeparture(ctx, 'zoe', 'rendement', 'nora', 'fired')).toBe('notice');
    expect(org(w).positions.filter((p) => p.replaces === 'zoe')).toHaveLength(1);

    const relief = await hireAgent(ctx, position, drawCandidates(ctx, 'art_director', 0, 1)[0]!);
    expect(agent(w, 'zoe')).toBeUndefined();
    expect(agent(w, relief.id)!.roleId).toBe('art_director');
    expect(everyKindHeld(w)).toBe(true);
    expect(org(w).alumni).toHaveLength(1);
    expect(org(w).alumni[0]).toMatchObject({ id: 'zoe', kind: 'fired', reason: 'rendement', founder: true, replacedBy: relief.id, leftDay: w.day });
    expect(leaveLines(w, 'zoe')).toHaveLength(1);
    expect(auditOrg(w)).toEqual([]);
  });

  it('a replacement on a founding role holds it like a founder did, and may be replaced in turn', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await requestDeparture(ctx, 'zoe', 'rendement', 'nora', 'fired');
    const relief = await hireAgent(ctx, org(w).positions.at(-1)!, drawCandidates(ctx, 'art_director', 0, 1)[0]!);
    expect(agent(w, relief.id)!.founder).toBe(false);
    expect(canLeave(w, relief.id).ok).toBe(false);
    expect(await requestDeparture(ctx, relief.id, 'rendement', 'nora', 'fired')).toBe('notice');
  });

  it('anyone else leaves at once: alumni, one line of 7 days of pay, the hat back, playbook and chats kept', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    const tom = hired(w, 'tom', 3);
    const pay = payOf(tom);
    const cash = sim.financeSnapshot(w).cash;
    w.memory!.idleTicks.tom = 4;
    w.memory!.recalled.tom = ['les_1'];
    w.company.chats.tom = [{ id: 'msg_1', day: 1, from: 'founder', text: 'salut', at: 0 }];
    expect(agent(w, 'leo')!.hatKinds).not.toContain('post_organic');

    expect(await requestDeparture(ctx, 'tom', 'test', 'nora', 'founder_order')).toBe('left');

    expect(agent(w, 'tom')).toBeUndefined();
    expect(org(w).alumni[0]).toMatchObject({ id: 'tom', name: 'Tom', roleId: 'community_manager', dept: 'crm', hiredDay: 3, leftDay: 1, reason: 'test', kind: 'founder_order', replacedBy: null, founder: false });
    expect(leaveLines(w, 'tom')).toMatchObject([{ type: 'recruiting', amount: -7 * pay }]);
    expect(sim.financeSnapshot(w).cash).toBeCloseTo(cash - ORG.severanceDays * pay, 2);
    expect(agent(w, 'leo')!.hatKinds).toContain('post_organic');
    expect(w.memory!.idleTicks.tom).toBeUndefined();
    expect(w.memory!.recalled.tom).toBeUndefined();
    expect(w.company.playbooks.tom).toBeDefined();
    expect(w.company.chats.tom).toHaveLength(1);
    expect(org(w).stats).toMatchObject({ departures: 1, layoffs: 0 });
    expect(org(w).decisions.at(-1)).toMatchObject({ kind: 'leave', agentId: 'tom', roleId: 'community_manager', day: 1 });
    expect(org(w).decisions.at(-1)!.numbers).toMatchObject({ severance: 7 * pay, headcount: 8 });
    expect(w.activity.at(-1)!.kind).toBe('org');
    expect(auditOrg(w)).toEqual([]);
  });

  it('a departure pays out once, however often it is asked for (D17)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'tom');
    await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired');
    await completeDeparture(ctx, 'tom');
    expect(await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired')).toBe('refused');
    expect(leaveLines(w, 'tom')).toHaveLength(1);
    expect(org(w).alumni).toHaveLength(1);
    expect(org(w).stats.departures).toBe(1);
  });

  it('agents who are free owe no severance', async () => {
    const w = leanWorld(7, { org: { team: 'lean', autoHire: true, payroll: false } });
    const { ctx } = mount(w);
    hired(w, 'tom');
    expect(await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired')).toBe('left');
    expect(leaveLines(w, 'tom')).toEqual([]);
  });

  it('a position that falls through sends the agent back to work: a notice never outlives its replacement', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await requestDeparture(ctx, 'zoe', 'rendement', 'nora', 'fired');
    org(w).positions.at(-1)!.status = 'cancelled';
    await layoffsEvening(ctx);
    expect(agent(w, 'zoe')!.notice).toBeNull();
    expect(canLeave(w, 'zoe').ok).toBe(false);
  });

  it('no position can open: the founder stays, the request is refused, no notice is left behind', async () => {
    const legacy = leanWorld(7, LEGACY); // a legacy team has no recruiting
    const { ctx } = mount(legacy);
    expect(await requestDeparture(ctx, 'zoe', 'x', 'nora', 'fired')).toBe('refused');
    expect(agent(legacy, 'zoe')!.notice).toBeNull();
  });
});

describe('what stays behind', () => {
  it('the rules a machine reads reach whoever carries on, the hat just back included; prose stays (org 16)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'tom');
    addRule(w, 'tom', 'Ne jamais écrire « miracle »');
    addRule(w, 'tom', 'Les parents répondent mieux le soir.');
    const lesson = { id: 'les_1', insight: 'Ne jamais écrire « miracle »', appliesTo: ['tom'], confidence: 0.8 } as unknown as Lesson;
    w.company.lessons.push(lesson);
    expect(w.company.playbooks.leo).not.toContain('Ne jamais écrire « miracle »');

    await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired');

    expect(agent(w, 'leo')!.hatKinds).toContain('post_organic');
    expect(w.company.playbooks.leo).toContain('Ne jamais écrire « miracle »');
    expect(w.company.playbooks.leo).not.toContain('Les parents répondent mieux le soir.');
    expect(lesson.appliesTo).toContain('leo');
    expect(lesson.appliesTo).toContain('tom');
  });

  it('a leaver who is the last of a team closes it, and the department note says who carries it', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await ctx.brain.init();
    hired(w, 'tom');
    await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired');
    const section = deptRulesSection(w, 'crm', 1);
    expect(section).toContain("Ce département n'a pas d'équipe");
    expect(section).toMatch(/s'en occupe/);
    expect((await ctx.brain.read('playbooks/Playbook Communauté.md'))!.body).toContain("Ce département n'a pas d'équipe");
  });

  it('an open department never reads as carried', () => {
    const w = leanWorld();
    expect(deptRulesSection(w, 'growth', 1)).not.toContain("n'a pas d'équipe");
  });

  it('the note of someone who left stays in the vault with the reason, tagged alumni; the department drops them; the chart moves', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await ctx.brain.init();
    const kenji = hired(w, 'kenji'); // a colleague in a team that stays open
    await ctx.brain.write({ path: 'playbooks/Kenji.md', title: 'Kenji', tags: ['playbook', kenji.dept], body: 'ancien corps', day: 1 });
    const before = (await ctx.brain.read('playbooks/Kenji.md'))!;
    expect(before.tags).not.toContain('alumni');

    await requestDeparture(ctx, 'kenji', 'couvertures en retard', 'nora', 'fired');

    const note = (await ctx.brain.read('playbooks/Kenji.md'))!;
    expect(note.body).toContain("> A quitté l'agence le jour 1 : couvertures en retard");
    expect(note.tags).toContain('alumni');
    expect(note.body).toContain('Règles apprises');
    expect((await ctx.brain.read('playbooks/Playbook Création.md'))!.body).not.toContain('[[Kenji]]');
    const chart = (await ctx.brain.read('entreprise/Organigramme.md'))!;
    expect(chart.body).not.toContain('[[Kenji]]');
    expect(chart.body).toContain('[[Zoé]]');
    expect(chart.body).toContain('## Départements fermés');
    expect(chart.body).toContain('**Masse salariale**');
    expect(chart.body).toContain('**Revenu par tête**');
  });

  it('a brain that fails costs the note, not the departure', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'tom');
    ctx.brain.write = async () => { throw new Error('disque plein'); };
    expect(await requestDeparture(ctx, 'tom', 'test', 'nora', 'fired')).toBe('left');
    expect(agent(w, 'tom')).toBeUndefined();
    expect(org(w).alumni).toHaveLength(1);
    expect(w.activity.some((a) => a.text.includes('disque plein'))).toBe(true);
  });

  it('every agent has a note and the chart exists from the first evening, whatever the retro managed (I8)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await ctx.brain.init();
    expect(await ctx.brain.read('playbooks/Zoé.md')).toBeNull();
    await layoffsEvening(ctx);
    for (const a of w.company.agents) expect(await ctx.brain.read(`playbooks/${a.name}.md`), a.name).not.toBeNull();
    expect(await ctx.brain.read('entreprise/Organigramme.md')).not.toBeNull();
  });

  it('a team unchanged writes nothing on a later evening: only day 1 fills the gaps', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await ctx.brain.init();
    w.day = 2;
    await layoffsEvening(ctx);
    expect(await ctx.brain.read('entreprise/Organigramme.md')).toBeNull();
  });

  it('every seventh evening the week is on record: role, who, wait, utilisation, payroll, decisions', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    await ctx.brain.init();
    w.day = 14;
    org(w).load.push({ ...loadDay(10, { nora: 9 }), wait: { retro: 14, reply_inbox: 7 } });
    org(w).decisions.push({ id: 'org_1', day: 9, kind: 'refused', roleId: 'support_agent', agentId: null, text: 'Refus du jour 9', numbers: {} });
    org(w).decisions.push({ id: 'org_2', day: 3, kind: 'refused', roleId: 'support_agent', agentId: null, text: 'Refus trop vieux', numbers: {} });
    await layoffsEvening(ctx);
    const note = (await ctx.brain.read('rh/effectif-semaine-2.md'))!;
    expect(note.body).toContain('| DRH & coach | [[Nora]] | 14,0 | 100 % |');
    expect(note.body).toContain('| Agent support | casquette : [[Clara]] | 7,0 |');
    org(w).load.push({ ...loadDay(11, {}), wait: { optimize_ads: 7 } });
    await writeWeekNote(ctx);
    const week = (await ctx.brain.read('rh/effectif-semaine-2.md'))!.body;
    expect(week).toContain('| Media buyer TikTok |');
    expect(week).not.toContain('| Media buyer Pinterest |'); // that channel is not open: nobody to hire
    expect(note.body).toContain(`${dec(payrollToday(w))} € de salaires par jour`);
    expect(note.body).toContain('Jour 9 : Refus du jour 9');
    expect(note.body).not.toContain('Refus trop vieux');
    expect(await ctx.brain.read('rh/effectif-semaine-1.md')).toBeNull();
  });

  it('the legacy team writes nothing, lays off nobody and stays byte for byte (org 5)', async () => {
    const w = leanWorld(7, LEGACY);
    const { ctx } = mount(w);
    await ctx.brain.init();
    const counter = w.idCounter;
    w.day = 7;
    await layoffsEvening(ctx);
    expect(w.idCounter).toBe(counter);
    expect(await ctx.brain.read('entreprise/Organigramme.md')).toBeNull();
    expect(await ctx.brain.read('rh/effectif-semaine-1.md')).toBeNull();
  });
});

describe('lessons follow the work', () => {
  it('an ad lesson reaches the video and community teams', () => {
    expect(TOPIC_DEPTS.ads).toEqual(['growth', 'video', 'crm']);
    const w = leanWorld();
    hired(w, 'chloe');
    hired(w, 'tom');
    const ids = agentsForLesson(w, 'ads').map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['leo', 'chloe', 'tom']));
  });

  it('wearing a department as a hat counts: the shop lead hears what support learned, until support exists', () => {
    const w = leanWorld();
    expect(agentsForLesson(w, 'support').map((a) => a.id)).toContain('clara');
    hired(w, 'ines');
    expect(agentsForLesson(w, 'support').map((a) => a.id)).toEqual(['ines']);
  });
});

describe('layoffs', () => {
  /** A company with one idle hire and one busy one, nothing in the till, a margin of nothing. */
  function broke(): { w: WorldState; ctx: RuntimeCtx } {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'tom');
    hired(w, 'lucas');
    setCash(w, 5);
    w.day = 10; // past the cooldown a new company starts with
    return { w, ctx };
  }

  /** One evening: the day's load, then the rule. */
  async function evening(w: WorldState, ctx: RuntimeCtx, busy: Record<AgentId, number>): Promise<void> {
    w.day += 1;
    org(w).load.push(loadDay(w.day, busy));
    await layoffsEvening(ctx);
  }

  it('L1: five evenings under water take the least busy hire, never a founder, then the count starts over (org 21)', async () => {
    const { w, ctx } = broke();
    for (let i = 0; i < 4; i++) await evening(w, ctx, { tom: 5, lucas: 1, nora: 0 });
    expect(org(w).lossDays).toBe(4);
    expect(org(w).alumni).toEqual([]);
    await evening(w, ctx, { tom: 5, lucas: 1, nora: 0 });
    expect(agent(w, 'lucas')).toBeUndefined();
    expect(agent(w, 'tom')).toBeDefined();
    expect(org(w).alumni[0]).toMatchObject({ id: 'lucas', kind: 'layoff', founder: false });
    expect(org(w).alumni[0]!.reason).toContain('€');
    expect(org(w).lossDays).toBe(0);
    expect(org(w).lastLayoffDay).toBe(w.day);
    expect(org(w).stats).toMatchObject({ layoffs: 1, departures: 1 });
    expect(org(w).decisions.at(-1)).toMatchObject({ kind: 'layoff', agentId: 'lucas' });
    expect(org(w).decisions.at(-1)!.numbers).toHaveProperty('cash');
    const said = w.activity.filter((a) => a.kind === 'org').map((a) => a.agentId);
    expect(said).toEqual(expect.arrayContaining([officerId(w, 'cfo'), officerId(w, 'hr')]));
  });

  describe('the league selects among the idle (L6)', () => {
    /** Two idle holders of one role, with enough days on the books to read them. */
    function idleTwins(over: Partial<ScenarioConfig> = {}): { w: WorldState; ctx: RuntimeCtx; low: AgentState; high: AgentState } {
      const w = leanWorld(7, over);
      const { ctx } = mount(w);
      const low = hired(w, 'lucas', 1);
      const high = hired(w, 'fatou', 1);
      w.day = 15;
      for (let d = 2; d <= 15; d++) org(w).load.push(loadDay(d, { [low.id]: 1, [high.id]: 0 }));
      return { w, ctx, low, high };
    }
    const rated = (w: WorldState, a: AgentState, rating: number) => {
      const skill = primaryOf(a.roleId)!;
      w.company.league!.entries[a.id] ??= leagueEntry(w, a);
      w.company.league!.entries[a.id]!.ratings[skill] = { skill, rating, rd: 80, n: 20, seasonN: 4, metric: 70, history: [] };
    };

    it('the lowest rating goes first, even a little busier, and the reason names the rating and the occupation', async () => {
      const { w, ctx, low, high } = idleTwins();
      rated(w, low, 1412);
      rated(w, high, 1600);
      await layoffsEvening(ctx);
      expect(agent(w, low.id)).toBeUndefined();
      expect(agent(w, high.id)).toBeDefined();
      expect(org(w).alumni[0]).toMatchObject({ id: low.id, kind: 'layoff' });
      expect(org(w).alumni[0]!.reason).toContain('classement 1 412');
      expect(org(w).alumni[0]!.reason).toContain("d'occupation");
      expect(w.company.league!.entries[low.id]!.leftBecause).toBe(org(w).alumni[0]!.reason);
    });

    it('occupation breaks a tie', async () => {
      const { w, ctx, low, high } = idleTwins();
      rated(w, low, 1500);
      rated(w, high, 1500);
      await layoffsEvening(ctx);
      expect(agent(w, high.id)).toBeUndefined(); // the less busy of the two
      expect(agent(w, low.id)).toBeDefined();
    });

    it('nobody who is not idle enough goes, whatever the rating', async () => {
      const { w, ctx, low, high } = idleTwins();
      rated(w, low, 1200);
      rated(w, high, 1600);
      for (const d of org(w).load) d.busy[low.id] = 9;
      await layoffsEvening(ctx);
      expect(agent(w, low.id)).toBeDefined();
      expect(agent(w, high.id)).toBeUndefined();
    });

    it('cash under water reads the same way among the idle, and today\'s order when nobody is idle', async () => {
      const { w, ctx, low, high } = idleTwins();
      rated(w, low, 1412);
      rated(w, high, 1600);
      setCash(w, 5);
      org(w).lossDays = ORG.layoff.lossDays - 1;
      await layoffsEvening(ctx);
      expect(agent(w, low.id)).toBeUndefined();
      expect(org(w).alumni[0]!.reason).toContain('classement 1 412');

      const busy = idleTwins();
      rated(busy.w, busy.low, 1412);
      rated(busy.w, busy.high, 1600);
      for (const d of org(busy.w).load) Object.assign(d.busy, { [busy.low.id]: 9, [busy.high.id]: 6 });
      setCash(busy.w, 5);
      org(busy.w).lossDays = ORG.layoff.lossDays - 1;
      await layoffsEvening(busy.ctx);
      expect(agent(busy.w, busy.high.id)).toBeUndefined();
    });

    it('the flat control keeps today\'s order and today\'s words', async () => {
      const { w, ctx, low, high } = idleTwins({ talent: 'flat' });
      rated(w, low, 1412);
      rated(w, high, 1600);
      await layoffsEvening(ctx);
      expect(agent(w, high.id)).toBeUndefined();
      expect(agent(w, low.id)).toBeDefined();
      expect(org(w).alumni[0]!.reason).not.toContain('classement');
    });
  });

  it('a layoff of the evening lands after the retro, and the day still closes on the ledger', async () => {
    const w = leanWorld();
    const { company } = mount(w);
    for (let i = 0; i < 3 * 12; i++) await company.step();
    hired(w, 'lucas', w.day);
    setCash(w, 12);
    sim.recordLedger(w, { type: 'ad_spend', amount: -300, memo: 'test', ref: null }); // a margin under water...
    sim.recordLedger(w, { type: 'capital', amount: 300, memo: 'test', ref: null }); // ...with the till as it was
    org(w).lossDays = ORG.layoff.lossDays - 1;
    const day = w.day;
    for (let i = 0; i < 12; i++) await company.step();

    expect(org(w).alumni[0]).toMatchObject({ id: 'lucas', kind: 'layoff', leftDay: day });
    expect(leaveLines(w, 'lucas')).toHaveLength(1);
    const kpi = w.company.kpis.find((k) => k.day === day)!;
    const fresh = computeDailyKpi(w, day);
    expect(kpi.cash).toBeCloseTo(w.ledger.filter((e) => e.day <= day).reduce((s, e) => s + e.amount, 0), 2);
    expect(kpi).toMatchObject({ cash: fresh.cash, profit: fresh.profit, cumulativeProfit: fresh.cumulativeProfit });
    expect(kpi.tasksDone).toBeLessThan(fresh.tasksDone); // the rest of the row is the retro's, which did not count itself
  }, 60_000);

  it('L1: ties go to the highest pay, then the id', async () => {
    const { w, ctx } = broke();
    const raphael = hired(w, 'raphael'); // sonnet, better paid than the two haiku, and behind Lucas by id
    expect(payOf(raphael)).toBeGreaterThan(payOf(agent(w, 'lucas')!));
    org(w).lossDays = ORG.layoff.lossDays - 1;
    await evening(w, ctx, {});
    expect(org(w).alumni[0]!.id).toBe('raphael');
  });

  it('L1 needs both halves: a margin that holds or a full till stops the count', async () => {
    const margin = broke();
    await evening(margin.w, margin.ctx, {});
    expect(org(margin.w).lossDays).toBe(1);
    sim.recordLedger(margin.w, { type: 'revenue', amount: 700, memo: 'test', ref: null });
    setCash(margin.w, 5); // the margin is back, the till is still empty
    await evening(margin.w, margin.ctx, {});
    expect(org(margin.w).lossDays).toBe(0);

    const till = broke();
    await evening(till.w, till.ctx, {});
    expect(org(till.w).lossDays).toBe(1);
    sim.recordLedger(till.w, { type: 'capital', amount: 5000, memo: 'test', ref: null }); // the till is full, the margin is still nothing
    await evening(till.w, till.ctx, {});
    expect(org(till.w).lossDays).toBe(0);
  });

  it('a founder stays out even with someone else on the role: the rule is about founders, not about who is left', async () => {
    const { w, ctx } = broke();
    const twin = hired(w, 'kenji');
    twin.roleId = 'art_director';
    expect(canLeave(w, 'zoe').ok).toBe(true);
    org(w).lossDays = ORG.layoff.lossDays - 1;
    await evening(w, ctx, { kenji: 9, tom: 9, lucas: 9 }); // Zoé is the least busy of all
    expect(agent(w, 'zoe')).toBeDefined();
    expect(org(w).alumni).toHaveLength(1);
  });

  it('founders alone: the count runs, nobody goes', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    setCash(w, 5);
    for (let i = 0; i < 8; i++) await evening(w, ctx, {});
    expect(org(w).lossDays).toBe(8);
    expect(w.company.agents).toHaveLength(8);
  });

  it('L2: an idle duplicate goes, the busy holder and a one-person role stay (org 21)', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'lucas', 1);
    hired(w, 'fatou', 1);
    hired(w, 'tom', 1); // alone on that role, as idle as can be
    w.day = 15;
    for (let d = 2; d <= 15; d++) org(w).load.push(loadDay(d, { lucas: 9, fatou: 1 }));
    await layoffsEvening(ctx);
    expect(org(w).alumni.map((a) => a.id)).toEqual(['fatou']);
    expect(org(w).alumni[0]).toMatchObject({ kind: 'layoff' });
    expect(agent(w, 'tom')).toBeDefined();
    expect(agent(w, 'lucas')).toBeDefined();
  });

  it('L2 waits for fourteen days of proof and fourteen days of presence', async () => {
    const w = leanWorld();
    const { ctx } = mount(w);
    hired(w, 'lucas', 1);
    hired(w, 'fatou', 5);
    w.day = 15;
    for (let d = 2; d <= 15; d++) org(w).load.push(loadDay(d, { lucas: 9 }));
    await layoffsEvening(ctx);
    expect(org(w).alumni).toEqual([]); // hired 10 days ago

    const short = leanWorld();
    const m = mount(short);
    hired(short, 'lucas', 1);
    hired(short, 'fatou', 1);
    short.day = 15;
    for (let d = 3; d <= 15; d++) org(short).load.push(loadDay(d, { lucas: 9 }));
    await layoffsEvening(m.ctx);
    expect(org(short).alumni).toEqual([]); // 13 days of data
  });

  it('at most one layoff per cooldown, whatever the rule', async () => {
    const { w, ctx } = broke();
    hired(w, 'adam');
    org(w).lossDays = ORG.layoff.lossDays - 1;
    await evening(w, ctx, {});
    expect(org(w).alumni).toHaveLength(1);
    org(w).lossDays = ORG.layoff.lossDays - 1;
    await evening(w, ctx, {});
    await evening(w, ctx, {});
    expect(org(w).alumni).toHaveLength(1);
    await evening(w, ctx, {});
    expect(org(w).alumni).toHaveLength(2);
  });

  it('the founder has the last word: no layoff under a firing hold, a pinned agent stays out', async () => {
    const { w, ctx } = broke();
    org(w).lossDays = ORG.layoff.lossDays - 1;
    const hold = addHold(w, { kind: 'firing', productId: null, until: null, reason: 'ne vire personne' });
    await evening(w, ctx, {});
    expect(org(w).alumni).toEqual([]);
    hold.liftedDay = w.day;
    addHold(w, { kind: 'pin', productId: null, until: null, reason: 'garde Lucas', agentId: 'lucas' });
    org(w).lossDays = ORG.layoff.lossDays - 1;
    await evening(w, ctx, { tom: 9 });
    expect(org(w).alumni.map((a) => a.id)).toEqual(['tom']);
  });

  it('a paired control keeps its team: autoHire false lays off nobody', async () => {
    const w = leanWorld(7, { org: { team: 'lean', autoHire: false, payroll: true } });
    const { ctx } = mount(w);
    hired(w, 'tom');
    setCash(w, 5);
    w.day = 10;
    org(w).lossDays = ORG.layoff.lossDays + 3;
    await evening(w, ctx, {});
    expect(org(w).alumni).toEqual([]);
    expect(agent(w, 'tom')).toBeDefined();
  });

  describe('in approval mode a layoff is a normal ask (A22, D48)', () => {
    const asks = (w: WorldState) => w.company.tasks.filter((t) => t.kind === 'league_review' && decidedLayoff(t));

    /** The evening leaves the world before a morning: the gate is a work tick away. */
    const until = async (company: Company, done: () => boolean): Promise<void> => {
      for (let i = 0; i < 12 && !done(); i++) await company.step();
      expect(done()).toBe(true);
    };

    /** Nobody left, nobody on notice, no line in the ledger, no count moved. */
    function nothingMoved(w: WorldState, id: AgentId): void {
      expect(agent(w, id)).toBeDefined();
      expect(agent(w, id)!.notice).toBeNull();
      expect(org(w).alumni).toEqual([]);
      expect(org(w).positions).toEqual([]);
      expect(leaveLines(w, id)).toEqual([]);
      expect(org(w).stats).toMatchObject({ departures: 0, layoffs: 0 });
      expect(org(w).lastLayoffDay).toBe(0);
    }

    /** L1: the fifth evening under water, Lucas the least busy. */
    async function cashRoad() {
      const w = leanWorld(7, { founderApproval: true });
      const m = mount(w);
      hired(w, 'tom');
      hired(w, 'lucas');
      setCash(w, 5);
      w.day = 10;
      for (let i = 0; i < ORG.layoff.lossDays; i++) await evening(w, m.ctx, { tom: 5, lucas: 1, nora: 0 });
      return { ...m, w };
    }

    /** L2: Fatou idle for two weeks on a role Lucas carries, the till full. */
    async function idleRoad() {
      const w = leanWorld(7, { founderApproval: true });
      const m = mount(w);
      hired(w, 'lucas', 1);
      hired(w, 'fatou', 1);
      w.day = 15;
      for (let d = 2; d <= 15; d++) org(w).load.push(loadDay(d, { lucas: 9, fatou: 1 }));
      await layoffsEvening(m.ctx);
      return { ...m, w };
    }

    it('L1: the fifth evening opens the ask, nothing moves before the yes, and the yes lays off once', async () => {
      const { w, company } = await cashRoad();
      nothingMoved(w, 'lucas');
      expect(org(w).lossDays).toBe(0);
      const [task] = asks(w);
      expect(task).toMatchObject({ status: 'pending', reviewer: null, workLeft: 0, assignee: officerId(w, 'hr'), title: 'Licencier Lucas' });

      await until(company, () => task!.status === 'awaiting_founder');
      expect(w.company.pendingApprovals).toContain(task!.id);
      expect(String(task!.input.founderAsk)).toMatch(/^Licencier Lucas \(.*\d € en caisse.*\) : \d.* € d'indemnité$/);
      nothingMoved(w, 'lucas');

      company.approve(task!.id, true);
      await until(company, () => task!.status === 'done');
      expect(agent(w, 'lucas')).toBeUndefined();
      expect(agent(w, 'tom')).toBeDefined();
      expect(org(w).alumni).toHaveLength(1);
      expect(org(w).alumni[0]).toMatchObject({ id: 'lucas', kind: 'layoff', founder: false });
      expect(org(w).alumni[0]!.reason).toMatch(/^licenciement, .*€ en caisse/);
      expect(leaveLines(w, 'lucas')).toHaveLength(1);
      expect(org(w).stats).toMatchObject({ layoffs: 1, departures: 1 });
      expect(org(w).lastLayoffDay).toBe(w.day);
      expect(w.company.pendingApprovals).not.toContain(task!.id);
    }, 60_000);

    it('L2: the idle duplicate waits for the founder the same way', async () => {
      const { w, company } = await idleRoad();
      nothingMoved(w, 'fatou');
      const [task] = asks(w);
      expect(task!.title).toBe('Licencier Fatou');

      await until(company, () => task!.status === 'awaiting_founder');
      expect(String(task!.input.founderAsk)).toMatch(/^Licencier Fatou \(.*d'occupation sur 14 jours sur un rôle tenu à plusieurs\) : \d.* € d'indemnité$/);
      nothingMoved(w, 'fatou');

      company.approve(task!.id, true);
      await until(company, () => task!.status === 'done');
      expect(agent(w, 'fatou')).toBeUndefined();
      expect(agent(w, 'lucas')).toBeDefined();
      expect(org(w).alumni[0]).toMatchObject({ id: 'fatou', kind: 'layoff' });
      expect(org(w).alumni[0]!.reason).toContain('sur un rôle tenu à plusieurs');
      expect(leaveLines(w, 'fatou')).toHaveLength(1);
    }, 60_000);

    it('one ask at a time: the evenings after it do not ask twice, on either road', async () => {
      const cash = await cashRoad();
      for (let i = 0; i < ORG.layoff.lossDays + 1; i++) await evening(cash.w, cash.ctx, { tom: 5, lucas: 1, nora: 0 });
      expect(asks(cash.w)).toHaveLength(1);
      nothingMoved(cash.w, 'lucas');

      const idle = await idleRoad();
      for (let i = 0; i < ORG.layoff.cooldownDays + 1; i++) await evening(idle.w, idle.ctx, { lucas: 9, fatou: 1 });
      expect(asks(idle.w)).toHaveLength(1);
      nothingMoved(idle.w, 'fatou');
    }, 60_000);

    it('L1: a no pins the person, books nothing and starts the count over, and the road passes to the next one', async () => {
      const { w, company, ctx } = await cashRoad();
      const [task] = asks(w);
      await until(company, () => task!.status === 'awaiting_founder');
      org(w).lossDays = 3;
      company.approve(task!.id, false);

      expect(task!.status).toBe('cancelled');
      expect(org(w).lossDays).toBe(0);
      expect(pinHold(w, 'lucas')).toMatchObject({ kind: 'pin', agentId: 'lucas', until: w.day + TALENT.challenge.refusalPinDays });
      expect(pinHold(w, 'lucas')!.reason).toContain('licencier Lucas');
      nothingMoved(w, 'lucas');

      for (let i = 0; i < ORG.layoff.lossDays; i++) await evening(w, ctx, { tom: 5, lucas: 1, nora: 0 });
      expect(asks(w).map((t) => decidedLayoff(t)!.agentId)).toEqual(['lucas', 'tom']);
      nothingMoved(w, 'lucas');
    }, 60_000);

    it('L2: a no holds until the pin ends, and only then may the founder be asked again', async () => {
      const { w, company, ctx } = await idleRoad();
      const [task] = asks(w);
      await until(company, () => task!.status === 'awaiting_founder');
      company.approve(task!.id, false);
      const pin = pinHold(w, 'fatou')!;
      while (w.day < pin.until!) {
        await evening(w, ctx, { lucas: 9, fatou: 1 });
        expect(asks(w), `jour ${w.day}`).toHaveLength(1);
      }
      await evening(w, ctx, { lucas: 9, fatou: 1 });
      expect(asks(w)).toHaveLength(2);
      nothingMoved(w, 'fatou');
    }, 60_000);

    it('a yes comes too late when the person left meanwhile: nobody is paid out twice', async () => {
      const { w, company, ctx } = await cashRoad();
      const [task] = asks(w);
      await until(company, () => task!.status === 'awaiting_founder');
      await requestDeparture(ctx, 'lucas', 'test', 'founder', 'founder_order');
      company.approve(task!.id, true);
      await until(company, () => task!.status === 'done');
      expect(task!.log.join(' ')).toContain('sans objet');
      expect(task!.output?.left).toBeNull();
      expect(leaveLines(w, 'lucas')).toHaveLength(1);
      expect(org(w).stats).toMatchObject({ departures: 1, layoffs: 0 });
    }, 60_000);

    it('a yes moves nobody once the founder stopped the firing, or protected that person', async () => {
      const firing = await cashRoad();
      const [held] = asks(firing.w);
      await until(firing.company, () => held!.status === 'awaiting_founder');
      addHold(firing.w, { kind: 'firing', productId: null, until: null, reason: 'ne vire personne' });
      firing.company.approve(held!.id, true);
      await until(firing.company, () => held!.status === 'done');
      expect(held!.output?.left).toBeNull();
      nothingMoved(firing.w, 'lucas');

      const pinned = await idleRoad();
      const [kept] = asks(pinned.w);
      await until(pinned.company, () => kept!.status === 'awaiting_founder');
      addHold(pinned.w, { kind: 'pin', productId: null, until: null, reason: 'garde Fatou', agentId: 'fatou' });
      pinned.company.approve(kept!.id, true);
      await until(pinned.company, () => kept!.status === 'done');
      nothingMoved(pinned.w, 'fatou');
    }, 60_000);

    it('layoffRefused ignores a ritual, which carries nothing', () => {
      const w = leanWorld(7, { founderApproval: true });
      const { ctx } = mount(w);
      const ritual = createTask(w, { kind: 'league_review', title: 'Clôture' });
      expect(decidedLayoff(ritual)).toBeNull();
      expect(() => layoffRefused(ctx, ritual)).not.toThrow();
      expect(w.company.holds ?? []).toEqual([]);
    });

    it('the ask outlives a reload, and the yes lands on the world that came back', async () => {
      const { w, company, reload } = await cashRoad();
      const id = asks(w)[0]!.id;
      await until(company, () => asks(w)[0]!.status === 'awaiting_founder');
      const back = JSON.parse(JSON.stringify(w)) as WorldState;
      const next = reload(back);
      nothingMoved(back, 'lucas');
      next.approve(id, true);
      await until(next, () => asks(back)[0]!.status === 'done');
      expect(agent(back, 'lucas')).toBeUndefined();
      expect(leaveLines(back, 'lucas')).toHaveLength(1);
    }, 60_000);
  });
});

describe('the policy note', () => {
  const note = readFileSync(join(repo, 'brain', 'politiques', 'Recrutement.md'), 'utf8');
  const fr = (n: number, digits = 2): string => n.toFixed(digits).replace('.', ',');
  const percent = (x: number): string => `${Math.round(x * 100)} %`;

  it('Recrutement.md quotes the numbers of ORG, each where it is the rule (org 22)', () => {
    const L = ORG.layoff;
    const quoted = [
      `Effectif maximum : **${ORG.maxHeadcount} agents**`,
      `haiku ${fr(ORG.payPerDay.haiku)} €`, `sonnet ${fr(ORG.payPerDay.sonnet)} €`, `opus ${fr(ORG.payPerDay.opus)} €`,
      `+${Math.round(ORG.levelRaise * 100)} % par niveau`,
      `**Recrutement** : ${ORG.recruitingDays} jours de salaire`,
      `**Départ** : ${ORG.severanceDays} jours de salaire`,
      `prennent ${percent(ORG.survivalPayCut)} de leur salaire`,
      `garde toujours ${ORG.adReserveDays} jours de salaires`,
      `${ORG.workTicksPerDay} ticks de travail`,
      `${fr(ORG.hatSpeed)} de la vitesse normale`,
      `${fr(ORG.rampSpeed, 1)} de la vitesse normale pendant ${ORG.rampDays} jours`,
      `sur les ${ORG.windowDays} derniers jours`,
      `**${ORG.reliefPerDay} ticks par jour**`,
      `**${percent(ORG.ownerUtil)}**`,
      `**${ORG.pressureDays} soirs de suite**`,
      `au moins ${ORG.hireCooldownDays} jours depuis la dernière embauche`,
      `couvre ${ORG.reserveDays} jours de frais`,
      `couvre ${Math.round(ORG.marginCover * 100)} % des frais`,
      `en couvre ${ORG.cashRouteDays} jours`,
      `au moins ${ORG.revPerHeadPayMultiple} fois un salaire mensuel`,
      `moins de ${L.cashDays} jours de frais`,
      `${L.lossDays} soirs de suite`,
      `par période de ${L.cooldownDays} jours`,
      `sous ${percent(L.idleUtil)} d'occupation pendant ${L.idleDays} jours`,
      `embauchée depuis ${L.idleDays} jours`,
    ];
    expect(quoted.filter((q) => !note.includes(q))).toEqual([]);
  });

  it('the home of the brain links the new notes, and the note links back to what it rests on', () => {
    const home = readFileSync(join(repo, 'brain', '00 - Accueil.md'), 'utf8');
    for (const name of ['Recrutement', 'Organigramme', 'Playbook Vidéo', 'Playbook Communauté']) expect(home).toContain(`[[${name}]]`);
    expect(note).toContain('[[Budget et garde-fous]]');
  });
});

describe('determinism', () => {
  const decisions = (world: WorldState): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  /** Departures landing mid-work: the company with no Tom and no Lucas, whatever tick a reload fell on. */
  async function play(ticks: number, reloadEvery: number): Promise<string> {
    let world = leanWorld(7, { horizonDays: 90 });
    const m = mount(world);
    let { company, ctx } = m;
    hired(world, 'tom');
    hired(world, 'lucas');
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (i === 30) await requestDeparture(ctx, 'tom', 'test', officerId(world, 'hr'), 'fired');
      if (i === 53) await requestDeparture(ctx, 'lucas', 'test', officerId(world, 'hr'), 'layoff');
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = m.reload(world);
        ctx = (company as unknown as { ctx: RuntimeCtx }).ctx;
      }
    }
    return decisions(world);
  }

  it('a run with departures reloaded at every tick of the day ends like a straight one (D55)', async () => {
    const ticks = 7 * 12;
    const straight = await play(ticks, 0);
    expect(await play(ticks, 7) === straight).toBe(true);
  }, 120_000);
});

describe('chaos (org 2)', () => {
  const holdsWork = (w: WorldState, a: AgentState): boolean => w.company.tasks.some((t) => isOpen(t) && t.assignee === a.id);

  /** Who to pull out: anyone but the CEO, in an order only the seed decides. Someone holding work first: that is where a departure hurts. */
  function nextVictim(w: WorldState, order: AgentId[]): AgentState | undefined {
    const free = order.flatMap((id) => agent(w, id) ?? []).filter((a) => a.roleId !== 'ceo' && !a.notice);
    return free.find((a) => holdsWork(w, a)) ?? free[0];
  }

  async function chaos(seed: number): Promise<{ left: number; dropped: number; world: WorldState }> {
    const w = leanWorld(seed, { horizonDays: 45 });
    const { company, ctx } = mount(w);
    const extra: AgentId[] = ['tom', 'lucas', 'ines', 'adam', 'raphael', 'theo', 'kenji', 'rayan'];
    for (const id of extra) hired(w, id);
    const rng = createRng(seed);
    const waiting = new Map<string, number>();
    let left = 0;
    let dropped = 0;
    while (w.day <= 40) {
      if (w.tick === 3 && w.day % 3 === 0) {
        const victim = nextVictim(w, rng.shuffle(w.company.agents.map((a) => a.id).sort()));
        if (victim && holdsWork(w, victim)) dropped++;
        if (victim && (await requestDeparture(ctx, victim.id, `chaos du jour ${w.day}`, officerId(w, 'hr'), 'fired')) !== 'refused') left++;
      }
      const evening = w.tick === 11;
      const day = w.day;
      await company.step();
      if (!evening) continue;
      expect(auditOrg(w), `jour ${day}`).toEqual([]);
      expect(everyKindHeld(w), `jour ${day}`).toBe(true);
      const open = w.company.tasks.filter((t) => isOpen(t) && t.status === 'pending' && !t.assignee && depState(w, t) === 'ready');
      for (const id of waiting.keys()) if (!open.some((t) => t.id === id)) waiting.delete(id);
      for (const t of open) {
        const since = waiting.get(t.id) ?? day;
        waiting.set(t.id, since);
        expect(day - since, `${t.kind} sans titulaire depuis le jour ${since}`).toBeLessThanOrEqual(2);
      }
    }
    return { left, dropped, world: w };
  }

  it.each([7, 42, 3])('a departure every 3 days for 40 days, seed %i: audit empty, no task unassigned over 2 days', async (seed) => {
    const { left, dropped, world } = await chaos(seed);
    expect(left).toBe(13);
    expect(dropped).toBeGreaterThanOrEqual(5);
    expect(org(world).stats.violations).toBe(0);
    expect(org(world).alumni.length).toBeGreaterThanOrEqual(left - 1); // a notice given late may still run
    expect(world.ledger.filter((e) => e.ref?.startsWith('leave:'))).toHaveLength(org(world).alumni.length); // paid out once each
  }, 180_000);
});
