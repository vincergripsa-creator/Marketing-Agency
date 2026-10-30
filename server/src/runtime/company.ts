/**
 * The autonomous company: one `step()` = one tick of the day.
 *   tick 0      morning   stand-up: CFO budget → CEO plan → missions → chiefs delegate
 *   ticks 1-9   work      reviews, assignment, brain reads, work, handlers (real deliverables)
 *   tick 10     market    sim.tickMarket (ads, sales, refunds, inbox, events)
 *   tick 11     evening   retro (lessons → playbooks → brain), weekly HR review, status checks
 */
import type {
  AgentId, AgentState, ChatMessage, DailyKpi, DayPhase, Mission, Task, TaskKind, WorldEvent, WorldState,
} from '../shared.js';
import { TICKS_PER_DAY } from '../shared.js';
import type {
  BrainVault, CompanyApi, CompanyOptions, ContentEngine, DayPlan, DayPlanItem, MarketTools, MindContext, RunPaths, Rng, StepResult,
} from '../contracts.js';
import { createRng, emit, nextId } from '../core/index.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, productOf } from './ctx.js';
import { learning, sim } from './modules.js';
import { HANDLERS, type HandlerOutcome } from './handlers/index.js';
import { reviewTask, MAX_ATTEMPTS } from './review.js';
import {
  agentById, assignReady, chiefOf, closeMissions, createTask, depState, isFeminine, isOpen, KIND_META, logTask, openTasks, PLAN_KINDS, productIdOf, taskById,
} from './tasks.js';
import { buildHeuristicPlan, keywordMission, materialize, mergePlans, normalizeItem, prepareFounderItem } from './strategy.js';
import { activeCampaigns, currentBudget } from './metrics.js';
import { dec, errorText, eur, idNum, round2, short } from './util.js';
import { FORMAT_LABELS as FORMAT_NAMES, HOOK_LABELS as HOOK_NAMES } from './handlers/phrases.js';

const MAX_CONCURRENT_CLAUDE = 6;

export function phaseOf(tick: number): DayPhase {
  if (tick <= 0) return 'morning';
  if (tick <= 9) return 'work';
  if (tick === 10) return 'market';
  return 'evening';
}

interface ReadyWork { task: Task; agent: AgentState }

type Usage = ReturnType<ContentEngine['usage']>;

function safeUsage(engine: ContentEngine): Usage | null {
  try {
    const u = engine.usage();
    return { calls: u.calls || 0, inputTokens: u.inputTokens || 0, outputTokens: u.outputTokens || 0, costEur: u.costEur || 0, fallbacks: u.fallbacks || 0 };
  } catch {
    return null;
  }
}

export class Company implements CompanyApi {
  readonly world: WorldState;
  private readonly engine: ContentEngine;
  private readonly brain: BrainVault;
  private readonly paths: RunPaths;
  private readonly rng: Rng;
  private readonly tools: MarketTools;
  private readonly ctx: RuntimeCtx;
  private initPromise: Promise<void> | null = null;
  private readonly minds = new Map<string, MindContext>();
  private readonly brainRead = new Set<string>();
  private readonly idleTicks = new Map<AgentId, number>();
  private readonly recalled = new Map<AgentId, Set<string>>();
  private stepLock: Promise<unknown> = Promise.resolve();
  /** Usage already persisted in world.mind when this Company was mounted (a resumed run keeps counting from it). */
  private readonly mindBase: Usage;
  /** Engine counters when this Company was mounted (the engine may be shared or already used). */
  private readonly engineZero: Usage;
  /** Engine cost (EUR, since mount) already booked in the ledger as 'compute'. */
  private bookedCompute = 0;

  constructor(world: WorldState, opts: CompanyOptions) {
    this.world = world;
    this.engine = opts.engine;
    this.brain = opts.brain;
    this.paths = opts.paths;
    this.rng = createRng(world.rngState);
    this.tools = sim.createMarketTools(world, this.rng);
    this.ctx = { world, engine: this.engine, brain: this.brain, tools: this.tools, rng: this.rng, paths: this.paths, incidents: [], lastMarketNotes: [] };
    const m = (world.mind ?? {}) as Partial<Usage>;
    this.mindBase = { calls: m.calls || 0, inputTokens: m.inputTokens || 0, outputTokens: m.outputTokens || 0, costEur: m.costEur || 0, fallbacks: m.fallbacks || 0 };
    this.engineZero = safeUsage(this.engine) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 };
    world.mind = { mode: this.engine.mode, ...this.mindBase };
    // Tasks interrupted by a reload start their brain read again; nothing else is kept in memory.
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** Serialized: a second call (e.g. a manual "step" while the play loop runs) waits for the current tick. */
  step(): Promise<StepResult> {
    const run = this.stepLock.then(() => this.stepNow());
    this.stepLock = run.catch(() => undefined);
    return run;
  }

  private async stepNow(): Promise<StepResult> {
    await this.ready();
    const w = this.world;
    const counterBefore = w.idCounter;
    const day = w.day;
    const tick = w.tick;
    const phase = phaseOf(tick);
    if (w.status === 'finished') return { day, tick, phase, status: w.status, activities: 0 };
    w.phase = phase;
    try {
      if (tick === 0) await this.morning();
      else if (tick <= 9) await this.workTick();
      else if (tick === 10) await this.marketClose();
      else await this.evening();
      this.rehomeMissions(counterBefore);
    } finally {
      this.syncMind();
      w.rngState = this.rng.state();
    }
    const activities = w.activity.filter((a) => idNum(a.id) > counterBefore).length;
    this.advance();
    return { day, tick, phase, status: w.status, activities };
  }

  async runDays(days: number, onDay?: (kpi: DailyKpi) => void): Promise<void> {
    const n = Math.max(0, Math.floor(days));
    for (let i = 0; i < n; i++) {
      if (this.world.status === 'finished') break;
      const startDay = this.world.day;
      let guard = 0;
      do {
        await this.step();
        guard++;
      } while (this.world.day === startDay && !this.finished() && guard < TICKS_PER_DAY * 2);
      const kpi = this.world.company.kpis.find((k) => k.day === startDay) ?? learning.computeDailyKpi(this.world, startDay);
      if (onDay) {
        try { onDay(kpi); } catch { /* a broken callback must not stop the company */ }
      }
    }
  }

  async giveMission(text: string, agentId?: AgentId): Promise<string> {
    await this.ready();
    const w = this.world;
    const clean = String(text ?? '').trim() || 'Faire le point sur la situation';
    const target = agentById(w, agentId);
    const ceo = agentById(w, 'camille')!;
    emit(w, { agentId: target?.id ?? ceo.id, kind: 'founder', text: `Mission du fondateur${target ? ` pour ${target.name}` : ''} : « ${short(clean, 120)} »` });
    let items: DayPlanItem[] = [];
    try {
      const raw = await this.engine.interpretMission({ text: clean, allowedKinds: target ? target.taskKinds.filter((k) => PLAN_KINDS.includes(k)) : PLAN_KINDS }, await this.mindFor(target ?? ceo, target?.taskKinds[0] ?? 'plan_day', clean));
      items = (Array.isArray(raw) ? raw : []).map((it) => normalizeItem(this.ctx, it)).filter((it): it is DayPlanItem => !!it);
    } catch {
      items = [];
    }
    if (!items.length) items = keywordMission(this.ctx, clean);
    items = items.slice(0, 5).map((it) => prepareFounderItem(this.ctx, it));
    const owner = target ? (target.isChief ? target : chiefOf(w, target.dept) ?? ceo) : chiefOf(w, items[0]?.dept ?? 'direction') ?? ceo;
    const mission: Mission = { id: nextId(w, 'mis'), day: w.day, from: 'founder', text: clean, ownerId: owner.id, taskIds: [], status: 'open' };
    w.company.missions.push(mission);
    const assignee = target && items.every((it) => target.taskKinds.includes(it.kind)) ? target.id : null;
    const created = materialize(this.ctx, items, { createdBy: 'founder', missionId: mission.id, priority: 1, assignee });
    for (const t of created) if (t.missionId !== mission.id) { t.missionId = mission.id; if (!mission.taskIds.includes(t.id)) mission.taskIds.push(t.id); }
    if (!created.length) {
      mission.status = 'done';
      emit(w, { agentId: ceo.id, kind: 'thought', text: `Camille : c'est déjà en cours, aucune nouvelle tâche nécessaire pour « ${short(clean, 60)} »` });
    } else {
      if (owner.id !== ceo.id) emit(w, { agentId: ceo.id, toAgentId: owner.id, kind: 'delegate', text: `Camille confie la mission du fondateur à ${owner.name} (${created.length} tâche(s))` });
      emit(w, { agentId: owner.id, kind: 'thought', text: `${owner.name} : « ${short(created.map((t) => t.title).join(', '), 120)} » — on s'y met en priorité.` });
      assignReady(w);
    }
    this.syncMind();
    return mission.id;
  }

  async chat(agentId: AgentId, text: string): Promise<string> {
    await this.ready();
    const w = this.world;
    const agent = agentById(w, agentId);
    if (!agent) throw Object.assign(new Error(`Agent inconnu : ${agentId}`), { status: 404 });
    const clean = String(text ?? '').trim();
    const history = (w.company.chats[agentId] ??= []);
    const situation = this.situationFor(agent);
    let reply = '';
    try {
      const mind = await this.mindFor(agent, agent.taskKinds[0] ?? 'plan_day', clean);
      reply = String(await this.engine.chat({
        history: history.slice(-12).map((m) => ({ from: m.from === 'founder' ? 'Fondateur' : agent.name, text: m.text })),
        text: clean, situation,
      }, mind)).trim();
    } catch {
      reply = '';
    }
    if (!reply) {
      const task = taskById(w, agent.currentTaskId ?? '');
      reply = `Bonjour ! Ici ${agent.name} (${agent.role}). ${task ? `Je suis sur « ${task.title} ».` : 'Je suis disponible.'} Je note votre message et j'en parle au prochain stand-up.`;
    }
    const at = Date.now();
    const mine: ChatMessage = { id: nextId(w, 'msg'), day: w.day, from: 'founder', text: clean, at };
    const theirs: ChatMessage = { id: nextId(w, 'msg'), day: w.day, from: agent.id, text: reply, at: at + 1 };
    history.push(mine, theirs);
    if (history.length > 80) history.splice(0, history.length - 80);
    emit(w, { agentId: agent.id, kind: 'chat', text: `${agent.name} répond au fondateur : « ${short(reply, 90)} »` });
    this.syncMind();
    return reply;
  }

  approve(taskId: string, approved: boolean): void {
    const w = this.world;
    const task = taskById(w, taskId);
    const i = w.company.pendingApprovals.indexOf(taskId);
    if (i >= 0) w.company.pendingApprovals.splice(i, 1);
    if (!task || task.status !== 'awaiting_founder') return;
    if (approved) {
      task.input = { ...task.input, founderApproved: true };
      task.status = 'pending';
      task.workLeft = 0;
      logTask(task, `Jour ${w.day} : approuvée par le fondateur.`);
      emit(w, { agentId: task.assignee, kind: 'founder', text: `Le fondateur approuve « ${short(task.title, 70)} »`, refs: { taskId: task.id, productId: productIdOf(task) } });
    } else {
      task.status = 'cancelled';
      task.dayDone = w.day;
      logTask(task, `Jour ${w.day} : refusée par le fondateur.`);
      incident(this.ctx, `Le fondateur a refusé « ${task.title} »`);
      emit(w, { agentId: task.assignee, kind: 'founder', text: `Le fondateur refuse « ${short(task.title, 70)} »`, refs: { taskId: task.id, productId: productIdOf(task) } });
      const a = agentById(w, task.assignee);
      if (a && a.currentTaskId === task.id) { a.currentTaskId = null; a.status = 'idle'; a.bubble = null; }
    }
  }

  // ───────────────────────────── phases ─────────────────────────────

  private async morning(): Promise<void> {
    const w = this.world;
    this.ctx.incidents = [];
    const chiefs = w.company.agents.filter((a) => a.isChief);
    for (const c of chiefs) {
      if (c.place !== 'direction') {
        c.place = 'direction';
        emit(w, { agentId: c.id, kind: 'walk', place: 'direction', text: `${c.name} rejoint le stand-up` });
      }
      c.status = 'meeting';
      c.bubble = 'Stand-up';
    }
    emit(w, { agentId: 'camille', kind: 'meeting', text: `Stand-up du jour ${w.day} : ${chiefs.length} chefs d'équipe autour de Camille` });

    // CFO first: the envelope frames every paid decision of the day.
    await this.runImmediate('budget_review', 'gabriel', 'Revue budgétaire du matin');

    const ceo = agentById(w, 'camille')!;
    const heuristic = await buildHeuristicPlan(this.ctx);
    let plan: DayPlan | null = null;
    try {
      plan = await this.engine.planDay({
        day: w.day,
        finance: sim.financeSnapshot(w),
        kpis: w.company.kpis.slice(-7),
        products: w.company.products,
        openTasks: openTasks(w),
        lessons: w.company.lessons.slice(-8),
        founderMissions: w.company.missions.filter((m) => m.from === 'founder' && m.status === 'open').map((m) => m.text),
        heuristicPlan: heuristic,
      }, await this.mindFor(ceo, 'plan_day', heuristic.focus));
    } catch {
      plan = null;
    }
    const items = mergePlans(this.ctx, heuristic, plan);
    const focus = plan?.focus?.trim() || heuristic.focus;
    const memo = plan?.memo?.trim() || heuristic.memo;
    const planTask = createTask(w, { kind: 'plan_day', title: `Plan du jour ${w.day}`, assignee: ceo.id, createdBy: ceo.id, workLeft: 0, reviewer: null });
    planTask.status = 'done';
    planTask.dayDone = w.day;
    planTask.progress = 1;
    planTask.output = { focus, memo, items: items.map((i) => ({ kind: i.kind, title: i.title, why: i.why, priority: i.priority })) };
    logTask(planTask, memo);
    emit(w, { agentId: ceo.id, kind: 'thought', text: `Cap du jour : ${focus}`, refs: { taskId: planTask.id } });

    const created = materialize(this.ctx, items, { createdBy: ceo.id, missionId: null });
    this.attachMissions(created, ceo.id);
    assignReady(w);
  }

  private async workTick(): Promise<void> {
    const w = this.world;
    if (w.tick === 1) {
      for (const a of w.company.agents) {
        if (a.status !== 'meeting') continue;
        a.status = 'idle';
        a.bubble = null;
        if (a.place !== a.dept) {
          a.place = a.dept;
          emit(w, { agentId: a.id, kind: 'walk', place: a.dept, text: `${a.name} retourne sur son île` });
        }
      }
    }
    this.cascadeCancel();
    const reviewing = new Set<AgentId>();
    await this.processReviews(reviewing);
    assignReady(w);

    const ready: ReadyWork[] = [];
    for (const agent of w.company.agents) {
      if (reviewing.has(agent.id)) continue;
      const task = this.pickTask(agent);
      if (!task) { this.idle(agent); continue; }
      this.idleTicks.set(agent.id, 0);
      if (agent.energy <= 12 && task.workLeft > 0) {
        this.coffee(agent, `${agent.name} est à plat : pause café avant de reprendre « ${short(task.title, 40)} »`);
        continue;
      }
      if (task.status !== 'in_progress') {
        const resumed = task.progress > 0 || task.attempts > 0;
        task.status = 'in_progress';
        emit(w, { agentId: agent.id, kind: 'task_start', text: `${agent.name} ${resumed ? 'reprend' : 'commence'} « ${short(task.title, 70)} »`, refs: { taskId: task.id, productId: productIdOf(task) } });
      }
      agent.currentTaskId = task.id;
      if (!this.brainRead.has(task.id)) await this.consultBrain(agent, task);
      if (agent.place !== agent.dept) {
        agent.place = agent.dept;
        emit(w, { agentId: agent.id, kind: 'walk', place: agent.dept, text: `${agent.name} file à son bureau` });
      }
      agent.status = 'working';
      agent.bubble = KIND_META[task.kind].bubble;
      if (task.workLeft > 0) {
        task.progress = Math.min(0.95, task.progress + (1 - task.progress) / task.workLeft);
        task.workLeft -= 1;
        agent.energy = Math.max(0, agent.energy - 8);
      }
      if (task.workLeft <= 0) ready.push({ task, agent });
    }
    await this.runHandlers(ready);
  }

  private async marketClose(): Promise<void> {
    const w = this.world;
    for (const a of w.company.agents) {
      if (a.status === 'working' || a.status === 'reviewing') { a.status = 'idle'; a.bubble = null; }
    }
    const before = w.idCounter;
    const res = sim.tickMarket(w, this.rng);
    this.ctx.lastMarketNotes = Array.isArray(res.notes) ? res.notes.slice(0, 12) : [];
    // The market narrates its own events/messages: only add what it did not already say.
    const said = w.activity.filter((a) => idNum(a.id) > before);
    const saidKinds = new Set(said.map((a) => a.kind));
    const saidText = said.map((a) => a.text).join('\n');
    emit(w, {
      agentId: 'raphael', kind: 'sale',
      text: res.sales > 0
        ? `Clôture du marché : ${res.sales} vente(s), ${eur(res.revenue)} encaissés, ${eur(res.adSpend)} de pub`
        : `Clôture du marché : aucune vente aujourd'hui${res.adSpend > 0 ? ` (${eur(res.adSpend)} de pub dépensés)` : ''}`,
    });
    if (res.refunds > 0 && !saidKinds.has('refund')) emit(w, { agentId: 'alice', kind: 'refund', text: `${res.refunds} remboursement(s) enregistré(s) au grand livre` });
    if (res.newMessages > 0 && !saidKinds.has('message')) emit(w, { agentId: 'ines', kind: 'message', text: `${res.newMessages} nouveau(x) message(s) dans la boîte mail` });
    for (const id of res.events ?? []) {
      const ev = w.market.events.find((e) => e.id === id);
      if (!ev) continue;
      if (!saidText.includes(ev.title)) emit(w, { agentId: null, kind: 'event', text: `${ev.title} — ${short(ev.description, 140)}` });
      if (ev.severity === 'warn' || ev.severity === 'danger') incident(this.ctx, `${ev.title} : ${ev.description}`);
    }
    for (const n of this.ctx.lastMarketNotes.filter((x) => !saidText.includes(x)).slice(0, 2)) emit(w, { agentId: 'raphael', kind: 'thought', text: `Raphaël note : ${n}` });
  }

  private async evening(): Promise<void> {
    const w = this.world;
    const nora = agentById(w, 'nora');
    if (nora) { nora.status = 'meeting'; nora.place = nora.dept; nora.bubble = 'Rétro du soir'; }
    emit(w, { agentId: 'nora', kind: 'meeting', text: `Rétro du soir (jour ${w.day}) : ${this.ctx.incidents.length} incident(s) à analyser` });
    await this.runImmediate('retro', 'nora', `Rétro du jour ${w.day}`);
    if (!w.company.kpis.some((k) => k.day === w.day)) {
      const kpi = learning.computeDailyKpi(w, w.day);
      w.company.kpis.push(kpi);
      w.company.kpis.sort((a, b) => a.day - b.day);
    }
    if (w.day % 7 === 0) await this.runImmediate('performance_review', 'nora', `Revue RH de la semaine ${Math.ceil(w.day / 7)}`);
    const closed = closeMissions(w);
    if (closed.length) emit(w, { agentId: 'hugo', kind: 'thought', text: `Hugo : ${closed.length} mission(s) bouclée(s) aujourd'hui` });
    this.checkStatus();
    // Forget the cached minds of finished tasks (they are rebuilt on demand anyway).
    for (const id of [...this.minds.keys()]) {
      const t = taskById(w, id);
      if (!t || !isOpen(t)) { this.minds.delete(id); this.brainRead.delete(id); }
    }
    for (const a of w.company.agents) {
      a.energy = Math.min(100, a.energy + 45);
      if (a.status !== 'blocked') a.status = 'idle';
      a.place = a.dept;
      a.bubble = null;
    }
  }

  // ───────────────────────────── work mechanics ─────────────────────────────

  private pickTask(agent: AgentState): Task | null {
    const w = this.world;
    const current = agent.currentTaskId ? taskById(w, agent.currentTaskId) : undefined;
    if (current && current.status === 'in_progress' && current.assignee === agent.id) return current;
    if (current && current.status !== 'in_progress') agent.currentTaskId = null;
    const mine = w.company.tasks
      .filter((t) => t.assignee === agent.id && (t.status === 'pending' || t.status === 'in_progress') && depState(w, t) === 'ready')
      .sort((a, b) => (a.status === 'in_progress' ? -1 : 0) - (b.status === 'in_progress' ? -1 : 0) || a.priority - b.priority || idNum(a.id) - idNum(b.id));
    return mine[0] ?? null;
  }

  private idle(agent: AgentState): void {
    const w = this.world;
    agent.currentTaskId = null;
    if (agent.status === 'coffee') {
      agent.energy = Math.min(100, agent.energy + 25);
      if (agent.energy >= 90) {
        agent.status = 'idle';
        agent.bubble = null;
        agent.place = agent.dept;
        emit(w, { agentId: agent.id, kind: 'walk', place: agent.dept, text: `${agent.name} revient du café, rechargé${isFeminine(agent.id) ? 'e' : ''}` });
      }
      return;
    }
    if (agent.energy < 60) { this.coffee(agent, `${agent.name} prend un café (énergie ${Math.round(agent.energy)} %)`); return; }
    const n = (this.idleTicks.get(agent.id) ?? 0) + 1;
    this.idleTicks.set(agent.id, n);
    agent.energy = Math.min(100, agent.energy + 2);
    if (agent.status !== 'idle') agent.status = 'idle';
    agent.bubble = null;
    if (n >= 6 && this.rng.chance(0.04)) {
      this.coffee(agent, `${agent.name} passe à la cafétéria discuter avec l'équipe`);
      this.idleTicks.set(agent.id, 0);
    } else if (agent.place !== agent.dept && agent.place !== 'cafe') {
      agent.place = agent.dept;
      emit(w, { agentId: agent.id, kind: 'walk', place: agent.dept, text: `${agent.name} retourne à son bureau` });
    }
  }

  private coffee(agent: AgentState, text: string): void {
    const w = this.world;
    if (agent.place !== 'cafe') emit(w, { agentId: agent.id, kind: 'walk', place: 'cafe', text: `${agent.name} file à la cafétéria` });
    agent.place = 'cafe';
    if (agent.status !== 'coffee') emit(w, { agentId: agent.id, kind: 'coffee', text, place: 'cafe' });
    agent.status = 'coffee';
    agent.bubble = 'Pause café';
    agent.energy = Math.min(100, agent.energy + 25);
  }

  private async consultBrain(agent: AgentState, task: Task): Promise<void> {
    const w = this.world;
    const mind = await this.mindFor(agent, task.kind, this.taskQuery(task));
    this.minds.set(task.id, mind);
    this.brainRead.add(task.id);
    emit(w, { agentId: agent.id, kind: 'walk', place: 'cerveau', text: `${agent.name} va consulter le Cerveau` });
    const titles = [...new Set(mind.brainNotes.map((n) => n.title).filter(Boolean))].slice(0, 3);
    emit(w, {
      agentId: agent.id, kind: 'brain_read', place: 'cerveau',
      text: titles.length ? `${agent.name} lit le cerveau avant d'agir : ${titles.join(', ')}` : `${agent.name} consulte le cerveau : rien de précis sur ce sujet pour l'instant`,
      refs: { taskId: task.id, productId: productIdOf(task) },
    });
    // Recall a lesson the agent has not just quoted (rotates through what the brain taught them).
    const recalled = mind.lessons.find((l) => !this.recalled.get(agent.id)?.has(l.id));
    if (recalled) {
      const seen = this.recalled.get(agent.id) ?? new Set<string>();
      seen.add(recalled.id);
      if (seen.size > 20) seen.delete(seen.values().next().value!);
      this.recalled.set(agent.id, seen);
      emit(w, { agentId: agent.id, kind: 'thought', text: `${agent.name} retient : « ${short(recalled.insight, 90)} »`, refs: { taskId: task.id } });
    }
    emit(w, { agentId: agent.id, kind: 'walk', place: agent.dept, text: `${agent.name} retourne à son bureau` });
    agent.place = agent.dept;
  }

  private taskQuery(task: Task): string {
    const p = productOf(this.ctx, task.input.productId);
    const niche = typeof task.input.nicheId === 'string' ? this.world.company.research.trends.find((t) => t.nicheId === task.input.nicheId)?.name : undefined;
    return [KIND_META[task.kind].keywords, p?.title ?? '', niche ?? ''].filter(Boolean).join(' ');
  }

  private async mindFor(agent: AgentState, kind: TaskKind, query: string): Promise<MindContext> {
    const w = this.world;
    let brainNotes: MindContext['brainNotes'] = [];
    try {
      brainNotes = (await this.brain.search(`${KIND_META[kind].keywords} ${query}`.trim(), 4)).map((r) => ({ path: r.path, title: r.title, excerpt: r.excerpt }));
    } catch {
      brainNotes = [];
    }
    const topics = KIND_META[kind].topics;
    const lessons = w.company.lessons
      .filter((l) => topics.includes(l.topic) || l.appliesTo.includes(agent.id))
      .sort((a, b) => b.day - a.day || b.confidence - a.confidence)
      .slice(0, 6);
    return { agent, playbook: [...(w.company.playbooks[agent.id] ?? [])], brainNotes, lessons, day: w.day, brand: w.scenario.companyName || w.company.name };
  }

  private async runHandlers(ready: ReadyWork[]): Promise<void> {
    if (!ready.length) return;
    if (this.engine.mode === 'claude') {
      for (let i = 0; i < ready.length; i += MAX_CONCURRENT_CLAUDE) {
        await Promise.all(ready.slice(i, i + MAX_CONCURRENT_CLAUDE).map((r) => this.runHandler(r.task, r.agent)));
      }
    } else {
      for (const r of ready) await this.runHandler(r.task, r.agent);
    }
  }

  private async runHandler(task: Task, agent: AgentState): Promise<void> {
    const w = this.world;
    const spec = HANDLERS[task.kind];
    if (!spec) { this.failTask(task, agent, 'aucun savoir-faire pour ce type de tâche'); return; }
    const cached = this.minds.get(task.id);
    const mind: MindContext = cached
      ? { ...cached, agent, playbook: [...(w.company.playbooks[agent.id] ?? [])], day: w.day, brand: w.scenario.companyName || w.company.name }
      : await this.mindFor(agent, task.kind, this.taskQuery(task));
    let outcome: HandlerOutcome;
    try {
      outcome = await spec.run(this.ctx, task, agent, mind);
    } catch (e) {
      task.attempts += 1;
      logTask(task, `Jour ${w.day} : erreur technique — ${short(errorText(e), 160)}`);
      if (task.attempts >= MAX_ATTEMPTS) { this.failTask(task, agent, `erreur technique répétée (${short(errorText(e), 80)})`); return; }
      task.status = 'pending';
      task.workLeft = 1;
      this.release(agent);
      emit(w, { agentId: agent.id, kind: 'thought', text: `${agent.name} bute sur un problème technique, nouvel essai au prochain créneau`, refs: { taskId: task.id } });
      return;
    }
    await this.applyOutcome(task, agent, outcome);
  }

  private async applyOutcome(task: Task, agent: AgentState, outcome: HandlerOutcome): Promise<void> {
    const w = this.world;
    if (outcome.fail) { this.failTask(task, agent, outcome.fail); return; }
    if (outcome.awaitFounder) {
      this.awaitFounder(task, agent, outcome.awaitFounder, 'before');
      return;
    }
    if (outcome.retryLater) {
      task.attempts += 1;
      for (const d of outcome.dependsOn ?? []) if (!task.dependsOn.includes(d)) task.dependsOn.push(d);
      logTask(task, `Jour ${w.day} : reportée — ${outcome.retryLater}`);
      if (task.attempts > 6) { this.failTask(task, agent, outcome.retryLater); return; }
      task.status = 'pending';
      task.workLeft = 1;
      this.release(agent);
      return;
    }
    task.output = { ...(task.output ?? {}), ...(outcome.output ?? {}) };
    logTask(task, `Jour ${w.day} : ${outcome.summary}`);
    this.release(agent);
    agent.xp += 6;
    const founderGate = task.kind === 'publish_product' && w.scenario.founderApproval && task.input.founderApproved !== true;
    if (founderGate) { this.awaitFounder(task, agent, `Mettre en ligne « ${task.title} »`, 'after'); return; }
    const reviewer = !outcome.skipReview && !(task.kind === 'publish_product' && task.input.founderApproved === true) ? agentById(w, task.reviewer) : undefined;
    if (reviewer && reviewer.id !== agent.id) {
      task.status = 'review';
      emit(w, { agentId: agent.id, toAgentId: reviewer.id, kind: 'task_done', text: `${agent.name} termine « ${short(task.title, 60)} » → relecture par ${reviewer.name}`, refs: { taskId: task.id, productId: productIdOf(task) } });
      return;
    }
    await this.finishTask(task);
  }

  private async processReviews(reviewing: Set<AgentId>): Promise<void> {
    const w = this.world;
    const queue = w.company.tasks.filter((t) => t.status === 'review').sort((a, b) => a.priority - b.priority || idNum(a.id) - idNum(b.id));
    const count = new Map<AgentId, number>();
    for (const task of queue) {
      const reviewer = agentById(w, task.reviewer);
      if (!reviewer) { await this.finishTask(task); continue; }
      const n = count.get(reviewer.id) ?? 0;
      if (n >= 3) continue;
      count.set(reviewer.id, n + 1);
      reviewing.add(reviewer.id);
      reviewer.status = 'reviewing';
      reviewer.bubble = `Je relis « ${short(task.title, 30)} »`;
      let res;
      try {
        res = await reviewTask(this.ctx, task, reviewer);
      } catch (e) {
        res = { verdict: 'approve' as const, notes: [`Relecture impossible (${short(errorText(e), 60)}) : validé par défaut.`], score: null };
      }
      if (res.verdict === 'changes' && task.attempts + 1 >= MAX_ATTEMPTS) {
        res = { verdict: 'approve' as const, notes: [...res.notes, `Validé après ${MAX_ATTEMPTS} tentatives : les défauts restants iront dans la prochaine version.`], score: res.score };
        incident(this.ctx, `« ${task.title} » validé après ${MAX_ATTEMPTS} tentatives sans atteindre le niveau attendu${res.score !== null ? ` (${res.score}/100)` : ''} : ${res.notes[0] ?? ''}`);
      }
      task.reviews.push({ by: reviewer.id, day: w.day, verdict: res.verdict, notes: res.notes });
      const assignee = agentById(w, task.assignee);
      const score = res.score !== null ? ` (${Math.round(res.score)}/100)` : '';
      if (res.verdict === 'approve') {
        if (assignee) { assignee.perf.approved += 1; if (task.attempts === 0) assignee.xp += 5; this.refreshScore(assignee); }
        emit(w, { agentId: reviewer.id, toAgentId: task.assignee ?? undefined, kind: 'review', text: `${reviewer.name} valide « ${short(task.title, 60)} »${score}`, refs: { taskId: task.id, productId: productIdOf(task) } });
        await this.finishTask(task);
      } else if (res.verdict === 'changes') {
        if (assignee) { assignee.perf.rejected += 1; this.refreshScore(assignee); }
        task.attempts += 1;
        task.status = 'pending';
        task.workLeft = Math.max(1, Math.ceil(KIND_META[task.kind].work / 2));
        task.progress = Math.min(task.progress, 0.5);
        logTask(task, `Jour ${w.day} : à corriger (${reviewer.name}) — ${res.notes.slice(0, 2).join(' ; ')}`);
        emit(w, { agentId: reviewer.id, toAgentId: task.assignee ?? undefined, kind: 'review', text: `${reviewer.name} renvoie « ${short(task.title, 50)} » à ${assignee?.name ?? 'son auteur'}${score} : ${short(res.notes[0] ?? 'à retravailler', 80)}`, refs: { taskId: task.id, productId: productIdOf(task) } });
        if (task.kind === 'publish_product') this.publishRework(task, res.notes);
      } else {
        emit(w, { agentId: reviewer.id, toAgentId: task.assignee ?? undefined, kind: 'review', text: `${reviewer.name} rejette « ${short(task.title, 60)} »${score}`, refs: { taskId: task.id } });
        this.failTask(task, assignee ?? reviewer, `rejetée en relecture : ${res.notes[0] ?? ''}`);
      }
    }
  }

  /** The CEO refused to publish: one more humanization + render that the publish task waits for. */
  private publishRework(task: Task, notes: string[]): void {
    const w = this.world;
    const p = productOf(this.ctx, task.input.productId);
    if (!p) return;
    const human = createTask(w, { kind: 'humanize_pdf', title: `Renforcer le guide avant sortie — « ${short(p.title, 40)} »`, input: { productId: p.id, nicheId: p.nicheId, fixes: notes.slice(0, 3) }, createdBy: 'camille', missionId: task.missionId, priority: 1 });
    const render = createTask(w, { kind: 'render_pdf', title: `Remettre en page — « ${short(p.title, 40)} »`, input: { productId: p.id, nicheId: p.nicheId }, dependsOn: [human.id], createdBy: 'camille', missionId: task.missionId, priority: 1 });
    task.dependsOn.push(render.id);
  }

  private async finishTask(task: Task): Promise<void> {
    const w = this.world;
    task.status = 'done';
    task.dayDone = w.day;
    task.progress = 1;
    task.workLeft = 0;
    const pa = w.company.pendingApprovals.indexOf(task.id);
    if (pa >= 0) w.company.pendingApprovals.splice(pa, 1);
    const agent = agentById(w, task.assignee);
    if (agent) {
      agent.perf.done += 1;
      agent.xp += 10;
      this.refreshScore(agent);
      const level = Math.max(agent.level, 1 + Math.floor(agent.xp / 150));
      if (level > agent.level) {
        agent.level = level;
        emit(w, { agentId: agent.id, kind: 'thought', text: `${agent.name} passe niveau ${level} !` });
      }
      if (agent.currentTaskId === task.id) this.release(agent);
    }
    if (task.kind !== 'plan_day') {
      emit(w, { agentId: task.assignee, kind: 'task_done', text: `${agent?.name ?? 'L’équipe'} a terminé « ${short(task.title, 70)} »`, refs: { taskId: task.id, productId: productIdOf(task) } });
    }
    const spec = HANDLERS[task.kind];
    if (spec?.onDone) {
      try {
        await spec.onDone(this.ctx, task);
      } catch (e) {
        logTask(task, `Jour ${w.day} : suite non exécutée — ${short(errorText(e), 120)}`);
        incident(this.ctx, `Suite de « ${task.title} » en échec : ${short(errorText(e), 100)}`);
      }
    }
  }

  private failTask(task: Task, agent: AgentState | undefined, reason: string): void {
    const w = this.world;
    task.status = 'failed';
    task.dayDone = w.day;
    logTask(task, `Jour ${w.day} : échec — ${reason}`);
    if (agent) { agent.perf.failed += 1; this.refreshScore(agent); this.release(agent); }
    incident(this.ctx, `Échec de « ${task.title} » : ${reason}`);
    emit(w, { agentId: agent?.id ?? null, kind: 'task_failed', text: `${agent?.name ?? 'L’équipe'} échoue sur « ${short(task.title, 60)} » : ${short(reason, 80)}`, refs: { taskId: task.id, productId: productIdOf(task) } });
  }

  private awaitFounder(task: Task, agent: AgentState, what: string, phase: 'before' | 'after'): void {
    const w = this.world;
    task.status = 'awaiting_founder';
    task.input = { ...task.input, founderPhase: phase };
    if (!w.company.pendingApprovals.includes(task.id)) w.company.pendingApprovals.push(task.id);
    logTask(task, `Jour ${w.day} : en attente de l'accord du fondateur.`);
    this.release(agent);
    emit(w, { agentId: agent.id, kind: 'founder', text: `En attente du fondateur : ${short(what, 100)}`, refs: { taskId: task.id, productId: productIdOf(task) } });
  }

  private release(agent: AgentState): void {
    agent.currentTaskId = null;
    agent.status = 'idle';
    agent.bubble = null;
  }

  private refreshScore(a: AgentState): void {
    const q = (a.perf.approved + 1) / (a.perf.approved + a.perf.rejected + 2);
    const r = (a.perf.done + 1) / (a.perf.done + a.perf.failed + 1);
    a.perf.score = Math.round(100 * (0.6 * q + 0.4 * r));
  }

  /** Dependents of failed/cancelled tasks can never run: cancel them (the CEO's watchdog rebuilds chains). */
  private cascadeCancel(): void {
    const w = this.world;
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of w.company.tasks) {
        if (t.status !== 'pending' || depState(w, t) !== 'broken') continue;
        t.status = 'cancelled';
        t.dayDone = w.day;
        logTask(t, `Jour ${w.day} : annulée, une étape préalable a échoué.`);
        changed = true;
      }
    }
  }

  /** Runs a ritual task right now (budget review, retro, HR review) and records it. */
  private async runImmediate(kind: TaskKind, agentId: AgentId, title: string): Promise<void> {
    const w = this.world;
    const agent = agentById(w, agentId) ?? chiefOf(w, KIND_META[kind].dept);
    if (!agent) return;
    const task = createTask(w, { kind, title, assignee: agent.id, createdBy: 'system', reviewer: null, workLeft: 0, priority: 1 });
    task.status = 'in_progress';
    const spec = HANDLERS[kind];
    try {
      const mind = await this.mindFor(agent, kind, title);
      const outcome = await spec.run(this.ctx, task, agent, mind);
      task.output = outcome.output ?? null;
      logTask(task, outcome.summary);
      task.status = outcome.fail ? 'failed' : 'done';
    } catch (e) {
      task.status = 'failed';
      logTask(task, `Erreur : ${short(errorText(e), 160)}`);
      emit(w, { agentId: agent.id, kind: 'thought', text: `${agent.name} n'a pas pu mener « ${title} » (${short(errorText(e), 60)})` });
    }
    task.dayDone = w.day;
    task.progress = 1;
    if (task.status === 'done') { agent.perf.done += 1; agent.xp += 4; }
  }

  // ───────────────────────────── missions, status, compute ─────────────────────────────

  /** One mission per department and per day, owned by the chief; the CEO hands it over at the stand-up. */
  private attachMissions(tasks: Task[], from: AgentId): void {
    const w = this.world;
    const byDept = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.missionId) continue;
      const list = byDept.get(t.dept) ?? [];
      list.push(t);
      byDept.set(t.dept, list);
    }
    for (const [dept, list] of byDept) {
      const mission = this.dayMission(dept as Task['dept'], from, list);
      for (const t of list) {
        t.missionId = mission.id;
        if (!mission.taskIds.includes(t.id)) mission.taskIds.push(t.id);
      }
    }
  }

  private dayMission(dept: Task['dept'], from: AgentId, seed: Task[]): Mission {
    const w = this.world;
    const chief = chiefOf(w, dept) ?? agentById(w, 'camille')!;
    const existing = w.company.missions.find((m) => m.day === w.day && m.from !== 'founder' && m.ownerId === chief.id && m.status === 'open');
    if (existing) return existing;
    const deptName = w.company.departments.find((d) => d.id === dept)?.name ?? dept;
    const titles = [...new Set(seed.map((t) => KIND_META[t.kind].label))];
    const mission: Mission = {
      id: nextId(w, 'mis'), day: w.day, from, ownerId: chief.id, taskIds: [], status: 'open',
      text: `${deptName} : ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` et ${titles.length - 3} autre(s)` : ''}`,
    };
    w.company.missions.push(mission);
    if (chief.id !== from) emit(w, { agentId: from, toAgentId: chief.id, kind: 'delegate', text: `${agentById(w, from)?.name ?? 'Camille'} confie à ${chief.name} la mission « ${short(mission.text, 80)} »` });
    return mission;
  }

  /** Follow-up tasks created during a tick join their own department's mission of the day (founder missions keep theirs). */
  private rehomeMissions(counterBefore: number): void {
    const w = this.world;
    const fresh = w.company.tasks.filter((t) => idNum(t.id) > counterBefore && isOpen(t));
    const toAttach: Task[] = [];
    for (const t of fresh) {
      const m = t.missionId ? w.company.missions.find((x) => x.id === t.missionId) : undefined;
      if (m?.from === 'founder') continue;
      const chief = chiefOf(w, t.dept);
      if (m && chief && m.ownerId === chief.id) continue;
      if (m) m.taskIds = m.taskIds.filter((id) => id !== t.id);
      t.missionId = null;
      toAttach.push(t);
    }
    if (toAttach.length) this.attachMissions(toAttach, 'camille');
  }

  private checkStatus(): void {
    const w = this.world;
    const fin = sim.financeSnapshot(w);
    if (fin.cash < 0) {
      if (w.status !== 'bankrupt') {
        w.status = 'bankrupt';
        this.pushEvent('bankrupt', 'Faillite : trésorerie négative', `La trésorerie est passée à ${eur(fin.cash)}. Plus aucune dépense payante : support, organique et créateurs à la commission uniquement.`, 'danger');
        for (const c of activeCampaigns(w)) {
          try { if (this.tools.updateCampaign(c.id, { status: 'paused' }).ok) c.status = 'paused'; } catch { /* ignore */ }
        }
        emit(w, { agentId: 'gabriel', kind: 'finance', text: `Gabriel : trésorerie à ${eur(fin.cash)}, toutes les pubs sont coupées` });
      }
    } else if (w.status === 'bankrupt') {
      w.status = w.market.events.some((e) => e.kind === 'goal_reached') ? 'goal_reached' : 'running';
      emit(w, { agentId: 'gabriel', kind: 'finance', text: `Gabriel : la trésorerie redevient positive (${eur(fin.cash)})` });
    }
    if (fin.profit >= w.scenario.goal.targetProfit && !w.market.events.some((e) => e.kind === 'goal_reached')) {
      this.pushEvent('goal_reached', 'Objectif atteint !', `${eur(fin.profit)} de profit cumulé au jour ${w.day} (objectif ${eur(w.scenario.goal.targetProfit)}). L'agence continue de tourner.`, 'good');
      if (w.status === 'running') w.status = 'goal_reached';
      emit(w, { agentId: 'camille', kind: 'event', text: `Objectif atteint : ${eur(fin.profit)} de profit cumulé ! On ne s'arrête pas là.` });
    }
    const b = currentBudget(w);
    if (b.survival) emit(w, { agentId: 'gabriel', kind: 'finance', text: `Gabriel : trésorerie ${eur(fin.cash)} (${dec(fin.cash / Math.max(1, w.scenario.startingCash) * 100, 0)} % du départ) — on reste en mode survie` });
  }

  private pushEvent(kind: WorldEvent['kind'], title: string, description: string, severity: WorldEvent['severity']): void {
    const w = this.world;
    const ev: WorldEvent = { id: nextId(w, 'evt'), day: w.day, kind, title, description, severity };
    w.market.events.push(ev);
    emit(w, { agentId: null, kind: 'event', text: `${title} — ${short(description, 140)}` });
  }

  /**
   * world.mind = what the run had already used when mounted + what the engine used since (cumulative across
   * resumes). With scenario.chargeCompute, every new engine cost since the last sync is booked as 'compute'.
   */
  private syncMind(): void {
    const w = this.world;
    const u = safeUsage(this.engine);
    if (!u) return;
    const z = this.engineZero;
    const b = this.mindBase;
    const spent = Math.max(0, u.costEur - z.costEur);
    w.mind = {
      mode: this.engine.mode,
      calls: b.calls + Math.max(0, u.calls - z.calls),
      inputTokens: b.inputTokens + Math.max(0, u.inputTokens - z.inputTokens),
      outputTokens: b.outputTokens + Math.max(0, u.outputTokens - z.outputTokens),
      costEur: round2(b.costEur + spent),
      fallbacks: b.fallbacks + Math.max(0, u.fallbacks - z.fallbacks),
    };
    if (!w.scenario.chargeCompute) return;
    const delta = round2(spent - this.bookedCompute);
    if (delta < 0.01) return;
    sim.recordLedger(w, { type: 'compute', amount: -delta, memo: `Calcul Claude (${w.mind.calls} appels cumulés)`, ref: null });
    this.bookedCompute = round2(this.bookedCompute + delta);
  }

  private advance(): void {
    const w = this.world;
    w.tick += 1;
    if (w.tick >= TICKS_PER_DAY) {
      w.tick = 0;
      w.day += 1;
      if (w.day > w.scenario.horizonDays) {
        w.status = 'finished';
        const fin = sim.financeSnapshot(w);
        emit(w, { agentId: 'camille', kind: 'event', text: `Fin de la simulation après ${w.scenario.horizonDays} jours : profit cumulé ${eur(fin.profit)}, trésorerie ${eur(fin.cash)}.` });
      }
    }
    w.phase = phaseOf(w.tick);
  }

  private finished(): boolean {
    return this.world.status === 'finished';
  }

  private situationFor(agent: AgentState): string {
    const w = this.world;
    const fin = sim.financeSnapshot(w);
    const task = taskById(w, agent.currentTaskId ?? '') ?? [...w.company.tasks].reverse().find((t) => t.assignee === agent.id && isOpen(t));
    const kpi = w.company.kpis[w.company.kpis.length - 1];
    const lessons = w.company.lessons.slice(-2).map((l) => l.insight);
    const liveProducts = w.company.products.filter((p) => p.status === 'live');
    const live = liveProducts.map((p) => `« ${short(p.title, 50)} » à ${eur(p.price)}`);
    const dept = w.company.departments.find((d) => d.id === agent.dept)?.name ?? agent.dept;
    // One fact per line: the heuristic mind picks the lines relevant to the question, Claude reads them all.
    const lines = [
      task ? `Ma tâche en cours : « ${task.title} » (${task.status === 'in_progress' ? 'en cours' : task.status === 'review' ? 'en relecture' : 'à faire'}).` : `Pas de tâche en cours pour moi ce jour ${w.day}.`,
      kpi ? `Hier : ${kpi.sales} ventes, ${eur(kpi.revenue)} de CA, ${eur(kpi.adSpend)} de pub, ROAS ${dec(kpi.roas)}.` : 'Pas encore de chiffres de vente.',
      `Trésorerie ${eur(fin.cash)}, profit cumulé ${eur(fin.profit)}${fin.runwayDays !== null ? `, runway ${fin.runwayDays} jours` : ''}.`,
      live.length ? `En boutique : ${live.join(', ')}.` : 'Aucun produit en ligne pour l’instant.',
      ...this.deptFacts(agent),
      ...lessons.map((l) => `Leçon récente : ${short(l, 140)}`),
      `Contexte : ${agent.name}, ${agent.role} (${dept}) chez ${w.company.name}, jour ${w.day}.`,
    ];
    return lines.join('\n');
  }

  /** Facts a member of each department would know by heart. */
  private deptFacts(agent: AgentState): string[] {
    const w = this.world;
    const live = w.company.products.filter((p) => p.status === 'live');
    const out: string[] = [];
    switch (agent.dept) {
      case 'growth': {
        const camps = activeCampaigns(w);
        out.push(camps.length ? `Pub : ${camps.length} campagne(s) active(s), ${eur(camps.reduce((s, c) => s + c.dailyBudget, 0))} par jour.` : 'Pub : aucune campagne active.');
        for (const p of live.slice(0, 2)) {
          const hook = learning.armStats(w, `hook_style:${p.nicheId}`).find((a) => a.pulls > 0);
          const fmt = learning.armStats(w, `ad_format:${p.nicheId}`).find((a) => a.pulls > 0);
          if (hook) out.push(`Meilleur hook pub sur « ${short(p.title, 40)} » : ${HOOK_NAMES[hook.key] ?? hook.key} (score ${Math.round(hook.mean * 100)}/100, ${hook.pulls} essais)${fmt ? `, meilleur format ${FORMAT_NAMES[fmt.key] ?? fmt.key}` : ''}.`);
        }
        break;
      }
      case 'support': {
        const open = w.market.inbox.filter((m) => m.status === 'open').length;
        const tone = learning.armStats(w, 'support_tone').find((a) => a.pulls > 0);
        out.push(`Support : ${open} message(s) client en attente${tone ? `, le ton « ${tone.key} » marche le mieux (${Math.round(tone.mean * 100)}/100)` : ''}.`);
        break;
      }
      case 'finance': {
        const b = currentBudget(w);
        out.push(`Budget : enveloppe pub du jour ${eur(b.adCap)}${b.survival ? ', mode survie actif' : ''}.`);
        break;
      }
      case 'boutique':
        for (const p of live.slice(0, 3)) out.push(`Produit « ${short(p.title, 40)} » : ${p.stats.sales} ventes, note ${p.stats.rating ? dec(p.stats.rating, 1) : '—'}/5, prix ${eur(p.price)}.`);
        break;
      case 'recherche':
        out.push(`Niche : shortlist actuelle ${w.company.research.shortlist.slice(0, 3).map((id) => w.company.research.trends.find((t) => t.nicheId === id)?.name ?? id).join(', ') || 'vide'}.`);
        break;
      case 'studio':
      case 'creation':
        for (const p of w.company.products.filter((x) => x.status !== 'killed').slice(-2)) out.push(`Guide « ${short(p.title, 40)} » (v${p.version}) : qualité ${p.quality?.overall ?? '—'}/100.`);
        break;
      case 'analyse': {
        const running = w.company.experiments.filter((e) => e.status === 'running');
        out.push(running.length ? `Test A/B en cours : ${running.map((e) => e.hypothesis).join(' ; ')}.` : 'Aucun test A/B en cours.');
        break;
      }
      case 'partenariats':
        out.push(`Partenariats créateurs : ${w.market.partnerships.length} proposition(s), ${w.market.partnerships.filter((p) => p.status === 'accepted' || p.status === 'delivered').length} active(s).`);
        break;
      case 'rh':
        out.push(`Leçons apprises : ${w.company.lessons.length} au total.`);
        break;
      default: {
        const pending = w.company.pendingApprovals.length;
        out.push(`Direction : ${openTasks(w).length} tâche(s) ouvertes${pending ? `, ${pending} décision(s) en attente du fondateur` : ''}.`);
      }
    }
    return out;
  }

  private ready(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.brain.init().catch((e) => {
        emit(this.world, { agentId: 'nora', kind: 'thought', text: `Nora : le cerveau n'a pas pu être initialisé (${short(errorText(e), 80)}) — on travaille sans mémoire pour l'instant` });
      });
    }
    return this.initPromise;
  }
}

