/**
 * Positions, candidates, hires (org §9). The decision is arithmetic over the load and the ledger, never the content
 * engine: HR proposes, the CFO checks the money, the CEO signs. Every draw sits on STREAM.hire, keyed by position, so
 * a hire shifts nothing the market or another position draws.
 */
import type { AgentId, AgentState, Candidate, LedgerType, OrgDecision, Position, PositionReason, RolePressure, RoleId, Task, TaskKind, WorldState } from '../../shared.js';
import { isHold, nextId, streamRng } from '../../core/index.js';
import { addRule, noLearning, writePlaybookNotes } from '../../learning/playbooks.js';
import { FEES } from '../../sim/balance.js';
import type { RuntimeCtx } from '../ctx.js';
import { agentOf, incident, nameOf, say, speak } from '../ctx.js';
import { addHold, hiringHold, REFUSAL_COOLDOWN_DAYS } from '../holds.js';
import { computeBudget } from '../metrics.js';
import { sim } from '../modules.js';
import { SEED_PLAYBOOKS } from '../roster.js';
import { STREAM } from '../streams.js';
import { scoreCandidates, seedHire } from '../talent/challenge.js';
import { createTask, isOpen, KIND_META, taskById } from '../tasks.js';
import { dec, errorText, eur, round2, short, slugify } from '../util.js';
import { CANDIDATES, ROLES } from './catalog.js';
import { isLegacyOrg, ORG, payOfTier } from './constants.js';
import { completeDeparture } from './departure.js';
import { pickRole, refreshPressure, whoIsWaiting } from './load.js';
import { avatarFor, personaFor, pickName, skillsOf, takenNames, toolsOf } from './names.js';
import { writeOrgNote } from './notes.js';
import { officerId, ownersOfAny, roleHolders } from './officers.js';
import { payOf, payrollToday } from './payroll.js';
import { reconcileOrg } from './reconcile.js';

const CANDIDATES_PER_POSITION = 3;
const REFUSAL_REPEAT_DAYS = 7;
const MAX_DECISIONS = 200;
/** What the operating margin counts: the money a day of business moved, salaries and fixed costs aside. */
const OPERATING: readonly LedgerType[] = ['revenue', 'refund', 'chargeback', 'ad_spend', 'payment_fee', 'creator_payout', 'scam_loss', 'discount'];
/** Each field of a candidate has its own key in STREAM.hire, the traits of the avatar from 2 on: a change to one draw moves no other. */
const FIELD = { name: 0, persona: 1, avatar: 2 } as const;

export function logOrgDecision(w: WorldState, d: Omit<OrgDecision, 'id' | 'day'>): OrgDecision {
  const org = w.company.org!;
  const row: OrgDecision = { id: nextId(w, 'org'), day: w.day, ...d };
  org.decisions.push(row);
  if (org.decisions.length > MAX_DECISIONS) org.decisions.splice(0, org.decisions.length - MAX_DECISIONS);
  return row;
}

// ───────────────────────────── Gates ─────────────────────────────

/** What a decision reads, each number straight from the ledger or the payroll. Every refusal keeps them. */
export interface MoneyRead { payroll: number; pay: number; fixed: number; cost: number; cash: number; margin: number; revenue30: number; headcount: number }

export interface GateCheck {
  ok: boolean;
  /** Not today, and nothing to say: a position is open, the cooldown runs, the team is frozen on purpose, no seat is free. */
  quiet: boolean;
  /** What the CFO answers, French. */
  why: string | null;
  read: MoneyRead;
}

/** Signed sum of the operating lines of the last 7 closed days, per day. Holds are cash timing, never margin. */
function marginPerDay(w: WorldState): number {
  const closed = sim.lastClosedDay(w);
  const from = closed - ORG.windowDays;
  let total = 0;
  for (const e of w.ledger) if (e.day > from && e.day <= closed && OPERATING.includes(e.type) && !isHold(e)) total += e.amount;
  return round2(total / Math.max(1, Math.min(ORG.windowDays, closed)));
}

/** Revenue of the last 30 closed days, scaled to 30 while the run is younger. */
function revenue30(w: WorldState): number {
  const closed = sim.lastClosedDay(w);
  const from = closed - 30;
  let total = 0;
  for (const e of w.ledger) if (e.type === 'revenue' && e.day > from && e.day <= closed && !isHold(e)) total += e.amount;
  return round2(total * 30 / Math.max(1, Math.min(30, closed)));
}

export function moneyRead(w: WorldState, role: RoleId): MoneyRead {
  const payroll = payrollToday(w);
  const pay = w.scenario.org?.payroll ? payOfTier(ROLES[role].tier) : 0;
  const fixed = round2(FEES.boutiqueDaily + FEES.toolsDaily);
  return { payroll, pay, fixed, cost: round2(payroll + pay + fixed), cash: sim.financeSnapshot(w).cash, margin: marginPerDay(w), revenue30: revenue30(w), headcount: w.company.agents.length };
}

/**
 * G0 to G3 of org §9. `replacement` passes them all (D17). `founder` skips the bottleneck and G3, keeps G0 except
 * autoHire, keeps G1. `channel` keeps everything but the bottleneck. `self` is the position under recheck, which G0
 * must not count against itself.
 */
export function checkGates(w: WorldState, role: RoleId, reason: PositionReason, self?: Position): GateCheck {
  const read = moneyRead(w, role);
  const pass: GateCheck = { ok: true, quiet: false, why: null, read };
  if (reason === 'replacement') return pass;
  const org = w.company.org!;
  const quiet: GateCheck = { ok: false, quiet: true, why: null, read };
  const no = (why: string): GateCheck => ({ ok: false, quiet: false, why, read });
  if (reason !== 'founder' && !w.scenario.org?.autoHire) return quiet;
  if (org.positions.some((p) => p.status === 'open' && p !== self)) return quiet;
  if (w.day - org.lastHireDay < ORG.hireCooldownDays) return quiet;
  if (roleHolders(w, role).length >= ROLES[role].seats) return quiet;
  const budget = computeBudget(w);
  if (budget.bankrupt) return no(`trésorerie négative (${eur(read.cash)}), aucune embauche`);
  if (budget.survival) return no(`mode survie (${eur(read.cash)} en caisse), aucune embauche`);
  const hold = hiringHold(w);
  if (hold) return no(`les embauches sont gelées : ${hold.reason}`);
  if (read.headcount >= ORG.maxHeadcount) return no(`l'agence est au complet (${read.headcount} agents)`);
  const reserve = ORG.reserveDays * read.cost;
  if (read.cash < reserve) return no(`${eur(read.cash)} en caisse, il en faut ${eur(reserve)} pour tenir ${ORG.reserveDays} jours après embauche`);
  if (reason === 'founder') return pass;
  const byCash = read.cash >= ORG.cashRouteDays * read.cost;
  if (read.margin < ORG.marginCover * read.cost && !byCash) {
    const covered = read.cost > 0 ? Math.round(read.margin / read.cost * 100) : 0;
    return no(`la marge couvre ${covered} % des frais fixes après embauche, il faut ${Math.round(ORG.marginCover * 100)} %`);
  }
  if (byCash) return pass;
  const perHead = read.revenue30 / (read.headcount + 1);
  const floor = ORG.revPerHeadPayMultiple * 30 * read.pay;
  if (perHead < floor) return no(`${eur(perHead)} de revenu par tête et par mois, il en faut ${eur(floor)} pour ce poste`);
  return pass;
}

const numbersOf = (read: MoneyRead, p?: RolePressure): Record<string, number> => ({
  margin: read.margin, payroll: read.payroll, pay: read.pay, fixed: read.fixed, cost: read.cost, cash: read.cash, revenue30: read.revenue30, headcount: read.headcount,
  ...(p ? { relief: p.relief, ownerUtil: p.ownerUtil, days: p.days } : {}),
});

const pressureOf = (w: WorldState, role: RoleId): RolePressure | undefined => w.company.org!.pressure.find((p) => p.roleId === role);

function refusedLately(w: WorldState, role: RoleId): boolean {
  return w.company.org!.decisions.some((d) => d.kind === 'refused' && d.roleId === role && w.day - d.day < REFUSAL_REPEAT_DAYS);
}

/** One refusal per role per 7 days, with its numbers: the founder sees why nothing happens. */
function refuse(ctx: RuntimeCtx, role: RoleId, check: GateCheck): void {
  const w = ctx.world;
  if (refusedLately(w, role)) return;
  const cfo = officerId(w, 'cfo');
  const text = `${nameOf(ctx, cfo)} refuse : ${check.why}.`;
  logOrgDecision(w, { kind: 'refused', roleId: role, agentId: null, text, numbers: numbersOf(check.read, pressureOf(w, role)) });
  say(ctx, cfo, text, 'org');
}

// ───────────────────────────── Positions ─────────────────────────────

export function openPosition(ctx: RuntimeCtx, role: RoleId, reason: PositionReason, detail: string, replaces?: AgentId, opts?: { noTask?: boolean }): Position | null {
  const w = ctx.world;
  const org = w.company.org;
  if (!org || isLegacyOrg(w)) return null;
  const position: Position = {
    id: `pos_${org.positions.length + 1}`, roleId: role, reason, detail, openedDay: w.day, closedDay: null, status: 'open',
    candidates: [], hiredId: null, replaces: replaces ?? null, taskId: null,
  };
  org.positions.push(position);
  if (!opts?.noTask) {
    const hr = officerId(w, 'hr');
    position.taskId = createTask(w, { kind: 'recruit', title: `Recruter : ${ROLES[role].title}`, input: { positionId: position.id }, assignee: hr, createdBy: hr, reviewer: null, priority: 2 }).id;
  }
  logOrgDecision(w, { kind: 'position', roleId: role, agentId: replaces ?? null, text: `Poste ouvert : ${ROLES[role].title}. ${detail}`, numbers: numbersOf(moneyRead(w, role), pressureOf(w, role)) });
  return position;
}

/** The way in for every reason but a replacement, which is the league's and opens its position itself (D17). */
export function requestRole(ctx: RuntimeCtx, role: RoleId, reason: PositionReason, detail: string): Position | null {
  const w = ctx.world;
  if (!w.company.org || isLegacyOrg(w)) return null;
  const check = checkGates(w, role, reason);
  if (!check.ok) {
    if (!check.quiet) refuse(ctx, role, check);
    return null;
  }
  const { margin, cost, cash } = check.read;
  const cfo = officerId(w, 'cfo');
  say(ctx, cfo, `${nameOf(ctx, cfo)} valide : ${eur(margin)} de marge par jour pour ${eur(cost)} de frais après embauche, ${eur(cash)} en caisse.`, 'org');
  return openPosition(ctx, role, reason, detail);
}

function closePosition(position: Position, status: 'filled' | 'cancelled', day: number): void {
  position.status = status;
  position.closedDay = day;
}

export function positionOf(w: WorldState, task: Task): Position | undefined {
  return w.company.org?.positions.find((p) => p.taskId === task.id);
}

/** The recheck failed: the position closes, the task does not fail. HR's score does not pay for the market. */
export function cancelPosition(ctx: RuntimeCtx, position: Position, check: GateCheck): void {
  const w = ctx.world;
  closePosition(position, 'cancelled', w.day);
  const text = `Poste annulé : ${ROLES[position.roleId].title}, ${check.why ?? 'le moment est passé'}.`;
  logOrgDecision(w, { kind: 'refused', roleId: position.roleId, agentId: null, text, numbers: numbersOf(check.read, pressureOf(w, position.roleId)) });
  speak(ctx, 'hr', text, 'org');
}

/** An open position whose task died would freeze hiring for good: G0 counts it. */
function closeDeadPositions(ctx: RuntimeCtx): void {
  const w = ctx.world;
  for (const position of w.company.org!.positions) {
    if (position.status !== 'open') continue;
    const task = position.taskId ? taskById(w, position.taskId) : undefined;
    if (!task || !isOpen(task)) closePosition(position, 'cancelled', w.day);
  }
}

// ───────────────────────────── Candidates ─────────────────────────────

function namedCandidate(id: AgentId): Candidate {
  const def = CANDIDATES[id]!;
  return {
    id, name: def.name, gender: def.gender, roleId: def.roleId, tier: def.tier, persona: def.persona, skills: [...def.skills], avatar: { ...def.avatar },
    interview: 50, deliverable: null, lineage: null,
  };
}

function generatedCandidate(w: WorldState, role: RoleId, positionIndex: number, index: number, taken: ReadonlySet<string>): Candidate {
  const rng = (field: number) => streamRng(w.scenario.seed, STREAM.hire, positionIndex, index, field);
  const { name, gender } = pickName(taken, rng(FIELD.name));
  const { dept, tier } = ROLES[role];
  return {
    id: slugify(name), name, gender, roleId: role, tier, persona: personaFor(dept, name, gender, rng(FIELD.persona)), skills: skillsOf(role),
    avatar: avatarFor(dept, gender, (trait) => rng(FIELD.avatar + trait)), interview: 50, deliverable: null, lineage: null,
  };
}

/** The role's named candidates first, if still unused, then the market. A name is taken by a hire alone (D53). */
export function drawCandidates(ctx: RuntimeCtx, role: RoleId, positionIndex: number, n: number): Candidate[] {
  const w = ctx.world;
  if (isLegacyOrg(w)) return [];
  const taken = takenNames(w);
  const named = Object.values(CANDIDATES).filter((c) => c.roleId === role && !taken.has(c.name)).slice(0, n);
  const drawn = named.map((c) => namedCandidate(c.id));
  for (let i = drawn.length; i < n; i++) {
    const c = generatedCandidate(w, role, positionIndex, i, taken);
    taken.add(c.name);
    drawn.push(c);
  }
  return drawn;
}

/** Best real test wins. Ties: the named candidate, then the id (D16). */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  const named = (c: Candidate): number => (CANDIDATES[c.id] ? 1 : 0);
  return [...candidates].sort((a, b) => b.interview - a.interview || named(b) - named(a) || a.id.localeCompare(b.id));
}

/** Who gets the job: the candidates of the position, drawn on first need and again if all their names went meanwhile. */
export async function bestCandidate(ctx: RuntimeCtx, position: Position): Promise<Candidate> {
  const w = ctx.world;
  const taken = takenNames(w);
  let free = position.candidates.filter((c) => !taken.has(c.name));
  if (!free.length) {
    position.candidates = drawCandidates(ctx, position.roleId, w.company.org!.positions.indexOf(position), CANDIDATES_PER_POSITION);
    await scoreCandidates(ctx, position.roleId, position.candidates);
    free = position.candidates;
  }
  return rankCandidates(free)[0]!;
}

// ───────────────────────────── The hire ─────────────────────────────

const ruleText = (rule: string): string => rule.replace(/\s+/g, ' ').trim();

/**
 * The department's seed rules, then every rule the current owners of its core kinds hold, confidence trim included.
 * Without this the learned hook, price and banned words would be lost on the first hire.
 */
function inheritRules(w: WorldState, agent: AgentState): void {
  const book = (w.company.playbooks[agent.id] ??= []);
  if (noLearning(w)) { // addRule writes nothing in that arm: a hire starts as the founders did, from the seeds and from nobody's lessons
    book.push(...SEED_PLAYBOOKS[agent.dept]);
    return;
  }
  const owners = ownersOfAny(w, ROLES[agent.roleId].core).filter((a) => a.id !== agent.id);
  for (const rule of SEED_PLAYBOOKS[agent.dept]) addRule(w, agent.id, rule);
  for (const owner of owners) for (const rule of w.company.playbooks[owner.id] ?? []) addRule(w, agent.id, rule);
  const held = new Set(book.map(ruleText));
  for (const lesson of w.company.lessons) {
    if (held.has(ruleText(lesson.insight)) && !lesson.appliesTo.includes(agent.id)) lesson.appliesTo.push(agent.id);
  }
}

/** Waiting tasks of the hire's core kinds go back to the pool when a hat wearer held them: the specialist is there now. */
function rebalance(w: WorldState, wearers: ReadonlyMap<TaskKind, ReadonlySet<AgentId>>): void {
  for (const t of w.company.tasks) {
    if (t.status === 'pending' && t.progress === 0 && t.assignee && wearers.get(t.kind)?.has(t.assignee)) t.assignee = null;
  }
}

/** The person a candidate is on their first day. The real test seats a copy of it. */
export function agentFrom(w: WorldState, c: Candidate): AgentState {
  const role = ROLES[c.roleId];
  const def = CANDIDATES[c.id];
  return {
    id: c.id, name: c.name, role: def?.role ?? role.title, dept: role.dept, isChief: false, tier: c.tier, persona: c.persona, skills: [...c.skills],
    tools: def ? [...def.tools] : toolsOf(c.roleId), taskKinds: [...role.core, ...role.assist], avatar: { ...c.avatar },
    roleId: c.roleId, gender: c.gender, founder: false,
    status: 'idle', place: role.dept, currentTaskId: null, energy: 100, level: 1, xp: 0, perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 50 }, bubble: null,
    hatKinds: [], hatDepts: [], hiredDay: w.day, rampUntilDay: w.day + ORG.rampDays, notice: null,
  };
}

export async function hireAgent(ctx: RuntimeCtx, position: Position, c: Candidate): Promise<AgentState> {
  const w = ctx.world;
  const org = w.company.org!;
  const role = ROLES[c.roleId];
  const wearers = new Map(role.core.map((k) => [k, new Set(w.company.agents.filter((a) => a.hatKinds.includes(k)).map((a) => a.id))]));
  const agent = agentFrom(w, c);
  w.company.agents.push(agent);
  seedHire(w, agent, c);
  inheritRules(w, agent);
  const pay = payOf(agent);
  if (w.scenario.org?.payroll) sim.recordLedger(w, { type: 'recruiting', amount: -round2(ORG.recruitingDays * pay), memo: `Recrutement de ${c.name} (${role.title})`, ref: `hire:${c.id}` });
  reconcileOrg(w);
  rebalance(w, wearers);
  position.hiredId = c.id;
  closePosition(position, 'filled', w.day);
  org.lastHireDay = w.day;
  org.stats.hires += 1;
  if (position.replaces) await completeDeparture(ctx, position.replaces);
  try {
    await writePlaybookNotes(w, ctx.brain, [agent.id], w.day);
  } catch (e) {
    incident(ctx, `Note de ${c.name} non écrite : ${short(errorText(e), 80)}`);
  }
  await writeOrgNote(ctx);
  const ceo = officerId(w, 'ceo');
  const monthly = round2(pay * 30);
  const text = `${nameOf(ctx, ceo)} signe : ${c.name} rejoint l'agence comme ${role.title} (${eur(monthly)}/mois).`;
  logOrgDecision(w, { kind: 'hire', roleId: c.roleId, agentId: c.id, text, numbers: { pay, monthly, interview: c.interview, recruiting: round2(ORG.recruitingDays * pay), headcount: w.company.agents.length } });
  say(ctx, ceo, text, 'org');
  return agent;
}

// ───────────────────────────── The evening ─────────────────────────────

/** Would tonight's review have anything to do? A role under pressure that was just refused waits for its week to end, unless the money moved. */
function dueRole(w: WorldState): RolePressure | null {
  const pick = pickRole(w);
  if (!pick) return null;
  const check = checkGates(w, pick.roleId, 'bottleneck');
  if (check.quiet) return null;
  return check.ok || !refusedLately(w, pick.roleId) ? pick : null;
}

/** The `headcount_review` ritual. Returns its line for the task log. */
export function reviewHeadcount(ctx: RuntimeCtx): string {
  const w = ctx.world;
  const pick = dueRole(w);
  if (!pick) return 'Aucun poste à ouvrir ce soir.';
  const { title } = ROLES[pick.roleId];
  const { kind, owner } = whoIsWaiting(w, pick.roleId);
  const hr = officerId(w, 'hr');
  const label = KIND_META[kind].label;
  const load = `${label} attend ${dec(pick.relief, 1)} ticks par jour, ${nameOf(ctx, owner)} est occupé${agentOf(ctx, owner)?.gender === 'f' ? 'e' : ''} à ${Math.round(pick.ownerUtil * 100)} %.`;
  say(ctx, hr, `${nameOf(ctx, hr)} propose d'embaucher : ${title}. ${load}`, 'org');
  const position = requestRole(ctx, pick.roleId, 'bottleneck', load);
  return position ? `Poste ouvert : ${title}.` : `Poste refusé : ${title}.`;
}

export async function headcountEvening(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  if (!w.company.org || isLegacyOrg(w)) return;
  closeDeadPositions(ctx);
  refreshPressure(w);
  const weekly = w.day % 7 === 0;
  if (weekly || dueRole(w)) await ctx.ritual('headcount_review', officerId(w, 'hr'), weekly ? `Revue des effectifs de la semaine ${Math.ceil(w.day / 7)}` : `Revue des effectifs du jour ${w.day}`);
}

/** The founder said no to a hire: the position closes and a `hiring` hold stands (D49). Someone on notice stays: `layoffsEvening` settles it. */
export function recruitRefused(ctx: RuntimeCtx, task: Task): void {
  const w = ctx.world;
  const position = positionOf(w, task);
  if (!position || position.status !== 'open') return;
  closePosition(position, 'cancelled', w.day);
  const until = w.day + REFUSAL_COOLDOWN_DAYS;
  addHold(w, { kind: 'hiring', productId: null, until, reason: `le fondateur a refusé une embauche le jour ${w.day} (nouvelle demande après le jour ${until})` });
  const text = `Le fondateur refuse le poste : ${ROLES[position.roleId].title}. Pas de nouvelle embauche avant le jour ${until + 1}.`;
  logOrgDecision(w, { kind: 'refused', roleId: position.roleId, agentId: null, text, numbers: { ...numbersOf(moneyRead(w, position.roleId), pressureOf(w, position.roleId)), until } });
  speak(ctx, 'hr', `compris, pas de nouvelle embauche avant le jour ${until + 1}.`, 'founder');
}
