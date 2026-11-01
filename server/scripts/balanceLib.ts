/**
 * Market-balance benchmark: runs headless companies (heuristic engine by default) and measures what a
 * founder cares about — profit, goal, bankruptcy, learning (CTR / ROAS of the 2nd half vs the 1st, fresh-creative
 * CTR and angle fit beside them) — plus the artefacts a fair market must never show: profit cliffs without a
 * cause, paid-ads stalls, KPI cash ≠ ledger, NaN. Used by scripts/balance.ts and scripts/calibrate.ts (CLI) and by
 * test/balance.test.ts (smoke runs). It reads hidden truth (talent, market): it stays outside the product.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPaths, summarizeLedger } from '../src/core/index.js';
import { RECON } from '../src/learning/attribution.js';
import { createBrainVault } from '../src/learning/index.js';
import { FRESH_CREATIVE_IMPRESSIONS } from '../src/learning/retro.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { adBanActive, promotionBlock } from '../src/runtime/acquisition.js';
import { CFO } from '../src/runtime/cfo.js';
import { CHANNEL_POLICY } from '../src/runtime/channelPolicy.js';
import { COMPACT } from '../src/runtime/compaction.js';
import { isUpsellProduct } from '../src/runtime/metrics.js';
import { ORG } from '../src/runtime/org/constants.js';
import { PORTFOLIO } from '../src/runtime/portfolio.js';
import { STAGE_GATES, STAGE_POLICY } from '../src/runtime/stages.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { KIND_SKILL } from '../src/runtime/talent/skills.js';
import * as BALANCE from '../src/sim/balance.js';
import {
  ASSIST, CHANNEL_EVENTS, CHANNEL_SIM, CLAIMS, COST_HINT, FAMILY_FATIGUE, LEARNING, PAID_TAIL, SEARCH, setChannelNumber, TIKTOK_OVERLAP,
} from '../src/sim/channelBalance.js';
import { financeSnapshot } from '../src/sim/finance.js';
import { GROWTH } from '../src/sim/growth.js';
import { VIDEO_MARKET } from '../src/sim/videoCraft.js';
import { VISUAL } from '../src/sim/visual.js';
import type { RunPaths } from '../src/contracts.js';
import { channelOf } from '../src/shared.js';
import type { DailyKpi, Difficulty, LeagueState, MindMode, ScenarioConfig, Skill, TalentTruth, WeekRollup, WorldEvent, WorldState } from '../src/shared.js';

export const DIFFICULTIES: readonly Difficulty[] = ['facile', 'normal', 'cauchemar'];

export interface RunSpec {
  difficulty: Difficulty;
  seed: number;
  days: number;
  budget: number;
  /** 'claude' without a key must fall back to the heuristic engine (never calls the API: no key is passed). */
  mindMode?: MindMode;
  founderApproval?: boolean;
  /** founderApproval runs: approve every task awaiting the founder at the end of each day (a diligent founder). */
  autoApprove?: boolean;
  /** Keep the run folder under runs/<runId> (world.json saved) instead of a deleted temp folder. */
  keep?: boolean;
  runId?: string;
  /** Calibration overrides for this process, e.g. { 'ADS.baseCtr': 0.007, 'DIFFICULTY.cauchemar.cpmMultiplier': 1.5 }. */
  overrides?: Record<string, number>;
  /** Scenario fields of this run, over the benchmark's own. */
  scenario?: Partial<ScenarioConfig>;
  /** Where the proof of talent reads a run. Absent: `DEFAULT_WINDOWS`. A smoke run is too short for them. */
  windows?: RunWindows;
}

export interface RunWindows {
  /** Days whose finished tasks weigh the assignees' talent (M2). */
  work: [number, number];
  /** Evening the ratings are read against the truth (M7). */
  ratingsDay: number;
}

/** Talent §10.2. */
export const DEFAULT_WINDOWS: RunWindows = { work: [31, 60], ratingsDay: 42 };

export interface DayRow {
  day: number;
  cash: number;
  ledgerCash: number;
  revenue: number;
  /** What the day's ad rows sold. The market keeps those rows 90 days, this column keeps them all. */
  adRevenue: number;
  adSpend: number;
  cumulativeProfit: number;
  sales: number;
  refunds: number;
  impressions: number;
  clicks: number;
  /** TikTok rows of creatives under FRESH_CREATIVE_IMPRESSIONS: neither fatigue nor the channel mix shows there. */
  freshImpressions: number;
  freshClicks: number;
  /** Angle fit of the day's TikTok rows, summed by impression: divide by `fitImpressions`. Reads the market's truth. */
  fitSum: number;
  fitImpressions: number;
  /** A live, non-upsell product passes the quality gate (could take paid ads). */
  sellable: boolean;
  banned: boolean;
  survival: boolean;
  nan: string[];
}

export interface Cliff { fromDay: number; toDay: number; peak: number; low: number; events: string[] }
export interface Stall { fromDay: number; toDay: number; days: number }

/** One person on one skill, the evening of `RunWindows.ratingsDay`. */
export interface RatedPair { skill: Skill; rating: number; truth: number }
/** Close of the days the calibration reads. Null: the run stopped earlier. */
export interface CashOn { d60: number | null; d90: number | null; d120: number | null; d180: number | null; last: number | null }

export interface RunResult {
  difficulty: Difficulty;
  seed: number;
  days: number;
  budget: number;
  mindMode: string;
  finalCash: number;
  profit: number;
  peakProfit: number;
  firstProfitDay: number | null;
  goalDay: number | null;
  bankrupt: boolean;
  bankruptDay: number | null;
  finalStatus: string;
  products: number;
  live: number;
  killed: number;
  paused: number;
  sales: number;
  revenue: number;
  adSpend: number;
  roas1: number | null;
  roas2: number | null;
  ctr1: number | null;
  ctr2: number | null;
  /** Fresh-creative CTR and angle fit of each half: where learning shows when spend scales and ROAS falls with saturation. */
  fresh1: number | null;
  fresh2: number | null;
  fit1: number | null;
  fit2: number | null;
  refundPct: number;
  lessons: number;
  /** Agents still in the company on the last day. */
  headcount: number;
  /** Everything paid to people over the run: salaries, plus the one-offs of hires and departures. */
  payroll: number;
  hires: number;
  departures: number;
  /** Seats the league gave to someone from the market: a challenge the incumbent lost. */
  replacements: number;
  /** Broken org invariants, summed over every evening. Must stay 0. */
  violations: number;
  /** Days the CFO ran under the survival line. */
  survivalDays: number;
  cliffs: Cliff[];
  stalls: Stall[];
  kpiMismatchDays: number[];
  nanDays: number[];
  awaitingFounder: number;
  seconds: number;
  dir: string | null;
  rows: DayRow[];
  cashOn: CashOn;
  /** Null with talent off. */
  league: Pick<LeagueState, 'parStats'> | null;
  /** The hidden truth, for the proof. Null with talent off. */
  talentTruth: Pick<TalentTruth, 'samples' | 'swaps'> | null;
  growth: { weeks: WeekRollup[] };
  /** M2: the assignee's true talent on the skill of each task finished in `RunWindows.work`, summed. */
  work: { tasks: number; talent: number };
  /** M7: every rated person on every skill they were rated on. */
  ratings: RatedPair[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function finite(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

function ledgerCashUpTo(world: WorldState, day: number): number {
  let s = 0;
  for (const e of world.ledger) if (e.day <= day) s += e.amount;
  return r2(s);
}

function sellable(world: WorldState): boolean {
  return world.company.products.some((p) => p.status === 'live' && !isUpsellProduct(world, p.id) && !promotionBlock(world, p));
}

/** The CFO's reading of `day`. Never `world.day`: the evening callback runs once the clock has moved to the next morning. */
export function survivalOn(world: Pick<WorldState, 'company'>, day: number): boolean {
  const b = world.company.budget;
  return !!b && b.day === day && b.survival;
}

/** Under this a share of impressions reads nothing: the rule of the CTR halves. */
const MIN_READ_IMPRESSIONS = 2000;

/** Paid-ads stats of a day window [from, to], from the daily rows: they hold the whole run, the market's rows the last 90 days. */
export function adWindow(rows: readonly DayRow[], from: number, to: number): { spend: number; revenue: number; impressions: number; clicks: number; roas: number | null; ctr: number | null; freshCtr: number | null; fit: number | null } {
  let spend = 0, revenue = 0, impressions = 0, clicks = 0, freshImpressions = 0, freshClicks = 0, fitSum = 0, fitImpressions = 0;
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    spend += r.adSpend; revenue += r.adRevenue; impressions += r.impressions; clicks += r.clicks;
    freshImpressions += r.freshImpressions; freshClicks += r.freshClicks; fitSum += r.fitSum; fitImpressions += r.fitImpressions;
  }
  return {
    spend: r2(spend), revenue: r2(revenue), impressions, clicks,
    roas: spend >= 20 ? revenue / spend : null,
    ctr: impressions >= MIN_READ_IMPRESSIONS ? clicks / impressions : null,
    freshCtr: freshImpressions >= MIN_READ_IMPRESSIONS ? freshClicks / freshImpressions : null,
    fit: fitImpressions >= MIN_READ_IMPRESSIONS ? fitSum / fitImpressions : null,
  };
}

/**
 * The bankruptcy of the health sweep and of `RunResult.bankrupt`: at least one close below zero up to that day, recovered or
 * not. That is what `checkStatus` reads on the evening's cash, so the first such day is the day of the `bankrupt` event.
 */
export const bankruptBy = (rows: readonly DayRow[], day: number): boolean => rows.some((r) => r.day <= day && r.cash < 0);

/** Below zero on the last day: a bankruptcy it did not come back from. */
export const deadAtEnd = (rows: readonly DayRow[]): boolean => (rows[rows.length - 1]?.cash ?? 0) < 0;

export const closeOn = (rows: readonly DayRow[], day: number): DayRow | null => rows.find((r) => r.day === day) ?? null;

/** Where a pair stands against the niche's best: 1 is the best hook on the best format. Null on a pair the niche never rated. */
function angleFit(hook: number | undefined, format: number | undefined, hooks: readonly number[], formats: readonly number[]): number | null {
  if (hook === undefined || format === undefined || !hooks.length || !formats.length) return null;
  return (hook * format) / (Math.max(...hooks) * Math.max(...formats));
}

/** The ad columns of one evening. `seen` holds each creative's TikTok impressions of the days before. */
function adColumns(world: WorldState, day: number, seen: Map<string, number>): Pick<DayRow, 'adRevenue' | 'freshImpressions' | 'freshClicks' | 'fitSum' | 'fitImpressions'> {
  const creatives = new Map(world.company.creatives.map((c) => [c.id, c]));
  const niches = new Map(world.company.products.map((p) => [p.id, world.market.niches.find((n) => n.id === p.nicheId)]));
  const today = new Map<string, number>();
  const out = { adRevenue: 0, freshImpressions: 0, freshClicks: 0, fitSum: 0, fitImpressions: 0 };
  for (const s of world.market.adStats) {
    if (s.day !== day) continue;
    out.adRevenue += s.revenue;
    if (channelOf(s) !== 'tiktok' || s.tail) continue; // a channel's CTR is its own: a mix shift is no learning
    if ((seen.get(s.creativeId) ?? 0) < FRESH_CREATIVE_IMPRESSIONS) { out.freshImpressions += s.impressions; out.freshClicks += s.clicks; }
    today.set(s.creativeId, (today.get(s.creativeId) ?? 0) + s.impressions);
    const creative = creatives.get(s.creativeId);
    const niche = niches.get(s.productId);
    const fit = creative && niche ? angleFit(niche.hookAffinity[creative.hookStyle], niche.formatAffinity[creative.format], Object.values(niche.hookAffinity), Object.values(niche.formatAffinity)) : null;
    if (fit !== null) { out.fitSum += fit * s.impressions; out.fitImpressions += s.impressions; }
  }
  for (const [id, n] of today) seen.set(id, (seen.get(id) ?? 0) + n);
  return { ...out, adRevenue: r2(out.adRevenue) };
}

/** Same filter as `sampleTalent`, one line per task and not per day: a busy day weighs what it did. */
function workedTalent(world: WorldState, day: number): number[] {
  const truth = world.talentTruth;
  if (!truth) return [];
  return world.company.tasks.flatMap((task) => {
    const skill = KIND_SKILL[task.kind];
    if (task.dayDone !== day || task.status !== 'done' || !skill || !task.assignee) return [];
    return truth.agents[task.assignee]?.talent[skill] ?? [];
  });
}

function ratedPairs(world: WorldState): RatedPair[] {
  const truth = world.talentTruth;
  const entries = Object.values(world.company.league?.entries ?? {}).filter((e) => e.status !== 'gone');
  return entries.flatMap((e) => Object.values(e.ratings).flatMap((r) => {
    const t = truth?.agents[e.agentId]?.talent[r.skill];
    return r.n > 0 && t !== undefined ? [{ skill: r.skill, rating: r.rating, truth: t }] : [];
  }));
}

const EXPLAINING_EVENTS: ReadonlySet<WorldEvent['kind']> = new Set([
  'cpm_spike', 'ad_rejected', 'ad_account_warning', 'ad_account_banned', 'competitor_clone', 'payment_hold', 'trend_shift',
  'bad_review_wave', 'scam_attempt', 'platform_outage', 'bankrupt',
]);

/** Cumulative profit losing > 40 % of a (≥ 100 €) peak in less than 7 days. */
export function findCliffs(world: WorldState, rows: DayRow[], minPeak = 100, drop = 0.4, window = 6): Cliff[] {
  const out: Cliff[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    let peak = -Infinity, peakDay = cur.day;
    for (let j = Math.max(0, i - window); j < i; j++) if (rows[j]!.cumulativeProfit > peak) { peak = rows[j]!.cumulativeProfit; peakDay = rows[j]!.day; }
    if (peak < minPeak || cur.cumulativeProfit > peak * (1 - drop)) continue;
    const last = out[out.length - 1];
    if (last && peakDay <= last.toDay) { last.toDay = cur.day; last.low = Math.min(last.low, cur.cumulativeProfit); continue; }
    const events = world.market.events
      .filter((e) => e.day >= peakDay && e.day <= cur.day && EXPLAINING_EVENTS.has(e.kind))
      .map((e) => `J${e.day} ${e.kind}`);
    // Logged money moves that explain a drop without an event: paid days without a single sale, refund waves.
    for (const r of rows) {
      if (r.day <= peakDay || r.day > cur.day) continue;
      if (r.adSpend >= 20 && r.sales === 0) events.push(`J${r.day} 0 vente pour ${Math.round(r.adSpend)} € de pub`);
      const refunds = world.ledger.filter((e) => e.day === r.day && (e.type === 'refund' || e.type === 'chargeback')).reduce((s, e) => s - e.amount, 0);
      if (refunds >= 40) events.push(`J${r.day} ${Math.round(refunds)} € remboursés`);
    }
    out.push({ fromDay: peakDay, toDay: cur.day, peak: r2(peak), low: r2(cur.cumulativeProfit), events });
  }
  return out;
}

/** More than `maxIdle` days in a row without ad spend while cash > 30 % of the start, a sellable product exists and ads are not banned. */
export function findStalls(rows: DayRow[], budget: number, maxIdle = 2): Stall[] {
  const out: Stall[] = [];
  let start: number | null = null;
  let len = 0;
  const flush = (endDay: number) => {
    if (start !== null && len > maxIdle) out.push({ fromDay: start, toDay: endDay, days: len });
    start = null; len = 0;
  };
  for (const r of rows) {
    const idle = r.adSpend <= 0 && r.cash > 0.3 * budget && r.sellable && !r.banned;
    if (idle) { if (start === null) start = r.day; len++; } else flush(r.day - 1);
  }
  flush(rows.length ? rows[rows.length - 1]!.day : 0);
  return out;
}

function kpiNaN(k: DailyKpi): string[] {
  return Object.entries(k).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([key]) => key);
}

async function makePaths(spec: RunSpec, runId: string): Promise<{ paths: RunPaths; cleanup: () => Promise<void> }> {
  if (spec.keep) return { paths: runPaths(runId), cleanup: async () => undefined };
  const root = await mkdtemp(join(tmpdir(), 'pixel-balance-'));
  return {
    paths: { root, brain: join(root, 'brain'), files: join(root, 'files') },
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined),
  };
}

/** Every object a calibration may move (PLAN §2.9), by the name a path starts with. Readers read them at call time: no copy at import. */
const OVERRIDABLE: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(BALANCE).filter(([, v]) => typeof v === 'object')),
  ORG, TALENT, CHANNEL_SIM, SEARCH, ASSIST, CLAIMS, CHANNEL_EVENTS, LEARNING, PAID_TAIL, COST_HINT, CHANNEL_POLICY, RECON, VIDEO_MARKET, VISUAL, GROWTH,
  STAGE_POLICY, STAGE_GATES, COMPACT, CFO, PORTFOLIO,
};

const isChannelNumber = (path: string): path is 'TIKTOK_OVERLAP' | 'FAMILY_FATIGUE' => path === 'TIKTOK_OVERLAP' || path === 'FAMILY_FATIGUE';

const own = (obj: unknown, key: string): unknown => (obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? (obj as Record<string, unknown>)[key] : undefined);

/** The object that holds the number at `path`, and its last key. Throws on anything else, so a typo never benchmarks the default market. */
function overrideSlot(path: string): { holder: Record<string, number>; key: string } {
  const keys = path.split('.');
  const key = keys.pop()!;
  const holder = keys.reduce<unknown>(own, OVERRIDABLE);
  if (!keys.length || typeof own(holder, key) !== 'number') throw new Error(`Constante inconnue ou non numérique : ${path}`);
  return { holder: holder as Record<string, number>, key };
}

/** Today's value of a constant, by the path `applyOverrides` takes. */
export function constantAt(path: string): number {
  if (isChannelNumber(path)) return path === 'TIKTOK_OVERLAP' ? TIKTOK_OVERLAP : FAMILY_FATIGUE;
  const { holder, key } = overrideSlot(path);
  return holder[key]!;
}

/**
 * Applies calibration overrides to the live constants of §2.9 (process-wide: the readers read them at call time) and returns
 * what they replaced. Throws on an unknown path, on a path that is not a number, on a value that is not one.
 */
export function applyOverrides(overrides: Record<string, number> | undefined): Record<string, number> {
  const before: Record<string, number> = {};
  for (const [path, value] of Object.entries(overrides ?? {})) {
    if (!Number.isFinite(value)) throw new Error(`Valeur non numérique pour ${path}`);
    before[path] = constantAt(path);
    if (isChannelNumber(path)) { setChannelNumber(path, value); continue; }
    const { holder, key } = overrideSlot(path);
    holder[key] = value;
  }
  return before;
}

/** One headless company, `spec.days` days, measured every evening. */
export async function runOne(spec: RunSpec): Promise<RunResult> {
  const t0 = performance.now();
  applyOverrides(spec.overrides);
  const mindMode: MindMode = spec.mindMode ?? 'heuristic';
  const runId = spec.runId ?? `bench-${spec.difficulty}-${spec.seed}`;
  const { paths, cleanup } = await makePaths(spec, runId);
  try {
    const scenario = defaultScenario({
      name: `Benchmark ${spec.difficulty} — graine ${spec.seed}`,
      startingCash: spec.budget,
      difficulty: spec.difficulty,
      seed: spec.seed,
      mindMode,
      founderApproval: spec.founderApproval ?? false,
      maxComputeEur: 0,
      horizonDays: Math.max(60, spec.days),
      ...spec.scenario,
    });
    const world = createWorld(scenario, runId);
    // No API key on purpose: a 'claude' benchmark measures the fallback, never spends money.
    const engine = createContentEngine({ mode: mindMode, apiKey: undefined, maxComputeEur: 0, seed: scenario.seed, log: () => undefined });
    world.mind.mode = engine.mode;
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine, brain });
    const rows: DayRow[] = [];
    const kpiMismatchDays: number[] = [];
    const nanDays: number[] = [];
    const { work: [workFrom, workTo], ratingsDay } = spec.windows ?? DEFAULT_WINDOWS;
    const seen = new Map<string, number>();
    const work = { tasks: 0, talent: 0 };
    let ratings: RatedPair[] = [];
    await company.runDays(spec.days, (kpi) => {
      const ledgerCash = ledgerCashUpTo(world, kpi.day);
      const nan = kpiNaN(kpi);
      if (nan.length) nanDays.push(kpi.day);
      if (Math.abs(kpi.cash - ledgerCash) > 0.011) kpiMismatchDays.push(kpi.day);
      rows.push({
        day: kpi.day, cash: kpi.cash, ledgerCash, revenue: kpi.revenue, adSpend: kpi.adSpend, cumulativeProfit: kpi.cumulativeProfit,
        sales: kpi.sales, refunds: kpi.refunds, impressions: kpi.impressions, clicks: kpi.clicks, ...adColumns(world, kpi.day, seen),
        sellable: sellable(world), banned: adBanActive(world), survival: survivalOn(world, kpi.day), nan,
      });
      if (kpi.day >= workFrom && kpi.day <= workTo) for (const t of workedTalent(world, kpi.day)) { work.tasks += 1; work.talent += t; }
      if (kpi.day === ratingsDay) ratings = ratedPairs(world);
      if (spec.autoApprove) {
        for (const t of world.company.tasks) if (t.status === 'awaiting_founder') company.approve(t.id, true);
      }
    });
    const fin = financeSnapshot(world);
    if (!finite(fin.cash) || !finite(fin.profit)) nanDays.push(world.day);
    const products = world.company.products;
    const half = Math.floor(spec.days / 2);
    const a1 = adWindow(rows, 1, half);
    const a2 = adWindow(rows, half + 1, spec.days);
    // Daily rows, not `market.orders`: compaction leaves 120 days of orders in the world.
    const sales = rows.reduce((n, r) => n + r.sales, 0);
    const refunded = rows.reduce((n, r) => n + r.refunds, 0);
    const goalEvent = world.market.events.find((e) => e.kind === 'goal_reached');
    const bankruptEvent = world.market.events.find((e) => e.kind === 'bankrupt');
    const firstProfit = rows.find((r) => r.cumulativeProfit > 0);
    const goalRow = rows.find((r) => r.cumulativeProfit >= scenario.goal.targetProfit);
    const org = world.company.org?.stats;
    const cashAt = (day: number): number | null => closeOn(rows, day)?.cash ?? null;
    const league = world.company.league;
    const truth = world.talentTruth;
    if (spec.keep) {
      const persist = await import('../src/api/persist.js');
      await persist.saveWorld(world, { finance: { cash: fin.cash, profit: fin.profit } });
    }
    return {
      difficulty: spec.difficulty, seed: spec.seed, days: spec.days, budget: spec.budget, mindMode: engine.mode,
      finalCash: fin.cash, profit: fin.profit,
      peakProfit: r2(Math.max(0, ...rows.map((r) => r.cumulativeProfit))),
      firstProfitDay: firstProfit?.day ?? null,
      goalDay: goalEvent?.day ?? goalRow?.day ?? null,
      bankrupt: !!bankruptEvent || bankruptBy(rows, spec.days),
      bankruptDay: bankruptEvent?.day ?? rows.find((r) => r.cash < 0)?.day ?? null,
      finalStatus: world.status,
      products: products.length,
      live: products.filter((p) => p.status === 'live').length,
      killed: products.filter((p) => p.status === 'killed').length,
      paused: products.filter((p) => p.status === 'paused').length,
      sales,
      revenue: fin.revenue,
      adSpend: fin.adSpend,
      roas1: a1.roas, roas2: a2.roas, ctr1: a1.ctr, ctr2: a2.ctr,
      fresh1: a1.freshCtr, fresh2: a2.freshCtr, fit1: a1.fit, fit2: a2.fit,
      refundPct: sales ? refunded / sales : 0,
      lessons: world.company.lessons.length,
      headcount: world.company.agents.length,
      payroll: summarizeLedger(world.ledger, world.day).payroll,
      hires: org?.hires ?? 0,
      departures: org?.departures ?? 0,
      replacements: (world.company.league?.hires ?? []).filter((h) => h.hired).length,
      violations: org?.violations ?? 0,
      survivalDays: rows.filter((r) => r.survival).length,
      cliffs: findCliffs(world, rows),
      stalls: findStalls(rows, spec.budget),
      kpiMismatchDays,
      nanDays,
      awaitingFounder: world.company.tasks.filter((t) => t.status === 'awaiting_founder').length,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      dir: spec.keep ? paths.root : null,
      rows,
      cashOn: { d60: cashAt(60), d90: cashAt(90), d120: cashAt(120), d180: cashAt(180), last: rows[rows.length - 1]?.cash ?? null },
      league: league ? { parStats: league.parStats } : null,
      talentTruth: truth ? { samples: truth.samples, swaps: truth.swaps } : null,
      growth: { weeks: world.company.growth?.weeks ?? [] },
      work: { tasks: work.tasks, talent: Math.round(work.talent * 1e6) / 1e6 },
      ratings,
    };
  } finally {
    await cleanup();
  }
}

// ───────────────────────────── aggregates ─────────────────────────────

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function improved(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && b > a;
}

export interface Aggregate {
  difficulty: Difficulty;
  runs: number;
  medianProfit: number;
  minProfit: number;
  maxProfit: number;
  profitable: number;
  goal: number;
  bankrupt: number;
  /** Null when the runs stopped before that day. `bankruptBy` says what a bankruptcy reads. */
  bankruptD60: number | null;
  bankruptD180: number | null;
  dead: number;
  medianFirstProfitDay: number | null;
  ctrImproved: number;
  roasImproved: number;
  bothImproved: number;
  freshImproved: number;
  fitImproved: number;
  medianFresh1: number | null;
  medianFresh2: number | null;
  medianFit1: number | null;
  medianFit2: number | null;
  cliffs: number;
  unexplainedCliffs: number;
  stalls: number;
  kpiMismatches: number;
  nan: number;
  medianHeadcount: number;
  medianPayroll: number;
  hires: number;
  departures: number;
  violations: number;
}

export function aggregate(results: RunResult[], difficulty: Difficulty): Aggregate | null {
  const rs = results.filter((r) => r.difficulty === difficulty);
  if (!rs.length) return null;
  const profits = rs.map((r) => r.profit);
  const firsts = rs.map((r) => r.firstProfitDay).filter((d): d is number => d !== null);
  const medianOf = (read: (r: RunResult) => number | null): number | null => {
    const xs = rs.map(read).filter((x): x is number => x !== null);
    return xs.length ? median(xs) : null;
  };
  const bankruptAt = (day: number): number | null => (rs.every((r) => r.days >= day) ? rs.filter((r) => bankruptBy(r.rows, day)).length : null);
  return {
    difficulty,
    runs: rs.length,
    medianProfit: r2(median(profits)),
    minProfit: Math.min(...profits),
    maxProfit: Math.max(...profits),
    profitable: rs.filter((r) => r.profit > 0).length,
    goal: rs.filter((r) => r.goalDay !== null).length,
    bankrupt: rs.filter((r) => r.bankrupt).length,
    bankruptD60: bankruptAt(60),
    bankruptD180: bankruptAt(180),
    dead: rs.filter((r) => deadAtEnd(r.rows)).length,
    medianFirstProfitDay: firsts.length ? median(firsts) : null,
    ctrImproved: rs.filter((r) => improved(r.ctr1, r.ctr2)).length,
    roasImproved: rs.filter((r) => improved(r.roas1, r.roas2)).length,
    bothImproved: rs.filter((r) => improved(r.ctr1, r.ctr2) && improved(r.roas1, r.roas2)).length,
    freshImproved: rs.filter((r) => improved(r.fresh1, r.fresh2)).length,
    fitImproved: rs.filter((r) => improved(r.fit1, r.fit2)).length,
    medianFresh1: medianOf((r) => r.fresh1),
    medianFresh2: medianOf((r) => r.fresh2),
    medianFit1: medianOf((r) => r.fit1),
    medianFit2: medianOf((r) => r.fit2),
    cliffs: rs.reduce((n, r) => n + r.cliffs.length, 0),
    unexplainedCliffs: rs.reduce((n, r) => n + r.cliffs.filter((c) => !c.events.length).length, 0),
    stalls: rs.reduce((n, r) => n + r.stalls.length, 0),
    kpiMismatches: rs.reduce((n, r) => n + r.kpiMismatchDays.length, 0),
    nan: rs.reduce((n, r) => n + r.nanDays.length, 0),
    medianHeadcount: median(rs.map((r) => r.headcount)),
    medianPayroll: r2(median(rs.map((r) => r.payroll))),
    hires: rs.reduce((n, r) => n + r.hires, 0),
    departures: rs.reduce((n, r) => n + r.departures, 0),
    violations: rs.reduce((n, r) => n + r.violations, 0),
  };
}

// ───────────────────────────── formatting ─────────────────────────────

export function eur(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${s} €`;
}
export const num = (n: number | null, d = 2) => (n === null ? '—' : n.toFixed(d).replace('.', ','));
export const pctS = (n: number | null, d = 1) => (n === null ? '—' : `${(n * 100).toFixed(d).replace('.', ',')} %`);
const dayS = (d: number | null) => (d === null ? '—' : `J${d}`);
const arrow = (a: number | null, b: number | null, fmt: (n: number | null) => string) => `${fmt(a)}→${fmt(b)}${improved(a, b) ? ' ↑' : a !== null && b !== null ? ' ↓' : ''}`;

const COLUMNS: [string, number][] = [
  ['Difficulté', 10], ['Graine', 6], ['Trésorerie', 10], ['Profit', 9], ['Pic', 9], ['J>0', 4], ['Objectif', 8], ['Faillite', 8],
  ['Produits (en ligne/arrêtés)', 12], ['ROAS 1→2', 14], ['CTR 1→2', 18], ['CTR neuf 1→2', 18], ['Angle 1→2', 14], ['Remb.', 7], ['Leçons', 6], ['Artefacts', 9],
  ['Effectif', 8], ['Masse salariale', 15], ['Embauches', 9], ['Départs', 7], ['Survie', 6], ['Violations', 10],
];

function line(cells: string[]): string {
  return cells.map((c, i) => (i < 2 ? c.padEnd(COLUMNS[i]![1]) : c.padStart(COLUMNS[i]![1]))).join(' │ ');
}

export function tableHeader(): string {
  const head = line(COLUMNS.map(([t]) => (t.startsWith('Produits') ? 'Prod. L/A' : t)));
  return `${head}\n${COLUMNS.map(([, w]) => '─'.repeat(w)).join('─┼─')}`;
}

export function resultRow(r: RunResult): string {
  const artefacts = [
    r.cliffs.length ? `${r.cliffs.length}F` : '',
    r.stalls.length ? `${r.stalls.length}S` : '',
    r.kpiMismatchDays.length ? `${r.kpiMismatchDays.length}K` : '',
    r.nanDays.length ? `${r.nanDays.length}N` : '',
  ].filter(Boolean).join(' ') || 'aucun';
  return line([
    r.difficulty, String(r.seed), eur(r.finalCash), eur(r.profit), eur(r.peakProfit), dayS(r.firstProfitDay), dayS(r.goalDay),
    r.bankrupt ? `oui J${r.bankruptDay}` : 'non', `${r.live}/${r.killed}`,
    arrow(r.roas1, r.roas2, (n) => num(n)), arrow(r.ctr1, r.ctr2, (n) => pctS(n, 2)), arrow(r.fresh1, r.fresh2, (n) => pctS(n, 2)), arrow(r.fit1, r.fit2, (n) => num(n)),
    pctS(r.refundPct), String(r.lessons), artefacts,
    String(r.headcount), eur(r.payroll), String(r.hires), String(r.departures), String(r.survivalDays), String(r.violations),
  ]);
}

export function aggregateLines(a: Aggregate): string[] {
  const p = (k: number) => `${k}/${a.runs}`;
  const share = (k: number) => `${Math.round((k / a.runs) * 100)} %`;
  const atDay = (k: number | null) => (k === null ? '—' : p(k));
  return [
    `${a.difficulty.padEnd(10)} │ profit médian ${eur(a.medianProfit)} (min ${eur(a.minProfit)}, max ${eur(a.maxProfit)}) · rentables ${p(a.profitable)} · objectif ${p(a.goal)} · faillites ${p(a.bankrupt)} (J60 ${atDay(a.bankruptD60)}, J180 ${atDay(a.bankruptD180)}) · mortes ${p(a.dead)} · 1er jour > 0 médian ${dayS(a.medianFirstProfitDay)}`,
    `${''.padEnd(10)} │ 2e moitié meilleure : CTR ${share(a.ctrImproved)} · ROAS ${share(a.roasImproved)} · les deux ${share(a.bothImproved)} · CTR neuf ${share(a.freshImproved)} (médiane ${pctS(a.medianFresh1, 2)}→${pctS(a.medianFresh2, 2)}) · angle ${share(a.fitImproved)} (médiane ${num(a.medianFit1)}→${num(a.medianFit2)})`,
    `${''.padEnd(10)} │ falaises ${a.cliffs} (inexpliquées ${a.unexplainedCliffs}) · arrêts pub ${a.stalls} · KPI≠grand livre ${a.kpiMismatches} · NaN ${a.nan}`,
    `${''.padEnd(10)} │ effectif médian ${a.medianHeadcount} · masse salariale médiane ${eur(a.medianPayroll)} · embauches ${a.hires} · départs ${a.departures} · violations ${a.violations}`,
  ];
}

export function learningShare(results: RunResult[], difficulties: readonly Difficulty[] = ['normal', 'cauchemar']): { runs: number; ctr: number; roas: number; both: number; fresh: number; fit: number } {
  const rs = results.filter((r) => difficulties.includes(r.difficulty));
  return {
    runs: rs.length,
    ctr: rs.filter((r) => improved(r.ctr1, r.ctr2)).length,
    roas: rs.filter((r) => improved(r.roas1, r.roas2)).length,
    both: rs.filter((r) => improved(r.ctr1, r.ctr2) && improved(r.roas1, r.roas2)).length,
    fresh: rs.filter((r) => improved(r.fresh1, r.fresh2)).length,
    fit: rs.filter((r) => improved(r.fit1, r.fit2)).length,
  };
}
