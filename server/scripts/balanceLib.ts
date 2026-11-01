/**
 * Market-balance benchmark: runs headless companies (heuristic engine by default) and measures what a
 * founder cares about — profit, goal, bankruptcy, learning (CTR / ROAS of the 2nd half vs the 1st) — plus
 * the artefacts a fair market must never show: profit cliffs without a cause, paid-ads stalls, KPI cash ≠
 * ledger, NaN. Used by scripts/balance.ts (CLI) and by test/balance.test.ts (smoke runs).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPaths, summarizeLedger } from '../src/core/index.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { adBanActive, promotionBlock } from '../src/runtime/acquisition.js';
import { isUpsellProduct } from '../src/runtime/metrics.js';
import * as BALANCE from '../src/sim/balance.js';
import { financeSnapshot } from '../src/sim/finance.js';
import type { RunPaths } from '../src/contracts.js';
import type { DailyKpi, Difficulty, MindMode, ScenarioConfig, WorldEvent, WorldState } from '../src/shared.js';

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
}

export interface DayRow {
  day: number;
  cash: number;
  ledgerCash: number;
  revenue: number;
  adSpend: number;
  cumulativeProfit: number;
  sales: number;
  impressions: number;
  clicks: number;
  /** A live, non-upsell product passes the quality gate (could take paid ads). */
  sellable: boolean;
  banned: boolean;
  survival: boolean;
  nan: string[];
}

export interface Cliff { fromDay: number; toDay: number; peak: number; low: number; events: string[] }
export interface Stall { fromDay: number; toDay: number; days: number }

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
  cliffs: Cliff[];
  stalls: Stall[];
  kpiMismatchDays: number[];
  nanDays: number[];
  awaitingFounder: number;
  seconds: number;
  dir: string | null;
  rows: DayRow[];
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

function survivalToday(world: WorldState): boolean {
  const b = world.company.budget;
  return !!b && b.day === world.day && b.survival;
}

/** Paid-ads stats of a day window [from, to]. */
export function adWindow(world: WorldState, from: number, to: number): { spend: number; revenue: number; impressions: number; clicks: number; roas: number | null; ctr: number | null } {
  let spend = 0, revenue = 0, impressions = 0, clicks = 0;
  for (const s of world.market.adStats) {
    if (s.day < from || s.day > to) continue;
    spend += s.spend; revenue += s.revenue; impressions += s.impressions; clicks += s.clicks;
  }
  return {
    spend: r2(spend), revenue: r2(revenue), impressions, clicks,
    roas: spend >= 20 ? revenue / spend : null,
    ctr: impressions >= 2000 ? clicks / impressions : null,
  };
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

/**
 * Applies calibration overrides to the live constants of sim/balance.ts (process-wide: the market reads them at
 * call time). Throws on an unknown path, so a typo never silently benchmarks the default market.
 */
export function applyOverrides(overrides: Record<string, number> | undefined): void {
  for (const [path, value] of Object.entries(overrides ?? {})) {
    const keys = path.split('.');
    let obj: unknown = BALANCE;
    for (const k of keys.slice(0, -1)) obj = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[k] : undefined;
    const last = keys[keys.length - 1]!;
    if (!obj || typeof obj !== 'object' || typeof (obj as Record<string, unknown>)[last] !== 'number') throw new Error(`Constante inconnue ou non numérique : ${path}`);
    (obj as Record<string, number>)[last] = value;
  }
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
    await company.runDays(spec.days, (kpi) => {
      const ledgerCash = ledgerCashUpTo(world, kpi.day);
      const nan = kpiNaN(kpi);
      if (nan.length) nanDays.push(kpi.day);
      if (Math.abs(kpi.cash - ledgerCash) > 0.011) kpiMismatchDays.push(kpi.day);
      rows.push({
        day: kpi.day, cash: kpi.cash, ledgerCash, revenue: kpi.revenue, adSpend: kpi.adSpend, cumulativeProfit: kpi.cumulativeProfit,
        sales: kpi.sales, impressions: kpi.impressions, clicks: kpi.clicks,
        sellable: sellable(world), banned: adBanActive(world), survival: survivalToday(world), nan,
      });
      if (spec.autoApprove) {
        for (const t of world.company.tasks) if (t.status === 'awaiting_founder') company.approve(t.id, true);
      }
    });
    const fin = financeSnapshot(world);
    if (!finite(fin.cash) || !finite(fin.profit)) nanDays.push(world.day);
    const products = world.company.products;
    const half = Math.floor(spec.days / 2);
    const a1 = adWindow(world, 1, half);
    const a2 = adWindow(world, half + 1, spec.days);
    const orders = world.market.orders;
    const refunded = orders.filter((o) => o.refunded || o.chargeback).length;
    const goalEvent = world.market.events.find((e) => e.kind === 'goal_reached');
    const bankruptEvent = world.market.events.find((e) => e.kind === 'bankrupt');
    const firstProfit = rows.find((r) => r.cumulativeProfit > 0);
    const goalRow = rows.find((r) => r.cumulativeProfit >= scenario.goal.targetProfit);
    const org = world.company.org?.stats;
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
      bankrupt: !!bankruptEvent || rows.some((r) => r.cash < 0),
      bankruptDay: bankruptEvent?.day ?? rows.find((r) => r.cash < 0)?.day ?? null,
      finalStatus: world.status,
      products: products.length,
      live: products.filter((p) => p.status === 'live').length,
      killed: products.filter((p) => p.status === 'killed').length,
      paused: products.filter((p) => p.status === 'paused').length,
      sales: orders.length,
      revenue: fin.revenue,
      adSpend: fin.adSpend,
      roas1: a1.roas, roas2: a2.roas, ctr1: a1.ctr, ctr2: a2.ctr,
      refundPct: orders.length ? refunded / orders.length : 0,
      lessons: world.company.lessons.length,
      headcount: world.company.agents.length,
      payroll: summarizeLedger(world.ledger, world.day).payroll,
      hires: org?.hires ?? 0,
      departures: org?.departures ?? 0,
      replacements: (world.company.league?.hires ?? []).filter((h) => h.hired).length,
      violations: org?.violations ?? 0,
      cliffs: findCliffs(world, rows),
      stalls: findStalls(rows, spec.budget),
      kpiMismatchDays,
      nanDays,
      awaitingFounder: world.company.tasks.filter((t) => t.status === 'awaiting_founder').length,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      dir: spec.keep ? paths.root : null,
      rows,
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
  medianFirstProfitDay: number | null;
  ctrImproved: number;
  roasImproved: number;
  bothImproved: number;
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
  return {
    difficulty,
    runs: rs.length,
    medianProfit: r2(median(profits)),
    minProfit: Math.min(...profits),
    maxProfit: Math.max(...profits),
    profitable: rs.filter((r) => r.profit > 0).length,
    goal: rs.filter((r) => r.goalDay !== null).length,
    bankrupt: rs.filter((r) => r.bankrupt).length,
    medianFirstProfitDay: firsts.length ? median(firsts) : null,
    ctrImproved: rs.filter((r) => improved(r.ctr1, r.ctr2)).length,
    roasImproved: rs.filter((r) => improved(r.roas1, r.roas2)).length,
    bothImproved: rs.filter((r) => improved(r.ctr1, r.ctr2) && improved(r.roas1, r.roas2)).length,
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

function eur(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${s} €`;
}
const num = (n: number | null, d = 2) => (n === null ? '—' : n.toFixed(d).replace('.', ','));
const pctS = (n: number | null, d = 1) => (n === null ? '—' : `${(n * 100).toFixed(d).replace('.', ',')} %`);
const dayS = (d: number | null) => (d === null ? '—' : `J${d}`);
const arrow = (a: number | null, b: number | null, fmt: (n: number | null) => string) => `${fmt(a)}→${fmt(b)}${improved(a, b) ? ' ↑' : a !== null && b !== null ? ' ↓' : ''}`;

const COLUMNS: [string, number][] = [
  ['Difficulté', 10], ['Graine', 6], ['Trésorerie', 10], ['Profit', 9], ['Pic', 9], ['J>0', 4], ['Objectif', 8], ['Faillite', 8],
  ['Produits (en ligne/arrêtés)', 12], ['ROAS 1→2', 14], ['CTR 1→2', 18], ['Remb.', 7], ['Leçons', 6], ['Artefacts', 9],
  ['Effectif', 8], ['Masse salariale', 15], ['Embauches', 9], ['Départs', 7], ['Violations', 10],
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
    arrow(r.roas1, r.roas2, (n) => num(n)), arrow(r.ctr1, r.ctr2, (n) => pctS(n, 2)), pctS(r.refundPct), String(r.lessons), artefacts,
    String(r.headcount), eur(r.payroll), String(r.hires), String(r.departures), String(r.violations),
  ]);
}

export function aggregateLines(a: Aggregate): string[] {
  const p = (k: number) => `${k}/${a.runs}`;
  const share = (k: number) => `${Math.round((k / a.runs) * 100)} %`;
  return [
    `${a.difficulty.padEnd(10)} │ profit médian ${eur(a.medianProfit)} (min ${eur(a.minProfit)}, max ${eur(a.maxProfit)}) · rentables ${p(a.profitable)} · objectif ${p(a.goal)} · faillites ${p(a.bankrupt)} · 1er jour > 0 médian ${dayS(a.medianFirstProfitDay)}`,
    `${''.padEnd(10)} │ 2e moitié meilleure : CTR ${share(a.ctrImproved)} · ROAS ${share(a.roasImproved)} · les deux ${share(a.bothImproved)} · falaises ${a.cliffs} (inexpliquées ${a.unexplainedCliffs}) · arrêts pub ${a.stalls} · KPI≠grand livre ${a.kpiMismatches} · NaN ${a.nan}`,
    `${''.padEnd(10)} │ effectif médian ${a.medianHeadcount} · masse salariale médiane ${eur(a.medianPayroll)} · embauches ${a.hires} · départs ${a.departures} · violations ${a.violations}`,
  ];
}

export function learningShare(results: RunResult[], difficulties: readonly Difficulty[] = ['normal', 'cauchemar']): { runs: number; ctr: number; roas: number; both: number } {
  const rs = results.filter((r) => difficulties.includes(r.difficulty));
  return {
    runs: rs.length,
    ctr: rs.filter((r) => improved(r.ctr1, r.ctr2)).length,
    roas: rs.filter((r) => improved(r.roas1, r.roas2)).length,
    both: rs.filter((r) => improved(r.ctr1, r.ctr2) && improved(r.roas1, r.roas2)).length,
  };
}
