// Pure view-model helpers of the UI (no DOM). Run: cd server && npx vitest run --root ../web/src
import { describe, expect, it } from 'vitest';
import type { Activity, CompanySnapshot, LedgerEntry, SessionInfo, Task, TaskStats, WorldEvent } from '../../../shared/types';
import { asSession, brainNotePath, fileUrl } from '../api';
import { godDataAfter, withPlaybooks, withSession, withTick } from '../store';
import { mockSnapshot } from '../world/mockSnapshot';
import {
  activityProductId, approvalAsk, budgetView, currentRunPill, customerLabel, deptCalendar, doneTasksByDay, doneTasksTotal, failedTasksTotal, goalLate, goalTitle, hasWaiver, ledgerView,
  nextStepTitle, redTeamView, sessionView,
} from './derive';
import { budgetError, budgetTooLow, deadlineNote, defaultForm, minCashOf, readNumber, scenarioConfig, settleField, type ScenarioForm } from './scenarioForm';
import { eventToast } from './useEventToasts';

const session = (o: Partial<SessionInfo> = {}): SessionInfo => ({ runId: 'demo-pixel-agency', playing: true, speed: 4, busy: false, mindMode: 'heuristic', lastError: null, ...o });
const snap = (o: Partial<CompanySnapshot> = {}): CompanySnapshot => ({ ...mockSnapshot(), ...o });

describe('sessionView — snapshot.session is the source of truth for play/pause and speed', () => {
  it('uses the server loop state even when the run status disagrees', () => {
    // between two ticks the server reports status "paused" while the loop is playing
    const v = sessionView(snap({ status: 'paused', session: session({ playing: true, speed: 4 }) }), 1);
    expect(v).toMatchObject({ playing: true, speed: 4, fromServer: true });
    const p = sessionView(snap({ status: 'running', session: session({ playing: false, speed: 2 }) }), 8);
    expect(p).toMatchObject({ playing: false, speed: 2 });
  });

  it('falls back to the run status and the local speed without a session', () => {
    const { session: _none, ...rest } = snap();
    expect(sessionView({ ...rest, status: 'running' }, 8)).toMatchObject({ playing: true, speed: 8, fromServer: false, lastError: null });
    expect(sessionView({ ...rest, status: 'paused' }, 2)).toMatchObject({ playing: false, speed: 2 });
    expect(sessionView(null, 1)).toMatchObject({ playing: false, speed: 1, ended: false });
  });

  it('exposes lastError (trimmed) and busy, ignores invalid speeds, never plays a finished run', () => {
    const v = sessionView(snap({ session: session({ lastError: '  disque plein  ', busy: true, speed: 3 as never }) }), 2);
    expect(v).toMatchObject({ lastError: 'disque plein', busy: true, speed: 2 });
    expect(sessionView(snap({ session: session({ lastError: '   ' }) }), 1).lastError).toBeNull();
    expect(sessionView(snap({ status: 'finished', session: session({ playing: true }) }), 1)).toMatchObject({ playing: false, ended: true });
  });

  it('only « finished » ends a run, like isTerminal on the server: the agency keeps working after a goal or a bankruptcy', () => {
    for (const status of ['goal_reached', 'bankrupt'] as const) {
      expect(sessionView(snap({ status, session: session({ playing: true, speed: 4 }) }), 1), status).toMatchObject({ playing: true, speed: 4, ended: false });
      expect(sessionView(snap({ status, session: session({ playing: false }) }), 1), status).toMatchObject({ playing: false, ended: false });
    }
  });

  it('a control response patches snapshot.session right away (same run only)', () => {
    const s = snap({ session: session({ playing: true, speed: 1 }) });
    const next = withSession(s, session({ playing: false, speed: 8, status: 'paused' }))!;
    expect(next.session).toMatchObject({ playing: false, speed: 8 });
    expect(next.status).toBe('paused');
    expect(withSession(s, session({ runId: 'autre-run', playing: false }))).toBe(s);
    expect(asSession({ runId: 'r', playing: true, speed: 2 })).toBeTruthy();
    expect(asSession({ runId: 'r', playing: true, speed: 3 })).toBeUndefined();
    expect(asSession('nope')).toBeUndefined();
  });
});

describe('run status', () => {
  it('the pill of the current run says where it stands: a finished run is not « en cours »', () => {
    expect(currentRunPill('finished')).toEqual({ label: 'terminée', tone: 'neutral' });
    expect(currentRunPill('running')).toEqual({ label: 'en cours', tone: 'green' });
    expect(currentRunPill('bankrupt')).toEqual({ label: 'faillite', tone: 'red' });
    expect(currentRunPill('finished', true)).toEqual({ label: 'faillite', tone: 'red' });
    expect(currentRunPill('finished', false)).toEqual({ label: 'terminée', tone: 'neutral' });
  });

  it('a goal reached after the deadline is not the goal of the scenario, on the deadline it is', () => {
    const goal = { targetProfit: 1000, byDay: 20 };
    const at = (goalReachedDay: number | null) => snap({ scenario: { ...snap().scenario, goal }, goalReachedDay });
    expect(goalLate(at(31))).toBe(true);
    expect(goalTitle(at(31))).toBe('Objectif atteint après l’échéance');
    expect(goalLate(at(20))).toBe(false);
    expect(goalTitle(at(20))).toBe('Objectif atteint !');
    expect(goalLate(at(null))).toBe(false);
  });
});

describe('scenario form — number fields', () => {
  const MIN = 110;
  const form = (o: Partial<ScenarioForm> = {}): ScenarioForm => ({ ...defaultForm(undefined, MIN, 7), ...o });
  // what the field does when the founder selects its content and types: one change per keystroke, no parsing
  const type = (f: ScenarioForm, field: 'horizonDays' | 'startingCash', text: string): ScenarioForm => {
    let out = f;
    for (let i = 1; i <= text.length; i++) out = { ...out, [field]: text.slice(0, i) };
    return out;
  };

  it('typing 30 days gives 30 days and leaves the goal deadline alone', () => {
    const f = settleField(type(form({ byDay: '20' }), 'horizonDays', '30'), 'horizonDays');
    expect(f.horizonDays).toBe('30');
    expect(f.byDay).toBe('20');
    expect(deadlineNote(f)).toBeNull();
    expect(scenarioConfig(f)).toMatchObject({ horizonDays: 30, goal: { byDay: 20 } });
  });

  it('a horizon shorter than the deadline is said under the field, and only applied to the run that starts', () => {
    const typed = settleField(type(form({ byDay: '60' }), 'horizonDays', '30'), 'horizonDays');
    expect(typed.byDay).toBe('60');
    expect(deadlineNote(typed)).toContain('jour 30');
    expect(scenarioConfig(typed)).toMatchObject({ horizonDays: 30, goal: { byDay: 30 } });
    // the founder corrects the horizon: the deadline he chose is still there
    expect(deadlineNote(settleField(type(typed, 'horizonDays', '90'), 'horizonDays'))).toBeNull();
    expect(scenarioConfig(settleField(type(typed, 'horizonDays', '90'), 'horizonDays'))).toMatchObject({ horizonDays: 90, goal: { byDay: 60 } });
  });

  it('the raw text survives until blur, then the field clamps to its own range', () => {
    expect(type(form(), 'startingCash', '300').startingCash).toBe('300');
    expect(form({ horizonDays: '' }).horizonDays).toBe('');
    expect(settleField(form({ horizonDays: '3' }), 'horizonDays').horizonDays).toBe('7');
    expect(settleField(form({ horizonDays: '9000' }), 'horizonDays').horizonDays).toBe('365');
    expect(settleField(form({ horizonDays: '' }), 'horizonDays').horizonDays).toBe('60');
    expect(settleField(form({ byDay: 'abc', horizonDays: '45' }), 'byDay').byDay).toBe('45');
    expect(settleField(form({ byDay: '80', horizonDays: '45' }), 'byDay').byDay).toBe('45');
    expect(settleField(form({ maxComputeEur: '12,5' }), 'maxComputeEur').maxComputeEur).toBe('12.5');
    expect(settleField(form({ startingCash: '250000' }), 'startingCash').startingCash).toBe('100000');
  });

  it('submit reads the same values without a blur (Enter in a field)', () => {
    const c = scenarioConfig(form({ startingCash: '1 000', horizonDays: '3', targetProfit: '', seed: '12.9', name: '  ' }));
    expect(c).toMatchObject({ startingCash: 1000, horizonDays: 7, seed: 12, name: 'Agence PDF', goal: { targetProfit: 1000, byDay: 7 } });
  });

  it('reads French numbers', () => {
    expect(readNumber('1 500,50')).toBe(1500.5);
    expect(readNumber('2 000')).toBe(2000);
    expect(readNumber('')).toBeNull();
    expect(readNumber('douze')).toBeNull();
  });

  it('a budget below the server minimum is refused in French, never raised behind the founder', () => {
    const low = settleField(form({ startingCash: '50' }), 'startingCash');
    expect(low.startingCash).toBe('50');
    expect(budgetTooLow(low, MIN)).toBe(true);
    expect(budgetError(low, MIN)).toMatch(/Budget de départ trop bas : il faut au moins 110\s€/);
    expect(budgetError(form({ startingCash: '110' }), MIN)).toBeNull();
    expect(budgetTooLow(form({ startingCash: '' }), MIN)).toBe(false); // still typing
  });

  it('the minimum comes from the session, and the defaults never start below it', () => {
    expect(minCashOf(snap({ session: session({ minStartingCash: 140 }) }))).toBe(140);
    expect(minCashOf(snap())).toBe(110);
    expect(minCashOf(null)).toBe(110);
    const old = mockSnapshot().scenario;
    expect(defaultForm({ ...old, startingCash: 50 }, 110, 1).startingCash).toBe('110');
    expect(defaultForm({ ...old, startingCash: 800 }, 110, 1).startingCash).toBe('800');
  });
});

describe('task counts — the task list of a snapshot is trimmed, the counts are not', () => {
  const task = (o: Partial<Task>): Task => ({ ...mockSnapshot().company.tasks[0]!, status: 'done', dayCreated: 5, dayDone: 5, dept: 'finance', ...o });
  const stats: TaskStats = {
    days: [{ day: 3, created: 9, done: 12, failed: 0, cancelled: 0 }, { day: 5, created: 4, done: 4, failed: 1, cancelled: 0 }],
    depts: { finance: { days: [{ day: 9, created: 3, done: 2, failed: 0, cancelled: 0 }], kinds7d: { budget_review: 2 }, done: 40, failed: 7, avgDelayDays: 1.5 } },
  };
  const base = snap();
  const withTasks = (tasks: Task[], o: Partial<CompanySnapshot> = {}) => ({ ...base, day: 10, company: { ...base.company, tasks }, ...o });

  it('per day: server counts first, for days whose tasks left the list', () => {
    const m = doneTasksByDay(withTasks([task({ id: 'a', dayDone: 5 })], { taskStats: stats }));
    expect(m.get(3)).toBe(12);
    expect(m.get(5)).toBe(4);
  });

  it('per day without taskStats: the KPIs, then the list for the open day', () => {
    const s = withTasks([task({ id: 'a', dayDone: 10 }), task({ id: 'b', dayDone: 2 })]);
    const m = doneTasksByDay({ ...s, company: { ...s.company, kpis: [{ ...base.company.kpis[0]!, day: 2, tasksDone: 17 }] } });
    expect(m.get(2)).toBe(17);
    expect(m.get(10)).toBe(1);
  });

  it('whole run, by team', () => {
    const s = withTasks([], { taskStats: stats });
    expect(doneTasksTotal(s, 'all')).toBe(16);
    expect(doneTasksTotal(s, 'finance')).toBe(40);
    expect(doneTasksTotal(s, 'rh')).toBe(0);
    expect(doneTasksTotal(withTasks([]), 'all')).toBeNull();
  });

  it('failed and cancelled tasks: whole run, by team', () => {
    const s = withTasks([], { taskStats: { ...stats, days: [...stats.days, { day: 6, created: 0, done: 0, failed: 2, cancelled: 3 }] } });
    expect(failedTasksTotal(s, 'all')).toBe(6);
    expect(failedTasksTotal(s, 'finance')).toBe(7);
    expect(failedTasksTotal(s, 'rh')).toBe(0);
    expect(failedTasksTotal(withTasks([]), 'all')).toBeNull();
  });

  it('team calendar: 14 days, today first, and it says what the list lacks', () => {
    const kept = task({ id: 'a', dayCreated: 9, dayDone: 9 });
    const days = deptCalendar(withTasks([kept], { taskStats: stats }), 'finance', [kept]);
    expect(days.map((d) => d.day)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(days[1]).toMatchObject({ day: 9, doneCount: 2, createdCount: 3, hidden: 2 });
    expect(days[1]!.done).toEqual([kept]);
    expect(days[0]).toMatchObject({ doneCount: 0, createdCount: 0, hidden: 0 });
    expect(deptCalendar({ ...withTasks([]), day: 30 }, 'finance', [])).toHaveLength(14);
  });

  it('team calendar without taskStats counts the list', () => {
    const kept = task({ id: 'a', dayCreated: 9, dayDone: 10 });
    const days = deptCalendar(withTasks([kept]), 'finance', [kept]);
    expect(days[0]).toMatchObject({ doneCount: 1, createdCount: 0, hidden: 0 });
    expect(days[1]).toMatchObject({ doneCount: 0, createdCount: 1, hidden: 0 });
  });
});

describe('approval card — the founder reads what he approves', () => {
  const task: Task = { ...mockSnapshot().company.tasks[0]!, id: 'tsk_9', title: 'Lancer la campagne', input: { productId: 'prd_91', nicheId: 'chiot' } };
  const act = (o: Partial<Activity>): Activity => ({ id: 'a', day: 5, tick: 3, at: 0, agentId: 'leo', kind: 'founder', text: 'En attente du fondateur : Rembourser 24,00 € (commande ord_1)', refs: { taskId: 'tsk_9' }, ...o });

  it('prefers the request stored on the task', () => {
    expect(approvalAsk({ ...task, input: { ...task.input, founderAsk: 'Lancer une campagne TikTok à 40,00 €/jour pour « Chiot »', founderPhase: 'before' } }, [])).toBe('Lancer une campagne TikTok à 40,00 €/jour pour « Chiot »');
  });
  it('falls back to the feed line, then to the title (runs saved before founderAsk)', () => {
    expect(approvalAsk(task, [act({})])).toBe('Rembourser 24,00 € (commande ord_1)');
    expect(approvalAsk(task, [act({ refs: { taskId: 'tsk_other' } })])).toBe('Lancer la campagne');
    expect(approvalAsk(undefined, [])).toBeNull();
  });
});

describe('quality gates on a task card', () => {
  const task = (o: Partial<Task>): Task => ({ ...mockSnapshot().company.tasks[0]!, ...o });
  it('reads the Red Team verdict and rework cycle', () => {
    expect(redTeamView(task({ kind: 'red_team', input: { cycle: 2 }, output: { finalVerdict: 'fix' } }))).toEqual({ verdict: 'À corriger', cycle: 2 });
    expect(redTeamView(task({ kind: 'red_team', input: {}, output: null }))).toEqual({ verdict: null, cycle: 0 });
    expect(redTeamView(task({ kind: 'write_pdf' }))).toBeNull();
  });
  it('finds a waiver in the full and in the live snapshot', () => {
    expect(hasWaiver(task({ output: { waiver: { day: 3 } }, log: [], reviews: [] }))).toBe(true);
    expect(hasWaiver(task({ output: {}, log: ['Jour 3 : dérogation de Camille — prix'], reviews: [] }))).toBe(true);
    expect(hasWaiver(task({ output: {}, log: [], reviews: [{ by: 'nora', day: 3, verdict: 'approve', notes: ['Dérogation après 3 tentatives'] }] }))).toBe(true);
    expect(hasWaiver(task({ output: { verdict: 'go' }, log: ['Jour 3 : ok'], reviews: [] }))).toBe(false);
  });
});

describe('ledgerView — payment reserves are neither a cost nor an income', () => {
  const e = (id: number, o: Partial<LedgerEntry>): LedgerEntry => ({ id: `led_${id}`, day: 1, type: 'platform_fee', amount: 0, memo: '', ref: null, ...o });
  const capital = e(0, { type: 'capital', amount: 2000 });
  const fee = e(1, { amount: -12.61, ref: 'fixed:3' });
  const sale = e(2, { type: 'revenue', amount: 100 });
  const hold = e(3, { amount: -1374.3, ref: 'hold:evt_1' });
  const release = e(4, { amount: 1374.3, ref: 'hold:release:46' });

  it('an active reserve has its own amount, platform fees stay what they are', () => {
    const v = ledgerView([capital, fee, sale, hold]);
    expect(v.byType).toEqual([['revenue', 100], ['platform_fee', -12.61]]);
    expect(v.reserve).toBe(1374.3);
    expect(v.total).toBe(87.39);
    expect(v.complete).toBe(true);
  });
  it('a released reserve leaves nothing', () => {
    expect(ledgerView([capital, fee, hold, sale, release])).toMatchObject({ reserve: 0, total: 87.39 });
  });
  it('a release whose hold left the list is not an income', () => {
    const v = ledgerView([fee, sale, release]);
    expect(v.byType).toEqual([['revenue', 100], ['platform_fee', -12.61]]);
    expect(v.reserve).toBe(0);
    expect(v.complete).toBe(false); // the list no longer starts at the capital
  });
  it('a second hold after a release still shows', () => {
    expect(ledgerView([hold, release, e(5, { amount: -50, ref: 'hold:evt_2' })]).reserve).toBe(50);
  });
  it('an empty ledger is whole', () => {
    expect(ledgerView([])).toEqual({ byType: [], reserve: 0, total: 0, complete: true });
  });
});

describe('brain notes among the files of a run', () => {
  it('recognises a note and gives its vault path', () => {
    expect(brainNotePath('r1', 'brain/journal/jour-029.md')).toBe('journal/jour-029.md');
    expect(brainNotePath('r1', 'runs/r1/brain/niches/tendances.md')).toBe('niches/tendances.md');
    expect(brainNotePath('r1', 'brain\\finance\\pnl-semaine-001.md')).toBe('finance/pnl-semaine-001.md');
  });
  it('leaves generated files alone', () => {
    expect(brainNotePath('r1', 'files/prd_1/v2/guide.pdf')).toBeNull();
    expect(brainNotePath('r1', 'files/brain/guide.md')).toBeNull();
    expect(brainNotePath('r1', null)).toBeNull();
    expect(fileUrl('r1', 'runs/r1/files/a b.pdf')).toBe('/runs/r1/files/a%20b.pdf');
  });
});

describe('store — what comes between two snapshots', () => {
  it('a tick merges what moved for the agents, by id', () => {
    const s = snap();
    const [first, second] = s.company.agents;
    const finance = { ...s.finance, cash: 1 };
    const next = withTick(s, { day: 11, tick: 2, phase: 'work', finance, agents: [{ id: first!.id, status: 'coffee', place: 'cafe', currentTaskId: null, energy: 12, bubble: 'Pause' }, { id: 'inconnu', status: 'idle', place: 'cafe', currentTaskId: null, energy: 1, bubble: null }] });
    expect(next).toMatchObject({ day: 11, tick: 2, phase: 'work', finance: { cash: 1 } });
    expect(next.company.agents).toHaveLength(s.company.agents.length);
    expect(next.company.agents[0]).toMatchObject({ id: first!.id, name: first!.name, status: 'coffee', energy: 12, bubble: 'Pause' });
    expect(next.company.agents[1]).toBe(second);
  });
  it('a tick without agents (older server) keeps them', () => {
    const s = snap();
    expect(withTick(s, { day: 11, tick: 2, phase: 'work', finance: s.finance }).company).toBe(s.company);
  });
  it('the stream carries no playbooks: the panel keeps what this run already gave it, and never another run\'s', () => {
    const full = snap();
    const rules = { agent: ['Une règle apprise'] };
    const prev = { ...full, company: { ...full.company, playbooks: rules } };
    const stream = { ...full, company: { ...full.company, playbooks: {} } };
    expect(withPlaybooks(stream, prev, true).company.playbooks).toBe(rules);
    expect(withPlaybooks(stream, prev, false)).toBe(stream);
    expect(withPlaybooks(stream, null, true)).toBe(stream);
    expect(withPlaybooks(prev, stream, true)).toBe(prev); // a full snapshot speaks for itself
  });
  it('hidden truth never survives a run switch', () => {
    const god = { niches: [], intents: { msg_1: 'troll' as const } };
    const plain = snap();
    const { godMode: _none, ...noGod } = plain;
    expect(godDataAfter(god, noGod, true)).toBe(god);
    expect(godDataAfter(god, noGod, false)).toBeNull();
    const fresh = { niches: [], intents: {} };
    expect(godDataAfter(god, { ...noGod, godMode: fresh }, false)).toBe(fresh);
  });
});

describe('customerLabel — inbox shows names, not ids', () => {
  it('prefers customerName and falls back to the id', () => {
    expect(customerLabel({ customerId: 'cus_12', customerName: 'Sophie L.' })).toBe('Sophie L.');
    expect(customerLabel({ customerId: 'cus_12', customerName: '  ' })).toBe('Client cus_12');
    expect(customerLabel({ customerId: 'cus_12' })).toBe('Client cus_12');
  });
});

describe('nextStepTitle — « La suite est ici » printed once', () => {
  it('strips the prefix the minds already put in the title', () => {
    expect(nextStepTitle('La suite est ici : aller plus loin')).toBe('aller plus loin');
    expect(nextStepTitle('La suite est ici : « Siestes faciles »')).toBe('Siestes faciles');
    expect(nextStepTitle('la suite est ici — Le guide des siestes')).toBe('Le guide des siestes');
    expect(nextStepTitle('La suite est ici : La suite est ici : x')).toBe('x');
  });
  it('returns an empty string when only the prefix is left', () => {
    expect(nextStepTitle('La suite est ici')).toBe('');
    expect(nextStepTitle('La suite est ici :')).toBe('');
    expect(nextStepTitle(undefined)).toBe('');
  });
  it('keeps other titles untouched', () => {
    expect(nextStepTitle('Siestes faciles : le guide')).toBe('Siestes faciles : le guide');
  });
});

describe('activityProductId — feed lines link to the product', () => {
  const ev = (o: Partial<WorldEvent>): WorldEvent => ({ id: 'e', day: 5, kind: 'ad_rejected', title: 'Pub refusée', description: 'd', severity: 'danger', ...o });
  const act = (o: Partial<Activity>): Activity => ({ id: 'a', day: 5, tick: 10, at: 0, agentId: null, kind: 'event', text: 'Pub refusée — promesse trop forte', ...o });

  it('uses the activity refs first', () => {
    expect(activityProductId(act({ kind: 'ad', refs: { productId: 'prd_9' } }), [])).toBe('prd_9');
  });
  it('maps an event line to the world event it announces (refs.productId)', () => {
    const events = [ev({ id: 'e1', refs: { productId: 'prd_1' } }), ev({ id: 'e2', title: 'Hausse du CPM' })];
    expect(activityProductId(act({}), events)).toBe('prd_1');
    expect(activityProductId(act({ text: 'Hausse du CPM — +30 %' }), events)).toBeNull();
    expect(activityProductId(act({ day: 9 }), events)).toBeNull(); // another day's event
    expect(activityProductId(act({ kind: 'thought' }), events)).toBeNull();
  });
  it('event toasts carry the « Voir le produit » action when given one', () => {
    const run = () => undefined;
    expect(eventToast(ev({ refs: { productId: 'prd_1' } }), { label: 'Voir le produit', run }).action?.label).toBe('Voir le produit');
    expect(eventToast(ev({})).action).toBeUndefined();
  });
});

describe('budgetView — CFO envelope of the day', () => {
  it('reads company.budget', () => {
    const s = snap();
    const b = budgetView({ ...s, day: 10, company: { ...s.company, budget: { day: 10, adCap: 25, survival: true, note: ' Trésorerie basse ' } } });
    expect(b).toEqual({ adCap: 25, survival: true, note: 'Trésorerie basse', day: 10, stale: false });
  });
  it('flags an envelope from an earlier day and tolerates its absence', () => {
    const s = snap();
    expect(budgetView({ ...s, day: 11, company: { ...s.company, budget: { day: 10, adCap: 0, survival: false, note: '' } } })?.stale).toBe(true);
    expect(budgetView({ ...s, company: { ...s.company, budget: null } })).toBeNull();
    expect(budgetView(null)).toBeNull();
  });
  it('falls back to the last done budget_review task (runs saved before company.budget existed)', () => {
    const s = snap();
    const { budget: _b, ...company } = s.company;
    const review = { ...s.company.tasks[0]!, id: 'tsk_b', kind: 'budget_review' as const, status: 'done' as const, dayDone: 9, output: { adCap: 18.4, survival: true, cash: 120 } };
    const v = budgetView({ ...s, day: 10, company: { ...company, tasks: [...s.company.tasks, review] } });
    expect(v).toMatchObject({ adCap: 18.4, survival: true, day: 9, stale: true });
    expect(budgetView({ ...s, company: { ...company, tasks: [] } })).toBeNull();
  });
});
