/**
 * The one calibration (PLAN §4). Each step runs alone, ends on a table and on runs/calibration/step<N>.json.
 *
 *   cd server && npx tsx scripts/calibrate.ts --step 1                      noise floor: N, the threshold of paired gains
 *   cd server && npx tsx scripts/calibrate.ts --step 2 [--write]            pars, spreads, levers; --write overwrites TALENT.par and TALENT.sd, once
 *   cd server && npx tsx scripts/calibrate.ts --step 3 [--insurance]        the seven candidates, K1 to K8, the winner by the rule; the one re-run of D123
 *   cd server && npx tsx scripts/calibrate.ts --step 4 [--winner-written]   every paired control with its own rule
 *   cd server && npx tsx scripts/calibrate.ts --step 5                      the Markdown block for docs/BALANCE.md
 *
 * Options: --jobs N (14), --out FOLDER (runs/calibration), --smoke (2 seeds, 8 to 12 days, 2 jobs, --out required),
 * --budget-minutes N (240), --candidates A,D,F,B,G,E,C (any other list is refused).
 *
 * Each seed runs in its own process and ends in <out>/step<N>/<arm>/<difficulty>-<seed>.json with the stamp of the code that made it.
 * A finished seed never runs twice, so a killed step resumes by the same command, and a seed of another code stops the step. The
 * budget is the one clock here, and it never reaches a run.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPaths } from '../src/core/index.js';
import { LEAN_ORG } from '../src/runtime/org/constants.js';
import { TALENT } from '../src/runtime/talent/constants.js';
import { SKILLS } from '../src/runtime/talent/skills.js';
import type { Difficulty, ScenarioConfig, Skill } from '../src/shared.js';
import { constantAt, eur, num, runOne, type RunResult, type RunSpec, type RunWindows } from './balanceLib.js';
import {
  ALREADY_WRITTEN, armScenario, assertCandidates, assertWinnerWritten, averageRoasRow, CANDIDATES, candidateEdits, checksOf, codeStamp, decide, designRow, firingShare, FULL_READS, gains,
  insuranceDue, LEVER_TEXT, lastClickRow, leagueRead, leagueSwitch, legacyRow, leverOutcome, MAX_IDENTICAL, mdTable, medianOf, noHireRow, noiseRead, noLearningRow, normalMedian, parMarked,
  passText, PLACEBO_CTR, pooledPars, Refused, retestRead, retestRow, rewritePars, scaleRead, seedCounts, SMOKE_READS, table, TARGET_MEDIAN, threshold, tiktokRow, tempoRow, videoSkillRow, type Candidate,
  type Check, type CodeEscape, type ControlRow, type LeagueRead, type LeverOutcome, type MeasuredPar, type Reads, type RetestRead, type ScaleRead,
} from './calibrateLib.js';

class ArgError extends Error {}

interface Args {
  step: number | null;
  jobs: number;
  out: string;
  smoke: boolean;
  write: boolean;
  winnerWritten: boolean;
  insurance: boolean;
  candidates: string[] | null;
  budgetMinutes: number;
  worker: string | null;
  /** The stamp of the code this step runs on. */
  code: string;
}

const USAGE = `Utilisation : npx tsx scripts/calibrate.ts --step N [options]
  --step N                 1 bruit, 2 pars et leviers, 3 candidats, 4 contrôles, 5 rapport
  --jobs N                 processus en parallèle (défaut 14, 2 en --smoke)
  --out DOSSIER            où vont les résultats (défaut runs/calibration)
  --smoke                  2 graines, 8 à 12 jours : vérifie l'outil, ne décide rien (--out obligatoire)
  --write                  étape 2 : écrit TALENT.par et TALENT.sd dans constants.ts, une seule fois
  --winner-written         étape 4 : le gagnant est déjà dans le code, ne pas rejouer ses valeurs
  --candidates A,B,...     étape 3 : refusée si ce ne sont pas les sept du plan
  --insurance              étape 3 : l'assurance de D117 est construite, le gagnant rejoue normal et cauchemar, une fois
  --budget-minutes N       plus aucune graine lancée passé ce temps (défaut 240)`;

function parseArgs(argv: string[]): Args {
  const a: Args = { step: null, jobs: 14, out: runPaths('calibration').root, smoke: false, write: false, winnerWritten: false, insurance: false, candidates: null, budgetMinutes: 240, worker: null, code: '' };
  let jobs: number | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith('--')) throw new ArgError(`Argument inattendu : « ${tok} ».`);
    const key = tok.slice(2);
    if (key === 'smoke') { a.smoke = true; continue; }
    if (key === 'write') { a.write = true; continue; }
    if (key === 'winner-written') { a.winnerWritten = true; continue; }
    if (key === 'insurance') { a.insurance = true; continue; }
    if (key === 'help') throw new ArgError('');
    const value = argv[++i];
    if (value === undefined) throw new ArgError(`L'option --${key} attend une valeur.`);
    const int = (min: number, max: number) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) throw new ArgError(`--${key} doit être un entier entre ${min} et ${max}.`);
      return n;
    };
    switch (key) {
      case 'step': a.step = int(1, 5); break;
      case 'jobs': jobs = int(1, 16); break;
      case 'out': out = resolve(value); break;
      case 'candidates': a.candidates = value.split(',').map((s) => s.trim()); break;
      case 'budget-minutes': a.budgetMinutes = int(0, 10_000); break;
      case 'worker': a.worker = value; break;
      default: throw new ArgError(`Option inconnue : --${key}.`);
    }
  }
  if (a.worker) return a;
  if (a.step === null) throw new ArgError('--step est obligatoire.');
  if (a.insurance && a.step !== 3) throw new ArgError('--insurance ne vaut que pour l\'étape 3.');
  if (a.smoke && !out) throw new ArgError('--smoke exige --out : un essai n\'écrit jamais dans runs/calibration.');
  if (out) a.out = out;
  a.jobs = jobs ?? (a.smoke ? 2 : 14);
  return a;
}

// ───────────────────────────── jobs ─────────────────────────────

/** How long a run lasts and where it is read, the real way or the smoke way. */
interface Plan {
  reads: Reads;
  short: number; long: number; longest: number;
  seeds: (ids: number[]) => number[];
  windows: RunWindows | undefined;
  prefix: string;
  maxIdentical: number;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const REAL: Plan = { reads: FULL_READS, short: 60, long: 182, longest: 270, seeds: (ids) => ids, windows: undefined, prefix: 'cal', maxIdentical: MAX_IDENTICAL };
const SMOKE: Plan = { reads: SMOKE_READS, short: 8, long: 12, longest: 12, seeds: (ids) => ids.slice(0, 2), windows: { work: [2, 8], ratingsDay: 8 }, prefix: 's14t', maxIdentical: Infinity };

const planOf = (args: Args): Plan => (args.smoke ? SMOKE : REAL);

interface ArmDef { arm: string; difficulty?: Difficulty; seeds: number[]; days: number; overrides?: Record<string, number>; scenario?: Partial<ScenarioConfig> }
interface Job { file: string; label: string; spec: RunSpec }

const BUDGET = 500;
const SEEDS = range(1, 30);
const FRESH_SEEDS = range(31, 60);
const LEVER_SEEDS = range(1, 12);
/** The placebo of §4: a market moved by nothing. */
const perturbed = (): Record<string, number> => ({ 'ADS.baseCtr': constantAt('ADS.baseCtr') * PLACEBO_CTR });

function jobsOf(args: Args, step: number, arms: readonly ArmDef[]): Job[] {
  const plan = planOf(args);
  return arms.flatMap(({ arm, difficulty = 'normal', seeds, days, overrides = {}, scenario }) => plan.seeds(seeds).map((seed) => ({
    file: join(args.out, `step${step}`, arm, `${difficulty}-${seed}.json`),
    label: `étape ${step}/${arm} ${difficulty} graine ${seed}`,
    spec: { difficulty, seed, days, budget: BUDGET, overrides, scenario: armScenario(scenario), windows: plan.windows, runId: `${plan.prefix}-${step}-${arm}-${difficulty}-${seed}`.toLowerCase() },
  })));
}

const MARK = '@@CALIBRATE_DONE@@';
const REPO = fileURLToPath(new URL('../..', import.meta.url));

interface Saved { spec: RunSpec; code: string; result: RunResult }

/** One seed, one process: overrides are process-wide. The file appears whole or not at all, and a killed step takes its seeds with it (`worker`). */
function runInChild(job: Job): Promise<{ profit: number; seconds: number }> {
  return new Promise((done, fail) => {
    const script = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [...process.execArgv, script, '--worker', JSON.stringify({ spec: job.spec, file: job.file })], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { err += b.toString('utf8'); });
    child.on('error', fail);
    child.on('close', (code) => {
      const at = out.lastIndexOf(MARK);
      if (at < 0) { fail(new Error(`pas de résultat (code ${code}). ${err.slice(-800)}`)); return; }
      done(JSON.parse(out.slice(at + MARK.length).trim()) as { profit: number; seconds: number });
    });
  });
}

async function worker(payload: string): Promise<void> {
  const { spec, file } = JSON.parse(payload) as { spec: RunSpec; file: string };
  process.stdin.on('end', () => process.exit(1)); // the pipe closes when the step dies
  process.stdin.resume();
  const code = await codeStamp(REPO); // read by the process that runs: a code that moves during a step shows
  const result = await runOne(spec);
  await mkdir(dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.tmp`;
  await writeFile(part, JSON.stringify({ spec, code, result } satisfies Saved), 'utf8');
  await rename(part, file);
  process.stdout.write(`\n${MARK}${JSON.stringify({ profit: result.profit, seconds: result.seconds })}\n`);
}

/** Which seeds of another code a step lets through. Only D123 lets any. */
type Escape = (job: Job) => CodeEscape;

/** Saved runs of these jobs. A file made with another spec or another code stops the step: mixing two calibrations would read as one. */
async function loadJobs(args: Args, jobs: readonly Job[], escape: Escape): Promise<Map<string, RunResult>> {
  const saved = new Map<string, RunResult>();
  for (const job of jobs) {
    if (!existsSync(job.file)) continue;
    const { spec, code, result } = JSON.parse(await readFile(job.file, 'utf8')) as Saved;
    // Through JSON: `undefined` fields leave the saved copy.
    if (seedCounts(job.file, { spec, code }, { spec: JSON.parse(JSON.stringify(job.spec)), code: args.code }, escape(job))) saved.set(job.file, result);
  }
  return saved;
}

interface Launch { store: Map<string, RunResult>; stopped: boolean; failed: string[] }

/** Runs what is not finished. Past the budget nothing new starts: what runs ends, and the step reports what finished. */
async function launch(args: Args, jobs: readonly Job[], escape: Escape): Promise<Launch> {
  const store = await loadJobs(args, jobs, escape);
  const pending = jobs.filter((j) => !store.has(j.file));
  console.log(`\n${jobs.length} runs prévus, ${store.size} déjà finis, ${pending.length} à lancer (${args.jobs} processus).`);
  const deadline = performance.now() + args.budgetMinutes * 60_000;
  const failed: string[] = [];
  let next = 0;
  let done = 0;
  let stopped = false;
  const pump = async () => {
    while (next < pending.length) {
      if (performance.now() >= deadline) { stopped = true; return; }
      const job = pending[next++]!;
      try {
        const r = await runInChild(job);
        done++;
        console.log(`  [${done}/${pending.length}] ${job.label} : profit ${eur(r.profit)} (${r.seconds} s)`);
      } catch (e) {
        failed.push(job.label);
        console.error(`Échec, ${job.label} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.jobs, pending.length) }, pump));
  if (stopped) console.log(`\nBudget de ${args.budgetMinutes} minutes dépassé : ${pending.length - next} runs non lancés, le rapport lit ce qui a fini.`);
  return { store: await loadJobs(args, jobs, escape), stopped, failed };
}

/** What one step knows of its arms once they ran. */
class Results {
  constructor(readonly args: Args, readonly step: number, readonly jobs: Job[], readonly run: Launch) {}

  get planned(): number { return this.jobs.length; }
  get finished(): number { return this.run.store.size; }
  get complete(): boolean { return this.finished === this.planned; }

  arm(arm: string, difficulty: Difficulty = 'normal'): RunResult[] {
    const dir = join(this.args.out, `step${this.step}`, arm);
    return this.jobs.filter((j) => dirname(j.file) === dir && j.spec.difficulty === difficulty).flatMap((j) => this.run.store.get(j.file) ?? []);
  }

  /** A step cut short says so at the top of what it prints. */
  status(): { complete: boolean; planned: number; finished: number; failed: string[]; code: string } {
    return { complete: this.complete, planned: this.planned, finished: this.finished, failed: this.run.failed, code: this.args.code };
  }

  banner(): void {
    console.log(`\n── Étape ${this.step} : ${this.finished}/${this.planned} runs${this.complete ? '' : ', INCOMPLÈTE'}${this.args.smoke ? ' (smoke : rien ne se décide ici)' : ''} ──`);
  }
}

async function steppedRun(args: Args, step: number, arms: readonly ArmDef[], escape: Escape = () => 'none'): Promise<Results> {
  const jobs = jobsOf(args, step, arms);
  return new Results(args, step, jobs, await launch(args, jobs, escape));
}

const reportFile = (args: Args, step: number): string => join(args.out, `step${step}.json`);

async function writeReport(args: Args, step: number, report: object): Promise<void> {
  await mkdir(args.out, { recursive: true });
  await writeFile(reportFile(args, step), `${JSON.stringify(report, null, 1)}\n`, 'utf8');
  console.log(`\nRapport : ${reportFile(args, step)}`);
}

async function readReport<T>(args: Args, step: number): Promise<T> {
  const file = reportFile(args, step);
  if (!existsSync(file)) throw new Refused(`Il manque ${file} : lancer d'abord l'étape ${step}.`);
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function floorOf(args: Args): Promise<number> {
  const report = await readReport<Step1Report>(args, 1);
  if (!report.complete) throw new Refused('L\'étape 1 n\'a pas fini : N n\'existe pas encore. La relancer, elle reprend où elle s\'est arrêtée.');
  if (report.N === null) throw new Refused(`N n'existe pas : le placebo n'a pas touché ${report.identical.length} graines sur ${report.pairs.length}, au-delà de ${MAX_IDENTICAL}.`);
  return report.N;
}

// ───────────────────────────── step 1: noise floor ─────────────────────────────

interface StepStatus { complete: boolean; planned: number; finished: number; failed: string[]; code: string }
interface Step1Report extends StepStatus { step: 1; N: number | null; threshold: number | null; identical: number[]; pairs: { seed: number; base: number; perturbed: number }[] }

async function step1(args: Args): Promise<void> {
  const plan = planOf(args);
  const results = await steppedRun(args, 1, [
    { arm: 'base', seeds: SEEDS, days: plan.short },
    { arm: 'perturbed', seeds: SEEDS, days: plan.short, overrides: perturbed() },
  ]);
  const [base, moved] = [results.arm('base'), results.arm('perturbed')];
  const byMoved = new Map(moved.map((r) => [r.seed, r.profit]));
  const pairs = base.flatMap((r) => (byMoved.has(r.seed) ? [{ seed: r.seed, base: r.profit, perturbed: byMoved.get(r.seed)! }] : []));
  const noise = noiseRead(base, moved, plan.maxIdentical);
  const N = noise.N ?? (args.smoke ? 0 : null); // a smoke decides nothing, and 8 days may touch no seed
  results.banner();
  console.log(table(['Graine', 'Tel quel', `ADS.baseCtr × ${num(PLACEBO_CTR)}`, 'Écart absolu'], pairs.map((p) => [String(p.seed), eur(p.base), eur(p.perturbed), eur(Math.abs(p.base - p.perturbed))])));
  console.log(`\nGraines intactes (lignes identiques à l'octet dans les deux bras) : ${noise.identical.length}/${noise.pairs}${noise.identical.length ? `, ${noise.identical.join(', ')}, hors de N` : ''}.`);
  console.log(`N = ${N === null ? '—' : eur(N)} (médiane des écarts absolus appariés). Seuil « 420 € » des étapes suivantes : ${N === null ? '—' : eur(threshold(N))}.`);
  if (N === null && results.complete) console.log(`Pas de N : plus de ${MAX_IDENTICAL} graines intactes, les étapes suivantes refusent.`);
  await writeReport(args, 1, { step: 1, ...results.status(), N, threshold: N === null ? null : threshold(N), identical: noise.identical, pairs } satisfies Step1Report);
}

// ───────────────────────────── step 2: pars and levers ─────────────────────────────

const LEVER_GROUPS: readonly { id: string; label: string; skills: Skill[] }[] = [
  { id: 'copy', label: 'copy', skills: ['copy'] },
  { id: 'page', label: 'page', skills: ['page'] },
  { id: 'longform', label: 'longform + polish', skills: ['longform', 'polish'] },
  { id: 'buying', label: 'buying', skills: ['buying'] },
];
const FLAT_T = 0.56;
const LOW_T = 0.25;
const HIGH_T = 0.8;

/** Talent §10.1: one group at .25 or .8, all the rest at .56, so that a difference is that group's. */
const forcedTalent = (skills?: Skill[], value?: number): Partial<ScenarioConfig> => ({
  talent: 'flat',
  control: { talentOverride: [{ skills: [...SKILLS], value: FLAT_T }, ...(skills && value !== undefined ? [{ skills, value }] : [])] },
});

interface LeverRead { group: string; gain: number | null; pairs: number; outcome: LeverOutcome | null }
interface ParRow { key: string; n: number; par: number; sd: number; wasPar: number | null; wasSd: number | null }
interface Step2Report extends StepStatus { step: 2; pars: ParRow[]; levers: LeverRead[]; written: boolean }

const CONSTANTS_FILE = fileURLToPath(new URL('../src/runtime/talent/constants.ts', import.meta.url));

/** The real file, or under --smoke a copy of it: a smoke writes nothing the code reads. */
async function constantsTarget(args: Args): Promise<string> {
  if (!args.smoke) return CONSTANTS_FILE;
  const copy = join(args.out, 'constants.ts');
  if (!existsSync(copy)) {
    await mkdir(args.out, { recursive: true });
    await copyFile(CONSTANTS_FILE, copy);
  }
  return copy;
}

const parsWritten = async (args: Args): Promise<boolean> => parMarked(await readFile(await constantsTarget(args), 'utf8'));

async function writePars(args: Args, measured: Record<string, MeasuredPar>): Promise<void> {
  const target = await constantsTarget(args);
  const source = await readFile(target, 'utf8');
  await writeFile(target, rewritePars(source, TALENT, measured), 'utf8');
  console.log(`\nTALENT.par et TALENT.sd écrits dans ${target}.`);
}

async function step2(args: Args): Promise<void> {
  const plan = planOf(args);
  if (args.write) {
    if (await parsWritten(args)) throw new Refused(ALREADY_WRITTEN);
    await floorOf(args); // the write moves the code: past it, step 1 cannot resume
  }
  const results = await steppedRun(args, 2, [
    { arm: 'par', seeds: LEVER_SEEDS, days: plan.short, scenario: forcedTalent() },
    ...LEVER_GROUPS.flatMap(({ id, skills }) => [
      { arm: `${id}-low`, seeds: LEVER_SEEDS, days: plan.short, scenario: forcedTalent(skills, LOW_T) },
      { arm: `${id}-high`, seeds: LEVER_SEEDS, days: plan.short, scenario: forcedTalent(skills, HIGH_T) },
    ]),
  ]);
  const measured = pooledPars(results.arm('par'));
  const pars: ParRow[] = Object.entries(measured).sort(([a], [b]) => a.localeCompare(b)).map(([key, m]) => ({ key, ...m, wasPar: TALENT.par[key] ?? null, wasSd: TALENT.sd[key] ?? null }));
  const levers: LeverRead[] = LEVER_GROUPS.map(({ id, label }) => {
    const gain = gains(results.arm(`${id}-high`), results.arm(`${id}-low`));
    const median = medianOf(gain);
    return { group: label, gain: median, pairs: gain.length, outcome: leverOutcome(median) };
  });
  results.banner();
  console.log(table(['Clé', 'n', 'par', 'avant', 'sd', 'avant'], pars.map((p) => [p.key, String(p.n), num(p.par), num(p.wasPar), num(p.sd), num(p.wasSd)])));
  const silent = Object.keys(TALENT.par).filter((k) => !measured[k]);
  if (silent.length) console.log(`\nSans mesure, gardent leur valeur : ${silent.join(', ')}.`);
  console.log(`\n${table(['Groupe', `profit(${HIGH_T}) − profit(${LOW_T})`, 'Paires', 'Règle'], levers.map((l) => [l.group, l.gain === null ? '—' : eur(l.gain), String(l.pairs), l.outcome ? LEVER_TEXT[l.outcome] : '—']))}`);
  if (args.write) {
    if (!results.complete) throw new Refused('--write refusé : l\'étape n\'a pas fini, la mesure ne se fait qu\'une fois.');
    await writePars(args, measured);
  }
  await writeReport(args, 2, { step: 2, ...results.status(), pars, levers, written: await parsWritten(args) } satisfies Step2Report);
}

// ───────────────────────────── step 3: candidates ─────────────────────────────

interface CandidateRead { id: string; label: string; overrides: Record<string, number>; median: number | null; failed: number; checks: Check[] }
interface Winner { id: string; label: string; overrides: Record<string, number>; reason: string; edits: string[]; insurance: boolean; insured: boolean }
interface Step3Report extends StepStatus { step: 3; N: number; candidates: CandidateRead[]; winner: Winner | null }

/** §4: the list on the command line, then the list that first ran here. There is no second one. */
async function checkedCandidates(args: Args): Promise<void> {
  if (args.candidates) {
    const named = args.candidates.map((id) => CANDIDATES.find((c) => c.id === id) ?? { id, label: id, overrides: {} });
    assertCandidates(named);
  }
  const stamp = join(args.out, 'step3', 'candidates.json');
  const list = JSON.stringify(CANDIDATES, null, 1);
  if (existsSync(stamp)) {
    if ((await readFile(stamp, 'utf8')) !== list) throw new Refused(`Liste de candidats refusée : ${stamp} en garde une autre.`);
    return;
  }
  await mkdir(dirname(stamp), { recursive: true });
  await writeFile(stamp, list, 'utf8');
}

function candidateArms(c: Candidate, plan: Plan): ArmDef[] {
  return [
    { arm: c.id, difficulty: 'normal', seeds: SEEDS, days: plan.long, overrides: c.overrides },
    { arm: c.id, difficulty: 'facile', seeds: SEEDS, days: plan.short, overrides: c.overrides },
    { arm: c.id, difficulty: 'cauchemar', seeds: SEEDS, days: plan.short, overrides: c.overrides },
  ];
}

/** D123: the winner stays, on the code the insurance made. There is one re-run, and the code has to have moved. */
async function insuredWinner(args: Args): Promise<Winner> {
  const report = await readReport<Step3Report>(args, 3);
  const { winner } = report;
  if (!winner?.insurance || winner.insured) throw new Refused('--insurance refusé : D123 ne relance le gagnant qu\'une fois, et seulement si K3 ou K5 échoue sous lui.');
  if (report.code === args.code) throw new Refused('--insurance refusé : le code n\'a pas bougé depuis l\'étape 3, l\'assurance n\'est pas construite.');
  return winner;
}

async function step3(args: Args): Promise<void> {
  const plan = planOf(args);
  if (!(await parsWritten(args))) throw new Refused('L\'étape 3 mesure avec les pars de l\'étape 2 : lancer d\'abord --step 2 --write.');
  await checkedCandidates(args);
  const N = await floorOf(args);
  const insured = args.insurance ? await insuredWinner(args) : null;
  const rerun: Escape = ({ file, spec }) => (dirname(file) === join(args.out, 'step3', insured?.id ?? '') && spec.difficulty !== 'facile' ? 'rerun' : 'keep');
  const results = await steppedRun(args, 3, CANDIDATES.flatMap((c) => candidateArms(c, plan)), insured ? rerun : undefined);
  const candidates: CandidateRead[] = CANDIDATES.map((c) => {
    const [normal, facile, cauchemar] = [results.arm(c.id, 'normal'), results.arm(c.id, 'facile'), results.arm(c.id, 'cauchemar')];
    const checks = checksOf({ normal, facile, cauchemar }, plan.reads);
    return { id: c.id, label: c.label, overrides: c.overrides, median: normalMedian(normal, plan.reads), failed: checks.filter((k) => !k.pass).length, checks };
  });
  results.banner();
  console.log(`N = ${eur(N)}`);
  for (const c of candidates) {
    console.log(`\nCandidat ${c.id}, ${c.label}`);
    console.log(table(['Contrôle', 'Lu', 'Cible', 'Passe'], c.checks.map((k) => [k.id, k.value, k.target, passText(k.pass)])));
  }
  console.log(`\n${table(['Candidat', 'Échecs', `Médiane normal J${plan.reads.early}`, 'Écart à 1 800 €'], candidates.map((c) => [`${c.id} ${c.label}`, String(c.failed), c.median === null ? '—' : eur(c.median), c.median === null ? '—' : eur(Math.abs(c.median - TARGET_MEDIAN))]))}`);
  let winner: Winner | null = null;
  if (results.complete) {
    const { winner: id, reason } = insured ? { winner: insured.id, reason: `${insured.reason}, puis l'assurance de D123` } : decide(candidates, N);
    const chosen = candidates.find((c) => c.id === id)!;
    const edits = candidateEdits(chosen, constantAt);
    const insurance = insuranceDue(chosen.checks);
    winner = { id, label: chosen.label, overrides: chosen.overrides, reason, edits, insurance, insured: insured !== null };
    console.log(`\nGagnant par la règle : ${id}, ${chosen.label} (${reason}).`);
    console.log(edits.length ? `Valeurs à écrire :\n${edits.map((e) => `  ${e}`).join('\n')}` : 'Aucune valeur à écrire : le gagnant est le code tel qu\'il est.');
    if (insurance && !insured) console.log('K3 ou K5 échoue sous le gagnant : l\'assurance gardée par D117 se construit, puis --step 3 --insurance rejoue ses bras normal et cauchemar, une fois (D123).');
  } else {
    console.log('\nPas de gagnant : l\'étape n\'a pas fini. La même commande reprend les graines manquantes.');
    if (insured) return; // step3.json keeps its winner and its code: the same command resumes
  }
  await writeReport(args, 3, { step: 3, ...results.status(), N, candidates, winner } satisfies Step3Report);
}

// ───────────────────────────── step 4: paired controls ─────────────────────────────

interface Step4Report extends StepStatus {
  step: 4; N: number; threshold: number;
  winner: { id: string; overrides: Record<string, number>; written: boolean };
  rows: ControlRow[]; scale: ScaleRead; league: LeagueRead; retest: RetestRead;
}

/** Each arm of the table of §4 Step 4, on the winner. 182 days and not 180 for the scaling arms: week 26 closes on D182, and A2 reads D180 on the daily rows. */
function controlArms(plan: Plan, winner: Record<string, number>): ArmDef[] {
  const { short, long, longest } = plan;
  const arm = (name: string, scenario: Partial<ScenarioConfig> = {}, days = short, overrides = winner): ArmDef => ({ arm: name, seeds: SEEDS, days, overrides, scenario });
  const moved = { ...winner, ...perturbed() };
  return [
    arm('full'),
    arm('no-learning', { control: { noLearning: true } }),
    arm('flat', { talent: 'flat' }),
    arm('scale-noise', {}, long, moved),
    arm('scale-full', {}, long),
    arm('scale-off', { scaling: false }, long),
    arm('no-hire', { org: { ...LEAN_ORG, autoHire: false } }),
    arm('legacy31', { org: { team: 'legacy31', autoHire: false, payroll: true } }),
    arm('tiktok-only', { channelControl: 'tiktok_only' }),
    arm('average-roas', { channelControl: 'average_roas' }),
    arm('last-click', { channelControl: 'last_click' }),
    arm('video-low', { control: { videoSkill: 0.2 } }),
    arm('video-high', { control: { videoSkill: 0.9 } }),
    arm('tempo', { control: { videoTempo: 'standard' } }),
    arm('design-low', { control: { designTalent: 0.25 } }),
    arm('design-high', { control: { designTalent: 1 } }),
    { arm: 'retest-winner', seeds: FRESH_SEEDS, days: longest, overrides: winner },
    { arm: 'retest-any', seeds: FRESH_SEEDS, days: longest, overrides: { ...winner, 'PORTFOLIO.retestAny': 1 } },
    { arm: 'retest-placebo', seeds: FRESH_SEEDS, days: longest, overrides: moved },
  ];
}

/** The one retry of the Design talent row: it waits for the first read to fail. */
function designRetryArms(plan: Plan, winner: Record<string, number>): ArmDef[] {
  const overrides = { ...winner, 'VISUAL.cvr.slope': 0.25 };
  return [
    { arm: 'design-low-retry', seeds: SEEDS, days: plan.short, overrides, scenario: { control: { designTalent: 0.25 } } },
    { arm: 'design-high-retry', seeds: SEEDS, days: plan.short, overrides, scenario: { control: { designTalent: 1 } } },
  ];
}

async function winnerOf(args: Args): Promise<Step4Report['winner']> {
  const report = await readReport<Step3Report>(args, 3);
  if (!report.winner) throw new Refused('L\'étape 3 n\'a pas de gagnant : la relancer, elle reprend où elle s\'est arrêtée.');
  if (args.winnerWritten) assertWinnerWritten(report.winner.id, report.winner.overrides, constantAt);
  else if (report.code !== args.code) throw new Refused(`L'étape 3 vient d'un autre code (${report.code}, celui-ci est ${args.code}) : les contrôles ne liraient pas l'entreprise choisie.`);
  return { id: report.winner.id, overrides: args.winnerWritten ? {} : report.winner.overrides, written: args.winnerWritten };
}

async function step4(args: Args): Promise<void> {
  const plan = planOf(args);
  const { reads } = plan;
  const N = await floorOf(args);
  const t = threshold(N);
  const winner = await winnerOf(args);
  let results = await steppedRun(args, 4, controlArms(plan, winner.overrides));
  const arm = (name: string) => results.arm(name);
  const firstDesign = designRow(arm('design-low'), arm('design-high'));
  if (!firstDesign.pass && results.complete) results = await steppedRun(args, 4, [...controlArms(plan, winner.overrides), ...designRetryArms(plan, winner.overrides)]);
  const retried = arm('design-low-retry').length ? { low: arm('design-low-retry'), high: arm('design-high-retry') } : undefined;

  const full = arm('full');
  const long = arm('scale-full');
  const scale = scaleRead(long, arm('scale-off'), arm('scale-noise'), reads);
  const league = leagueRead(full, arm('flat'), long, reads);
  const retest = retestRead(arm('retest-winner'), arm('retest-any'), arm('retest-placebo'), reads);
  const fired = leagueSwitch(league, firingShare(long));
  const scalePass = scale.checks.every((c) => c.pass);
  const rows: ControlRow[] = [
    noLearningRow(full, arm('no-learning'), t),
    { id: 'no_league', label: 'Sans ligue', pass: league.checks.every((c) => c.pass), value: `M1-M7 : ${league.checks.filter((c) => c.pass).length}/7, remplacements J${reads.early} ${league.replacements.early}, J${reads.late} ${league.replacements.late}`, target: 'M1 à M7', fired },
    { id: 'no_scaling', label: 'Sans mise à l\'échelle', pass: scalePass, value: `A1-A5 : ${scale.checks.filter((c) => c.pass).length}/5, bruit ${scale.noise.floor === null ? '—' : eur(scale.noise.floor)}`, target: 'A1 à A5', fired: scalePass ? null : `nombres rapportés${scale.checks[0]!.pass ? '' : ' ; A1 manqué : regarder `priceMove` d\'abord (scale §13.2), une fois'}` },
    noHireRow(full, arm('no-hire'), reads),
    legacyRow(full, arm('legacy31')),
    tiktokRow(full, arm('tiktok-only'), reads),
    averageRoasRow(full, arm('average-roas'), t),
    lastClickRow(full, arm('last-click'), t),
    videoSkillRow(arm('video-low'), arm('video-high'), plan.short),
    tempoRow(full, arm('tempo'), reads),
    designRow(arm('design-low'), arm('design-high'), retried),
    retestRow(retest),
  ];
  results.banner();
  console.log(`Gagnant ${winner.id}${winner.written ? ' (écrit dans le code)' : ''}, N = ${eur(N)}, seuil ${eur(t)}`);
  console.log(`\n${table(['Contrôle', 'Lu', 'Règle', 'Passe', 'Bascule'], rows.map((r) => [r.label, r.value, r.target, passText(r.pass), r.fired ?? '—']))}`);
  console.log(`\nSans ligue : M1 à M7, remplacements J${reads.early} ${league.replacements.early}, J${reads.late} ${league.replacements.late} (médiane par graine ${num(league.replacements.medianLate, 1)})`);
  console.log(table(['', 'Lu', 'Cible', 'Passe'], league.checks.map((k) => [k.id, k.value, k.target, passText(k.pass)])));
  console.log(`\nSans mise à l'échelle : A1 à A5, jusqu'à J${plan.long}`);
  console.log(table(['', 'Lu', 'Cible', 'Passe'], scale.checks.map((k) => [k.id, k.value, k.target, passText(k.pass)])));
  console.log(`Bruit, marché à peine bougé contre le bras complet : écart médian ${scale.noise.floor === null ? '—' : eur(scale.noise.floor)} à J${reads.late}, A1 ${num(scale.noise.a1)}, A2 ${num(scale.noise.a2)}, ${scale.noise.identical} graines intactes. Bras sans échelle : pente > 0 sur ${scale.control.rising}/${arm('scale-off').length}, fin/début ${num(scale.control.growth)}.`);
  console.log(`\nRègle du nouveau test (D122) : ${retest.adopted ? 'adoptée, `PORTFOLIO.retestAny` passe à 1' : 'refusée pour de bon, le drapeau quitte le code'}.`);
  await writeReport(args, 4, { step: 4, ...results.status(), N, threshold: t, winner, rows, scale, league, retest } satisfies Step4Report);
}

// ───────────────────────────── step 5: the report ─────────────────────────────

/** Only assembles: nothing is decided here, and no run starts. */
function balanceBlock(s1: Step1Report, s2: Step2Report, s3: Step3Report, s4: Step4Report): string {
  const moneyOrDash = (x: number | null) => (x === null ? '—' : eur(x));
  const switches = s4.rows.filter((r) => r.fired);
  const incomplete = [s1, s2, s3, s4].filter((s) => !s.complete).map((s) => `étape ${s.step} (${s.finished}/${s.planned})`);
  return [
    '## Calibration S14',
    '',
    ...(incomplete.length ? [`**Incomplète :** ${incomplete.join(', ')}.`, ''] : []),
    `Bruit (étape 1) : N = ${moneyOrDash(s1.N)}, seuil ${moneyOrDash(s1.threshold)}, ${s1.identical.length} graines intactes sur ${s1.pairs.length}, ${s1.finished} runs.`,
    '',
    `Code : étape 1 ${s1.code}, étape 2 ${s2.code}, étape 3 ${s3.code}, étape 4 ${s4.code}.`,
    '',
    '### Pars et leviers (étape 2)',
    '',
    `TALENT.par et TALENT.sd ${s2.written ? 'écrits' : 'non écrits'}, ${s2.pars.length} clés mesurées.`,
    '',
    mdTable(['Groupe', 'Gain médian', 'Paires', 'Règle'], s2.levers.map((l) => [l.group, moneyOrDash(l.gain), String(l.pairs), l.outcome ? LEVER_TEXT[l.outcome] : '—'])),
    '',
    '### Candidats (étape 3)',
    '',
    mdTable(['Candidat', 'Médiane normal J60', 'Échecs', ...s3.candidates[0]!.checks.map((k) => k.id)], s3.candidates.map((c) => [`${c.id}, ${c.label}`, moneyOrDash(c.median), String(c.failed), ...c.checks.map((k) => `${k.value} (${passText(k.pass)})`)])),
    '',
    s3.winner ? `Gagnant : **${s3.winner.id}**, ${s3.winner.label}, ${s3.winner.reason}.` : 'Pas de gagnant.',
    ...(s3.winner?.edits.length ? ['', ...s3.winner.edits.map((e) => `- \`${e}\``)] : []),
    ...(s3.winner?.insured ? ['', 'Assurance de D117 construite, bras normal et cauchemar du gagnant rejoués (D123).'] : s3.winner?.insurance ? ['', 'K3 ou K5 échoue sous le gagnant : assurance de D117, pas encore rejouée (D123).'] : []),
    '',
    '### Contrôles appariés (étape 4)',
    '',
    mdTable(['Contrôle', 'Lu', 'Règle', 'Passe', 'Bascule'], s4.rows.map((r) => [r.label, r.value, r.target, passText(r.pass), r.fired ?? '—'])),
    '',
    `Ligue, remplacements : J60 ${s4.league.replacements.early}, J180 ${s4.league.replacements.late}, médiane par graine ${num(s4.league.replacements.medianLate, 1)}.`,
    '',
    mdTable(['', 'Lu', 'Cible', 'Passe'], [...s4.league.checks, ...s4.scale.checks].map((k) => [k.id, k.value, k.target, passText(k.pass)])),
    '',
    `Bruit à 180 jours : ${moneyOrDash(s4.scale.noise.floor)}.`,
    '',
    `Règle du nouveau test (D122) : ${s4.retest.adopted ? 'adoptée' : 'refusée pour de bon'}.`,
    '',
    '### Ce qui a basculé',
    '',
    ...(switches.length ? switches.map((r) => `- ${r.label} : ${r.fired}.`) : ['Rien.']),
    '',
    `Médiane de référence, normal J60 du gagnant : ${moneyOrDash(s3.candidates.find((c) => c.id === s3.winner?.id)?.median ?? null)}.`,
    '',
  ].join('\n');
}

async function step5(args: Args): Promise<void> {
  const [s1, s2, s3, s4] = [await readReport<Step1Report>(args, 1), await readReport<Step2Report>(args, 2), await readReport<Step3Report>(args, 3), await readReport<Step4Report>(args, 4)];
  const markdown = balanceBlock(s1, s2, s3, s4);
  console.log(`\n${markdown}`);
  await writeFile(join(args.out, 'step5.md'), markdown, 'utf8');
  await writeReport(args, 5, { step: 5, complete: [s1, s2, s3, s4].every((s) => s.complete), markdown });
}

// ───────────────────────────── main ─────────────────────────────

const STEPS: Record<number, (args: Args) => Promise<void>> = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 };

/** Every constant a step moves. A path that no longer exists stops here, before a single run. */
const MOVED_PATHS: readonly string[] = [...CANDIDATES.flatMap((c) => Object.keys(c.overrides)), 'ADS.baseCtr', 'PORTFOLIO.retestAny', 'VISUAL.cvr.slope'];

async function main(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.worker) {
      await worker(args.worker);
      return 0;
    }
    MOVED_PATHS.forEach(constantAt);
    args.code = await codeStamp(REPO);
    const t0 = performance.now();
    await STEPS[args.step!]!(args);
    console.log(`\nTerminé en ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s.`);
    return 0;
  } catch (e) {
    if (e instanceof Refused) {
      console.error(`Refusé : ${e.message}`);
      return 1;
    }
    if (!(e instanceof ArgError)) throw e;
    if (e.message) console.error(`Erreur : ${e.message}\n`);
    console.log(USAGE);
    return e.message ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.stdout.write('', () => process.exit(code)),
  (err) => {
    console.error('La calibration a échoué :', err);
    process.stdout.write('', () => process.exit(1));
  },
);
