/**
 * The CFO's split between channels (channels §7.4). One line is a (channel, product) with a spend-revenue curve fitted on
 * its last closed days. The envelope goes where the next euro earns the most, down to the floor under which a marginal euro
 * loses money: it may stay unspent, and a line whose average still looks fine can be cut. Reads observable rows and the
 * reconciled credit only, draws nothing, and everything it decided lives in `company.channels.plan`.
 */
import { CHANNELS, channelOf } from '../shared.js';
import type { Campaign, ChannelId, ChannelPlan, ChannelPlanLine, Product, WorldState } from '../shared.js';
import { scalingRoom } from './acquisition.js';
import { CHANNEL_POLICY } from './channelPolicy.js';
import { creditOf } from './channels.js';
import type { RuntimeCtx } from './ctx.js';
import { activeCampaigns, currentBudget } from './metrics.js';
import { sim } from './modules.js';
import { officerId } from './org/officers.js';
import { clamp, dec, eur, mean, round2, short, sum } from './util.js';

const ALLOC = CHANNEL_POLICY.alloc;

/** R = a·s^b. */
export interface Curve { a: number; b: number }

/**
 * The fit, with shrinkage: budgets that never moved give `b = prior`, which is honest. The ratio estimator for `a` survives
 * days with zero sales, where a log regression would not.
 */
export function elasticity(points: readonly { s: number; r: number }[], prior: number): Curve {
  const x = points.map((p) => Math.log(p.s));
  const y = points.map((p) => Math.log(Math.max(p.r, 0.5)));
  const mx = mean(x), my = mean(y);
  const sxy = sum(x.map((v, i) => (v - mx) * (y[i]! - my)));
  const sxx = sum(x.map((v) => (v - mx) ** 2));
  const b = clamp((sxy + ALLOC.kappa * prior) / (sxx + ALLOC.kappa), 0.15, 0.95);
  const a = sum(points.map((p) => p.r)) / Math.max(1e-6, sum(points.map((p) => p.s ** b)));
  return { a, b };
}

export const marginalAt = (c: Curve, s: number): number => c.a * c.b * s ** (c.b - 1);

/** How much a line can take before its next euro earns less than λ. */
const spendAt = (c: Curve, lambda: number): number => ((c.a * c.b) / lambda) ** (1 / (1 - c.b));

export interface Fill { lambda: number | null; spend: number[]; unspent: number }

/**
 * Bisection on λ ≥ the floor, every line brought to the same marginal ROAS. Under the floor a marginal euro loses money, so
 * what is left stays unspent. A line stopped by `lineCap` hands its excess back to the others.
 */
export function waterFill(curves: readonly Curve[], budget: number, floor: number = ALLOC.floorRoas, lineCap: number = budget): Fill {
  if (!curves.length || budget <= 0) return { lambda: null, spend: curves.map(() => 0), unspent: Math.max(0, budget) };
  const fill = (lambda: number) => curves.map((c) => Math.min(lineCap, spendAt(c, lambda)));
  const total = (lambda: number) => sum(fill(lambda));
  if (total(floor) <= budget) {
    const spend = fill(floor);
    return { lambda: floor, spend, unspent: budget - sum(spend) };
  }
  let lo = floor, hi = floor;
  while (total(hi) > budget) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > budget) lo = mid; else hi = mid;
  }
  return { lambda: hi, spend: fill(hi), unspent: 0 };
}

/** The control arm: each line gets its share of the average ROAS, whatever its next euro earns. */
function averageSplit(averages: readonly number[], budget: number, lineCap: number): Fill {
  const total = sum(averages);
  return { lambda: null, spend: averages.map((v) => (total > 0 ? Math.min(lineCap, (budget * v) / total) : 0)), unspent: 0 };
}

interface Line {
  channel: ChannelId; product: Product; campaigns: Campaign[];
  budget: number;              // Σ today's budgets
  least: number;               // what the platform accepts for all its campaigns
  points: { s: number; r: number }[];
  curve: Curve | null;         // null: too few days, the line stays as it is
  target: number; underMin: number;
}

const marginalOf = (l: Line): number | null => (l.curve ? marginalAt(l.curve, Math.max(1, l.budget)) : null);
const averageOf = (l: Line): number | null => (l.points.length ? sum(l.points.map((p) => p.r)) / sum(l.points.map((p) => p.s)) : null);

/** One line per (channel, product) running, in campaign order. Its curve reads all its rows, campaigns stopped since included: it describes the channel for this guide. */
function readLines(w: WorldState, campaigns: readonly Campaign[]): Line[] {
  const lines = new Map<string, Line>();
  for (const c of campaigns) {
    const product = w.company.products.find((p) => p.id === c.productId);
    if (!product) continue;
    const channel = channelOf(c);
    const key = `${channel}:${product.id}`;
    const line = lines.get(key) ?? { channel, product, campaigns: [], budget: 0, least: 0, points: [], curve: null, target: 0, underMin: 0 };
    line.campaigns.push(c);
    line.budget += c.dailyBudget;
    line.least += CHANNELS[channel].minDailyBudget;
    lines.set(key, line);
  }
  const toDay = sim.lastClosedDay(w);
  const fromDay = toDay - ALLOC.windowDays + 1;
  const outage = sim.announcedOutageDays(w);
  const days = new Map<string, Map<number, { s: number; r: number }>>();
  const rows = w.market.adStats;
  for (let i = rows.length - 1; i >= 0 && rows[i]!.day >= fromDay; i--) {
    const r = rows[i]!;
    const key = `${channelOf(r)}:${r.productId}`;
    if (r.day > toDay || outage.includes(r.day) || !lines.has(key)) continue;
    const of = days.get(key) ?? new Map<number, { s: number; r: number }>();
    const day = of.get(r.day) ?? { s: 0, r: 0 };
    day.s += r.spend;
    day.r += r.revenue; // a tail row has no spend: its sales land on the day that keeps paying for the pin
    of.set(r.day, day);
    days.set(key, of);
  }
  for (const [key, line] of lines) {
    const credit = creditOf(w, line.channel, line.product.nicheId);
    line.points = [...(days.get(key)?.values() ?? [])].filter((p) => p.s >= ALLOC.minSpendDay).map((p) => ({ s: p.s, r: credit * p.r }));
    if (line.points.length >= ALLOC.minDays) line.curve = elasticity(line.points, ALLOC.priorElasticity[CHANNELS[line.channel].buying]);
    line.target = line.budget;
  }
  return [...lines.values()];
}

/** ±30 % a day. Under what the platform accepts the line waits at the minimum, then stops after 3 days in a row. */
function stepTo(line: Line, wanted: number, daysUnder: number): void {
  const stepped = clamp(wanted, line.budget * (1 - ALLOC.maxStep), line.budget * (1 + ALLOC.maxStep));
  line.underMin = stepped < line.least ? daysUnder + 1 : 0;
  line.target = line.underMin >= ALLOC.trimDays ? 0 : Math.max(stepped, line.least);
}

/**
 * Σ targets ≤ `room`, whatever else moved: pro rata of what can still come off, so that no campaign falls under what its
 * platform accepts. When the minimums alone do not fit, the line whose next euro earns the least stops.
 */
function fitInto(lines: readonly Line[], room: number): void {
  for (;;) {
    const live = lines.filter((l) => l.target > 0);
    const over = sum(live.map((l) => l.target)) - room;
    if (over <= 0) return;
    const slack = sum(live.map((l) => l.target - l.least));
    if (slack >= over) {
      for (const l of live) l.target -= ((l.target - l.least) * over) / slack;
      return;
    }
    const value = (l: Line) => marginalOf(l) ?? Number.POSITIVE_INFINITY; // not measured yet: the last to go
    live.reduce((a, b) => (value(b) < value(a) ? b : a)).target = 0;
  }
}

const cents = (x: number): number => Math.floor(x * 100 + 1e-6) / 100;

/** A line's target over its campaigns, pro rata of today's budgets, each at what its platform accepts or more. */
function splitLine(line: Line): Record<string, number> {
  const parts: Record<string, number> = {};
  if (line.target <= 0) {
    for (const c of line.campaigns) parts[c.id] = 0;
    return parts;
  }
  const min = CHANNELS[line.channel].minDailyBudget;
  let left = line.target;
  let rest = line.campaigns;
  for (;;) {
    const weight = sum(rest.map((c) => c.dailyBudget));
    const under = rest.filter((c) => (left * c.dailyBudget) / weight < min);
    if (!under.length) {
      for (const c of rest) parts[c.id] = cents((left * c.dailyBudget) / weight);
      return parts;
    }
    for (const c of under) parts[c.id] = min;
    left -= under.length * min;
    rest = rest.filter((c) => !under.includes(c));
    if (!rest.length) return parts;
  }
}

const labelOf = (ch: ChannelId): string => CHANNELS[ch].label;

/** The buyer's line for this move: « Meta sommeil : 40 € → 52 €/jour, ROAS marginal 1,62 contre 1,18 sur TikTok ». */
function noteOf(line: Line, target: number, lines: readonly Line[]): string {
  const name = `${labelOf(line.channel)} « ${short(line.product.title, 30)} »`;
  if (!line.curve) return `${name} : ${eur(line.budget)}/jour, moins de ${ALLOC.minDays} jours de mesure, budget inchangé`;
  if (target <= 0) return `${name} : ligne arrêtée, sous le minimum de ${labelOf(line.channel)} depuis ${ALLOC.trimDays} jours`;
  const marginal = marginalOf(line)!;
  const others = lines.filter((l) => l !== line && l.channel !== line.channel && l.curve);
  const rising = target >= line.budget;
  const rival = others.reduce<Line | null>((best, l) => (!best || (rising ? marginalOf(l)! < marginalOf(best)! : marginalOf(l)! > marginalOf(best)!) ? l : best), null);
  return `${name} : ${eur(line.budget)} → ${eur(target)}/jour, ROAS marginal ${dec(marginal)}${rival ? ` contre ${dec(marginalOf(rival)!)} sur ${labelOf(rival.channel)}` : ''}`;
}

/** Today's plan, written in the book. Campaigns on test stay out of it; everything else running has a line. */
export function allocateChannels(ctx: RuntimeCtx): ChannelPlan {
  const w = ctx.world;
  const book = w.company.channels!;
  const adCap = currentBudget(w).adCap;
  const active = activeCampaigns(w);
  const lines = readLines(w, active.filter((c) => !c.test));
  // A guide still waiting for its first test keeps its share: the rule of the buyer's own envelope, the plan does not spend it.
  const usable = lines[0] ? scalingRoom(w, lines[0].product, adCap) : adCap;
  const room = Math.max(0, usable - sum(active.filter((c) => c.test).map((c) => c.dailyBudget)));
  const measured = lines.filter((l) => l.curve);
  const left = Math.max(0, room - sum(lines.filter((l) => !l.curve).map((l) => l.budget)));
  const lineCap = ALLOC.maxLineShare * room;
  const fill = w.scenario.channelControl === 'average_roas'
    ? averageSplit(measured.map((l) => averageOf(l) ?? 0), left, lineCap)
    : waterFill(measured.map((l) => l.curve!), left, ALLOC.floorRoas, lineCap);
  const yesterday = book.plan?.day === w.day - 1 ? book.plan.lines : [];
  measured.forEach((l, i) => {
    const before = yesterday.find((y) => y.channel === l.channel && y.productId === l.product.id);
    stepTo(l, fill.spend[i]!, before?.underMin ?? 0);
  });
  fitInto(lines, room);
  const planLines = lines.map((l): ChannelPlanLine => {
    const campaignTargets = splitLine(l);
    const target = round2(sum(Object.values(campaignTargets)));
    return {
      channel: l.channel, productId: l.product.id, campaignIds: l.campaigns.map((c) => c.id),
      budget: round2(l.budget), target, campaignTargets,
      average: averageOf(l), marginal: marginalOf(l), elasticity: l.curve?.b ?? null, days: l.points.length,
      note: noteOf(l, target, lines), ...(l.underMin ? { underMin: l.underMin } : {}),
    };
  });
  const plan: ChannelPlan = {
    day: w.day, envelope: adCap, testEnvelope: round2(adCap * CHANNEL_POLICY.testShare),
    lambda: fill.lambda, unspent: measured.length ? round2(fill.unspent) : 0, lines: planLines,
  };
  book.plan = plan;
  return plan;
}

function planLineOf(w: WorldState, c: Campaign): ChannelPlanLine | undefined {
  const plan = w.company.channels?.plan;
  return plan?.day === w.day ? plan.lines.find((l) => l.campaignIds.includes(c.id)) : undefined;
}

/** The plan's daily budget for a campaign, 0 when the plan stops its line; null keeps today's scale and trim rules (D26). */
export function planTarget(w: WorldState, c: Campaign): number | null {
  return planLineOf(w, c)?.campaignTargets?.[c.id] ?? null;
}

/** What the buyer says when this campaign moves. */
export function planNote(w: WorldState, c: Campaign): string | null {
  return planLineOf(w, c)?.note ?? null;
}

/** Ritual allocate_channels, once 2 channels have active campaigns. Survival, outages and a negative cash keep their own rules above all this. */
export async function allocationMorning(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  if (!w.company.channels || new Set(activeCampaigns(w).map(channelOf)).size < 2) return;
  const { survival, outage, bankrupt } = currentBudget(w);
  if (survival || outage || bankrupt) return;
  await ctx.ritual('allocate_channels', officerId(w, 'cfo'), `Répartir le budget entre les canaux, jour ${w.day}`);
}
