/**
 * The golden run: one legacy company, 25 days, seed 7, boiled down to a sha1 of what it did. Refactors prove they moved
 * nothing with it. Only D43 may re-record it (P8.1, P10.2, P14.1), with the old and new hash in docs/BALANCE.md; any other
 * mismatch is a bug.
 *
 *   cd server && npx tsx scripts/golden.ts            prints the hash of today's code
 *   cd server && npx tsx scripts/golden.ts --check    exit 1 when it differs from test/golden.json
 *   cd server && npx tsx scripts/golden.ts --record   rewrites test/golden.json
 *   cd server && npx tsx scripts/golden.ts --fixture  writes the day-20 world as the old-save fixture, never over an existing one
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isEntryPoint } from '../src/api/entry.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RunPaths } from '../src/contracts.js';
import type { WorldState } from '../src/shared.js';
import { LEGACY } from '../test/legacy.js';

export const GOLDEN = { days: 25, seed: 7, budget: 500, fixtureDay: 20 } as const;

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test');
export const GOLDEN_FILE = join(TEST_DIR, 'golden.json');
export const FIXTURE_FILE = join(TEST_DIR, 'fixtures', 'world-v1.json.gz');

export interface GoldenRecord {
  hash: string;
  parts: Record<'ledger' | 'kpis' | 'tasks' | 'events', string>; // which side moved, when the hash does
}

const sha1 = (value: unknown): string => createHash('sha1').update(JSON.stringify(value)).digest('hex');

/** What the hash covers. Ids, timestamps and French text stay out: a re-worded line is not a change of behaviour. */
export function goldenPayload(world: WorldState) {
  return {
    ledger: world.ledger.map((e) => [e.day, e.type, e.amount, e.ref]),
    kpis: world.company.kpis,
    tasks: world.company.tasks.map((t) => [t.kind, t.status, t.assignee, t.dayDone]),
    events: world.market.events.map((e) => [e.day, e.kind]),
  };
}

export function goldenRecord(world: WorldState): GoldenRecord {
  const p = goldenPayload(world);
  return { hash: sha1(p), parts: { ledger: sha1(p.ledger), kpis: sha1(p.kpis), tasks: sha1(p.tasks), events: sha1(p.events) } };
}

export function recordedGolden(): GoldenRecord {
  return JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) as GoldenRecord;
}

/** Plays the run in a throwaway folder. `onDay` sees the world each evening. */
export async function goldenRun(onDay?: (day: number, world: WorldState) => void): Promise<WorldState> {
  const root = await mkdtemp(join(tmpdir(), 'pixel-golden-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  try {
    const scenario = defaultScenario({
      ...LEGACY,
      name: `Golden — graine ${GOLDEN.seed}`,
      startingCash: GOLDEN.budget,
      difficulty: 'normal',
      seed: GOLDEN.seed,
      mindMode: 'heuristic',
      maxComputeEur: 0,
    });
    const world = createWorld(scenario, 'golden');
    const engine = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: scenario.seed });
    world.mind.mode = engine.mode;
    const brain = createBrainVault(paths);
    await brain.init();
    const company = new Company(world, { paths, engine, brain });
    await company.runDays(GOLDEN.days, (kpi) => onDay?.(kpi.day, world));
    return world;
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

async function main(argv: string[]): Promise<number> {
  const flag = argv[0];
  if (argv.length > 1 || (flag !== undefined && !['--check', '--record', '--fixture'].includes(flag))) {
    console.error('Utilisation : npx tsx scripts/golden.ts [--check | --record | --fixture]');
    return 1;
  }
  if (flag === '--fixture' && existsSync(FIXTURE_FILE)) {
    console.error(`Refusé : ${FIXTURE_FILE} existe déjà. Cette sauvegarde est celle d'avant le contrat, elle ne se régénère pas.`);
    return 1;
  }
  let fixture: Buffer | null = null;
  const world = await goldenRun((day, w) => {
    if (flag === '--fixture' && day === GOLDEN.fixtureDay) fixture = gzipSync(JSON.stringify(w), { level: 9 });
  });
  const now = goldenRecord(world);
  console.log(`golden : ${now.hash}`);
  if (flag === '--record') {
    await writeFile(GOLDEN_FILE, `${JSON.stringify(now, null, 2)}\n`, 'utf8');
    console.log(`Écrit : ${GOLDEN_FILE}`);
  }
  if (flag === '--fixture') {
    await mkdir(dirname(FIXTURE_FILE), { recursive: true });
    await writeFile(FIXTURE_FILE, fixture!);
    console.log(`Écrit : ${FIXTURE_FILE}`);
  }
  if (flag === '--check') {
    const was = recordedGolden();
    if (was.hash !== now.hash) {
      const moved = (Object.keys(now.parts) as (keyof GoldenRecord['parts'])[]).filter((k) => was.parts[k] !== now.parts[k]);
      console.error(`ÉCHEC : attendu ${was.hash}. Ont bougé : ${moved.join(', ')}.`);
      return 1;
    }
    console.log('OK : inchangé.');
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.stdout.write('', () => process.exit(code)),
    (err) => {
      console.error('Le run golden a échoué :', err);
      process.exit(1);
    },
  );
}
