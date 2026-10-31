/**
 * The owned list, as cohorts (scale §6.2). Nobody has a row: a list of 20 000 people is a handful of numbers, one welcome
 * pipe per niche and at most 7 buckets per (niche, kind). Unsubscribes are real: they leave the bucket, and nobody is ever
 * mailed past its size. Emails only make traffic: orders, money, refunds and support stay `runSales`'s, as for any visitor.
 */
import { clamp, round2 } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { AudienceState, AudienceView, Broadcast, EmailStep, ListBucket, NicheTruth, WorldState } from '../shared.js';
import { recordLedger } from './finance.js';
import { GROWTH } from './growth.js';
import { findNiche } from './market.js';
import { productById } from './ops.js';
import { fmtInt, fmtPct, norm, plural, short } from './text.js';

/** Index 0..10: the day of the sequence each lead is on. */
const WELCOME_DAYS = 11;
const MONTH_DAYS = 30;
/** Sends an open rate is read on: what a mailing tool's dashboard would show. */
const OPEN_RATE_SENDS = 4;
const RECENT_SENDS = 10;

/** Traffic of one send. `repeat`: these clicks come from past buyers of that niche. */
export interface EmailClicks { productId: string; clicks: number; cvrMult: number; repeat?: string; broadcast?: Broadcast }

/** First use, no draw. A world that never built a list has no audience at all. */
export function audienceOf(world: WorldState): AudienceState {
  return world.market.audience ??= {
    buckets: [], welcome: {}, sequences: [], queue: [], sent: [],
    totals: { leads: 0, buyers: 0, unsubscribed: 0, delivered: 0, opens: 0, clicks: 0, sales: 0, revenue: 0 },
  };
}

export const monthOf = (day: number): number => Math.floor((day - 1) / MONTH_DAYS);

const welcoming = (a: AudienceState): number => Object.values(a.welcome).reduce((s, pipe) => s + pipe.reduce((t, n) => t + n, 0), 0);
const bucketed = (a: AudienceState, kind: ListBucket['kind']): number => a.buckets.reduce((s, b) => s + (b.kind === kind ? b.size : 0), 0);

/** Everyone a mailing tool bills for. */
export function listSize(a: AudienceState): number {
  return welcoming(a) + bucketed(a, 'lead') + bucketed(a, 'buyer');
}

export function emailCost(size: number): number {
  const { freeSubscribers, costPer1000Daily } = GROWTH.email;
  return round2((Math.max(0, size - freeSubscribers) / 1000) * costPer1000Daily);
}

function addToBucket(a: AudienceState, nicheId: string, kind: ListBucket['kind'], month: number, n: number): void {
  if (n <= 0) return;
  const b = a.buckets.find((x) => x.nicheId === nicheId && x.kind === kind && x.month === month);
  if (b) b.size += n;
  else a.buckets.push({ nicheId, kind, month, size: n, fatigue: 0 });
}

/** Today's opt-ins: they get the sequence's first mail at the next close. */
export function addLeads(world: WorldState, nicheId: string, n: number): void {
  if (n <= 0) return;
  const a = audienceOf(world);
  const pipe = (a.welcome[nicheId] ??= new Array<number>(WELCOME_DAYS).fill(0));
  pipe[0]! += n;
  a.totals.leads += n;
}

export function addBuyers(world: WorldState, nicheId: string, n: number): void {
  if (n <= 0) return;
  const a = audienceOf(world);
  addToBucket(a, nicheId, 'buyer', monthOf(world.day), n);
  a.totals.buyers += n;
}

/** Empty buckets go, and those past `bucketMonths` melt into one cold bucket per (niche, kind), its month the mean of who is in it. */
function settleBuckets(a: AudienceState, day: number): void {
  const { fatigueDecayDaily, bucketMonths } = GROWTH.email;
  const last = monthOf(day) - bucketMonths;
  const cold = new Map<string, ListBucket[]>();
  for (const b of a.buckets) {
    b.fatigue = Math.max(0, b.fatigue - fatigueDecayDaily);
    if (b.month > last || b.size <= 0) continue;
    const key = `${b.nicheId}|${b.kind}`;
    cold.set(key, [...(cold.get(key) ?? []), b]);
  }
  for (const rows of cold.values()) {
    if (rows.length < 2) continue;
    const size = rows.reduce((s, b) => s + b.size, 0);
    const mean = (read: (b: ListBucket) => number): number => rows.reduce((s, b) => s + read(b) * b.size, 0) / size;
    Object.assign(rows[0]!, { size, month: Math.round(mean((b) => b.month)), fatigue: mean((b) => b.fatigue) });
    for (const b of rows.slice(1)) b.size = 0;
  }
  a.buckets = a.buckets.filter((b) => b.size > 0);
}

/** The writing's share of an open: a bad subject line is ignored, a good one only goes so far. */
const quality = (score: number): number => clamp(score / 70, 0.7, 1.2);

const ageOf = (b: ListBucket, day: number): number => Math.max(0, day - (b.month * MONTH_DAYS + 1));

/** Share of a bucket that opens this mail. A list goes cold with age, and never below the floor. */
export function openRate(b: ListBucket, score: number, day: number): number {
  const { open } = GROWTH.email;
  const base = open[b.kind];
  return clamp(base * quality(score) * (1 - b.fatigue) * Math.max(open.floor / base, Math.exp(-ageOf(b, day) / open.ageDays)));
}

function unsubRate(fatigue: number, hasUnsubscribe: boolean): number {
  const { base, fatigue: weight, noLinkFactor } = GROWTH.email.unsub;
  return clamp((base + weight * fatigue) * (hasUnsubscribe ? 1 : noLinkFactor));
}

/** A sequence step has no flag of its own: its text says it or not. */
const hasUnsubscribeLine = (step: EmailStep): boolean => /desabonn|desinscri/.test(norm(step.body));

/** The people at a step's offset get it. Whoever unsubscribes on it leaves the pipe there. */
function sendWelcome(world: WorldState, a: AudienceState, rng: Rng, nicheId: string, pipe: number[], out: EmailClicks[]): void {
  const { open, click, cvrMult } = GROWTH.email;
  const seq = a.sequences.find((s) => s.nicheId === nicheId && s.status === 'active');
  if (!seq) return;
  const onSale = productById(world, seq.productId)?.status === 'live';
  for (const step of seq.steps) {
    const delivered = pipe[step.day] ?? 0;
    if (delivered <= 0 || (step.kind === 'pitch' && !onSale)) continue;
    const opens = rng.binomial(delivered, clamp(open.welcome * quality(step.score)));
    const clicks = step.kind === 'pitch' ? rng.binomial(opens, click.welcome) : 0;
    const unsubscribed = rng.binomial(delivered, unsubRate(0, hasUnsubscribeLine(step)));
    pipe[step.day] = delivered - unsubscribed;
    a.totals.delivered += delivered;
    a.totals.opens += opens;
    a.totals.clicks += clicks;
    a.totals.unsubscribed += unsubscribed;
    if (clicks > 0) out.push({ productId: seq.productId, clicks, cvrMult: cvrMult.lead });
  }
}

/** Who a broadcast reaches, and how much of the usual open rate. A launch also goes to buyers of the same category, a colder crowd. */
function targets(world: WorldState, a: AudienceState, b: Broadcast, niche: NicheTruth | undefined): { bucket: ListBucket; reach: number }[] {
  const rows: { bucket: ListBucket; reach: number }[] = [];
  for (const bucket of a.buckets) {
    if (bucket.nicheId === b.nicheId) rows.push({ bucket, reach: 1 });
    else if (b.audience === 'launch' && bucket.kind === 'buyer' && niche && findNiche(world, bucket.nicheId)?.category === niche.category) rows.push({ bucket, reach: GROWTH.email.crossCategory });
  }
  return rows;
}

function sendBroadcast(world: WorldState, a: AudienceState, rng: Rng, b: Broadcast, out: EmailClicks[]): void {
  const { click, cvrMult, fatiguePerSend, sentKept } = GROWTH.email;
  for (const { bucket, reach } of targets(world, a, b, findNiche(world, b.nicheId))) {
    const delivered = bucket.size;
    const opens = rng.binomial(delivered, openRate(bucket, b.score, world.day) * reach);
    const clicks = rng.binomial(opens, click[bucket.kind]);
    const unsubscribed = rng.binomial(delivered, unsubRate(bucket.fatigue, b.hasUnsubscribe));
    bucket.size -= unsubscribed;
    bucket.fatigue = clamp(bucket.fatigue + fatiguePerSend);
    b.delivered += delivered;
    b.opens += opens;
    b.clicks += clicks;
    b.unsubscribed += unsubscribed;
    if (clicks > 0) out.push({ productId: b.productId, clicks, cvrMult: cvrMult[bucket.kind], broadcast: b, ...(bucket.kind === 'buyer' ? { repeat: bucket.nicheId } : {}) });
  }
  b.status = 'sent';
  a.sent.push(b);
  if (a.sent.length > sentKept) a.sent.splice(0, a.sent.length - sentKept);
  a.totals.delivered += b.delivered;
  a.totals.opens += b.opens;
  a.totals.clicks += b.clicks;
  a.totals.unsubscribed += b.unsubscribed;
}

/**
 * The day's mail. Broadcasts go first: a lead leaving the pipe today already got his mail of the day. Steps are read before
 * the pipe shifts: the close first sees a lead the day after he signed up, and that is day 0 of his sequence. Past day 10
 * he joins this month's lead bucket. The tool is billed last, on who stayed.
 */
export function deliverEmails(world: WorldState, rng: Rng): { rows: EmailClicks[]; notes: string[] } {
  const a = world.market.audience;
  const rows: EmailClicks[] = [];
  const notes: string[] = [];
  if (!a) return { rows, notes };
  settleBuckets(a, world.day);
  for (const b of a.queue.splice(0)) {
    if (productById(world, b.productId)?.status !== 'live') {
      notes.push(`E-mail « ${short(b.subject, 40)} » annulé : le guide n'est plus en vente.`);
      continue;
    }
    sendBroadcast(world, a, rng, b, rows);
    if (b.delivered > 0) notes.push(`E-mail « ${short(b.subject, 40)} » : ${plural(b.delivered, 'envoi', 'envois')}, ${fmtPct(b.opens / b.delivered, 0)} d'ouverture, ${plural(b.clicks, 'clic', 'clics')}.`);
  }
  for (const [nicheId, pipe] of Object.entries(a.welcome)) {
    sendWelcome(world, a, rng, nicheId, pipe, rows);
    addToBucket(a, nicheId, 'lead', monthOf(world.day), pipe.pop() ?? 0);
    pipe.unshift(0);
  }
  const size = listSize(a);
  const cost = emailCost(size);
  if (cost > 0) recordLedger(world, { type: 'tool_subscription', amount: -cost, memo: `Outil e-mail (${fmtInt(size)} abonnés)`, ref: `email:${world.day}` });
  return { rows, notes };
}

/** `runSales` hands back what the clicks of an e-mail sold. */
export function recordEmailSales(world: WorldState, n: number, amount: number, broadcast?: Broadcast): void {
  const a = audienceOf(world);
  a.totals.sales += n;
  a.totals.revenue = round2(a.totals.revenue + amount);
  if (!broadcast) return;
  broadcast.sales += n;
  broadcast.revenue = round2(broadcast.revenue + amount);
}

/** What the company and the UI read. An open rate is measured on real sends, as a mailing tool's dashboard would, never taken from the model. */
export function audienceView(world: WorldState): AudienceView {
  const a = world.market.audience;
  if (!a) return { size: 0, leads: 0, buyers: 0, byNiche: [], unsubscribed: 0, dailyCost: 0, recent: [], sequences: [] };
  const byNiche = new Map<string, number>();
  for (const [nicheId, pipe] of Object.entries(a.welcome)) byNiche.set(nicheId, pipe.reduce((s, n) => s + n, 0));
  for (const b of a.buckets) byNiche.set(b.nicheId, (byNiche.get(b.nicheId) ?? 0) + b.size);
  const openOf = (nicheId: string): number | null => {
    const sends = a.sent.filter((b) => b.nicheId === nicheId && b.delivered > 0).slice(-OPEN_RATE_SENDS);
    return sends.length ? sends.reduce((s, b) => s + b.opens, 0) / sends.reduce((s, b) => s + b.delivered, 0) : null;
  };
  const size = listSize(a);
  const buyers = bucketed(a, 'buyer');
  return {
    size, leads: size - buyers, buyers,
    byNiche: [...byNiche].map(([nicheId, n]) => ({ nicheId, size: n, openRate: openOf(nicheId) })),
    unsubscribed: a.totals.unsubscribed, dailyCost: emailCost(size),
    recent: [...a.sent, ...a.queue].slice(-RECENT_SENDS).map(({ body: _body, ...rest }) => rest),
    sequences: a.sequences.map((s) => ({ nicheId: s.nicheId, productId: s.productId, status: s.status })),
  };
}
