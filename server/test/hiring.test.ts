/**
 * Load, decision, hire (org §9): what the day leaves in `org.load`, who the pressure names, the gates that say no with
 * their numbers, the recruit behind a position, and a hire that reaches the books, the playbook and the chart. Numbers
 * come from a world built by hand: the decision is arithmetic, so a table can test it exactly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentState, KindLoadDay, Lesson, Position, RoleId, ScenarioConfig, Task, TaskKind, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { addHold, hiringHold } from '../src/runtime/holds.js';
import { HANDLERS } from '../src/runtime/handlers/index.js';
import { sim } from '../src/runtime/modules.js';
import { CANDIDATES, ROLES } from '../src/runtime/org/catalog.js';
import { ORG } from '../src/runtime/org/constants.js';
import { requestDeparture } from '../src/runtime/org/departure.js';
import { checkGates, drawCandidates, headcountEvening, hireAgent, moneyRead, openPosition, recruitRefused, requestRole } from '../src/runtime/org/hiring.js';
import { pickRole, recordLoad, refreshPressure } from '../src/runtime/org/load.js';
import { NAME_POOL, pickName, skillsOf, takenNames, toolsOf } from '../src/runtime/org/names.js';
import { roleHolders } from '../src/runtime/org/officers.js';
import { auditOrg } from '../src/runtime/org/reconcile.js';
import { SEED_PLAYBOOKS } from '../src/runtime/roster.js';
import { createTask } from '../src/runtime/tasks.js';
import { createRng } from '../src/core/index.js';
import { slugify } from '../src/runtime/util.js';
import { LEGACY } from './legacy.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

interface Lab { world: WorldState; company: Company; ctx: RuntimeCtx; reopen(w: WorldState): Company }

async function lab(over: Partial<ScenarioConfig> = {}): Promise<Lab> {
  const world = createWorld(defaultScenario({ talent: 'off', seed: 7, mindMode: 'heuristic', maxComputeEur: 0, horizonDays: 90, ...over }), 'test-hiring');
  const root = mkdtempSync(join(tmpdir(), 'pixel-hiring-'));
  roots.push(root);
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const brain = createBrainVault(paths);
  await brain.init();
  const opts = { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: world.scenario.seed }), brain };
  const company = new Company(world, opts);
  return { world, company, ctx: (company as unknown as { ctx: RuntimeCtx }).ctx, reopen: (w) => new Company(w, opts) };
}

const org = (w: WorldState) => w.company.org!;
const agent = (w: WorldState, id: string): AgentState => w.company.agents.find((a) => a.id === id)!;
const decisions = (w: WorldState, kind: string) => org(w).decisions.filter((d) => d.kind === kind);
/** Where the two generators the company holds stand. `streamRng` builds a new one from its keys, so only these can move. */
const liveStreams = (ctx: RuntimeCtx): [number, number] => [ctx.rng.state(), ctx.channelRng.state()];

/** `days` closed days of a business, and the day it stops at: revenue and ads a day, as the ledger holds them. */
function book(w: WorldState, days: number, perDay: { revenue?: number; ads?: number }): void {
  for (let d = 1; d <= days; d++) {
    w.day = d;
    if (perDay.revenue) sim.recordLedger(w, { type: 'revenue', amount: perDay.revenue, memo: 'Ventes', ref: null });
    if (perDay.ads) sim.recordLedger(w, { type: 'ad_spend', amount: -perDay.ads, memo: 'Pub', ref: null });
    sim.recordLedger(w, { type: 'platform_fee', amount: 0, memo: 'Clôture', ref: `fixed:${d}` });
  }
}

/** Seven evenings of work waiting on `kind`, its wearer `owner` busy `busy` ticks a day. */
function pressureOn(w: WorldState, kind: TaskKind, owner: string, wait: number, busy: number): void {
  const load: KindLoadDay[] = [];
  for (let i = 0; i < 7; i++) {
    load.push({ day: w.day - 6 + i, wait: { [kind]: wait }, reviewWait: {}, work: {}, busy: { [owner]: busy }, headcount: w.company.agents.length, payroll: 0 });
  }
  org(w).load = load;
}

const RELIEF = ORG.reliefPerDay;
const BUSY = Math.ceil(ORG.workTicksPerDay * ORG.ownerUtil);

/**
 * All the lights green on the evening of day 20, the third under pressure: a community manager relieves Léo, a good
 * margin, cash well above the reserve, revenue per head above the floor. Each row of the gate table breaks one thing.
 */
async function green(over: Partial<ScenarioConfig> = {}, money: { revenue?: number; ads?: number } = { revenue: 100, ads: 20 }): Promise<Lab> {
  const l = await lab(over);
  const w = l.world;
  book(w, 20, money);
  w.tick = 11;
  w.phase = 'evening';
  pressureOn(w, 'post_organic', 'leo', RELIEF + 1, BUSY);
  org(w).pressure = [{ roleId: 'community_manager', relief: RELIEF + 1, ownerUtil: 0.8, days: ORG.pressureDays - 1 }];
  return l;
}

/** The rest of day 20, the next morning and its work: long enough for the recruit task of an open position. */
async function untilTheClose(l: Lab): Promise<void> {
  while (!(l.world.day === 21 && l.world.tick === 10)) await l.company.step();
}

describe('what a day leaves in the load', () => {
  it('counts ticks worked, ready tasks waiting and finished ones waiting for their reviewer, each by kind', async () => {
    const { world: w, ctx } = await lab();
    const ready = createTask(w, { kind: 'post_organic', assignee: 'leo' });
    const held = createTask(w, { kind: 'post_organic', dependsOn: [ready.id] });
    expect(held.status).toBe('pending');
    const inReview = createTask(w, { kind: 'produce_ad' });
    inReview.status = 'review';
    const running = createTask(w, { kind: 'scan_trends' });
    running.status = 'in_progress';
    const atFounder = createTask(w, { kind: 'publish_product' });
    atFounder.status = 'awaiting_founder';
    recordLoad(ctx, [{ agentId: 'nadia', taskId: running.id, kind: 'scan_trends' }]);
    const [row] = org(w).load;
    expect(row).toMatchObject({ day: w.day, wait: { post_organic: 1 }, reviewWait: { produce_ad: 1 }, work: { scan_trends: 1 }, busy: { nadia: 1 }, headcount: 8 });
    expect(row!.wait.scan_trends).toBeUndefined(); // in progress is not waiting
    expect(row!.wait.publish_product).toBeUndefined(); // his latency is not a reason to hire
    expect(row!.reviewWait.publish_product).toBeUndefined();
  });

  it('a reviewer reading three tasks in a tick is one busy tick, and reading is no work on the kind', async () => {
    const { world: w, ctx } = await lab();
    recordLoad(ctx, [1, 2, 3].map((i) => ({ agentId: 'elise', taskId: `t${i}`, kind: 'fact_check' as TaskKind, review: true })));
    expect(org(w).load[0]!.busy).toEqual({ elise: 1 });
    expect(org(w).load[0]!.work).toEqual({});
  });

  it('sums the ticks of a day in one row and keeps 14 days', async () => {
    const { world: w, ctx } = await lab();
    for (let d = 1; d <= 20; d++) {
      w.day = d;
      recordLoad(ctx, [{ agentId: 'leo', taskId: 't', kind: 'optimize_ads' }]);
      recordLoad(ctx, [{ agentId: 'leo', taskId: 't', kind: 'optimize_ads' }]);
    }
    expect(org(w).load.map((r) => r.day)).toEqual(Array.from({ length: 14 }, (_, i) => 7 + i));
    expect(org(w).load.at(-1)).toMatchObject({ busy: { leo: 2 }, work: { optimize_ads: 2 } });
  });

  it('stays out of a legacy run', async () => {
    const { world: w, ctx } = await lab({ ...LEGACY });
    createTask(w, { kind: 'post_organic' });
    recordLoad(ctx, [{ agentId: 'leo', taskId: 't', kind: 'optimize_ads' }]);
    await headcountEvening(ctx);
    expect(org(w).load).toEqual([]);
    expect(w.company.tasks.filter((t) => t.kind === 'headcount_review')).toEqual([]);
  });
});

describe('the pressure of a role', () => {
  it('reads relief over the window, adds the reviews its office would take, and the utilisation of the owners', async () => {
    const { world: w } = await lab();
    pressureOn(w, 'write_pdf', 'elise', 10, 7);
    for (const r of org(w).load) r.reviewWait = { write_pdf: 7 }; // write_pdf is read by the fact-checker office
    refreshPressure(w);
    const of = (role: RoleId) => org(w).pressure.find((p) => p.roleId === role);
    expect(of('ghostwriter')).toMatchObject({ relief: 10, ownerUtil: 0.78 });
    expect(of('fact_checker')).toMatchObject({ relief: 7 });
    expect(of('editor_in_chief')).toBeUndefined(); // no free seat
  });

  it('needs both signals, three evenings in a row, and starts over when one drops', async () => {
    const { world: w } = await lab();
    const days = (): number | undefined => org(w).pressure.find((p) => p.roleId === 'community_manager')?.days;
    pressureOn(w, 'post_organic', 'leo', RELIEF, BUSY);
    refreshPressure(w);
    refreshPressure(w);
    expect(days()).toBe(2);
    expect(pickRole(w)).toBeNull();
    refreshPressure(w);
    expect(days()).toBe(3);
    expect(pickRole(w)?.roleId).toBe('community_manager');
    pressureOn(w, 'post_organic', 'leo', RELIEF, BUSY - 2); // the owners are not busy enough: waiting is not their problem
    refreshPressure(w);
    expect(days()).toBe(0);
    expect(pickRole(w)).toBeNull();
    pressureOn(w, 'post_organic', 'leo', RELIEF - 1, BUSY);
    refreshPressure(w);
    expect(days()).toBe(0);
  });

  it('picks the most relief per euro: a haiku before a sonnet with more wait, the id on a tie', async () => {
    const { world: w } = await lab();
    org(w).pressure = [
      { roleId: 'ghostwriter', relief: 20, ownerUtil: 0.9, days: 3 },        // 25 per euro
      { roleId: 'community_manager', relief: 15, ownerUtil: 0.9, days: 3 },  // 30 per euro
      { roleId: 'voc_analyst', relief: 99, ownerUtil: 0.9, days: 2 },        // not three evenings
    ];
    expect(pickRole(w)?.roleId).toBe('community_manager');
    org(w).pressure.push({ roleId: 'accountant', relief: 15, ownerUtil: 0.9, days: 3 });
    expect(pickRole(w)?.roleId).toBe('accountant');
  });

  it('leaves out a media buyer whose channel is closed: he would have no task to serve (D25)', async () => {
    const { world: w } = await lab();
    pressureOn(w, 'optimize_ads', 'leo', RELIEF * 2, 9);
    refreshPressure(w);
    const roles = org(w).pressure.map((p) => p.roleId);
    expect(roles).toContain('media_buyer_tiktok');
    expect(roles).not.toContain('media_buyer_meta');
    expect(roles).not.toContain('media_buyer_google');
    expect(roles).not.toContain('media_buyer_pinterest');
  });
});

describe('the gate table (org test 10)', () => {
  it('all green: the position opens on the third evening and the hire lands the next day', async () => {
    const l = await green();
    const w = l.world;
    await l.company.step();
    expect(org(w).positions).toHaveLength(1);
    expect(org(w).positions[0]).toMatchObject({ id: 'pos_1', roleId: 'community_manager', reason: 'bottleneck', status: 'open', openedDay: 20, replaces: null });
    const task = w.company.tasks.find((t) => t.id === org(w).positions[0]!.taskId)!;
    expect(task).toMatchObject({ kind: 'recruit', assignee: 'nora', reviewer: null, priority: 2, workLeft: 1 });
    expect(decisions(w, 'position')[0]!.numbers).toMatchObject({ relief: RELIEF + 1, ownerUtil: 0.78, days: 3 });
    await untilTheClose(l);
    expect(org(w).positions[0]).toMatchObject({ status: 'filled', hiredId: 'tom', closedDay: 21 });
    expect(agent(w, 'tom')).toMatchObject({ roleId: 'community_manager', dept: 'crm', level: 1, hiredDay: 21, rampUntilDay: 21 + ORG.rampDays, founder: false });
    expect(org(w).stats.hires).toBe(1);
    expect(org(w).lastHireDay).toBe(21);
  });

  it('bottleneck without margin: no position, one refusal, with what it read', async () => {
    const l = await green({ startingCash: 700 }, { revenue: 10, ads: 5 });
    await untilTheClose(l);
    const w = l.world;
    expect(org(w).positions).toEqual([]);
    const [no] = decisions(w, 'refused');
    expect(no).toMatchObject({ day: 20, roleId: 'community_manager' });
    expect(no!.text).toMatch(/refuse : la marge couvre \d+ % des frais fixes après embauche, il faut 115 %\.$/);
    expect(no!.numbers).toMatchObject({ margin: 5, pay: 0.5, relief: RELIEF + 1, ownerUtil: 0.78, days: 3, headcount: 8 });
    expect(no!.numbers.cash).toBeGreaterThan(0);
    expect(no!.numbers.payroll).toBe(7.6);
    expect(no!.numbers.cost).toBe(9.47); // 7,60 + 0,50 + 1,37
    expect(no!.numbers.revenue30).toBe(300);
  });

  it('margin without bottleneck: nothing happens, not even a review, and nobody is told no', async () => {
    const l = await green();
    const w = l.world;
    pressureOn(w, 'post_organic', 'leo', RELIEF - 1, BUSY);
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    expect(decisions(w, 'refused')).toEqual([]);
    expect(w.company.tasks.filter((t) => t.kind === 'headcount_review')).toEqual([]);
  });

  it('a hiring hold: refused, and the reason says whose word it is', async () => {
    const l = await green();
    const w = l.world;
    addHold(w, { kind: 'hiring', productId: null, until: null, reason: 'le fondateur gèle les embauches' });
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    expect(decisions(w, 'refused')[0]!.text).toContain('le fondateur gèle les embauches');
  });

  it('survival: refused, whatever the bottleneck', async () => {
    const l = await green({ startingCash: 1000 }, { revenue: 0 });
    const w = l.world;
    sim.recordLedger(w, { type: 'ad_spend', amount: -800, memo: 'Pub', ref: null });
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    expect(decisions(w, 'refused')[0]!.text).toContain('mode survie');
    expect(decisions(w, 'refused')[0]!.numbers.cash).toBe(200);
  });

  it('bankrupt: refused', async () => {
    const l = await green();
    const w = l.world;
    sim.recordLedger(w, { type: 'ad_spend', amount: -5000, memo: 'Pub', ref: null });
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    expect(decisions(w, 'refused')[0]!.text).toContain('trésorerie négative');
  });

  it('the cooldown after a hire: not today, without a word', async () => {
    const l = await green();
    const w = l.world;
    org(w).lastHireDay = 18;
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    expect(decisions(w, 'refused')).toEqual([]);
    expect(w.company.tasks.filter((t) => t.kind === 'headcount_review')).toEqual([]);
    org(w).lastHireDay = 17;
    expect(checkGates(w, 'community_manager', 'bottleneck').ok).toBe(true); // day 20 - 17 = 3
  });

  it('an open position waits for its own end, and a frozen team asks for nothing', async () => {
    const a = await green();
    openPosition(a.ctx, 'ghostwriter', 'bottleneck', 'x');
    await a.company.step();
    expect(org(a.world).positions.map((p) => p.roleId)).toEqual(['ghostwriter']);
    expect(decisions(a.world, 'refused')).toEqual([]);

    const b = await green({ org: { team: 'lean', autoHire: false, payroll: true } });
    await b.company.step();
    expect(org(b.world).positions).toEqual([]);
    expect(decisions(b.world, 'refused')).toEqual([]);
    expect(org(b.world).pressure.find((p) => p.roleId === 'community_manager')?.days).toBe(3); // still measured
  });

  it('G1: the reserve holds 30 days of what the team will cost', async () => {
    const { world: w } = await green({ startingCash: 284 }, {}); // 30 × 9,47 € = 284,10 €
    expect(checkGates(w, 'community_manager', 'bottleneck').why).toMatch(/284 € en caisse, il en faut 284,10 € pour tenir 30 jours après embauche/);
    const { world: enough } = await green({ startingCash: 285 }, {});
    expect(checkGates(enough, 'community_manager', 'bottleneck').why).toContain('la marge couvre'); // past G1, stopped by G2
  });

  it('G3: on the margin route, revenue per head must pay the role three times over', async () => {
    // 15 € a day clears the margin bar without ads, and 450 € a month across nine heads pays a haiku, not a sonnet.
    const { world: w } = await green({ startingCash: 400 }, { revenue: 15 });
    const read = moneyRead(w, 'competitor_analyst');
    expect(read.margin).toBeGreaterThanOrEqual(ORG.marginCover * (read.cost + 0.3));
    expect(read.revenue30 / 9).toBe(50);
    expect(checkGates(w, 'competitor_analyst', 'bottleneck').ok).toBe(true);
    expect(checkGates(w, 'ghostwriter', 'bottleneck').why).toMatch(/de revenu par tête et par mois, il en faut 72 € pour ce poste/); // 3 × 24 €
  });

  it('G2 by cash: 120 days in the bank carry a thin margin, and spare the revenue per head', async () => {
    const { world: w } = await green({ startingCash: 2000 }, { revenue: 1 });
    expect(checkGates(w, 'community_manager', 'bottleneck').ok).toBe(true);
    const { world: thin } = await green({ startingCash: 800 }, { revenue: 1 });
    expect(checkGates(thin, 'community_manager', 'bottleneck').why).toContain('la marge couvre');
  });

  it('G2 by margin: covering the costs is not enough, it takes 115 % of them', async () => {
    const { world: w } = await green({ startingCash: 700 }, { revenue: 10 });
    const read = moneyRead(w, 'community_manager');
    expect(read.margin).toBeGreaterThan(read.cost);
    expect(checkGates(w, 'community_manager', 'bottleneck').why).toBe('la marge couvre 106 % des frais fixes après embauche, il faut 115 %');
  });

  it('counts the operating margin alone: holds, salaries and fixed costs stay out', async () => {
    const { world: w } = await lab();
    book(w, 7, { revenue: 50, ads: 10 });
    sim.recordLedger(w, { type: 'salary', amount: -7, memo: 'x', ref: 'payroll:7' });
    sim.recordLedger(w, { type: 'revenue', amount: 700, memo: 'Réserve', ref: 'hold:1' });
    sim.recordLedger(w, { type: 'refund', amount: -14, memo: 'x', ref: null });
    expect(moneyRead(w, 'accountant').margin).toBe(38); // (350 - 70 - 14) / 7
  });

  it('keeps the revenue of the last 30 closed days, scaled up on a younger run', async () => {
    const { world: w } = await lab();
    book(w, 10, { revenue: 10 });
    expect(moneyRead(w, 'accountant').revenue30).toBe(300);
    book(w, 40, { revenue: 1 });
    expect(moneyRead(w, 'accountant').revenue30).toBe(30);
  });

  it('a role with no free seat cannot open: nobody is over their seats (I7)', async () => {
    const { world: w } = await green();
    expect(checkGates(w, 'cfo', 'founder')).toMatchObject({ ok: false, quiet: true });
  });
});

describe('one refusal per role per 7 days', () => {
  it('says no once a week, a role at a time, and the review goes quiet in between', async () => {
    const l = await green({ startingCash: 700 }, { revenue: 10, ads: 5 });
    const w = l.world;
    await l.company.step();
    expect(decisions(w, 'refused')).toHaveLength(1);
    w.tick = 11;
    w.day = 22;
    await headcountEvening(l.ctx);
    expect(decisions(w, 'refused')).toHaveLength(1);
    expect(w.company.tasks.filter((t) => t.kind === 'headcount_review')).toHaveLength(1);
    w.day = 26;
    requestRole(l.ctx, 'community_manager', 'channel', 'canal');
    expect(decisions(w, 'refused')).toHaveLength(1);
    requestRole(l.ctx, 'data_analyst', 'channel', 'canal');
    expect(decisions(w, 'refused').map((d) => d.roleId)).toEqual(['community_manager', 'data_analyst']);
    w.day = 27;
    requestRole(l.ctx, 'community_manager', 'channel', 'canal');
    expect(decisions(w, 'refused').map((d) => d.roleId)).toEqual(['community_manager', 'data_analyst', 'community_manager']);
  });

  it('the money moves within the week: the review speaks again and the position opens', async () => {
    const l = await green({ startingCash: 700 }, { revenue: 10, ads: 5 });
    const w = l.world;
    await l.company.step();
    expect(org(w).positions).toEqual([]);
    w.day = 21;
    sim.recordLedger(w, { type: 'revenue', amount: 700, memo: 'Ventes', ref: null });
    sim.recordLedger(w, { type: 'platform_fee', amount: 0, memo: 'Clôture', ref: 'fixed:21' });
    await headcountEvening(l.ctx);
    expect(org(w).positions.map((p) => p.roleId)).toEqual(['community_manager']);
  });
});

describe('who gets past which gate', () => {
  it('channel: no bottleneck needed, every money gate kept, frozen teams stay frozen', async () => {
    const l = await green();
    const pos = requestRole(l.ctx, 'media_buyer_meta', 'channel', 'Ouvrir Meta');
    expect(pos).toMatchObject({ reason: 'channel', roleId: 'media_buyer_meta' });
    const poor = await green({ startingCash: 700 }, { revenue: 10, ads: 5 });
    expect(requestRole(poor.ctx, 'media_buyer_meta', 'channel', 'Ouvrir Meta')).toBeNull();
    const frozen = await green({ org: { team: 'lean', autoHire: false, payroll: true } });
    expect(requestRole(frozen.ctx, 'media_buyer_meta', 'channel', 'Ouvrir Meta')).toBeNull();
  });

  it('founder: skips bottleneck, margin and autoHire, keeps the reserve and the holds', async () => {
    const frozen = await green({ org: { team: 'lean', autoHire: false, payroll: true } }, { revenue: 10, ads: 10 });
    expect(requestRole(frozen.ctx, 'video_editor', 'founder', 'Le fondateur le demande')).toMatchObject({ reason: 'founder' });
    const broke = await green({ startingCash: 150 }, {});
    expect(requestRole(broke.ctx, 'video_editor', 'founder', 'Le fondateur le demande')).toBeNull();
    expect(decisions(broke.world, 'refused')[0]!.text).toContain('pour tenir 30 jours');
    const held = await green();
    addHold(held.world, { kind: 'hiring', productId: null, until: null, reason: 'gel' });
    expect(requestRole(held.ctx, 'video_editor', 'founder', 'Le fondateur le demande')).toBeNull();
  });

  it('replacement: every gate falls, money and holds alike (D17)', async () => {
    const { world: w } = await green({ startingCash: 1000 }, {});
    sim.recordLedger(w, { type: 'ad_spend', amount: -900, memo: 'Pub', ref: null });
    addHold(w, { kind: 'hiring', productId: null, until: null, reason: 'gel' });
    expect(checkGates(w, 'ghostwriter', 'bottleneck').ok).toBe(false);
    expect(checkGates(w, 'ghostwriter', 'replacement').ok).toBe(true);
  });

  it('a legacy team hires nobody, whatever is asked', async () => {
    const { world: w, ctx } = await lab({ ...LEGACY });
    expect(requestRole(ctx, 'media_buyer_meta', 'founder', 'x')).toBeNull();
    expect(openPosition(ctx, 'media_buyer_meta', 'replacement', 'x')).toBeNull();
    expect(drawCandidates(ctx, 'media_buyer_meta', 0, 3)).toEqual([]);
    expect(org(w).positions).toEqual([]);
  });
});

describe('the recruit', () => {
  async function recruitTask(l: Lab): Promise<{ task: Task; position: Position }> {
    await l.company.step(); // the evening opens it
    const position = org(l.world).positions[0]!;
    return { task: l.world.company.tasks.find((t) => t.id === position.taskId)!, position };
  }

  it('hires through the books, the playbook, the chart and the brain', async () => {
    const l = await green();
    const w = l.world;
    const cashBefore = sim.financeSnapshot(w).cash;
    await untilTheClose(l);
    const ledger = w.ledger.filter((e) => e.ref === 'hire:tom');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'recruiting', amount: -3.5, day: 21 });
    expect(sim.financeSnapshot(w).cash).toBeLessThan(cashBefore);
    expect(w.ledger.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(sim.financeSnapshot(w).cash, 2);
    expect(agent(w, 'tom').taskKinds).toEqual([...ROLES.community_manager.core, ...ROLES.community_manager.assist]);
    expect(agent(w, 'leo').hatKinds).not.toContain('post_organic');
    expect(w.company.departments.map((d) => d.id)).toContain('crm');
    expect(agent(w, 'tom').isChief).toBe(true);
    expect(w.company.playbooks.tom!.length).toBeGreaterThan(0);
    expect(await l.ctx.brain.read('playbooks/Tom.md')).toBeTruthy();
    expect((await l.ctx.brain.read('entreprise/Organigramme.md'))?.body).toContain('Tom');
    const [hire] = decisions(w, 'hire');
    expect(hire).toMatchObject({ roleId: 'community_manager', agentId: 'tom' });
    expect(hire!.text).toBe('Camille signe : Tom rejoint l\'agence comme Community manager (15 €/mois).');
    expect(auditOrg(w)).toEqual([]);
  });

  it('names the named candidate first, everyone at 50 (D16), and keeps all three on the position', async () => {
    const l = await green();
    await untilTheClose(l);
    const [position] = org(l.world).positions;
    expect(position!.candidates).toHaveLength(3);
    expect(position!.candidates[0]).toMatchObject({ id: 'tom', interview: 50, deliverable: null, lineage: null });
    expect(position!.hiredId).toBe('tom');
    expect(position!.candidates.map((c) => c.id)).toEqual(position!.candidates.map((c) => slugify(c.name)));
  });

  it('a position cancelled by the recheck closes without failing the task, and says why', async () => {
    const l = await green();
    const w = l.world;
    const { task, position } = await recruitTask(l);
    sim.recordLedger(w, { type: 'ad_spend', amount: -sim.financeSnapshot(w).cash + 1, memo: 'Pub', ref: null });
    await untilTheClose(l);
    expect(position).toMatchObject({ status: 'cancelled', hiredId: null, closedDay: 21 });
    expect(task.status).toBe('done');
    expect(agent(w, 'nora').perf.failed).toBe(0);
    expect(w.company.agents).toHaveLength(8);
    expect(w.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
    expect(decisions(w, 'refused').at(-1)!.numbers.margin).toBeTypeOf('number');
  });

  it('a task that died frees the position, or G0 would freeze hiring for good', async () => {
    const l = await green();
    const w = l.world;
    const { task, position } = await recruitTask(l);
    task.status = 'failed';
    w.day = 21;
    w.tick = 11;
    await headcountEvening(l.ctx);
    expect(position.status).toBe('cancelled');
  });

  it('asks the founder first: nothing moves until his yes', async () => {
    const l = await green({ founderApproval: true });
    const w = l.world;
    const { task, position } = await recruitTask(l);
    await untilTheClose(l);
    expect(task.status).toBe('awaiting_founder');
    expect(task.input.founderAsk).toBe('Embaucher Tom (Community manager) à 15 €/mois');
    expect(w.company.pendingApprovals).toContain(task.id);
    expect(position.status).toBe('open');
    expect(w.company.agents).toHaveLength(8);
    l.company.approve(task.id, true);
    while (!(w.day === 22 && w.tick === 10)) await l.company.step();
    expect(position.status).toBe('filled');
    expect(agent(w, 'tom').hiredDay).toBeGreaterThanOrEqual(21);
    expect(w.ledger.filter((e) => e.ref === 'hire:tom')).toHaveLength(1);
  });

  it('his no closes the position and stands as a hold, with its numbers (D49)', async () => {
    const l = await green({ founderApproval: true });
    const w = l.world;
    const { task, position } = await recruitTask(l);
    await untilTheClose(l);
    const counter = w.idCounter;
    const before = liveStreams(l.ctx);
    l.company.approve(task.id, false);
    expect(position).toMatchObject({ status: 'cancelled', closedDay: 21 });
    expect(hiringHold(w)).toMatchObject({ kind: 'hiring', until: 28 });
    const no = decisions(w, 'refused').at(-1)!;
    expect(no.numbers).toMatchObject({ until: 28, pay: 0.5 });
    expect(no.numbers.cash).toBeTypeOf('number');
    expect(w.idCounter).toBeGreaterThan(counter); // the hold and the decision took their ids, no generator moved
    expect(liveStreams(l.ctx)).toEqual(before);
    expect(checkGates(w, 'community_manager', 'bottleneck').why).toContain('gelées');
    w.day = 29;
    expect(hiringHold(w)).toBeNull();
  });

  it('a refusal of anything else, or of a closed position, changes nothing', async () => {
    const l = await green();
    const w = l.world;
    const other = createTask(w, { kind: 'recruit' });
    recruitRefused(l.ctx, other);
    expect(hiringHold(w)).toBeNull();
    expect(decisions(w, 'refused')).toEqual([]);
  });

  it('every step of the pipeline has a handler', () => {
    expect(HANDLERS.headcount_review).toBeDefined();
    expect(HANDLERS.recruit?.onDone).toBeDefined();
  });
});

describe('what a hire inherits (org test 16)', () => {
  async function hire(l: Lab, role: RoleId): Promise<AgentState> {
    const position = openPosition(l.ctx, role, 'bottleneck', 'x', undefined, { noTask: true })!;
    const [c] = drawCandidates(l.ctx, role, 0, 1);
    return hireAgent(l.ctx, position, c!);
  }

  it('a new hook writer holds the seed rules, the banned words and the hook directive of Léo', async () => {
    const l = await lab();
    const w = l.world;
    w.company.playbooks.leo!.push('Ne jamais écrire « miracle »', 'Privilégier le hook « pov »');
    const lesson = { id: 'les_1', insight: 'Ne jamais écrire « miracle »', appliesTo: ['leo'] } as Partial<Lesson> as Lesson;
    w.company.lessons.push(lesson);
    const sarah = await hire(l, 'hook_writer');
    expect(sarah.id).toBe('sarah');
    const book = w.company.playbooks.sarah!;
    expect(book).toEqual(expect.arrayContaining(['Ne jamais écrire « miracle »', 'Privilégier le hook « pov »', 'Ne jamais écrire « garanti »']));
    expect(lesson.appliesTo).toContain('sarah');
  });

  it('a hat wearer hands down what they learned: the first community manager has Léo\'s rules', async () => {
    const l = await lab();
    l.world.company.playbooks.leo!.push('Ne jamais écrire « miracle »');
    await hire(l, 'community_manager');
    expect(l.world.company.playbooks.tom).toContain('Ne jamais écrire « miracle »');
    expect(l.world.company.playbooks.tom).toEqual(expect.arrayContaining(SEED_PLAYBOOKS.crm)); // the rules of a department nobody had opened
  });

  it('under control.noLearning a hire starts from the seed rules alone, and the audit stays empty', async () => {
    const l = await lab({ control: { noLearning: true } });
    const w = l.world;
    w.company.playbooks.leo!.push('Ne jamais écrire « miracle »');
    await hire(l, 'community_manager');
    expect(w.company.playbooks.tom).toEqual(SEED_PLAYBOOKS.crm); // the founder's lesson stayed with him
    expect(auditOrg(w)).toEqual([]);
  });

  it('the leaver\'s banned word reaches the remaining owner', async () => {
    const l = await lab();
    const w = l.world;
    await hire(l, 'community_manager');
    w.company.playbooks.tom!.push('Ne jamais écrire « promis »');
    expect(await requestDeparture(l.ctx, 'tom', 'test', 'nora', 'fired')).toBe('left');
    expect(w.company.playbooks.leo).toContain('Ne jamais écrire « promis »');
  });

  it('never goes over the cap of a playbook', async () => {
    const l = await lab();
    const w = l.world;
    for (let i = 0; i < 40; i++) w.company.playbooks.leo!.push(`Règle numéro ${i}`);
    await hire(l, 'community_manager');
    expect(w.company.playbooks.tom!.length).toBeLessThanOrEqual(24);
  });
});

describe('a hire and the work already there', () => {
  it('sends back what a hat wearer had not started, and only that', async () => {
    const l = await lab();
    const w = l.world;
    const waiting = createTask(w, { kind: 'post_organic', assignee: 'leo' });
    const started = createTask(w, { kind: 'post_organic', assignee: 'leo' });
    started.progress = 0.5;
    const running = createTask(w, { kind: 'post_organic', assignee: 'leo' });
    running.status = 'in_progress';
    const own = createTask(w, { kind: 'optimize_ads', assignee: 'leo' });
    const position = openPosition(l.ctx, 'community_manager', 'bottleneck', 'x', undefined, { noTask: true })!;
    await hireAgent(l.ctx, position, drawCandidates(l.ctx, 'community_manager', 0, 1)[0]!);
    expect(waiting.assignee).toBeNull();
    expect(started.assignee).toBe('leo');
    expect(running.assignee).toBe('leo');
    expect(own.assignee).toBe('leo');
  });

  it('leaves a core owner\'s pending task alone: a second writer does not take the first one\'s desk', async () => {
    const l = await lab();
    const w = l.world;
    const task = createTask(w, { kind: 'write_pdf', assignee: 'elise' });
    const position = openPosition(l.ctx, 'ghostwriter', 'bottleneck', 'x', undefined, { noTask: true })!;
    await hireAgent(l.ctx, position, drawCandidates(l.ctx, 'ghostwriter', 0, 1)[0]!);
    expect(task.assignee).toBe('elise');
  });

  it('books no recruiting on a team nobody pays', async () => {
    const l = await lab({ org: { team: 'lean', autoHire: true, payroll: false } });
    const position = openPosition(l.ctx, 'community_manager', 'bottleneck', 'x', undefined, { noTask: true })!;
    await hireAgent(l.ctx, position, drawCandidates(l.ctx, 'community_manager', 0, 1)[0]!);
    expect(l.world.ledger.filter((e) => e.type === 'recruiting')).toEqual([]);
    expect(moneyRead(l.world, 'ghostwriter')).toMatchObject({ payroll: 0, pay: 0 });
  });
});

describe('a replacement (D17)', () => {
  it('goes through in one tick, with one exit, one payout and no recruit task', async () => {
    const l = await lab();
    const w = l.world;
    const zoe = agent(w, 'zoe');
    zoe.notice = { day: w.day, reason: 'test raté', by: 'nora', kind: 'fired' };
    const position = openPosition(l.ctx, 'art_director', 'replacement', 'Remplacer', 'zoe', { noTask: true })!;
    expect(position).toMatchObject({ taskId: null, replaces: 'zoe' });
    expect(w.company.tasks.filter((t) => t.kind === 'recruit')).toEqual([]);
    const [candidate] = drawCandidates(l.ctx, 'art_director', 0, 3);
    const hired = await hireAgent(l.ctx, position, candidate!);
    expect(w.company.agents.some((a) => a.id === 'zoe')).toBe(false);
    expect(roleHolders(w, 'art_director').map((a) => a.id)).toEqual([hired.id]);
    expect(org(w).alumni.filter((a) => a.id === 'zoe')).toMatchObject([{ kind: 'fired', replacedBy: hired.id }]);
    expect(w.ledger.filter((e) => e.ref === 'leave:zoe')).toHaveLength(1);
    expect(w.ledger.filter((e) => e.ref === `hire:${hired.id}`)).toHaveLength(1);
    expect(org(w).stats).toMatchObject({ hires: 1, departures: 1 });
    expect(auditOrg(w)).toEqual([]);
  });

  it('a founder on notice stays until the recruit lands, then leaves (org §10)', async () => {
    const l = await lab();
    const w = l.world;
    book(w, 20, {});
    expect(await requestDeparture(l.ctx, 'zoe', 'test raté', 'nora', 'fired')).toBe('notice');
    const [position] = org(w).positions;
    const task = w.company.tasks.find((t) => t.id === position!.taskId)!;
    const out = await HANDLERS.recruit.run(l.ctx, task, agent(w, 'nora'), {} as never);
    task.output = out.output ?? null;
    expect(position!.status).toBe('open');
    await HANDLERS.recruit.onDone!(l.ctx, task);
    expect(w.company.agents.some((a) => a.id === 'zoe')).toBe(false);
    expect(position!.status).toBe('filled');
  });
});

describe('names (D53)', () => {
  it('60 first names, 30 of each, none a person of the catalog, each its own id', () => {
    expect(NAME_POOL).toHaveLength(60);
    expect(NAME_POOL.filter((n) => n.gender === 'f')).toHaveLength(30);
    const ids = NAME_POOL.map((n) => slugify(n.name));
    expect(new Set(ids).size).toBe(60);
    const taken = new Set(Object.keys(CANDIDATES));
    expect(ids.filter((id) => taken.has(id))).toEqual([]);
  });

  it('200 positions in a row all get a name, an id of their own, and three candidates who differ', async () => {
    const { world: w, ctx } = await lab();
    const role: RoleId = 'motion_designer'; // no named candidate: every name comes from the pool
    for (let i = 0; i < 200; i++) {
      const position = openPosition(ctx, role, 'replacement', 'x', undefined, { noTask: true })!;
      const drawn = drawCandidates(ctx, role, i, 3);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn.map((c) => c.name)).size).toBe(3);
      expect(new Set(drawn.map((c) => c.id)).size).toBe(3);
      position.status = 'filled';
      const [hired] = drawn;
      org(w).alumni.push({ id: hired!.id, name: hired!.name, gender: hired!.gender, roleId: role, dept: 'video', founder: false, hiredDay: 1, leftDay: 1, reason: 'x', level: 1, kind: 'fired', replacedBy: null, perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, avatar: hired!.avatar });
    }
    const names = org(w).alumni.map((a) => a.name);
    expect(new Set(names).size).toBe(200);
    expect(new Set(org(w).alumni.map((a) => a.id)).size).toBe(200);
    expect(names.filter((n) => /^\S+ [A-Z]+\.$/.test(n)).length).toBe(140); // the pool ran out after 60, each past that wears an initial
  });

  it('a candidate turned down goes back in the pool: only a hire burns a name', async () => {
    const { world: w, ctx } = await lab();
    const drawn = drawCandidates(ctx, 'motion_designer', 0, 3).map((c) => c.name);
    expect([...takenNames(w)].filter((n) => drawn.includes(n))).toEqual([]);
    expect(drawCandidates(ctx, 'motion_designer', 0, 3).map((c) => c.name)).toEqual(drawn);
  });

  it('adds an initial when the pool is spent, never loops, and moves on when the initial is taken too', () => {
    const taken = new Set(NAME_POOL.map((n) => n.name));
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const { name } = pickName(taken, rng);
      expect(taken.has(name)).toBe(false);
      expect(name).toMatch(/^\S+ [A-Z]+\.$/);
      taken.add(name);
    }
  });

  it('draws the same candidates from the same seed and position, others from another position', async () => {
    const a = await lab();
    const b = await lab();
    const key = (ctx: RuntimeCtx, i: number) => JSON.stringify(drawCandidates(ctx, 'ghostwriter', i, 3));
    expect(key(a.ctx, 4)).toBe(key(b.ctx, 4));
    expect(key(a.ctx, 4)).not.toBe(key(a.ctx, 5));
    const c = await lab({ seed: 8 });
    expect(key(a.ctx, 4)).not.toBe(key(c.ctx, 4));
  });

  it('a drawing spends nothing the company draws from: no rng, no id', async () => {
    const { world: w, ctx } = await lab();
    const counter = w.idCounter;
    const before = liveStreams(ctx);
    drawCandidates(ctx, 'video_editor', 0, 3);
    expect(w.idCounter).toBe(counter);
    expect(liveStreams(ctx)).toEqual(before);
  });

  it('has skills and a kit for each of the 35 roles, the five without a named candidate included', () => {
    for (const role of Object.keys(ROLES) as RoleId[]) {
      expect(skillsOf(role).length, role).toBeGreaterThan(2);
      expect(toolsOf(role), role).toContain('brain.read');
    }
  });

  it('gives a generated candidate a persona, skills, a kit and the shirt of the department', async () => {
    const l = await lab();
    const drawn = drawCandidates(l.ctx, 'email_marketer', 0, 3);
    for (const c of drawn) {
      expect(c.persona).toContain(c.name);
      expect(c.skills.length).toBeGreaterThan(2);
      expect(c.avatar.shirt).toBe('#10b981');
      expect(c).toMatchObject({ tier: 'sonnet', roleId: 'email_marketer', interview: 50, deliverable: null, lineage: null });
    }
    const position = openPosition(l.ctx, 'email_marketer', 'bottleneck', 'x', undefined, { noTask: true })!;
    const hired = await hireAgent(l.ctx, position, drawn[0]!);
    expect(hired.tools.length).toBeGreaterThan(0);
    expect(hired.role).toBe('Email marketer');
  });
});

describe('a whole run', () => {
  async function play(l: Lab, days: number): Promise<void> {
    for (let i = 0; i < days * 12; i++) await l.company.step();
  }

  const decisionsOf = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

  /** Reloads are harsher with more of the day in the world: 7 and 12 share no divisor, so they fall on every tick. */
  async function replay(seed: number, ticks: number, reloadEvery: number): Promise<{ text: string; world: WorldState }> {
    const l = await lab({ seed });
    let { world, company } = l;
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = l.reopen(world);
      }
    }
    return { text: decisionsOf(world), world };
  }

  it('a lean run hires on its own, and each refusal keeps its numbers', async () => {
    const l = await lab({ startingCash: 500 });
    await play(l, 30);
    const w = l.world;
    expect(org(w).stats.hires).toBeGreaterThan(0);
    expect(decisions(w, 'hire').length).toBe(org(w).stats.hires);
    expect(w.company.agents.length).toBe(8 + org(w).stats.hires);
    for (const d of [...decisions(w, 'refused'), ...decisions(w, 'position')]) {
      expect(Object.keys(d.numbers).length).toBeGreaterThan(0);
      for (const v of Object.values(d.numbers)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(org(w).stats.violations).toBe(0);
    expect(w.ledger.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(sim.financeSnapshot(w).cash, 2);
  }, 180_000);

  it('a run with hires, reloaded on every tick of the day, ends byte for byte the same (org test 7)', async () => {
    const ticks = 26 * 12;
    const straight = await replay(7, ticks, 0);
    expect(org(straight.world).stats.hires).toBeGreaterThan(0);
    const reloaded = await replay(7, ticks, 7);
    expect(reloaded.text === straight.text).toBe(true);
  }, 240_000);

  it.each([7, 1, 5])('hiring never reaches the market, seed %i: auto and frozen see the same events on the same days (org test 8)', async (seed) => {
    const days = 40;
    const auto = await lab({ seed });
    const frozen = await lab({ seed, org: { team: 'lean', autoHire: false, payroll: true } });
    await play(auto, days);
    await play(frozen, days);
    expect(org(auto.world).stats.hires).toBeGreaterThan(0);
    expect(org(frozen.world).stats.hires).toBe(0);
    // goal_reached and bankrupt are the company's own books, pushed by checkStatus: the market drew neither. viral_organic
    // is rolled once per post the company made, and a community manager makes more: the rolls are the company's to count.
    const OWN = ['goal_reached', 'bankrupt', 'viral_organic'];
    const events = (w: WorldState) => w.market.events.filter((e) => !OWN.includes(e.kind)).map((e) => [e.day, e.kind]);
    expect(events(auto.world)).toEqual(events(frozen.world));
  }, 240_000);
});

