// Pure view-model helpers (no React, no DOM): unit-tested in derive.test.ts.
import type {
  Activity, CompanySnapshot, DayTaskCounts, DeptId, InboxMessage, LedgerEntry, LedgerType, Speed, Task, WorldEvent,
} from '../../../shared/types';

const SPEEDS: readonly Speed[] = [1, 2, 4, 8];
/** Same rule as isTerminal() on the server: a reached goal or a bankruptcy leaves the agency running (banner and toast only). */
const TERMINAL = new Set(['finished']);

export function isSpeed(v: unknown): v is Speed {
  return typeof v === 'number' && (SPEEDS as readonly number[]).includes(v);
}

export interface SessionView {
  /** The server loop is ticking on its own. */
  playing: boolean;
  speed: Speed;
  /** A tick is being computed right now (server side). */
  busy: boolean;
  /** Last tick error reported by the server loop (null once a tick succeeds again). */
  lastError: string | null;
  /** The run is over for good: the server no longer advances it. */
  ended: boolean;
  /** true when the values come from snapshot.session (the source of truth), false = local fallback. */
  fromServer: boolean;
}

/**
 * Play/pause and speed as the server sees them: `snapshot.session` wins; without it (older server,
 * demo data) the run status and the locally remembered speed are used.
 */
export function sessionView(s: CompanySnapshot | null | undefined, fallbackSpeed: Speed): SessionView {
  const ended = !!s && TERMINAL.has(s.status);
  const sess = s?.session;
  if (!sess) {
    return { playing: !!s && s.status === 'running', speed: fallbackSpeed, busy: false, lastError: null, ended, fromServer: false };
  }
  const err = typeof sess.lastError === 'string' ? sess.lastError.trim() : '';
  return {
    playing: !!sess.playing && !ended,
    speed: isSpeed(sess.speed) ? sess.speed : fallbackSpeed,
    busy: !!sess.busy,
    lastError: err || null,
    ended,
    fromServer: true,
  };
}

/** Display name of the customer behind a message: customerName when the sim provides it. */
export function customerLabel(m: Pick<InboxMessage, 'customerId' | 'customerName'>): string {
  const name = typeof m.customerName === 'string' ? m.customerName.trim() : '';
  return name || `Client ${m.customerId}`;
}

const NEXT_PREFIX = /^\s*la\s+suite\s+est\s+ici\s*(?:[:：\-–—·|»«"“”]\s*)*/i;

/**
 * Title of the "La suite est ici" upsell without the leading « La suite est ici : » that the minds
 * already put in it (the card prints that prefix itself). Empty string when nothing is left, or when the title is
 * the one a guide with no follow-up closes on: that is no follow-up.
 */
export function nextStepTitle(title: string | null | undefined): string {
  if (typeof title !== 'string') return '';
  let t = title.trim();
  // strip repeatedly: « La suite est ici : La suite est ici : x » → « x »
  for (let i = 0; i < 3 && NEXT_PREFIX.test(t); i++) t = t.replace(NEXT_PREFIX, '').trim();
  t = t.replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim();
  return /^votre prochaine étape$/i.test(t) ? '' : t;
}

/**
 * Product a feed line is about: the activity's own refs, else the world event it announces
 * (event activities are emitted as « <event title> — <description> » without refs).
 */
export function activityProductId(a: Activity, events: readonly WorldEvent[] | undefined): string | null {
  if (a.refs?.productId) return a.refs.productId;
  if (a.kind !== 'event' || !events?.length || !a.text) return null;
  let best: WorldEvent | null = null;
  for (const e of events) {
    if (!e.refs?.productId || !e.title) continue;
    if (e.day !== a.day && e.day !== a.day - 1) continue;
    if (!a.text.startsWith(e.title)) continue;
    if (!best || e.title.length > best.title.length || (e.title.length === best.title.length && e.day === a.day)) best = e;
  }
  return best?.refs?.productId ?? null;
}

export interface BudgetView {
  adCap: number;
  survival: boolean;
  note: string;
  day: number;
  /** The envelope was set for an earlier day (it is refreshed at the morning stand-up). */
  stale: boolean;
}

/**
 * CFO envelope of the day: company.budget, else (runs saved before that field existed) the output of the
 * last completed budget_review task. null when neither exists yet.
 */
export function budgetView(s: CompanySnapshot | null | undefined): BudgetView | null {
  if (!s) return null;
  const b = s.company?.budget;
  if (b && typeof b === 'object' && Number.isFinite(Number(b.adCap))) {
    const day = Number.isFinite(b.day) ? b.day : s.day;
    return { adCap: Math.max(0, Number(b.adCap)), survival: !!b.survival, note: typeof b.note === 'string' ? b.note.trim() : '', day, stale: day < s.day };
  }
  const tasks = s.company?.tasks ?? [];
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i]!;
    const o = t.output;
    if (t.kind !== 'budget_review' || t.status !== 'done' || !o || typeof o.adCap !== 'number' || !Number.isFinite(o.adCap)) continue;
    const day = t.dayDone ?? t.dayCreated;
    const note = typeof o.note === 'string' ? o.note.trim() : '';
    return { adCap: Math.max(0, o.adCap), survival: o.survival === true, note, day, stale: day < s.day };
  }
  return null;
}

// ───────────────────────────── Tasks: counts that survive the trimmed task list ─────────────────────────────

/**
 * Tasks done per day. snapshot.company.tasks only keeps the latest finished tasks, so the counts come from the server:
 * taskStats (every task of the run), else the daily KPIs, else the list for the days neither covers.
 */
export function doneTasksByDay(s: CompanySnapshot | null | undefined): Map<number, number> {
  const out = new Map<number, number>();
  const stats = s?.taskStats?.days;
  if (stats) {
    for (const d of stats) out.set(d.day, d.done);
    return out;
  }
  for (const k of s?.company?.kpis ?? []) out.set(k.day, k.tasksDone);
  const fromList = new Map<number, number>();
  for (const t of s?.company?.tasks ?? []) if (t.status === 'done' && t.dayDone) fromList.set(t.dayDone, (fromList.get(t.dayDone) ?? 0) + 1);
  for (const [day, n] of fromList) if (!out.has(day)) out.set(day, n);
  return out;
}

/** Tasks done in the whole run, by one team or by all of them. null without server counts. */
export function doneTasksTotal(s: CompanySnapshot | null | undefined, dept: DeptId | 'all'): number | null {
  const stats = s?.taskStats;
  if (!stats) return null;
  if (dept !== 'all') return stats.depts?.[dept]?.done ?? 0;
  return stats.days.reduce((n, d) => n + d.done, 0);
}

/** Failed or cancelled tasks of the whole run, by one team or by all of them. null without server counts. */
export function failedTasksTotal(s: CompanySnapshot | null | undefined, dept: DeptId | 'all'): number | null {
  const stats = s?.taskStats;
  if (!stats) return null;
  if (dept !== 'all') return stats.depts?.[dept]?.failed ?? 0;
  return stats.days.reduce((n, d) => n + d.failed + d.cancelled, 0);
}

export interface DeptDay {
  day: number;
  doneCount: number;
  createdCount: number;
  /** The tasks of that day still present in the snapshot. */
  done: Task[];
  created: Task[];
  /** Tasks of that day whose detail the snapshot no longer holds. */
  hidden: number;
}

const DEPT_CALENDAR_DAYS = 14;

/** Last 14 days of a team, today first. `tasks` = the team's tasks in the snapshot. */
export function deptCalendar(s: CompanySnapshot | null | undefined, dept: DeptId, tasks: readonly Task[]): DeptDay[] {
  const today = s?.day ?? 1;
  const counted = s?.taskStats?.depts?.[dept]?.days;
  const rows = new Map<number, DayTaskCounts>((counted ?? []).map((r) => [r.day, r]));
  const out: DeptDay[] = [];
  for (let day = today; day >= Math.max(1, today - DEPT_CALENDAR_DAYS + 1); day--) {
    const done = tasks.filter((t) => t.dayDone === day && t.status === 'done');
    const created = tasks.filter((t) => t.dayCreated === day);
    const doneCount = counted ? rows.get(day)?.done ?? 0 : done.length;
    const createdCount = counted ? rows.get(day)?.created ?? 0 : created.length;
    out.push({ day, doneCount, createdCount, done, created, hidden: Math.max(0, doneCount - done.length, createdCount - created.length) });
  }
  return out;
}

// ───────────────────────────── Run status ─────────────────────────────

export const RUN_STATUS: Record<string, string> = { running: 'en cours', paused: 'en pause', bankrupt: 'faillite', goal_reached: 'objectif atteint', finished: 'terminée' };

/** A run that reached its horizon below zero ended on a bankruptcy, not on a date. */
export function endedBankrupt(s: Pick<CompanySnapshot, 'status' | 'finance'> | null | undefined): boolean {
  return s?.status === 'finished' && !!s.finance?.bankrupt;
}

/** The pill of the run on screen: a finished run is not « en cours », and a run that ended bankrupt says so. */
export function currentRunPill(status: CompanySnapshot['status'] | undefined, bankrupt = false): { label: string; tone: 'green' | 'neutral' | 'red' } {
  if (status === 'finished' && bankrupt) return { label: RUN_STATUS.bankrupt!, tone: 'red' };
  return { label: RUN_STATUS[status ?? 'running'] ?? 'en cours', tone: status === 'finished' ? 'neutral' : status === 'bankrupt' ? 'red' : 'green' };
}

/** Reached, but after the deadline the founder set: the same milestone, not the same result. */
export function goalLate(s: CompanySnapshot | null | undefined): boolean {
  const byDay = s?.scenario?.goal?.byDay;
  const day = s?.goalReachedDay;
  return typeof byDay === 'number' && typeof day === 'number' && day > byDay;
}

export function goalTitle(s: CompanySnapshot | null | undefined): string {
  return goalLate(s) ? 'Objectif atteint après l’échéance' : 'Objectif atteint !';
}

// ───────────────────────────── Founder approvals ─────────────────────────────

const WAITING_PREFIX = /^En attente du fondateur\s*:\s*/;

/**
 * What the founder is asked to approve, in plain French with the amount: the runtime's request (task.input.founderAsk),
 * else the feed line that announced it, else the task title.
 */
export function approvalAsk(task: Task | undefined, activity: readonly Activity[]): string | null {
  if (!task) return null;
  const ask = task.input?.founderAsk;
  if (typeof ask === 'string' && ask.trim()) return ask.trim();
  for (let i = activity.length - 1; i >= 0; i--) {
    const a = activity[i]!;
    if (a.kind === 'founder' && a.refs?.taskId === task.id && WAITING_PREFIX.test(a.text)) return a.text.replace(WAITING_PREFIX, '').trim();
  }
  return task.title;
}

// ───────────────────────────── Quality gates ─────────────────────────────

const RED_TEAM_VERDICT: Record<string, string> = { go: 'Go', fix: 'À corriger', kill: 'À tuer' };

/** Verdict and rework cycle of a Red Team task (both survive the light live snapshot). */
export function redTeamView(t: Task): { verdict: string | null; cycle: number } | null {
  if (t.kind !== 'red_team') return null;
  const verdict = t.output?.finalVerdict;
  const cycle = t.input?.cycle;
  return { verdict: typeof verdict === 'string' ? RED_TEAM_VERDICT[verdict] ?? null : null, cycle: typeof cycle === 'number' && cycle > 0 ? cycle : 0 };
}

/** The task went through on a logged waiver. The live snapshot drops the output object: its log and last review keep the trace. */
export function hasWaiver(t: Task): boolean {
  if (t.output?.waiver) return true;
  const mentions = (lines: readonly string[] | undefined) => (lines ?? []).some((l) => /dérogation/i.test(l));
  return mentions(t.log) || (t.reviews ?? []).some((r) => mentions(r.notes));
}

// ───────────────────────────── Ledger ─────────────────────────────

/** Payment reserve ('hold:<id>', 'hold:release:<day>'): the provider freezes cash, then gives it back. Neither a cost nor an income. */
export function isReserve(e: Pick<LedgerEntry, 'ref'>): boolean {
  return typeof e.ref === 'string' && e.ref.startsWith('hold:');
}

/** The CFO's point mort, the one Croissance and the digest print. Null before the first Monday, and in a company without growth: nothing judges a ROAS then. */
export function breakEvenRoas(s: CompanySnapshot | null | undefined): number | null {
  return s?.company?.growth?.allocation?.beRoas ?? null;
}

/** A ROAS read against that point mort: there is no other break-even on screen. */
export function roasTone(roas: number, breakEven: number | null): 'good' | 'bad' | null {
  return breakEven === null ? null : roas >= breakEven ? 'good' : 'bad';
}

export interface LedgerView {
  /** Total per type, biggest first, capital and reserves left out. */
  byType: [LedgerType, number][];
  /** EUR still frozen by the payment provider at the end of the list (≥ 0). */
  reserve: number;
  /** Sum of the listed entries, capital and reserves left out. */
  total: number;
  /** false = the snapshot only keeps the latest entries (a whole ledger starts with the capital). */
  complete: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function ledgerView(ledger: readonly LedgerEntry[]): LedgerView {
  const totals = new Map<LedgerType, number>();
  let reserve = 0;
  let total = 0;
  for (const e of ledger) {
    // floor at 0: a release whose hold has left the list frees nothing the list counted
    if (isReserve(e)) { reserve = Math.max(0, reserve - e.amount); continue; }
    if (e.type === 'capital') continue;
    totals.set(e.type, (totals.get(e.type) ?? 0) + e.amount);
    total += e.amount;
  }
  return {
    byType: [...totals].map(([t, v]): [LedgerType, number] => [t, cents(v)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])),
    reserve: cents(reserve),
    total: cents(total),
    complete: ledger.length === 0 || ledger[0]!.type === 'capital',
  };
}
