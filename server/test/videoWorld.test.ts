/**
 * A video never touches the simulation (video D2, §12). The run lives in a temp folder, on the real session and the real
 * director: only the child process is a stand-in, which writes the files a real render writes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ContentEngine, BrainVault, RunPaths } from '../src/contracts.js';
import type { ScenarioConfig, WorldState } from '../src/shared.js';
import { LEGACY } from './legacy.js';

const fake = vi.hoisted(() => ({
  base: `${process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'}/agency-video-world-${process.pid}`,
  tmp: '',
}));

vi.mock('../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/index.js')>();
  const { join: j } = await import('node:path');
  return {
    ...actual,
    repoRoot: () => fake.tmp || actual.repoRoot(), // empty while the modules load: fonts are read from the real tree
    runPaths: (runId: string) => ({ root: j(fake.tmp, 'runs', runId), brain: j(fake.tmp, 'runs', runId, 'brain'), files: j(fake.tmp, 'runs', runId, 'files') }),
  };
});

const { AgencySession } = await import('../src/api/session.js');
const { saveWorld, worldFile } = await import('../src/api/persist.js');
const { toSnapshot } = await import('../src/api/snapshot.js');
const { createWorld, defaultScenario, Company } = await import('../src/runtime/index.js');
const { createContentEngine } = await import('../src/minds/index.js');
const { createBrainVault } = await import('../src/learning/index.js');
const { RESULT_FILE, selectWorthy, VideoDirector } = await import('../src/video/director.js');

afterAll(() => rmSync(fake.base, { recursive: true, force: true }));

const RUN = 'p71-world';
const DAYS = 12;
const SEED = 7;
const CAPS = { level: 'full', reason: null, ffmpeg: null, voice: 'Hortense', canvas: true, pages: true } as const;

/** Everything the run decided: only the wall clock, and what it stamps in a PDF, may differ (same filter as `runtime.test.ts`). */
const decisions = (world: unknown): string => JSON.stringify(world, (k, v: unknown) => (k === 'at' || k === 'createdAt' || k === 'bytes' ? undefined : v));

const scenarioOf = (over: Partial<ScenarioConfig> = {}) => defaultScenario({ seed: SEED, mindMode: 'heuristic', startingCash: 500, horizonDays: 90, ...over });

/** Writes the files of a finished render, at once: the session sees what a very fast worker would give it. */
function fakeRender(jobs: string[]) {
  return (job: { dir: string; root: string }) => {
    jobs.push(job.dir);
    const rel = job.dir.slice(job.root.length + 1).replace(/\\/g, '/');
    const path = `${rel}/master.mp4`;
    writeFileSync(join(job.dir, 'master.mp4'), Buffer.alloc(64));
    const result = { ok: true, retry: false, reason: null, video: { ratio: '9:16', path, durationSec: 20, bytes: 64 }, bytes: 64, poster: null, captions: null, cards: [], voice: null, qa: null } as const;
    writeFileSync(join(job.dir, RESULT_FILE), JSON.stringify(result));
    return { result: Promise.resolve(result) as never, cancel: () => undefined };
  };
}

/** A session on a saved world: `director` absent is the `off` a CLI run or a test gets. */
async function playRun(arm: string, director?: ConstructorParameters<typeof AgencySession>[0], scenario: Partial<ScenarioConfig> = {}, evening?: (s: InstanceType<typeof AgencySession>) => Promise<void>) {
  fake.tmp = join(fake.base, arm);
  mkdirSync(fake.tmp, { recursive: true });
  await saveWorld(createWorld(scenarioOf(scenario), RUN));
  const session = new AgencySession(director);
  await session.loadRun(RUN);
  session.pause();
  for (let day = 0; day < DAYS; day++) {
    await session.runDay();
    await evening?.(session);
  }
  return session;
}

const savedWorld = (): string => readFileSync(worldFile(RUN), 'utf8');

describe('rendering and the simulation', () => {
  it(`${DAYS} days with a director on auto equal ${DAYS} days with the video off`, async () => {
    const off = await playRun('off');
    expect(off.videoIndex().items).toEqual({});
    await off.shutdown();
    const quiet = savedWorld();
    expect(existsSync(join(fake.tmp, 'runs', RUN, 'video'))).toBe(false);

    const jobs: string[] = [];
    const seen: string[] = [];
    const on = await playRun('auto', {
      director: (paths, onChange) => new VideoDirector({
        paths, mode: 'auto', caps: CAPS, maxDiskMb: 1200, render: fakeRender(jobs) as never, probe: () => 20,
        onChange: (id, v) => { seen.push(`${id}:${v.status}`); onChange(id, v); },
      }),
    });
    const { items } = on.videoIndex();
    await on.shutdown();

    // The arm did render something, or this proves nothing.
    expect(jobs.length).toBeGreaterThan(0);
    expect(Object.values(items).some((v) => v.status === 'ready')).toBe(true);
    expect(seen.some((s) => s.endsWith(':ready'))).toBe(true);
    const loud = savedWorld();
    expect(existsSync(join(fake.tmp, 'runs', RUN, 'video', 'manifest.json'))).toBe(true);
    expect(decisions(JSON.parse(loud)) === decisions(JSON.parse(quiet))).toBe(true);
    expect(loud).not.toContain('master.mp4');
  }, 120_000);

  it('a director that throws costs the videos, never the run', async () => {
    const session = await playRun('broken', { director: () => ({ sync() { throw new Error('panne'); }, request: () => { throw new Error('panne'); }, index: () => ({ level: 'full', reason: null, items: {} }), stop: async () => undefined }) });
    expect(session.world.day).toBe(DAYS + 1);
    await session.shutdown();
    const noDirector = await playRun('refused', { director: () => { throw new Error('pas de ffmpeg'); } });
    expect(noDirector.world.day).toBe(DAYS + 1);
    expect(noDirector.videoIndex()).toMatchObject({ level: 'storyboard_only', items: {} });
    await expect(noDirector.requestVideo(noDirector.world.company.creatives[0]!.id)).rejects.toMatchObject({ status: 503 });
    await noDirector.shutdown();
  }, 120_000);

  it('asks the session for a real ad, and a 404 for one that does not exist', async () => {
    const jobs: string[] = [];
    const session = await playRun('asked', {
      director: (paths, onChange) => new VideoDirector({ paths, mode: 'ondemand', caps: CAPS, maxDiskMb: 1200, render: fakeRender(jobs) as never, probe: () => 20, onChange }),
    });
    const events: string[] = [];
    session.onVideo((id, v) => { events.push(`${id}:${v.status}`); });
    expect(jobs).toEqual([]); // on-demand: a run alone renders nothing
    const ad = session.world.company.creatives.find((c) => c.cut)!;
    expect((await session.requestVideo(ad.id)).status).toBe('rendering');
    await vi.waitFor(() => { expect(session.videoIndex().items[ad.id]?.status).toBe('ready'); });
    expect(events).toContain(`${ad.id}:ready`);
    await expect(session.requestVideo('cre_ghost')).rejects.toMatchObject({ status: 404 });

    const full = JSON.parse(session.snapshotJson(false)) as { videos: Record<string, unknown> };
    const live = JSON.parse(session.liveSnapshotJson(false)) as { videos: Record<string, unknown> };
    expect(Object.keys(full.videos)).toEqual([ad.id]);
    expect(Object.keys(live.videos)).toEqual([ad.id]);
    await session.shutdown();
  }, 120_000);

  it('renders a launch that waits for the founder, before it has shown once', async () => {
    const jobs: string[] = [];
    const session = await playRun('founder', {
      director: (paths, onChange) => new VideoDirector({ paths, mode: 'auto', caps: CAPS, maxDiskMb: 1200, render: fakeRender(jobs) as never, probe: () => 20, onChange }),
    }, { founderApproval: true }, async (s) => { // the founder says yes to everything but the launch
      const { tasks, pendingApprovals } = s.world.company;
      for (const id of [...pendingApprovals]) if (tasks.find((t) => t.id === id)?.kind !== 'launch_campaign') await s.approve(id, true);
    });
    const { world } = session;
    const waiting = world.company.tasks.filter((t) => t.kind === 'launch_campaign' && t.status === 'awaiting_founder');
    expect(waiting.length).toBeGreaterThan(0);
    const shown = new Set(world.market.adStats.map((s) => s.creativeId));
    const rendered = Object.keys(session.videoIndex().items);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.some((id) => !shown.has(id))).toBe(true);
    expect(selectWorthy(world, (id) => !rendered.includes(id))).not.toEqual([]);
    await session.shutdown();
  }, 120_000);

  it('stops the director of a run before it mounts the next, and of the last at shutdown', async () => {
    const stops: string[] = [];
    fake.tmp = join(fake.base, 'switch');
    mkdirSync(fake.tmp, { recursive: true });
    await saveWorld(createWorld(scenarioOf(), 'p71-one'));
    await saveWorld(createWorld(scenarioOf(), 'p71-two'));
    const session = new AgencySession({
      director: (paths) => ({ sync: () => undefined, request: () => { throw new Error('no'); }, index: () => ({ level: 'full', reason: null, items: {} }), stop: async () => { stops.push(paths.root.slice(-7)); } }),
    });
    await session.loadRun('p71-one');
    session.pause();
    expect(stops).toEqual([]);
    await session.loadRun('p71-two');
    expect(stops).toEqual(['p71-one']);
    await session.shutdown();
    expect(stops).toEqual(['p71-one', 'p71-two']);
  }, 60_000);
});

describe('the world holds the plan, never the file', () => {
  function mount(root: string, scenario: Partial<ScenarioConfig>) {
    const paths: RunPaths = { root, brain: join(root, 'brain'), files: join(root, 'files') };
    const engine = (createContentEngine as unknown as (o: object) => ContentEngine)({ mode: 'heuristic', maxComputeEur: 0, seed: SEED });
    const brain = (createBrainVault as unknown as (p: RunPaths) => BrainVault)(paths);
    const world = createWorld(scenarioOf(scenario), 'p71-reload');
    return { world, opts: { paths, engine, brain } };
  }

  async function play(arm: string, ticks: number, reloadEvery: number, scenario: Partial<ScenarioConfig> = {}, oldSave = false): Promise<WorldState> {
    const root = join(fake.base, arm);
    const m = mount(root, scenario);
    let world = m.world;
    if (oldSave) delete world.scenario.videoModel; // what a save from before video holds: `defaultScenario` would fill it
    let company = new Company(world, m.opts);
    for (let i = 1; i <= ticks; i++) {
      await company.step();
      if (reloadEvery && i % reloadEvery === 0) {
        world = JSON.parse(JSON.stringify(world)) as WorldState;
        company = new Company(world, m.opts);
      }
    }
    return world;
  }

  it('a reload mid-run ends identical, `cut` included', async () => {
    const ticks = 14 * 12;
    const straight = await play('straight', ticks, 0);
    expect(straight.company.creatives.some((c) => c.cut)).toBe(true);
    const reloaded = await play('reloaded', ticks, 7);
    expect(decisions(reloaded) === decisions(straight)).toBe(true);
  }, 120_000);

  it('`videoModel: off` plans no cut and draws what a scenario with no such field draws', async () => {
    const days = 6 * 12;
    const off = await play('model-off', days, 0, { ...LEGACY, videoModel: 'off' });
    expect(off.company.creatives.length).toBeGreaterThan(0);
    expect(off.company.creatives.every((c) => c.cut === undefined)).toBe(true);

    const absent = await play('model-absent', days, 0, { ...LEGACY, videoModel: 'off' }, true);
    expect(absent.rngState).toBe(off.rngState);
    expect(decisions({ ...absent, scenario: null }) === decisions({ ...off, scenario: null })).toBe(true);
  }, 120_000);

  it('`videoModel: on` leaves the market its own draws: the rng lands where it lands with the model off', async () => {
    const on = createWorld(scenarioOf({ ...LEGACY, videoModel: 'on' }), 'p71-on');
    const off = createWorld(scenarioOf({ ...LEGACY, videoModel: 'off' }), 'p71-off');
    expect(on.rngState).toBe(off.rngState);
    expect(on.market.niches).toEqual(off.market.niches);
  });

  it('no plain snapshot holds the truth of a niche', () => {
    const world = createWorld(scenarioOf(), 'p71-taste');
    expect(world.market.niches[0]!.hookAffinity).toBeDefined();
    expect(JSON.stringify(toSnapshot(world, false))).not.toContain('hookAffinity');
  });
});
