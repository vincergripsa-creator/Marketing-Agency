/**
 * A8 and A9 (PLAN §5): the company alone, no founder action, 30 seeds of 90 days by default. It reads each evening what the end
 * of a run has forgotten: compaction takes a task 21 days after it closed, so a task stuck for two weeks leaves no trace a month on.
 *
 *   cd server && npx tsx scripts/autonomy.ts [--seeds 1-30] [--days 90] [--jobs 2]
 *
 * Leaves with 1 on any verdict that fails or seed that crashes. A shorter list of seeds holds the same shares, rounded up.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../src/api/entry.js';
import { summarizeLedger } from '../src/core/index.js';
import { isOpen } from '../src/runtime/tasks.js';
import type { Task } from '../src/shared.js';
import { eur, median } from './balanceLib.js';
import { playLong, survivalFaults } from './longrun.js';

const LIVE_BY_DAY = 15;
const LIVE_SHARE = 28 / 30;
const OPEN_DAYS = 10;
const HEADCOUNT_DAY = 60;
const HEADCOUNT_MEDIAN: [number, number] = [9, 25];
const LEGACY_TEAM = 31;
const MARK = '@@AUTONOMY_RESULT@@';

export interface StaleTask { id: string; kind: Task['kind']; title: string; status: Task['status']; dayCreated: number; lastSeen: number; log: string | null }

export interface SeedRead {
  seed: number;
  /** First day a guide went on sale. Null: never in this run. */
  firstLive: number | null;
  /** The oldest task any evening found open, in days: 0 long-open tasks on a run says nothing unless this moved. */
  oldestOpen: number;
  /** Tasks seen open past `OPEN_DAYS` days. */
  longOpen: number;
  /** Those with no reason in their log the last evening they were seen so. */
  stale: StaleTask[];
  hires: number;
  /** Null when the run stopped before `HEADCOUNT_DAY`. */
  headcountD60: number | null;
  headcountEnd: number;
  payroll: number;
  /** What needed a founder and sat there: this run has none. */
  awaitingFounder: number;
  faults: string[];
}

/** « confiée à X » says who holds a task, not why it waits. Every other line of a log is a day it was looked at and something said. */
const HANDED_OVER = /^Jour \d+ : confiée à /;

export const hasReason = (t: Pick<Task, 'log'>): boolean => t.log.some((line) => !HANDED_OVER.test(line));

/** One evening: `past` keeps each task under its id, `reasonless` the ones whose last long-open evening showed no reason. Returns the age of the oldest open task. */
export function readEvening(day: number, tasks: readonly Task[], past: Map<string, StaleTask>, reasonless: Set<string>): number {
  let oldest = 0;
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    oldest = Math.max(oldest, day - t.dayCreated);
    if (day - t.dayCreated <= OPEN_DAYS) continue;
    past.set(t.id, { id: t.id, kind: t.kind, title: t.title, status: t.status, dayCreated: t.dayCreated, lastSeen: day, log: t.log.at(-1) ?? null });
    if (hasReason(t)) reasonless.delete(t.id);
    else reasonless.add(t.id);
  }
  return oldest;
}

export async function readSeed(seed: number, days: number): Promise<SeedRead> {
  const past = new Map<string, StaleTask>();
  const reasonless = new Set<string>();
  let firstLive: number | null = null;
  let headcountD60: number | null = null;
  let oldestOpen = 0;
  const world = await playLong({ days, seed }, (kpi, w) => {
    oldestOpen = Math.max(oldestOpen, readEvening(kpi.day, w.company.tasks, past, reasonless));
    firstLive ??= kpi.liveProducts > 0 ? kpi.day : null;
    if (kpi.day === HEADCOUNT_DAY) headcountD60 = w.company.agents.length;
  });
  return {
    seed, firstLive, oldestOpen, longOpen: past.size, stale: [...reasonless].map((id) => past.get(id)!),
    hires: world.company.org?.stats.hires ?? 0, headcountD60, headcountEnd: world.company.agents.length,
    payroll: summarizeLedger(world.ledger, world.day).payroll,
    awaitingFounder: world.company.tasks.filter((t) => t.status === 'awaiting_founder').length,
    faults: survivalFaults(world, seed),
  };
}

export interface Verdict { row: 'A8' | 'A9'; label: string; read: string; ok: boolean }

/** The rows of §5. The shares scale with the seeds, rounded up: 28 of 30 is 8 of 8. */
export function verdicts(reads: readonly SeedRead[], days: number): Verdict[] {
  const n = reads.length;
  const live = reads.filter((r) => r.firstLive !== null && r.firstLive <= LIVE_BY_DAY).length;
  const liveNeed = Math.ceil(n * LIVE_SHARE - 1e-9);
  const stale = reads.reduce((a, r) => a + r.stale.length, 0);
  const longOpen = reads.reduce((a, r) => a + r.longOpen, 0);
  const oldest = Math.max(0, ...reads.map((r) => r.oldestOpen));
  const hires = reads.reduce((a, r) => a + r.hires, 0);
  const hiring = reads.filter((r) => r.hires > 0).length;
  const waiting = reads.reduce((a, r) => a + r.awaitingFounder, 0);
  const team = reads.flatMap((r) => (r.headcountD60 === null ? [] : [r.headcountD60]));
  const read = team.length === n;
  const mid = median(team);
  const [low, high] = HEADCOUNT_MEDIAN;
  const unpaid = reads.filter((r) => r.payroll <= 0).length;
  return [
    { row: 'A8', label: `guide en ligne au plus tard J${LIVE_BY_DAY}`, read: `${live}/${n} (il en faut ${liveNeed})`, ok: live >= liveNeed },
    { row: 'A8', label: `aucune tâche ouverte plus de ${OPEN_DAYS} jours sans raison au journal`, read: `${stale} sans raison sur ${longOpen} ouvertes aussi longtemps, âge maximum ${oldest} j`, ok: stale === 0 },
    { row: 'A8', label: 'des embauches sans un appel', read: `${hires} embauches, ${hiring}/${n} graines, ${waiting} tâche(s) en attente du fondateur`, ok: hires > 0 && waiting === 0 },
    { row: 'A9', label: `l'effectif de J${HEADCOUNT_DAY} diffère selon la graine`, read: read ? `${new Set(team).size} valeurs : ${[...team].sort((a, b) => a - b).join(', ')}` : `non lu sur ${days} jours`, ok: read && new Set(team).size > 1 },
    { row: 'A9', label: `pas de ${LEGACY_TEAM} constant`, read: `${team.filter((h) => h === LEGACY_TEAM).length} graine(s) à ${LEGACY_TEAM}`, ok: read && !team.includes(LEGACY_TEAM) },
    { row: 'A9', label: `médiane entre ${low} et ${high}`, read: read ? String(mid) : '—', ok: read && mid >= low && mid <= high },
    { row: 'A9', label: 'la masse salariale au grand livre', read: `${n - unpaid}/${n} graines, médiane ${eur(median(reads.map((r) => r.payroll)))}`, ok: unpaid === 0 },
  ];
}

function runInChild(seed: number, days: number): Promise<SeedRead> {
  return new Promise((done, fail) => {
    const script = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [...process.execArgv, script, '--worker', String(seed), '--days', String(days)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { err += b.toString('utf8'); });
    child.on('error', fail);
    child.on('close', (code) => {
      const at = out.lastIndexOf(MARK);
      if (at < 0) { fail(new Error(`pas de résultat (code ${code}). ${err.slice(-800)}`)); return; }
      done(JSON.parse(out.slice(at + MARK.length).trim()) as SeedRead);
    });
  });
}

const cell = (s: string | number | null, width: number): string => String(s ?? '—').padStart(width);
const HEAD = `${'graine'.padEnd(6)} │ 1er guide │ âge max │ ouvertes > ${OPEN_DAYS} j │ sans raison │ embauches │ effectif J${HEADCOUNT_DAY} │ effectif fin │ masse salariale`;
const row = (r: SeedRead): string => [
  String(r.seed).padEnd(6), cell(r.firstLive === null ? null : `J${r.firstLive}`, 9), cell(r.oldestOpen, 7), cell(r.longOpen, 13), cell(r.stale.length, 11), cell(r.hires, 9), cell(r.headcountD60, 11), cell(r.headcountEnd, 12), cell(eur(r.payroll), 15),
].join(' │ ');

interface Args { seeds: number[]; days: number; jobs: number; worker: number | null }

/** `1-30`, `1,2,7` or both. */
function parseSeeds(text: string): number[] {
  return text.split(',').flatMap((part) => {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    return m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : [Number(part)];
  });
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = { seeds: parseSeeds('1-30'), days: 90, jobs: 2, worker: null };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Option incomplète : ${argv[i]}.`);
    const n = Number(value);
    switch (argv[i]) {
      case '--seeds': a.seeds = parseSeeds(value); break;
      case '--days': a.days = n; break;
      case '--jobs': a.jobs = n; break;
      case '--worker': a.worker = n; break;
      default: throw new Error(`Option inconnue : ${argv[i]}. Utilisation : npx tsx scripts/autonomy.ts [--seeds 1-30] [--days 90] [--jobs 2]`);
    }
  }
  if (!a.seeds.length || a.seeds.some((s) => !Number.isInteger(s) || s < 0)) throw new Error('--seeds : des entiers, par exemple 1-30 ou 1,2,7.');
  if (!Number.isInteger(a.days) || a.days < 1) throw new Error('--days : un entier positif.');
  if (!Number.isInteger(a.jobs) || a.jobs < 1) throw new Error('--jobs : un entier positif.');
  return a;
}

async function main(argv: readonly string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.worker !== null) {
    process.stdout.write(`\n${MARK}${JSON.stringify(await readSeed(a.worker, a.days))}\n`);
    return 0;
  }
  console.log(`Autonomie : ${a.seeds.length} graines, ${a.days} jours, aucune action du fondateur (${a.jobs} processus).\n`);
  const started = Date.now();
  const reads: SeedRead[] = [];
  const crashes: string[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < a.seeds.length) {
      const seed = a.seeds[next++]!;
      try {
        const r = a.jobs > 1 ? await runInChild(seed, a.days) : await readSeed(seed, a.days);
        reads.push(r);
        console.log(`  graine ${seed} : terminée (${reads.length}/${a.seeds.length})`);
      } catch (err) {
        crashes.push(`graine ${seed} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(a.jobs, a.seeds.length) }, worker));
  reads.sort((x, y) => x.seed - y.seed);

  console.log(`\n${HEAD}`);
  for (const r of reads) console.log(row(r));
  for (const r of reads) {
    for (const t of r.stale) console.log(`  graine ${r.seed} : ${t.id} ${t.kind} « ${t.title} », ${t.status}, ouverte le jour ${t.dayCreated}, vue jusqu'au jour ${t.lastSeen}, journal : ${t.log ?? 'vide'}`);
  }
  const faults = [...crashes, ...reads.flatMap((r) => r.faults)];
  const results = verdicts(reads, a.days);
  console.log('\nVerdicts');
  for (const v of results) console.log(`${v.ok ? 'OK    ' : 'ÉCHEC '} ${v.row} ${v.label} : ${v.read}`);
  for (const f of faults) console.log(`ÉCHEC  ${f}`);
  console.log(`\nTerminé en ${Math.round((Date.now() - started) / 1000)} s.`);
  return results.every((v) => v.ok) && !faults.length ? 0 : 1;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.stdout.write('', () => process.exit(code)),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.stdout.write('', () => process.exit(1));
    },
  );
}
