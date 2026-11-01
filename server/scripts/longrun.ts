/**
 * The long run (scale §9.2): one headless company for a year, logged every 30 days, against the targets of §7.1. It fails on any
 * target it misses, on a ledger that is not the cash, on a broken org rule and on a crash. Not in `npm test`: `npm run test:long
 * -w server` holds what must stay true at each stage gate, this script is what A6 reads. The heap is judged under a cap: without
 * one V8 collects lazily, and the peak says how much room it was given, not how much the company needs.
 *
 *   cd server && npx tsx --max-old-space-size=500 scripts/longrun.ts --days 365 --seed 7
 *   cd server && npx tsx scripts/longrun.ts --days 365 --seeds 1,2,3,4,5,6,7,8,9,10     survival only: no crash, Σ ledger = cash
 */
import { readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArchive } from '../src/api/archive.js';
import { isEntryPoint } from '../src/api/entry.js';
import { buildSnapshot, serializeLiveSnapshot, TIGHT_LIMITS } from '../src/api/trim.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { financeSnapshot } from '../src/sim/finance.js';
import type { RunPaths } from '../src/contracts.js';
import type { DailyKpi, Difficulty, ScenarioConfig, WorldState } from '../src/shared.js';

export interface LongRun { days: number; seed: number; budget?: number; difficulty?: Difficulty; scenario?: Partial<ScenarioConfig> }

/** Plays a company in a throwaway folder, its archive beside it. `onDay` sees the world each evening. */
export async function playLong(run: LongRun, onDay?: (kpi: DailyKpi, world: WorldState, root: string) => void): Promise<WorldState> {
  const root = await mkdtemp(join(tmpdir(), 'pixel-longrun-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  try {
    const scenario = defaultScenario({
      name: `Longue course — graine ${run.seed}`, startingCash: run.budget ?? 500, difficulty: run.difficulty ?? 'normal', seed: run.seed,
      mindMode: 'heuristic', maxComputeEur: 0, openEnded: true, horizonDays: run.days, ...run.scenario,
    });
    const world = createWorld(scenario, `longrun-${run.seed}`);
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: run.seed });
    world.mind.mode = engine.mode;
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine, brain, archive: runArchive(root) });
    await company.runDays(run.days, (kpi) => onDay?.(kpi, world, root));
    return world;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** One film of the index, at the weight of a real `result.json`. */
const FILM = { status: 'ready', reason: null, videos: [{ ratio: '9:16', path: 'video/cre_00000/00000000/master.mp4', durationSec: 41, bytes: 8783831 }], poster: 'video/cre_00000/00000000/poster.jpg', captions: 'video/cre_00000/00000000/captions.vtt', cards: [], voice: 'Microsoft Hortense Desktop', qa: { ok: true, failed: [], lufs: -14, cuts: 23, avgShotSec: 1.71, mb: 8.8 } };

/** What GET /api/state adds to the view and a CLI run does not have: the session, and the 30 films of D155. */
export const STATE_EXTRA = {
  session: { runId: 'longrun-00', playing: true, speed: 1, intervalMs: 3000, busy: false, mindMode: 'heuristic', status: 'running', day: 365, tick: 0, lastError: null, minStartingCash: 300, claudeReady: false, pace: 'live', watchers: 1, backoffMs: null },
  videos: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`cre_${i}`, FILM])),
};

/** Payloads and files as §7.1 and `trim.ts` budget them: bytes, in thousands. Only the heap counts as V8 does. */
const KB = 1000;
const MB = KB * KB;
const MIB = 1024 * 1024;

/** What a payload weighs on the wire: French text takes more bytes than characters. */
export function sizeKb(json: string): number {
  return Buffer.byteLength(json) / KB;
}

export interface Target { label: string; value: number; limit: number; unit: string }

/** §7.1, with D61's time. A longer run is held to the same bounds, its clock scaled with its days. */
export function targetsFor(days: number): { seconds: number; p95Ms: number; worldMb: number; heapMb: number; liveKb: number; stateKb: number; folderMb: number } {
  const stress = days > 365;
  return { seconds: 240 * (days / 365), p95Ms: 800, worldMb: stress ? 12 * 1.2 : 12, heapMb: 500, liveKb: 400, stateKb: 700, folderMb: stress ? 400 : 150 };
}

function folderBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    total += name.isDirectory() ? folderBytes(path) : statSync(path).size;
  }
  return total;
}

/** What weighs in world.json, heaviest first. */
function sections(w: WorldState): string {
  const parts: [string, unknown][] = [
    ['tasks', w.company.tasks], ['products', w.company.products], ['creatives', w.company.creatives], ['campaigns', w.company.campaigns], ['deliverables', w.company.deliverables],
    ['missions', w.company.missions], ['experiments', w.company.experiments], ['lessons', w.company.lessons], ['research', w.company.research], ['kpis', w.company.kpis],
    ['ledger', w.ledger], ['orders', w.market.orders], ['customers', w.market.customers], ['inbox', w.market.inbox], ['adStats', w.market.adStats], ['niches', w.market.niches], ['activity', w.activity],
  ];
  return parts.map(([name, v]) => [name, JSON.stringify(v ?? null).length] as const).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, n]) => `${name} ${(n / MB).toFixed(2)}`).join(' · ');
}

function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

/** One year on one seed, logged. Returns what missed its target. */
async function measure(run: LongRun): Promise<string[]> {
  const started = Date.now();
  const ms: number[] = [];
  let last = started, peakHeap = 0, peakLive = 0, peakState = 0, peakWorld = 0, peakFolder = 0;
  const world = await playLong(run, (kpi, w, root) => {
    const now = Date.now();
    ms.push(now - last);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed / MIB);
    if (kpi.day % 30 === 0) {
      const finance = financeSnapshot(w);
      const live = sizeKb(serializeLiveSnapshot(w, finance));
      const state = sizeKb(JSON.stringify({ ...buildSnapshot(w, finance, false, TIGHT_LIMITS), ...STATE_EXTRA })); // « never LIVE »: its fallback must not read as a pass
      const size = sizeKb(JSON.stringify(w)) / KB;
      const folder = folderBytes(root) / MB;
      peakLive = Math.max(peakLive, live);
      peakState = Math.max(peakState, state);
      peakWorld = Math.max(peakWorld, size);
      peakFolder = Math.max(peakFolder, folder);
      console.log(`J${String(kpi.day).padStart(4)}  monde ${size.toFixed(2)} Mo  ${Math.round(percentile(ms.slice(-30), 0.5))} ms/j  tas ${Math.round(process.memoryUsage().heapUsed / MIB)} Mo  direct ${Math.round(live)} ko  état ${Math.round(state)} ko  dossier ${folder.toFixed(1)} Mo  cash ${kpi.cash}  ${w.company.tasks.length} tâches  [${sections(w)}]`);
    }
    last = Date.now();
  });
  const seconds = (Date.now() - started) / 1000;
  const t = targetsFor(run.days);
  const measured: Target[] = [
    { label: 'temps', value: seconds, limit: t.seconds, unit: 's' }, { label: 'p95 jour', value: percentile(ms, 0.95), limit: t.p95Ms, unit: 'ms' },
    { label: 'world.json', value: peakWorld, limit: t.worldMb, unit: 'Mo' }, { label: 'tas', value: peakHeap, limit: t.heapMb, unit: 'Mo' },
    { label: 'instantané direct', value: peakLive, limit: t.liveKb, unit: 'ko' }, { label: 'GET /api/state', value: peakState, limit: t.stateKb, unit: 'ko' },
    { label: 'dossier sans vidéo', value: peakFolder, limit: t.folderMb, unit: 'Mo' },
  ];
  console.log(measured.map((m) => `${m.label} ${m.value.toFixed(1)} ${m.unit} / ${Math.round(m.limit)}`).join(' · '));
  return [...measured.filter((m) => m.value > m.limit).map((m) => `${m.label} : ${m.value.toFixed(1)} ${m.unit} pour ${Math.round(m.limit)}`), ...survivalFaults(world, run.seed)];
}

export function survivalFaults(world: WorldState, seed: number): string[] {
  const faults: string[] = [];
  const cash = world.company.kpis.at(-1)?.cash;
  const ledger = financeSnapshot(world).cash;
  if (cash !== undefined && Math.abs(cash - ledger) > 0.01 + 1e-9) faults.push(`graine ${seed} : ${cash} € aux KPI pour ${ledger} € au grand livre`);
  const violations = world.company.org?.stats.violations ?? 0;
  if (violations) faults.push(`graine ${seed} : ${violations} règle(s) d'organisation enfreinte(s)`);
  for (const k of world.company.kpis) if (!Number.isFinite(k.cash) || !Number.isFinite(k.profit)) faults.push(`graine ${seed} : NaN au jour ${k.day}`);
  return faults;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const days = Number(arg('days') ?? 365);
  const seeds = arg('seeds')?.split(',').map(Number);
  const faults: string[] = [];
  if (seeds) {
    for (const seed of seeds) {
      const started = Date.now();
      const world = await playLong({ days, seed });
      faults.push(...survivalFaults(world, seed));
      console.log(`graine ${seed} : jour ${world.day}, ${world.status}, ${world.company.kpis.at(-1)?.cash ?? 0} €, ${Math.round((Date.now() - started) / 1000)} s`);
    }
  } else faults.push(...await measure({ days, seed: Number(arg('seed') ?? 7), budget: Number(arg('budget') ?? 500), difficulty: (arg('difficulty') ?? 'normal') as Difficulty }));
  for (const f of faults) console.error(`ÉCHEC ${f}`);
  console.log(faults.length ? `${faults.length} cible(s) manquée(s).` : 'OK : toutes les cibles tiennent.');
  process.exitCode = faults.length ? 1 : 0;
}

if (isEntryPoint(import.meta.url)) void main();
