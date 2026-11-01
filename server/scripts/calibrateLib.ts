/**
 * What the one calibration reads (PLAN §4, talent §10.2, scale §9.1), pure on finished runs: the candidates, the checks K1-K8, the
 * decision rule, the paired controls, the readers A1-A5 and M1-M7, the rule of D122. Every number was fixed before any result
 * existed: a change here is a new calibration, which the plan forbids. scripts/calibrate.ts runs the seeds and prints.
 * It reads hidden truth (talent, market): it stays outside the product.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRng } from '../src/core/index.js';
import type { ScenarioConfig } from '../src/shared.js';
import { adWindow, bankruptBy, closeOn, eur, median, num, pctS, type RatedPair, type RunResult } from './balanceLib.js';

export type Run = RunResult;

/** A rule of the plan said no: the message is the whole story, no stack. */
export class Refused extends Error {}

// ───────────────────────────── candidates ─────────────────────────────

export interface Candidate { id: string; label: string; overrides: Record<string, number> }

const PAY = { 'ORG.payPerDay.haiku': 0.375, 'ORG.payPerDay.sonnet': 0.6, 'ORG.payPerDay.opus': 0.9 };
const B = { 'CONVERSION.base': 0.0195 };
const D = { ...PAY, 'TALENT.founderMean': 0.62 };
const F = { ...PAY, 'TALENT.marketMean': 0.6 };

/** The seven of §4 Step 3 (D120). There is no other list. */
export const CANDIDATES: readonly Candidate[] = [
  { id: 'A', label: 'Tel que conçu', overrides: {} },
  { id: 'B', label: 'Conversion 0,0195', overrides: B },
  { id: 'C', label: 'Conversion 0,0165', overrides: { 'CONVERSION.base': 0.0165 } },
  { id: 'D', label: 'Paie × 0,75, fondateurs 0,62', overrides: D },
  { id: 'E', label: 'B et D', overrides: { ...B, ...D } },
  { id: 'F', label: 'Paie × 0,75, marché 0,60', overrides: F },
  { id: 'G', label: 'F, réservoir × 2', overrides: { ...F, 'CONVERSION.poolBase': 240, 'CONVERSION.poolDemand': 900 } },
];

/** Who takes a tie or a gap under N (D121). */
export const DECISION_ORDER: readonly string[] = ['A', 'D', 'F', 'B', 'G', 'E', 'C'];

const listKey = (list: readonly Candidate[]): string => JSON.stringify([...list].map((c) => [c.id, Object.entries(c.overrides).sort()]).sort());

/** §4: one list, fixed before any result. */
export function assertCandidates(list: readonly Candidate[]): void {
  if (listKey(list) !== listKey(CANDIDATES)) throw new Refused('Liste de candidats refusée : seuls les sept du plan passent (D120), il n\'y a pas de seconde liste.');
}

/** The placebo of §4: it touches a click count on every seed in the first weeks and moves no mean that matters. × 1,0001 left whole seeds untouched (D124). */
export const PLACEBO_CTR = 1.01;

/** Every arm of the calibration: the product has no end, and a run with one stops the league in its last 10 days (D125). */
export const armScenario = (scenario: Partial<ScenarioConfig> = {}): Partial<ScenarioConfig> => ({ openEnded: true, ...scenario });

const CONSTANT_FILES: readonly [string, string][] = [
  ['ORG.', 'server/src/runtime/org/constants.ts'],
  ['TALENT.', 'server/src/runtime/talent/constants.ts'],
  ['CONVERSION.', 'server/src/sim/balance.ts'],
];

/** The edits that write a candidate into the code, one line per constant. `read` gives today's value. */
export function candidateEdits(c: Candidate, read: (path: string) => number): string[] {
  return Object.entries(c.overrides).map(([path, value]) => `${CONSTANT_FILES.find(([p]) => path.startsWith(p))?.[1] ?? '?'} : ${path} ${read(path)} → ${value}`);
}

/** `--winner-written` swears to what the code holds: the code is asked. Otherwise every control would describe another company (D127). */
export function assertWinnerWritten(id: string, overrides: Record<string, number>, read: (path: string) => number): void {
  const off = Object.entries(overrides).filter(([path, value]) => Math.abs(read(path) - value) > 1e-9).map(([path, value]) => `${path} vaut ${read(path)}, pas ${value}`);
  if (off.length) throw new Refused(`--winner-written refusé : ${id} n'est pas dans le code (${off.join(', ')}).`);
}

// ───────────────────────────── what a saved seed is made of ─────────────────────────────

const CODE_FOLDERS: readonly string[] = ['server/src', 'shared', 'server/assets'];
const CODE_FILES: readonly string[] = ['server/scripts/balanceLib.ts'];

/** Hash of what makes a run, by content: the simulation, its contracts, the fonts a page is measured with, the reader of runs. A commit moves nothing here, a constant does. */
export async function codeStamp(root: string): Promise<string> {
  const listed = await Promise.all(CODE_FOLDERS.map(async (folder) => {
    const entries = await readdir(join(root, folder), { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => relative(root, join(e.parentPath, e.name)).replace(/\\/g, '/'));
  }));
  const hash = createHash('sha256');
  for (const file of [...listed.flat(), ...CODE_FILES].sort()) hash.update(`${file}\0`).update(await readFile(join(root, file))).update('\0');
  return hash.digest('hex').slice(0, 16);
}

/** One seed on disk, one seed this step wants. `spec` through JSON on both sides. */
export interface SeedMark { spec: unknown; code: string }
/** Another code stops the step, except in the re-run of D123: `keep` counts the seed as it is, `rerun` runs it again. */
export type CodeEscape = 'none' | 'keep' | 'rerun';

/** True: the seed counts. False: it runs again. Two calibrations never mix: another setting or another code stops the step (D127). */
export function seedCounts(file: string, saved: SeedMark, wanted: SeedMark, escape: CodeEscape = 'none'): boolean {
  if (JSON.stringify(saved.spec) !== JSON.stringify(wanted.spec)) throw new Refused(`${file} vient d'un autre réglage : retirer ce dossier d'étape pour la refaire.`);
  if (saved.code === wanted.code) return true;
  if (escape === 'none') throw new Refused(`${file} vient d'un autre code (${saved.code}, celui-ci est ${wanted.code}) : deux calibrations ne se mélangent pas.`);
  return escape === 'keep';
}

// ───────────────────────────── reading a run ─────────────────────────────

/** Where a calibration reads: the real days, or those of a smoke run too short for them. */
export interface Reads {
  early: number;
  late: number;
  tempo: [number, number];  // days
  tail: [number, number];   // weeks, A1
  slope: [number, number];  // weeks, A3 and K8
  retest: [number, number]; // days: weeks 27-38
}

export const FULL_READS: Reads = { early: 60, late: 180, tempo: [31, 60], tail: [21, 26], slope: [9, 26], retest: [183, 266] };
export const SMOKE_READS: Reads = { early: 8, late: 12, tempo: [2, 8], tail: [1, 1], slope: [1, 1], retest: [1, 12] };

/** The goal of `docs/BALANCE.md`, the median the rule aims for, and the floor of every noise reading. */
export const GOAL_EUR = 1000;
export const TARGET_MEDIAN = 1800;
export const MIN_THRESHOLD = 420;
export const threshold = (N: number): number => Math.max(MIN_THRESHOLD, N);

const present = (xs: readonly (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
export const medianOf = (xs: readonly (number | null)[]): number | null => (present(xs).length ? median(present(xs)) : null);
const meanOf = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const positives = (xs: readonly number[]): number => xs.filter((x) => x > 0).length;

/** One run, its end over its start. A start at or under zero has no meaning: what grew from nothing reads Infinity, what did not reads 0, so a dead seed counts against. */
export const ratio = (a: number, b: number): number => (b > 0 ? a / b : a > 0 ? Infinity : 0);
/**
 * Two arms of one market: the arm ahead reads above 1 and the arm behind under it, whatever the sign, so a seed lost in both arms still
 * says which lost less (D126). From a base at or under zero, pairedRatio(a, b) is 1 / pairedRatio(b, a).
 */
export function pairedRatio(a: number, b: number): number {
  if (b > 0) return a / b;
  if (a > 0) return Infinity;
  return a === b ? 1 : Math.abs(b) / Math.abs(a);
}
export const ratioText = (x: number | null): string => (x === Infinity ? '∞' : num(x));

/** Profit on that close: a run that goes on past the day is read at the day. */
export const profitOn = (r: Run, day: number): number | null => closeOn(r.rows, day)?.cumulativeProfit ?? null;

export function goalBy(r: Run, day: number): boolean {
  return r.rows.some((x) => x.day <= day && x.cumulativeProfit >= GOAL_EUR);
}

export const swapsBy = (r: Run, day: number): number => (r.talentTruth?.swaps ?? []).filter((s) => s.day <= day).length;

const countBankrupt = (runs: readonly Run[], day: number): number => runs.filter((r) => bankruptBy(r.rows, day)).length;

/** Net revenue of each closed week, as scale §9.1 reads it. A week rolled twice counts once. */
export function netWeeks(r: Run): Map<number, number> {
  return new Map(r.growth.weeks.map((w) => [w.week, w.revenue - w.refunds]));
}

/** Median of the slopes between every two points. Null under two points. */
export function theilSen(points: readonly (readonly [number, number])[]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const [xi, yi] = points[i]!;
      const [xj, yj] = points[j]!;
      if (xj !== xi) slopes.push((yj - yi) / (xj - xi));
    }
  }
  return slopes.length ? median(slopes) : null;
}

/** The slope of A3 and K8, and the end over the start. */
export function weekTrend(r: Run, [from, to]: [number, number]): { slope: number | null; growth: number | null } {
  const weeks = netWeeks(r);
  const points = [...weeks].filter(([w]) => w >= from && w <= to).sort((a, b) => a[0] - b[0]);
  const start = weeks.get(from);
  const end = weeks.get(to);
  return { slope: theilSen(points), growth: start === undefined || end === undefined ? null : ratio(end, start) };
}

function trendCheck(runs: readonly Run[], slope: [number, number]): { rising: number; growth: number | null } {
  const reads = runs.map((r) => weekTrend(r, slope));
  return { rising: reads.filter((t) => t.slope !== null && t.slope > 0).length, growth: medianOf(reads.map((t) => t.growth)) };
}

// ───────────────────────────── K1-K8 ─────────────────────────────

export interface Check { id: string; pass: boolean; value: string; target: string }
export interface CandidateRuns { normal: Run[]; facile: Run[]; cauchemar: Run[] }

export function k1(normal: readonly Run[], reads: Reads): Check {
  const goal = normal.filter((r) => goalBy(r, reads.early)).length;
  return { id: 'K1', pass: goal >= 15 && goal <= 27, value: `objectif ${goal}/${normal.length}`, target: '15 à 27 sur 30' };
}

export const normalMedian = (normal: readonly Run[], reads: Reads): number | null => medianOf(normal.map((r) => profitOn(r, reads.early)));

export function k2(normal: readonly Run[], reads: Reads): Check {
  const m = normalMedian(normal, reads);
  return { id: 'K2', pass: m !== null && m >= 1000 && m <= 4000, value: m === null ? '—' : `médiane ${eur(m)}`, target: `1 000 à 4 000 € à J${reads.early}` };
}

export function k3(normal: readonly Run[], reads: Reads): Check {
  const early = countBankrupt(normal, reads.early);
  const late = countBankrupt(normal, reads.late);
  return { id: 'K3', pass: early <= 2 && late <= 2, value: `faillites J${reads.early} ${early}, J${reads.late} ${late}`, target: 'au plus 2 sur 30 à chacun' };
}

export function k4(facile: readonly Run[], reads: Reads): Check {
  const goal = facile.filter((r) => goalBy(r, reads.early)).length;
  const bankrupt = countBankrupt(facile, reads.early);
  return { id: 'K4', pass: goal >= 24 && bankrupt === 0, value: `objectif ${goal}/${facile.length}, faillites ${bankrupt}`, target: 'au moins 24 sur 30, aucune faillite' };
}

export function k5(cauchemar: readonly Run[], reads: Reads): Check {
  const bankrupt = countBankrupt(cauchemar, reads.early);
  const cash = medianOf(cauchemar.map((r) => r.finalCash));
  return { id: 'K5', pass: bankrupt <= 8 && cash !== null && cash >= 250, value: `faillites ${bankrupt}, trésorerie médiane ${cash === null ? '—' : eur(cash)}`, target: 'au plus 8 sur 30, au moins 250 €' };
}

/** Σ ledger = cash holds on every evening and on the last one. */
const ledgerGaps = (r: Run): number => r.kpiMismatchDays.length + (Math.abs(r.finalCash - (r.rows.at(-1)?.ledgerCash ?? r.finalCash)) > 0.011 ? 1 : 0);

export function k6(all: readonly Run[]): Check {
  const count = (read: (r: Run) => number) => all.reduce((n, r) => n + read(r), 0);
  const violations = count((r) => r.violations);
  const gaps = count(ledgerGaps);
  const nan = count((r) => r.nanDays.length);
  return { id: 'K6', pass: !violations && !gaps && !nan, value: `${all.length} runs : violations ${violations}, écarts au grand livre ${gaps}, NaN ${nan}`, target: 'tout à 0' };
}

export function k7(normal: readonly Run[]): Check {
  const m = medianOf(normal.map((r) => swapsBy(r, Infinity)));
  return { id: 'K7', pass: m !== null && m >= 1, value: `médiane ${num(m, 1)} par graine`, target: 'au moins 1 remplacement par graine, en médiane' };
}

export function k8(normal: readonly Run[], reads: Reads): Check {
  const { rising, growth } = trendCheck(normal, reads.slope);
  return { id: 'K8', pass: rising >= 24 && growth !== null && growth >= 2, value: `pente > 0 sur ${rising}/${normal.length}, S${reads.slope[1]}/S${reads.slope[0]} ${ratioText(growth)}`, target: 'au moins 24 sur 30, au moins 2,0' };
}

export function checksOf(c: CandidateRuns, reads: Reads): Check[] {
  return [k1(c.normal, reads), k2(c.normal, reads), k3(c.normal, reads), k4(c.facile, reads), k5(c.cauchemar, reads), k6([...c.normal, ...c.facile, ...c.cauchemar]), k7(c.normal), k8(c.normal, reads)];
}

// ───────────────────────────── the decision ─────────────────────────────

export interface Scored { id: string; failed: number; median: number | null }

/**
 * D121, D124. Those that pass all eight, or none does and those that fail the fewest, then the closest to 1 800 €. A tie or a gap
 * under the noise, `threshold(N)` like every noise reading, goes to the first in the order A, D, F, B, G, E, C.
 */
export function decide(scored: readonly Scored[], N: number): { winner: string; reason: string } {
  if (!scored.length) throw new Error('Aucun candidat à départager.');
  const fewest = Math.min(...scored.map((s) => s.failed));
  const pool = scored.filter((s) => s.failed === fewest);
  const gap = (s: Scored): number => (s.median === null ? Infinity : Math.abs(s.median - TARGET_MEDIAN));
  const best = Math.min(...pool.map(gap));
  const noise = threshold(N);
  const near = pool.filter((s) => gap(s) === best || gap(s) - best < noise);
  const winner = [...near].sort((a, b) => DECISION_ORDER.indexOf(a.id) - DECISION_ORDER.indexOf(b.id))[0]!;
  const passed = fewest === 0 ? `${pool.length} passe(nt) les huit contrôles` : `aucun ne passe tout, ${pool.length} n'échoue(nt) qu'à ${fewest} contrôle(s)`;
  const tied = near.length > 1 ? `, ${near.map((s) => s.id).join(', ')} à moins de ${eur(noise)} l'un de l'autre : le premier dans l'ordre ${DECISION_ORDER.join(', ')}` : ', le plus proche de 1 800 €';
  return { winner: winner.id, reason: `${passed}${tied}` };
}

/** D123: what the insurance held back by D117 waits for. */
export const insuranceDue = (checks: readonly Check[]): boolean => checks.some((c) => (c.id === 'K3' || c.id === 'K5') && !c.pass);

// ───────────────────────────── step 2: pars and levers ─────────────────────────────

export interface MeasuredPar { n: number; par: number; sd: number }

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The raw x of every seed together: mean and spread by `${skill}:${source}`. */
export function pooledPars(runs: readonly Run[]): Record<string, MeasuredPar> {
  const total: Record<string, { n: number; sum: number; sq: number }> = {};
  for (const r of runs) {
    for (const [key, s] of Object.entries(r.league?.parStats ?? {})) {
      const t = (total[key] ??= { n: 0, sum: 0, sq: 0 });
      t.n += s.n; t.sum += s.sum; t.sq += s.sq;
    }
  }
  return Object.fromEntries(Object.entries(total).map(([key, { n, sum, sq }]) => {
    const mean = sum / n;
    return [key, { n, par: round2(mean), sd: round2(Math.sqrt(Math.max(0, sq / n - mean * mean))) }];
  }));
}

/** Under this the mean of a key says nothing: it keeps its value. A spread of 0 would divide by nothing. */
export const MIN_PAR_SAMPLE = 5;
const usable = (m: MeasuredPar | undefined): m is MeasuredPar => !!m && m.n >= MIN_PAR_SAMPLE && m.sd > 0;

export const PAR_MARKER = '// S14: `par` and `sd` measured once, by calibrate.ts --step 2 --write. Never again.';
export const parMarked = (source: string): boolean => source.includes(PAR_MARKER);
export const ALREADY_WRITTEN = 'TALENT.par et TALENT.sd ont déjà été écrits : la mesure ne se fait qu\'une fois (D77).';

function recordBlock(name: string, values: Record<string, number>): string {
  const cells = Object.entries(values).map(([k, v]) => `'${k}': ${v}`);
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 6) lines.push(`    ${cells.slice(i, i + 6).join(', ')},`);
  return `  ${name}: {\n${lines.join('\n')}\n  } as Record<string, number>,\n`;
}

/** constants.ts with the measured pars, a key without a real sample keeping its value. Refuses a file already written. */
export function rewritePars(source: string, was: { par: Record<string, number>; sd: Record<string, number> }, measured: Record<string, MeasuredPar>): string {
  if (parMarked(source)) throw new Refused(ALREADY_WRITTEN);
  const pick = (read: (m: MeasuredPar) => number, old: Record<string, number>) => Object.fromEntries(Object.keys(old).map((k) => {
    const m = measured[k];
    return [k, usable(m) ? read(m) : old[k]!];
  }));
  const block = /  par: \{[\s\S]*?\} as Record<string, number>,\r?\n  sd: \{[\s\S]*?\} as Record<string, number>,\r?\n/;
  if (!block.test(source)) throw new Refused('constants.ts : bloc `par` et `sd` introuvable.');
  return source.replace(block, () => `  ${PAR_MARKER}\n${recordBlock('par', pick((m) => m.par, was.par))}${recordBlock('sd', pick((m) => m.sd, was.sd))}`);
}

export type LeverOutcome = 'keep' | 'keep_report' | 'flaws_zero';

/** §4 Step 2, no re-run. */
export function leverOutcome(gain: number | null): LeverOutcome | null {
  if (gain === null) return null;
  return gain >= 100 ? 'keep' : gain >= 0 ? 'keep_report' : 'flaws_zero';
}

export const LEVER_TEXT: Record<LeverOutcome, string> = {
  keep: 'garder',
  keep_report: 'garder, à rapporter',
  flaws_zero: 'défauts de ce groupe à 0, à rapporter',
};

// ───────────────────────────── paired arms ─────────────────────────────

/** Same market, by seed. */
export function paired(a: readonly Run[], b: readonly Run[]): [Run, Run][] {
  const other = new Map(b.map((r) => [r.seed, r]));
  return a.flatMap((r) => (other.has(r.seed) ? [[r, other.get(r.seed)!] as [Run, Run]] : []));
}

export function gains(a: readonly Run[], b: readonly Run[], read: (r: Run) => number | null = (r) => r.profit): number[] {
  return present(paired(a, b).map(([x, y]) => {
    const p = read(x);
    const q = read(y);
    return p === null || q === null ? null : p - q;
  }));
}

export const ratios = (a: readonly Run[], b: readonly Run[], read: (r: Run) => number | null): number[] => present(paired(a, b).map(([x, y]) => {
  const p = read(x);
  const q = read(y);
  return p === null || q === null ? null : pairedRatio(p, q);
}));

/** Median |a − b| by seed: the noise of 180 days for the scaling control. */
export const noiseFloor = (a: readonly Run[], b: readonly Run[], read?: (r: Run) => number | null): number | null => medianOf(gains(a, b, read).map(Math.abs));

/** Seeds whose daily rows match to the byte: the placebo never touched them. */
export const identicalSeeds = (a: readonly Run[], b: readonly Run[]): number[] => paired(a, b).filter(([x, y]) => JSON.stringify(x.rows) === JSON.stringify(y.rows)).map(([x]) => x.seed);

/** Past this many seeds the placebo did not touch at Step 1, there is no N (D124). */
export const MAX_IDENTICAL = 3;

export interface NoiseRead { N: number | null; identical: number[]; pairs: number }

/** Step 1. A seed the placebo did not touch measured no noise: it leaves the median, and past `maxIdentical` of them N does not exist. */
export function noiseRead(a: readonly Run[], b: readonly Run[], maxIdentical = MAX_IDENTICAL): NoiseRead {
  const identical = identicalSeeds(a, b);
  const pairs = paired(a, b);
  const touched = pairs.filter(([x]) => !identical.includes(x.seed));
  return { N: identical.length > maxIdentical ? null : medianOf(touched.map(([x, y]) => Math.abs(x.profit - y.profit))), identical, pairs: pairs.length };
}

export const ctrOver = (r: Run, [from, to]: [number, number]): number | null => adWindow(r.rows, from, to).ctr;

/** The 90 % interval of the median, by a seeded bootstrap: the same seeds give the same interval. */
export function bootstrapMedian(xs: readonly number[], level = 0.9, rounds = 10_000): [number, number] | null {
  if (!xs.length) return null;
  const rng = createRng(0x51a7);
  const medians = Array.from({ length: rounds }, () => median(xs.map(() => xs[rng.int(0, xs.length - 1)]!))).sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return [medians[Math.floor(tail * rounds)]!, medians[Math.ceil((1 - tail) * rounds) - 1]!];
}

function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

/** Null when either side does not move: no order to compare. */
export function spearman(a: readonly number[], b: readonly number[]): number | null {
  const [ra, rb] = [ranks(a), ranks(b)];
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const [ma, mb] = [mean(ra), mean(rb)];
  const cov = ra.reduce((s, x, i) => s + (x - ma) * (rb[i]! - mb), 0);
  const va = ra.reduce((s, x) => s + (x - ma) ** 2, 0);
  const vb = rb.reduce((s, y) => s + (y - mb) ** 2, 0);
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

/**
 * M7: per skill with at least 3 rated persons, the persons of every seed together (a lean team rarely holds 3 on one skill at D42),
 * then the skills weighted by their persons. Ratings and truth share one scale across seeds.
 */
export function ratingValidity(runs: readonly Pick<Run, 'ratings'>[]): { rho: number | null; skills: number; persons: number } {
  const bySkill = new Map<string, RatedPair[]>();
  for (const p of runs.flatMap((r) => r.ratings)) bySkill.set(p.skill, [...(bySkill.get(p.skill) ?? []), p]);
  let sum = 0, persons = 0, skills = 0;
  for (const pairs of bySkill.values()) {
    if (pairs.length < 3) continue;
    const rho = spearman(pairs.map((p) => p.rating), pairs.map((p) => p.truth));
    if (rho === null) continue;
    sum += rho * pairs.length; persons += pairs.length; skills += 1;
  }
  return { rho: persons ? sum / persons : null, skills, persons };
}

// ───────────────────────────── M1-M7 ─────────────────────────────

const sampleOn = (r: Run, day: number) => r.talentTruth?.samples.find((s) => s.day === day) ?? null;
const workMean = (r: Run): number | null => (r.work.tasks ? r.work.talent / r.work.tasks : null);

export interface LeagueRead { checks: Check[]; replacements: { early: number; late: number; medianLate: number | null } }

/** `short` and `flat` are the paired arms of the No league row. `long` is the full arm of the scaling control: the first replacement cannot come before D56 (D79). */
export function leagueRead(short: readonly Run[], flat: readonly Run[], long: readonly Run[], reads: Reads): LeagueRead {
  const talent = gains(short, flat, (r) => sampleOn(r, reads.early)?.meanLeague ?? null);
  const work = gains(short, flat, workMean);
  const profit = gains(short, flat);
  const ci = bootstrapMedian(profit);
  const swaps = long.flatMap((r) => r.talentTruth?.swaps ?? []);
  const under = swaps.filter((s) => s.tReplaced < s.familyMean).length;
  const share = swaps.length ? under / swaps.length : null;
  const seatGain = meanOf(swaps.map((s) => s.tHired - s.tReplaced));
  const churn = long.map((r) => r.talentTruth?.swaps.length ?? 0);
  const m1 = meanOf(talent);
  const m2 = meanOf(work);
  const m3 = medianOf(profit);
  const m6 = medianOf(churn);
  const m7 = ratingValidity(short);
  const pm = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : ''}${num(x, 3)}`);
  return {
    checks: [
      { id: 'M1', pass: m1 !== null && m1 >= 0.03 && positives(talent) >= 22, value: `${pm(m1)}, positif ${positives(talent)}/${talent.length}`, target: 'moyenne ≥ +0,03, positif sur ≥ 22/30' },
      { id: 'M2', pass: m2 !== null && m2 >= 0.06 && positives(work) >= 24, value: `${pm(m2)}, positif ${positives(work)}/${work.length}`, target: 'moyenne ≥ +0,06, positif sur ≥ 24/30' },
      { id: 'M3', pass: positives(profit) >= 20 && m3 !== null && m3 > 0 && ci !== null && ci[0] > 0, value: `médiane ${m3 === null ? '—' : eur(m3)}, positif ${positives(profit)}/${profit.length}, IC 90 % ${ci ? `${eur(ci[0])} à ${eur(ci[1])}` : '—'}`, target: '≥ 20/30, médiane > 0, IC 90 % sans 0' },
      { id: 'M4', pass: share !== null && share >= 0.7, value: `${pctS(share, 0)} (${under}/${swaps.length})`, target: 'au moins 70 %' },
      { id: 'M5', pass: seatGain !== null && seatGain >= 0.1, value: pm(seatGain), target: 'moyenne ≥ +0,10' },
      { id: 'M6', pass: m6 !== null && m6 <= 4 && Math.max(0, ...churn) <= 6, value: `médiane ${num(m6, 1)}, max ${Math.max(0, ...churn)}`, target: 'médiane ≤ 4, max ≤ 6' },
      { id: 'M7', pass: m7.rho !== null && m7.rho >= 0.5, value: `${num(m7.rho)} sur ${m7.skills} compétences, ${m7.persons} personnes`, target: 'au moins 0,5' },
    ],
    replacements: { early: long.reduce((n, r) => n + swapsBy(r, reads.early), 0), late: long.reduce((n, r) => n + swapsBy(r, reads.late), 0), medianLate: medianOf(long.map((r) => swapsBy(r, reads.late))) },
  };
}

const passed = (checks: readonly Check[], id: string): boolean => checks.find((c) => c.id === id)?.pass === true;

/** §4 Step 4, No league: what fires. Null when nothing does. */
export function leagueSwitch({ checks }: Pick<LeagueRead, 'checks'>, firingShare: number | null): string | null {
  if (firingShare !== null && firingShare < 0.5) return 'M4 sous 50 % : licenciements coupés, le routage reste';
  if (passed(checks, 'M1') && passed(checks, 'M2') && !passed(checks, 'M3')) return 'M1, M2 passent et M3 échoue : la ligue reste, l\'effet est rapporté';
  return checks.every((c) => c.pass) ? null : 'à rapporter';
}

export const firingShare = (long: readonly Run[]): number | null => {
  const swaps = long.flatMap((r) => r.talentTruth?.swaps ?? []);
  return swaps.length ? swaps.filter((s) => s.tReplaced < s.familyMean).length / swaps.length : null;
};

// ───────────────────────────── A1-A5 ─────────────────────────────

const tailNet = (r: Run, [from, to]: [number, number]): number | null => {
  const weeks = netWeeks(r);
  const rows = [...weeks].filter(([w]) => w >= from && w <= to);
  return rows.length === to - from + 1 ? rows.reduce((s, [, x]) => s + x, 0) : null;
};

export interface ScaleRead { checks: Check[]; noise: { floor: number | null; a1: number | null; a2: number | null; identical: number }; control: { rising: number; growth: number | null } }

/** Scale §9.1 on the full arm against `scaling: false`. The noise arm is the full arm with a perturbed market: what the same reading gives for nothing. */
export function scaleRead(full: readonly Run[], control: readonly Run[], noise: readonly Run[], reads: Reads): ScaleRead {
  const tail = (r: Run) => tailNet(r, reads.tail);
  const late = (r: Run) => profitOn(r, reads.late);
  const a1 = ratios(full, control, tail);
  const a2 = medianOf(ratios(full, control, late));
  const { rising, growth } = trendCheck(full, reads.slope);
  const a4 = medianOf(ratios(full, control, (r) => profitOn(r, reads.early)));
  const [bFull, bControl] = [countBankrupt(full, reads.late), countBankrupt(control, reads.late)];
  const a1m = medianOf(a1);
  return {
    checks: [
      { id: 'A1', pass: a1m !== null && a1m >= 2 && a1.filter((x) => x > 1).length >= 24, value: `médiane ${ratioText(a1m)}, au-dessus de 1 sur ${a1.filter((x) => x > 1).length}/${a1.length}`, target: 'au moins 2,0, > 1 sur ≥ 24/30' },
      { id: 'A2', pass: a2 !== null && a2 >= 1.5, value: `médiane ${ratioText(a2)}`, target: 'au moins 1,5' },
      { id: 'A3', pass: rising >= 24 && growth !== null && growth >= 2, value: `pente > 0 sur ${rising}/${full.length}, S${reads.slope[1]}/S${reads.slope[0]} ${ratioText(growth)}`, target: '≥ 24/30, au moins 2,0' },
      { id: 'A4', pass: a4 !== null && a4 >= 0.8, value: `médiane ${ratioText(a4)}`, target: 'au moins 0,8' },
      { id: 'A5', pass: bFull <= bControl + 1, value: `${bFull} contre ${bControl}`, target: 'au plus le contrôle + 1' },
    ],
    noise: { floor: noiseFloor(full, noise, late), a1: medianOf(ratios(noise, full, tail)), a2: medianOf(ratios(noise, full, late)), identical: identicalSeeds(full, noise).length },
    control: trendCheck(control, reads.slope),
  };
}

// ───────────────────────────── D122 ─────────────────────────────

const revenueOver = (r: Run, [from, to]: [number, number]): number => r.rows.reduce((s, x) => (x.day >= from && x.day <= to ? s + x.revenue : s), 0);

export interface RetestRead { adopted: boolean; medianRatio: number | null; above: number; pairs: number; placebo: number | null; identical: number; bankrupt: { winner: number; any: number } }

/** The one and only second look at the retest rule: 30 fresh seeds say yes or no. */
export function retestRead(winner: readonly Run[], any: readonly Run[], placebo: readonly Run[], reads: Reads): RetestRead {
  const revenue = (r: Run) => revenueOver(r, reads.retest);
  const rs = ratios(any, winner, revenue);
  const medianRatio = medianOf(rs);
  const placeboRatio = medianOf(ratios(placebo, winner, revenue));
  const above = rs.filter((x) => x > 1).length;
  const bankrupt = { winner: countBankrupt(winner, Infinity), any: countBankrupt(any, Infinity) };
  const adopted = medianRatio !== null && medianRatio >= 1.15 && above >= 19 && placeboRatio !== null && medianRatio > placeboRatio && bankrupt.any <= bankrupt.winner;
  return { adopted, medianRatio, above, pairs: rs.length, placebo: placeboRatio, identical: identicalSeeds(placebo, winner).length, bankrupt };
}

// ───────────────────────────── the rows of Step 4 ─────────────────────────────

export interface ControlRow { id: string; label: string; pass: boolean; value: string; target: string; fired: string | null }

const row = (id: string, label: string, pass: boolean, value: string, target: string, onFailure: string): ControlRow => ({ id, label, pass, value, target, fired: pass ? null : onFailure });
const money = (x: number | null): string => (x === null ? '—' : eur(x));
const medianFresh = (runs: readonly Run[]) => medianOf(runs.map((r) => r.fresh2));
const medianFit = (runs: readonly Run[]) => medianOf(runs.map((r) => r.fit2));

export function noLearningRow(full: readonly Run[], arm: readonly Run[], t: number): ControlRow {
  const d = gains(full, arm);
  const m = medianOf(d);
  const seen = `CTR neuf ${pctS(medianFresh(full), 2)} contre ${pctS(medianFresh(arm), 2)}, angle ${num(medianFit(full))} contre ${num(medianFit(arm))}`;
  return row('no_learning', 'Sans apprentissage', m !== null && m >= t && positives(d) >= 19, `médiane ${money(m)}, positif ${positives(d)}/${d.length} ; ${seen}`, `≥ +${eur(t)}, positif sur ≥ 19/30`, 'à rapporter : c\'est un défaut, S15 le regarde');
}

export function noHireRow(full: readonly Run[], arm: readonly Run[], reads: Reads): ControlRow {
  const m = medianOf(gains(full, arm));
  const [a, b] = [countBankrupt(full, reads.early), countBankrupt(arm, reads.early)];
  return row('no_hire', 'Sans embauche', m !== null && m >= 0 && a <= b, `médiane ${money(m)}, faillites ${a} contre ${b}`, '≥ 0, faillites ≤ contrôle', 'à rapporter');
}

export function legacyRow(full: readonly Run[], arm: readonly Run[]): ControlRow {
  const m = medianOf(gains(full, arm));
  return row('legacy', 'Équipe de 31 payée', m !== null && m > 0, `médiane ${money(m)}`, '> 0', 'à rapporter');
}

export function tiktokRow(full: readonly Run[], arm: readonly Run[], reads: Reads): ControlRow {
  const m = medianOf(ratios(full, arm, (r) => r.profit));
  const [a, b] = [countBankrupt(full, reads.early), countBankrupt(arm, reads.early)];
  return row('tiktok_only', 'TikTok seul', m !== null && m >= 1.25 && m <= 2.5 && a <= b, `× ${ratioText(m)}, faillites ${a} contre ${b}`, '× 1,25 à × 2,5, faillites ≤ contrôle', 'à rapporter');
}

const beats = (full: readonly Run[], arm: readonly Run[], t: number) => {
  const d = gains(full, arm);
  const m = medianOf(d);
  return { pass: positives(d) >= 19 && m !== null && m > t, value: `gagne ${positives(d)}/${d.length}, médiane ${money(m)}` };
};

export function averageRoasRow(full: readonly Run[], arm: readonly Run[], t: number): ControlRow {
  const { pass, value } = beats(full, arm, t);
  return row('average_roas', 'ROAS moyen', pass, value, `≥ 19/30 et > ${eur(t)}`, 'l\'allocateur repasse sur la règle du ROAS moyen');
}

export function lastClickRow(full: readonly Run[], arm: readonly Run[], t: number): ControlRow {
  const { pass, value } = beats(full, arm, t);
  return row('last_click', 'Dernier clic', pass, value, `≥ 19/30 et > ${eur(t)}`, '`RECON.claimWeight` 0 : réconciliation coupée, l\'UI montre les deux lectures');
}

export function videoSkillRow(low: readonly Run[], high: readonly Run[], days: number): ControlRow {
  const ctr = ratios(high, low, (r) => ctrOver(r, [1, days]));
  const strong = ctr.filter((x) => x >= 1.12).length;
  const m = medianOf(gains(high, low));
  return row('video_skill', 'Talent vidéo', strong >= 24 && m !== null && m > 0, `CTR ≥ × 1,12 sur ${strong}/${ctr.length}, gain ${money(m)}`, '≥ 24/30, gain > 0', 'à rapporter');
}

export function tempoRow(full: readonly Run[], arm: readonly Run[], reads: Reads): ControlRow {
  const d = gains(full, arm, (r) => ctrOver(r, reads.tempo));
  const above = positives(d);
  return row('tempo', 'Tempo', above >= 18, `CTR J${reads.tempo[0]}-${reads.tempo[1]} au-dessus du fixe sur ${above}/${d.length}`, '≥ 18/30', '`tempoFit` = 1 : le tempo reste cosmétique et quitte le bandit');
}

/** One retry only: `VISUAL.cvr.slope` 0,25. `retry` is what it gave, once it ran. */
export function designRow(low: readonly Run[], high: readonly Run[], retry?: { low: readonly Run[]; high: readonly Run[] }): ControlRow {
  const read = (lo: readonly Run[], hi: readonly Run[]) => {
    const d = gains(hi, lo);
    const m = medianOf(d);
    return { pass: m !== null && m > 0 && positives(d) >= 19, value: `gain ${money(m)}, positif ${positives(d)}/${d.length}` };
  };
  const first = read(low, high);
  const target = 'gain > 0, positif sur ≥ 19/30';
  if (first.pass || !retry) return row('design', 'Talent design', first.pass, first.value, target, 'un seul nouvel essai : `VISUAL.cvr.slope` 0,25');
  const second = read(retry.low, retry.high);
  const value = `${first.value} ; pente 0,25 : ${second.value}`;
  return { id: 'design', label: 'Talent design', pass: second.pass, value, target, fired: second.pass ? '`VISUAL.cvr.slope` passe à 0,25' : 'le look reste, noté « non prouvé »' };
}

export function retestRow(r: RetestRead): ControlRow {
  const value = `R/gagnant ${ratioText(r.medianRatio)}, au-dessus sur ${r.above}/${r.pairs}, placebo ${ratioText(r.placebo)} (${r.identical} graines intactes), faillites ${r.bankrupt.any} contre ${r.bankrupt.winner}`;
  return row('retest', 'Règle du nouveau test (D122)', r.adopted, value, '≥ 1,15, ≥ 19/30, au-dessus du placebo, faillites stables', 'refusée pour de bon : `PORTFOLIO.retestAny` quitte le code');
}

// ───────────────────────────── plain tables ─────────────────────────────

/** The first column to the left, the others to the right. */
export function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => (i ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join(' │ ');
  return [line(head), width.map((w) => '─'.repeat(w)).join('─┼─'), ...rows.map(line)].join('\n');
}

const mdRow = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

export function mdTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [mdRow(head), mdRow(head.map(() => '---')), ...rows.map(mdRow)].join('\n');
}

export const passText = (pass: boolean): string => (pass ? 'oui' : 'NON');
