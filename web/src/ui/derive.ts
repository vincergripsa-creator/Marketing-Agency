// Pure view-model helpers (no React, no DOM): unit-tested in derive.test.ts.
import type { Activity, CompanySnapshot, InboxMessage, Speed, WorldEvent } from '../../../shared/types';

const SPEEDS: readonly Speed[] = [1, 2, 4, 8];
const TERMINAL = new Set(['bankrupt', 'goal_reached', 'finished']);

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
 * already put in it (the card prints that prefix itself). Empty string when nothing is left.
 */
export function nextStepTitle(title: string | null | undefined): string {
  if (typeof title !== 'string') return '';
  let t = title.trim();
  // strip repeatedly: « La suite est ici : La suite est ici : x » → « x »
  for (let i = 0; i < 3 && NEXT_PREFIX.test(t); i++) t = t.replace(NEXT_PREFIX, '').trim();
  return t.replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim();
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
