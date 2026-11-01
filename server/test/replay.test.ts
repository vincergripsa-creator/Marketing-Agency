/**
 * A4 and A5 (PLAN §5): one seed is one market, every pillar on. Two runs of a seed end equal, and a run reloaded every 7 ticks
 * ends like one that never stopped, on roads that really hold a hire, a firing, a compaction and three channels with money on
 * them. A reload here is a restart: the world goes through JSON, and engine, brain and archive are new objects, as `mountWorld`
 * builds them.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScenarioConfig, TalentMode, WorldState } from '../src/shared.js';
import type { RunPaths } from '../src/contracts.js';
import { runArchive } from '../src/api/archive.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import { channelOf } from '../src/shared.js';

const TICKS_A_DAY = 12;
/** A row of §5 is a long proof. Under the full suite a day costs several times what it costs alone. */
const LONG_TIMEOUT = 900_000;

/** The company the product runs: `defaultScenario` fills every pillar, and `newRun()` passes `openEnded`. */
const FULL: Partial<ScenarioConfig> = { openEnded: true };

async function mount(seed: number, scenario: Partial<ScenarioConfig>) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-replay-'));
  const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
  const open = async (w: WorldState): Promise<Company> => {
    const brain = createBrainVault(paths);
    await brain.init();
    return new Company(w, { paths, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed }), brain, archive: runArchive(root) });
  };
  const world = createWorld(defaultScenario({ seed, mindMode: 'heuristic', horizonDays: 90, ...scenario }), 'test-replay');
  return { world, company: await open(world), open, root };
}

/** Everything the run decided: only the wall clock, and what it stamps in a PDF, may differ. */
const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

/** Where two runs part, and what surrounds it: the first thing to read when a run stops being a function of its seed. */
function firstGap(a: string, b: string): string | null {
  if (a === b) return null;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  return `character ${at} of ${a.length}: …${a.slice(Math.max(0, at - 160), at + 160)}… against …${b.slice(Math.max(0, at - 160), at + 160)}…`;
}

interface Played { world: WorldState; dump: string; reloads: number }

/**
 * `forceLow` is the seat of talent §11, test 4: the first copywriter hired is held at .05 on the same tick of both runs, and no
 * number of the league is touched. The plan, its failure and the challenge are the company's own evidence.
 */
async function play(seed: number, ticks: number, reloadEvery: number, scenario: Partial<ScenarioConfig> = FULL, forceLow = false): Promise<Played> {
  const m = await mount(seed, scenario);
  try {
    let { world, company } = m;
    let reloads = 0;
    let target: string | undefined;
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (forceLow) {
        target ??= world.company.agents.find((a) => !a.founder && world.company.league?.entries[a.id]?.primary === 'copy')?.id;
        const truth = target ? world.talentTruth?.agents[target] : undefined;
        if (truth) Object.assign(truth, { talent: { ...truth.talent, copy: 0.05 }, ceiling: { ...truth.ceiling, copy: 0.05 } });
      }
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = await m.open(world);
        reloads += 1;
      }
    }
    return { world, dump: decisions(world), reloads };
  } finally {
    rmSync(m.root, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** The channels that carried money: an account opened and never paid proves nothing. */
const spending = (w: WorldState): Set<string> => new Set(w.market.adStats.filter((s) => s.spend > 0).map((s) => channelOf(s)));

/** A run proves nothing about the pillars it did not reach: every one of them on, and working. */
function expectFullCompany(w: WorldState, talent: TalentMode, channels = 3): void {
  expect(w.scenario).toMatchObject({ org: { team: 'lean', autoHire: true, payroll: true }, talent, channelControl: 'none', videoModel: 'on', visualModel: 'on', scaling: true, openEnded: true });
  expect(w.company.org!.stats.hires).toBeGreaterThan(0);
  expect(spending(w).size).toBeGreaterThanOrEqual(channels);
  expect(w.company.archive?.tasks ?? 0).toBeGreaterThan(0); // the first compaction that takes a task: a finished one, 21 days on
  expect(w.company.products.some((p) => p.launchedDay !== null)).toBe(true);
  expect(w.company.org!.stats.violations).toBe(0);
}

describe('A4: same seed, same run', () => {
  it('two full-feature runs of 45 days end identical', async () => {
    const ticks = 45 * TICKS_A_DAY;
    const first = await play(7, ticks, 0);
    expectFullCompany(first.world, 'league');
    expect(firstGap(first.dump, (await play(7, ticks, 0)).dump)).toBeNull();
  }, LONG_TIMEOUT);
});

/** These roads are the market's: when a change moves one past its assertion, move the seed or the length, never the assertion. */
describe('A5: a reload is an uninterrupted run', () => {
  // `flat` has no consequence by design, so a layoff is the only firing it knows, and only failing companies lay off: no flat
  // road holds both that and 3 channels with money on them (seeds 1-24 forced low, 85 days). So the row takes two roads.
  it('flat: through a hire, a compaction and 3 channels that spend', async () => {
    const ticks = 35 * TICKS_A_DAY;
    const straight = await play(12, ticks, 0, { ...FULL, talent: 'flat' }, true);
    expectFullCompany(straight.world, 'flat');
    const reloaded = await play(12, ticks, 7, { ...FULL, talent: 'flat' }, true); // 7 and 12 share no divisor: reloads fall on every tick of the day
    expect(reloaded.reloads).toBe(Math.floor(ticks / 7));
    expect(firstGap(straight.dump, reloaded.dump)).toBeNull();
  }, LONG_TIMEOUT);

  // Seed 9 hires, overreaches and lays off on D43, with money on 2 channels.
  it('flat: through a hire, a layoff and a compaction', async () => {
    const ticks = 50 * TICKS_A_DAY;
    const straight = await play(9, ticks, 0, { ...FULL, talent: 'flat' }, true);
    expectFullCompany(straight.world, 'flat', 2);
    expect(straight.world.company.org!.alumni.map((a) => a.kind)).toContain('layoff');
    const reloaded = await play(9, ticks, 7, { ...FULL, talent: 'flat' }, true);
    expect(reloaded.reloads).toBe(Math.floor(ticks / 7));
    expect(firstGap(straight.dump, reloaded.dump)).toBeNull();
  }, LONG_TIMEOUT);

  // A failed plan goes to the challenge at a close: D56 at the earliest (D79) and on seed 12, D70 on other seeds, so the run holds both.
  it('league: through a hire, a firing, a compaction and 3 channels', async () => {
    const ticks = 71 * TICKS_A_DAY;
    const straight = await play(12, ticks, 0, { ...FULL, talent: 'league' }, true);
    expectFullCompany(straight.world, 'league');
    const fired = straight.world.company.org!.alumni.filter((a) => a.kind === 'fired');
    expect(fired.length).toBeGreaterThan(0);
    expect(fired[0]!.replacedBy).not.toBeNull();
    const reloaded = await play(12, ticks, 7, { ...FULL, talent: 'league' }, true);
    expect(reloaded.reloads).toBe(Math.floor(ticks / 7));
    expect(firstGap(straight.dump, reloaded.dump)).toBeNull();
  }, LONG_TIMEOUT);
});
