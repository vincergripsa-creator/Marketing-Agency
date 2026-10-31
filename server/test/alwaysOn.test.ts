/**
 * The agency runs alone for days (scale §2): a run with no end, a loop only the founder stops, saves that survive, a pace
 * for when nobody watches, and the truth kept out of /runs/<id>/. The company here is the real one; core's paths point to a
 * temp folder so nothing lands in the repo's runs/.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunPaths, StepResult } from '../src/contracts.js';
import type { ScenarioConfig, WorldState } from '../src/shared.js';
import { isServerOnlyFile } from '../src/api/http.js';
import {
  flushSaves, keptCheckpoints, listRuns, loadWorld, loadWorldSafe, migrateWorld, readCurrentRun, readSessionLog, runExists, runsDir, saveCheckpoint, saveWorld, writeCurrentRun,
} from '../src/api/persist.js';
import { createAgencyServer, installCrashGuards, PORT_BUSY_EXIT, sessionViews, startServer, type SessionLike } from '../src/api/server.js';
import { AgencySession, mountWorld, type MountedRun, type SessionOptions, type VideoDirectorLike } from '../src/api/session.js';
import { SseHub } from '../src/api/sse.js';
import { Company, createWorld, defaultScenario } from '../src/runtime/index.js';
import type { RuntimeCtx } from '../src/runtime/ctx.js';
import { createBrainVault } from '../src/learning/index.js';
import { createContentEngine } from '../src/minds/index.js';

const fake = vi.hoisted(() => ({ tmp: `${process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'}/agency-always-on-${process.pid}` }));

vi.mock('../src/core/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/index.js')>();
  const { join: j } = await import('node:path');
  return {
    ...actual,
    repoRoot: () => fake.tmp,
    runPaths: (runId: string) => ({ root: j(fake.tmp, 'runs', runId), brain: j(fake.tmp, 'runs', runId, 'brain'), files: j(fake.tmp, 'runs', runId, 'files') }),
  };
});

const director: VideoDirectorLike = {
  sync: () => undefined,
  request: () => { throw new Error('pas de vidéo ici'); },
  index: () => ({ level: 'storyboard_only', reason: null, items: {} }),
  stop: async () => undefined,
};
const options: SessionOptions = { director: () => director };

const scenario = (over: Partial<ScenarioConfig> = {}) => defaultScenario({ seed: 7, mindMode: 'heuristic', maxComputeEur: 0, ...over });

/** A run saved by a process that ended: it has played `days` days and stopped. */
async function savedRun(runId: string, days = 1): Promise<WorldState> {
  const world = createWorld(scenario(), runId);
  const run = await mountWorld(world);
  await run.company.runDays(days);
  world.status = 'paused';
  await saveWorld(world);
  return world;
}

const mounted = (s: AgencySession) => (s as unknown as { run: MountedRun }).run;
const stepped = (w: WorldState): StepResult => ({ day: w.day, tick: w.tick, phase: 'work', status: w.status, activities: 0 });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle = () => new Promise<void>((r) => { setImmediate(r); });

/** Moves the fake clock until `cond`, letting the real disk work between two moves. */
async function until(cond: () => boolean, moveMs = 1000): Promise<void> {
  for (let i = 0; i < 2000 && !cond(); i++) {
    await vi.advanceTimersByTimeAsync(moveMs);
    await idle();
  }
  expect(cond()).toBe(true);
}

beforeEach(async () => { await rm(fake.tmp, { recursive: true, force: true, maxRetries: 3 }); });
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await rm(fake.tmp, { recursive: true, force: true, maxRetries: 3 }); });

describe('a run with no end', () => {
  async function play(over: Partial<ScenarioConfig>, days: number): Promise<WorldState> {
    const world = createWorld(scenario(over), 'run-horizon');
    const paths: RunPaths = { root: join(fake.tmp, 'co'), brain: join(fake.tmp, 'co', 'brain'), files: join(fake.tmp, 'co', 'files') };
    const brain = createBrainVault(paths);
    await brain.init();
    await new Company(world, { paths, brain, engine: createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 }) }).runDays(days);
    return world;
  }

  it('passes its horizon by 3 days, and a run with a horizon stops at it', async () => {
    const open = await play({ horizonDays: 3, openEnded: true }, 6);
    expect(open.day).toBe(7);
    expect(open.status).not.toBe('finished');
    expect(open.activity.some((a) => a.text.includes('Fin de la simulation'))).toBe(false);
    const bounded = await play({ horizonDays: 3, openEnded: false }, 6);
    expect(bounded.day).toBe(4);
    expect(bounded.status).toBe('finished');
  });
});

describe('boot', () => {
  it('plays a saved run at once, same run, no call', async () => {
    const saved = await savedRun('run-saved');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    expect(s.world.runId).toBe(saved.runId);
    expect(s.world.day).toBe(saved.day);
    expect(s.info()).toMatchObject({ playing: true, mindMode: 'heuristic' });
    expect(mounted(s).engine.usage().calls).toBe(0);
    await s.shutdown();
  });

  it('a CLI run saved later does not take the place of the run the app played', async () => {
    const played = await savedRun('run-app');
    await writeCurrentRun(played.runId);
    await wait(20);
    await savedRun('run-cli');
    expect((await listRuns())[0]!.runId).toBe('run-cli');
    const s = new AgencySession(options);
    await s.start();
    expect(s.world.runId).toBe(played.runId);
    await s.shutdown();
  });

  it('names the run it plays in runs/current.json', async () => {
    const s = new AgencySession(options);
    await s.newRun({ mindMode: 'heuristic', maxComputeEur: 0 }, false);
    expect(await readCurrentRun()).toBe(s.world.runId);
    await s.shutdown();
    expect(await readCurrentRun(join(fake.tmp, 'nowhere'))).toBeNull();
  });

  it('a corrupt world.json resumes from world.prev.json: same run, incident recorded, and the good save survives', async () => {
    const saved = await savedRun('run-corrupt', 2);
    const prevDay = saved.day;
    const run = await mountWorld(saved);
    await run.company.runDays(1);
    await saveWorld(saved);
    const root = join(runsDir(), saved.runId);
    await writeFile(join(root, 'world.json'), '{ "runId": "run-corrupt", "day"');
    await writeCurrentRun(saved.runId);

    const s = new AgencySession(options);
    await s.start();
    expect(s.world.runId).toBe(saved.runId);
    expect(s.world.day).toBe(prevDay);
    expect(s.playing).toBe(true);
    expect(s.world.activity.some((a) => a.text.includes('Sauvegarde illisible') && a.text.includes('12 créneau'))).toBe(true);
    s.pause();
    await s.shutdown();
    expect((await readSessionLog(saved.runId)).at(-1)).toMatchObject({ recovered: { from: 'prev', lostTicks: 12 } });
    // the unreadable file went aside, not over the good save
    expect((await readdir(root))).toContain('world.bad.json');
    expect((await loadWorld(saved.runId))!.day).toBe(prevDay);
    expect(JSON.parse(await readFile(join(root, 'world.prev.json'), 'utf8')).day).toBe(prevDay);
  });

  it('with no current run, the scan resumes a run whose world.json is corrupt instead of starting a new one', async () => {
    const saved = await savedRun('run-scan', 1);
    await saveWorld(saved);
    await writeFile(join(runsDir(), saved.runId, 'world.json'), 'x');
    const s = new AgencySession(options);
    await s.start();
    expect(s.world.runId).toBe(saved.runId);
    await s.shutdown();
  });
});

describe('saves that survive', () => {
  const dir = () => join(fake.tmp, 'saves');
  const world = (day: number, tick = 0): WorldState => ({ ...createWorld(scenario(), 'run-saves'), day, tick });

  it('keeps the save before the last one', async () => {
    await saveWorld(world(3), { dir: dir() });
    expect(existsSync(join(dir(), 'run-saves', 'world.prev.json'))).toBe(false);
    await saveWorld(world(4), { dir: dir() });
    await saveWorld(world(5), { dir: dir() });
    const root = join(dir(), 'run-saves');
    expect(JSON.parse(await readFile(join(root, 'world.prev.json'), 'utf8')).day).toBe(4);
    expect(JSON.parse(await readFile(join(root, 'world.json'), 'utf8')).day).toBe(5);
    expect((await readdir(root)).sort()).toEqual(['meta.json', 'world.json', 'world.prev.json']); // no tmp leftovers
  });

  it('a crash between the two renames loses no run: only world.prev.json is left', async () => {
    await saveWorld(world(3), { dir: dir() });
    await saveWorld(world(4), { dir: dir() });
    await rm(join(dir(), 'run-saves', 'world.json'));
    expect(runExists('run-saves', dir())).toBe(true);
    expect((await listRuns({ dir: dir() })).map((r) => r.runId)).toEqual(['run-saves']);
    expect(await loadWorldSafe('run-saves', { dir: dir() })).toMatchObject({ from: 'prev', lostTicks: 12, world: { day: 3 } });
  });

  it('counts the ticks lost to the tick', async () => {
    await saveWorld(world(3, 5), { dir: dir() });
    await saveWorld(world(4, 2), { dir: dir() });
    await writeFile(join(dir(), 'run-saves', 'world.json'), '');
    expect((await loadWorldSafe('run-saves', { dir: dir() }))!.lostTicks).toBe(9);
  });

  it('falls back to the newest readable checkpoint, then gives up', async () => {
    await saveWorld(world(20), { dir: dir() });
    await saveCheckpoint(world(8), dir());
    await saveCheckpoint(world(15), dir());
    const root = join(dir(), 'run-saves');
    expect((await readdir(join(root, 'checkpoints'))).sort()).toEqual(['day-0007.json.gz', 'day-0014.json.gz']);
    await writeFile(join(root, 'world.json'), 'x');
    await writeFile(join(root, 'world.prev.json'), 'x');
    await writeFile(join(root, 'checkpoints', 'day-0014.json.gz'), 'pas du gzip');
    expect(await loadWorldSafe('run-saves', { dir: dir() })).toMatchObject({ from: 'checkpoint', world: { day: 8 } });
    await rm(join(root, 'world.bad.json'));
    await rm(join(root, 'checkpoints'), { recursive: true });
    await writeFile(join(root, 'world.json'), 'x');
    expect(await loadWorldSafe('run-saves', { dir: dir() })).toBeNull();
    expect(existsSync(join(root, 'world.json'))).toBe(true); // nothing better was found: the file stays where it was
  });

  it('a ledger that lost a number is not a valid save', async () => {
    const w = world(3);
    await saveWorld(w, { dir: dir() });
    w.day = 4;
    w.ledger.push({ id: 'led_nan', day: 4, type: 'revenue', amount: NaN, memo: '', ref: null });
    await saveWorld(w, { dir: dir() });
    expect(await loadWorldSafe('run-saves', { dir: dir() })).toMatchObject({ from: 'prev', world: { day: 3 } });
  });

  it('reads a checkpoint back to the same world', async () => {
    const w = world(15);
    await saveCheckpoint(w, dir());
    const root = join(dir(), 'run-saves');
    await writeFile(join(root, 'world.json'), 'x');
    expect((await loadWorldSafe('run-saves', { dir: dir() }))!.world).toEqual(w);
  });

  it('keeps the last 4 weekly checkpoints and one per 30 days, 12 at most', () => {
    let kept: number[] = [];
    for (let day = 7; day <= 7 * 104; day += 7) {
      kept = keptCheckpoints([...kept, day]);
      expect(kept.length).toBeLessThanOrEqual(12);
      expect(kept[0]).toBe(day);
    }
    const last = 7 * 104;
    expect(kept).toHaveLength(12);
    expect(kept.slice(0, 4)).toEqual([last, last - 7, last - 14, last - 21]);
    expect(new Set(kept.slice(4).map((d) => Math.floor(d / 30))).size).toBe(8);
  });

  it('prunes on disk', async () => {
    for (let day = 7; day <= 7 * 30; day += 7) await saveCheckpoint(world(day + 1), dir());
    const left = await readdir(join(dir(), 'run-saves', 'checkpoints'));
    expect(left.length).toBeLessThanOrEqual(12);
    expect(left).toContain('day-0210.json.gz');
    expect(left).toContain('day-0175.json.gz'); // the last of its 30 days
    expect(left).not.toContain('day-0168.json.gz');
  });

  it('a run past its goal saves the tick it got there, then each evening, not every tick', async () => {
    const saved = await savedRun('run-goal');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    const tickOf = async () => (await loadWorld(saved.runId))!.tick;
    run.company.step = async () => { run.world.tick += 1; run.world.status = 'goal_reached'; return stepped(run.world); };
    await s.step();
    const reachedAt = run.world.tick;
    expect(await tickOf()).toBe(reachedAt);
    await s.step();
    await s.step();
    expect(run.world.tick).toBe(reachedAt + 2);
    expect(await tickOf()).toBe(reachedAt);
    await s.shutdown();
  });

  it('the session writes a checkpoint when a seventh day closes', async () => {
    const saved = await savedRun('run-week', 6);
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.runDay();
    expect(s.world.day).toBe(8);
    expect(await readdir(join(runsDir(), saved.runId, 'checkpoints'))).toEqual(['day-0007.json.gz']);
    await s.shutdown();
  });
});

describe('compaction reaches the disk', () => {
  it('a batch goes from the company to runs/<id>/archive, and the videos of what it archived leave with it', async () => {
    const retired: string[] = [];
    const saved = await savedRun('run-archive');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession({ director: () => ({ ...director, retireCreativeFiles: async (id) => { retired.push(id); } }) });
    await s.start();
    s.pause();
    const { ctx } = mounted(s).company as unknown as { ctx: RuntimeCtx };
    await ctx.archive!({ day: 7, rows: { creatives: [{ id: 'cre_old' }], customers: [{ id: 'cus_old' }] }, dropFiles: [] });
    const root = join(runsDir(), saved.runId);
    expect(await readFile(join(root, 'archive', 'creatives.ndjson'), 'utf8')).toContain('cre_old');
    expect(await readFile(join(root, 'archive', 'customers.ndjson'), 'utf8')).toContain('cus_old');
    expect(retired).toEqual(['cre_old']);
    await s.shutdown();
  });

  it('a CLI run archives too, with no video to retire', async () => {
    const world = createWorld(scenario(), 'run-cli-archive');
    const run = await mountWorld(world);
    const { ctx } = run.company as unknown as { ctx: RuntimeCtx };
    await ctx.archive!({ day: 7, rows: { orders: [{ id: 'ord_old' }] }, dropFiles: [] });
    expect(await readFile(join(run.paths.root, 'archive', 'orders.ndjson'), 'utf8')).toContain('ord_old');
  });
});

describe('the session log', () => {
  it('a clean stop closes its record, a crash is found at the next boot', async () => {
    const saved = await savedRun('run-log');
    await writeCurrentRun(saved.runId);
    const first = new AgencySession(options);
    await first.start();
    await first.shutdown();
    const [clean] = await readSessionLog(saved.runId);
    expect(clean).toMatchObject({ clean: true, day: saved.day });
    expect(Date.parse(clean!.stopAt!)).toBeGreaterThanOrEqual(Date.parse(clean!.startAt));

    const crashed = new AgencySession(options);
    await crashed.start();
    crashed.pause();
    await crashed.step();
    // the process dies here: nothing closes the record, and the machine stays off for a while
    expect((await readSessionLog(saved.runId)).at(-1)!.stopAt).toBeUndefined();
    await wait(120);

    const after = new AgencySession(options);
    await after.start();
    const log = await readSessionLog(saved.runId);
    expect(log).toHaveLength(3);
    expect(log[1]).toMatchObject({ clean: false });
    // it closes at the last save the disk saw, not at this boot: the gap is the time the agency was off
    expect(Date.parse(log[2]!.startAt) - Date.parse(log[1]!.stopAt!)).toBeGreaterThanOrEqual(100);
    expect(log[2]!.stopAt).toBeUndefined();
    await after.shutdown();
    await crashed.shutdown();
  });

  it('a run switch closes the record of the run it leaves', async () => {
    const s = new AgencySession(options);
    await s.newRun({ mindMode: 'heuristic', maxComputeEur: 0 }, false);
    const left = s.world.runId;
    await wait(1100); // second-based run ids
    await s.newRun({ mindMode: 'heuristic', maxComputeEur: 0 }, false);
    expect((await readSessionLog(left)).at(-1)).toMatchObject({ clean: true });
    expect((await readSessionLog(s.world.runId)).at(-1)!.stopAt).toBeUndefined();
    await s.shutdown();
  });
});

describe('nothing stops the agency but the founder', () => {
  it('backs off, then skips the tick after 8 tries, and the loop still plays', async () => {
    const saved = await savedRun('run-broken');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step(); // behind the pause: one real tick
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });

    const run = mounted(s);
    const { day, tick } = s.world;
    const tries: number[] = [];
    run.company.step = async () => { tries.push(Date.now()); throw new Error('moteur en panne'); };
    s.play(1);
    await until(() => tries.length >= 3);
    expect(s.info()).toMatchObject({ playing: true, backoffMs: 30_000, lastError: 'moteur en panne' });
    await until(() => tries.length >= 6);
    expect(s.info()).toMatchObject({ playing: true, backoffMs: 300_000 });
    expect(`${s.world.day}:${s.world.tick}`).toBe(`${day}:${tick}`);
    await until(() => tries.length >= 8);
    await until(() => s.world.tick !== tick);

    const gaps = tries.slice(0, 8).map((t, i) => t - (tries[i - 1] ?? t)).slice(1).map((g) => Math.round(g / 1000));
    expect(gaps[0]).toBeLessThanOrEqual(3); // two errors: the normal pace
    expect(gaps[1]).toBeLessThanOrEqual(3);
    expect(gaps[2]).toBeGreaterThanOrEqual(30);
    expect(gaps[3]).toBeGreaterThanOrEqual(30);
    expect(gaps[4]).toBeGreaterThanOrEqual(30);
    expect(gaps[5]).toBeGreaterThanOrEqual(300);
    expect(gaps[6]).toBeGreaterThanOrEqual(300);

    expect(s.world.tick).toBe(tick + 1);
    expect(s.world.day).toBe(day);
    expect(s.info()).toMatchObject({ playing: true, backoffMs: null });
    expect(s.world.activity.some((a) => a.text.includes(`Le créneau ${tick} du jour ${day} est sauté`))).toBe(true);

    // The next tick starts its own count: a tick that fails once is not skipped.
    const after = tries.length;
    await until(() => tries.length === after + 1, 500);
    expect(s.world.tick).toBe(tick + 1);
    vi.useRealTimers();
    s.pause();
    await s.shutdown();
  });

  it('counts tries per tick: a run that fails a little on every tick never skips one', async () => {
    const saved = await savedRun('run-flaky');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    const { tick } = s.world;
    run.company.step = async () => { throw new Error('une fois'); };
    for (let i = 0; i < 7; i++) await s.step();
    expect(s.world.tick).toBe(tick);
    run.company.step = async () => stepped(run.world);
    await s.step();
    expect(s.info()).toMatchObject({ backoffMs: null, lastError: null });
    run.company.step = async () => { throw new Error('encore'); };
    for (let i = 0; i < 7; i++) await s.step();
    expect(s.world.tick).toBe(tick); // the count started over
    await s.shutdown();
  });

  it('a skipped tick that crosses the horizon ends the run as a played one would', async () => {
    const saved = await savedRun('run-last');
    saved.scenario.horizonDays = saved.day;
    saved.tick = 11;
    await saveWorld(saved);
    const run = await mountWorld(saved);
    run.company.skipTick('dernière panne');
    expect(saved.status).toBe('finished');
    const finishedAt = `${saved.day}:${saved.tick}`;
    run.company.skipTick('rien de plus');
    expect(`${saved.day}:${saved.tick}`).toBe(finishedAt);
  });

  it('an uncaught exception saves the run and the server goes on', async () => {
    const bus = new EventEmitter();
    const save = vi.fn(async () => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installCrashGuards(save, bus);
    bus.emit('uncaughtException', new Error('fuite'));
    expect(save).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('that save waits for the tick in flight', async () => {
    const saved = await savedRun('run-flight');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    const before = (await loadWorld(saved.runId))!.tick;
    let finish: () => void = () => undefined;
    run.company.step = () => new Promise((r) => { finish = () => { run.world.tick += 1; r(stepped(run.world)); }; });
    const flight = s.step();
    await idle();
    run.world.tick += 1; // halfway through the tick
    const save = s.saveAfterCrash();
    await wait(30);
    expect((await loadWorld(saved.runId))!.tick).toBe(before); // nothing was written mid-tick
    finish();
    await flight;
    await save;
    expect((await loadWorld(saved.runId))!.tick).toBe(run.world.tick);
    await s.shutdown();
  });

  it.each<[string, (s: AgencySession) => void]>([
    ['« vu »', (s) => { sessionViews(s).digestSeen(); }],
    ['a founder action', (s) => { (s as unknown as { touch(): void }).touch(); }],
  ])('%s saved on a timer waits for the tick in flight too', async (name, look) => {
    const saved = await savedRun(`run-soon-${name.length}`);
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    const before = (await loadWorld(saved.runId))!.tick;
    let finish: () => void = () => undefined;
    run.company.step = () => new Promise((r) => { finish = () => { run.world.tick += 1; r(stepped(run.world)); }; });
    const flight = s.step();
    await idle();
    run.world.tick += 1; // halfway through the tick
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    look(s);
    await vi.advanceTimersByTimeAsync(2000); // the debounce is over, the tick is not
    vi.useRealTimers();
    await wait(30);
    expect((await loadWorld(saved.runId))!.tick).toBe(before); // nothing was written mid-tick
    finish();
    await flight;
    await wait(30);
    await flushSaves();
    expect((await loadWorld(saved.runId))!.tick).toBe(run.world.tick);
    await s.shutdown();
  });

  it('« vu » reaches the save of a paused run, and flushing it waits for the tick too', async () => {
    const saved = await savedRun('run-seen-paused');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    const before = (await loadWorld(saved.runId))!.tick;
    let finish: () => void = () => undefined;
    run.company.step = () => new Promise((r) => { finish = () => { run.world.tick += 1; r(stepped(run.world)); }; });
    const flight = s.step();
    await idle();
    run.world.tick += 1;
    const founder = sessionViews(s).digestSeen();
    const flushed = flushSaves();
    await wait(30);
    expect((await loadWorld(saved.runId))!.tick).toBe(before);
    finish();
    await flight;
    await flushed;
    const disk = (await loadWorld(saved.runId))!;
    expect(disk.tick).toBe(run.world.tick);
    expect(disk.company.growth!.founder).toEqual(founder);
    await s.shutdown();
  });

  it('a playing run leaves « vu » to its evening save, or world.prev.json would be seconds old', async () => {
    const saved = await savedRun('run-seen-playing');
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    const run = mounted(s);
    let phase: StepResult['phase'] = 'work';
    run.company.step = async () => ({ ...stepped(run.world), phase });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    s.play();
    await vi.advanceTimersByTimeAsync(600);
    const seen = sessionViews(s).digestSeen()!;
    await vi.advanceTimersByTimeAsync(5000); // the debounce would be long over
    await flushSaves();                      // and its write on the disk
    expect((await loadWorld(saved.runId))!.company.growth!.founder.lastSeenAt).toBeNull();
    expect(run.world.company.growth!.founder).toEqual(seen); // the snapshot has it at once
    phase = 'evening';
    await vi.advanceTimersByTimeAsync(600);
    await idle();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    await wait(30);
    await flushSaves();
    expect((await loadWorld(saved.runId))!.company.growth!.founder).toEqual(seen);
    await s.shutdown();
  });
});

describe('the pace', () => {
  async function playing(id: string): Promise<{ s: AgencySession; ticks: number[] }> {
    const saved = await savedRun(id);
    await writeCurrentRun(saved.runId);
    const s = new AgencySession(options);
    await s.start();
    s.pause();
    await s.step();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const ticks: number[] = [];
    const run = mounted(s);
    run.company.step = async () => { ticks.push(Date.now()); return stepped(run.world); };
    return { s, ticks };
  }

  it('slows to a year per week with no viewer for 5 minutes, a viewer gives the speed back at once', async () => {
    const { s, ticks } = await playing('run-pace');
    s.setWatchers(1);
    s.play(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.info()).toMatchObject({ pace: 'live', watchers: 1, intervalMs: 1000 });
    expect(ticks.length).toBeGreaterThanOrEqual(9);

    s.setWatchers(0); // the last viewer leaves: the five minutes start here
    await vi.advanceTimersByTimeAsync(299_000);
    expect(s.info()).toMatchObject({ pace: 'live', watchers: 0, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.info()).toMatchObject({ pace: 'away', intervalMs: 138_082, speed: 2, playing: true });

    await vi.advanceTimersByTimeAsync(1_000);
    const before = ticks.length;
    await vi.advanceTimersByTimeAsync(138_082 * 3);
    expect(ticks.length - before).toBe(3);
    const gap = ticks.at(-1)! - ticks.at(-2)!;
    expect(gap).toBeGreaterThanOrEqual(138_000);

    await vi.advanceTimersByTimeAsync(10_000); // mid-wait
    const backAt = ticks.length;
    s.setWatchers(1);
    expect(s.info()).toMatchObject({ pace: 'live', watchers: 1, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(600);
    expect(ticks.length).toBeGreaterThan(backAt);
    vi.useRealTimers();
    await s.shutdown();
  });

  it('a boot with nobody watching counts from the boot, a pause keeps its pace honest', async () => {
    const { s } = await playing('run-boot');
    await vi.advanceTimersByTimeAsync(301_000);
    expect(s.info()).toMatchObject({ pace: 'away', playing: false });
    s.setWatchers(1);
    expect(s.info().pace).toBe('live');
    vi.useRealTimers();
    await s.shutdown();
  });

  it('a viewer does not cut short the wait of an incident', async () => {
    const { s } = await playing('run-both');
    const run = mounted(s);
    let tries = 0;
    run.company.step = async () => { tries += 1; throw new Error('panne'); };
    await vi.advanceTimersByTimeAsync(301_000);
    s.play(1);
    await until(() => tries >= 3, 20_000);
    expect(s.info()).toMatchObject({ pace: 'away', backoffMs: 30_000 });
    const before = tries;
    s.setWatchers(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(tries).toBe(before);
    vi.useRealTimers();
    s.pause();
    await s.shutdown();
  });

  it('AGENCY_AWAY_DAYS_PER_WEEK sets the away pace', () => {
    const away = (s: AgencySession) => (s as unknown as { awayTickMs: number }).awayTickMs;
    vi.stubEnv('AGENCY_AWAY_DAYS_PER_WEEK', '730');
    expect(away(new AgencySession(options))).toBe(69_041);
    vi.stubEnv('AGENCY_AWAY_DAYS_PER_WEEK', 'beaucoup');
    expect(away(new AgencySession(options))).toBe(138_082);
    vi.unstubAllEnvs();
  });
});

describe('the SSE hub counts its viewers', () => {
  it('on arrival and on departure', () => {
    const hub = new SseHub({ snapshotJson: () => '{}', tickJson: () => '{}' }, { heartbeatMs: 60_000 });
    const counts: number[] = [];
    hub.onClients((n) => counts.push(n));
    const attach = () => {
      const req = Object.assign(new EventEmitter(), { socket: { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} } }) as unknown as IncomingMessage;
      const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead() {}, write: () => true, end() {} }) as unknown as ServerResponse;
      hub.attach(req, res);
      return req;
    };
    const a = attach();
    const b = attach();
    a.emit('close');
    a.emit('close'); // one departure, however many events say so
    b.emit('close');
    expect(counts).toEqual([1, 2, 1, 0]);
    hub.close();
  });
});

describe('/runs/<id>/ and the routes', () => {
  interface Res { status: number; body: string }
  const call = (port: number, method: string, path: string) => new Promise<Res>((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end();
  });

  const SECRET = 'VERITE_DU_MARCHE';

  async function serve(session: Partial<SessionLike>) {
    const root = await mkdtemp(join(tmpdir(), 'agency-truth-'));
    const run = join(root, 'run-1');
    await mkdir(join(run, 'checkpoints'), { recursive: true });
    await mkdir(join(run, 'archive'), { recursive: true });
    await mkdir(join(run, 'files'), { recursive: true });
    for (const f of ['world.json', 'world.prev.json', 'world.bad.json', 'world.json.tmp-12-3', 'archive/customers.ndjson']) await writeFile(join(run, f), SECRET);
    await writeFile(join(run, 'checkpoints', 'day-0007.json.gz'), gzipSync(SECRET));
    await writeFile(join(run, 'session.log.json'), '[]');
    await writeFile(join(run, 'files', 'world.json'), 'un fichier du run, pas la sauvegarde');
    const app = createAgencyServer({ session: { info: () => ({ runId: 'run-1', playing: false, speed: 1, mindMode: 'heuristic' }), status: () => 'paused', ...session } as SessionLike, runsRoot: root, webDist: join(root, 'no-dist'), sse: { heartbeatMs: 60_000 } });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
    const port = (app.server.address() as AddressInfo).port;
    return { port, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
  }

  it('refuses every file holding truth, under any spelling', async () => {
    const { port, close } = await serve({});
    for (const f of ['world.json', 'world.prev.json', 'world.bad.json', 'world.json.tmp-12-3', 'checkpoints/day-0007.json.gz', 'archive/customers.ndjson']) {
      const res = await call(port, 'GET', `/runs/run-1/${f}`);
      expect([f, res.status]).toEqual([f, 403]);
      expect(res.body).not.toContain(SECRET);
    }
    expect((await call(port, 'GET', '/runs/run-1/world.prev.json?x=1')).status).toBe(403);
    expect((await call(port, 'GET', '/runs/run-1/WORLD.PREV.JSON')).status).toBe(403);
    expect((await call(port, 'GET', '/runs/run-1/%77orld.prev.json')).status).toBe(403);
    expect((await call(port, 'GET', '/runs/run-1/Checkpoints/day-0007.json.gz')).status).toBe(403);
    expect((await call(port, 'GET', '/runs/run-1/archive%2Fcustomers.ndjson')).status).toBe(403);
    expect((await call(port, 'GET', '/runs/run-1/world.prev.json.')).status).toBe(403);
    // Short names, where the volume keeps them, open the real file: the guard reads the name on disk, not the URL.
    for (const f of ['WORLD~1.JSO', 'WORLDP~1.JSO', 'WORLDB~1.JSO', 'CHECKP~1/day-0007.json.gz', 'ARCHIV~1/customers.ndjson']) {
      const res = await call(port, 'GET', `/runs/run-1/${f}`);
      expect([f, res.status === 200]).toEqual([f, false]);
      expect(res.body).not.toContain(SECRET);
    }
    await close();
  });

  it('still serves the rest of the folder', async () => {
    const { port, close } = await serve({});
    expect((await call(port, 'GET', '/runs/run-1/session.log.json')).status).toBe(200);
    expect((await call(port, 'GET', '/runs/run-1/files/world.json')).status).toBe(200);
    await close();
  });

  it('the guard is the one of D51', () => {
    for (const f of ['world.json', 'world.prev.json', 'WORLD.JSON', 'checkpoints/x', 'archive\\customers.ndjson']) expect(isServerOnlyFile(f)).toBe(true);
    for (const f of ['meta.json', 'files/world.json', 'session.log.json', 'checkpoints', 'worldly.txt']) expect(isServerOnlyFile(f)).toBe(false);
  });

  it('POST /api/run/extend prolongs the run and answers like a control', async () => {
    const extendRun = vi.fn(async () => ({ runId: 'run-1', playing: true, speed: 1 as const, mindMode: 'heuristic' as const }));
    const { port, close } = await serve({ extendRun, status: () => 'running' });
    expect((await call(port, 'GET', '/api/run/extend')).status).toBe(405);
    const res = await call(port, 'POST', '/api/run/extend');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, status: 'running', playing: true });
    expect(JSON.parse(res.body).message).toContain('sans fin');
    expect(extendRun).toHaveBeenCalledTimes(1);
    await close();
  });

  it('the session hears the viewers of the stream', async () => {
    const setWatchers = vi.fn();
    const { port, close } = await serve({ setWatchers, snapshotJson: () => '{}', tickJson: () => '{}' });
    const stream = httpRequest({ host: '127.0.0.1', port, path: '/api/stream' });
    stream.on('error', () => undefined);
    stream.end();
    await vi.waitFor(() => expect(setWatchers).toHaveBeenCalledWith(1));
    stream.destroy();
    await vi.waitFor(() => expect(setWatchers).toHaveBeenLastCalledWith(0));
    await close();
  });
});

describe('the goal of a run that does not end', () => {
  const goals = (w: WorldState) => w.market.events.filter((e) => e.kind === 'goal_reached');
  const reached = async (runId: string): Promise<{ world: WorldState; run: MountedRun }> => {
    const world = createWorld(scenario({ openEnded: true, goal: { targetProfit: -10_000, byDay: 60 } }), runId);
    const run = await mountWorld(world);
    await run.company.runDays(1);
    expect(world.company.goalReachedDay).toBe(1);
    expect(goals(world)).toHaveLength(1);
    return { world, run };
  };

  it('falls once, for a run that outlives the 200 events market.events keeps', async () => {
    const { world, run } = await reached('run-goal-once');
    world.market.events = [];
    await run.company.runDays(1);
    expect(goals(world)).toEqual([]);
    expect(world.company.goalReachedDay).toBe(1);
  });

  it('a run back from bankruptcy finds it, whatever the events kept', async () => {
    const { world, run } = await reached('run-goal-back');
    world.market.events = [];
    world.status = 'bankrupt';
    await run.company.runDays(1);
    expect(world.status).toBe('goal_reached');
  });

  it('a save older than the field gets it from its event, even at version 2', () => {
    const world = createWorld(scenario(), 'run-goal-old');
    world.market.events.push({ id: 'evt_1', day: 31, kind: 'goal_reached', title: '', description: '', severity: 'good' });
    expect(world.version).toBeGreaterThanOrEqual(2);
    expect(migrateWorld(world).company.goalReachedDay).toBe(31);
  });
});

describe('two servers, one port', () => {
  const freePort = (): Promise<number> => new Promise((done) => {
    const probe = createNetServer().listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });

  beforeEach(() => {
    vi.spyOn(process, 'on').mockReturnThis(); // no crash guard or signal handler left on the test worker
    vi.spyOn(process, 'once').mockReturnThis();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('the one that cannot have the port leaves before it opens a run, on the code forever stops on', async () => {
    const busy = createNetServer();
    await new Promise<void>((done) => { busy.listen(0, done); });
    const start = vi.spyOn(AgencySession.prototype, 'start');
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Error(`sortie ${code}`); }) as never);
    await expect(startServer((busy.address() as AddressInfo).port)).rejects.toThrow(`sortie ${PORT_BUSY_EXIT}`);
    expect(start).not.toHaveBeenCalled();
    await new Promise((done) => { busy.close(done); });
  });

  it('the port comes first: until the run is mounted the API says so and nothing else runs', async () => {
    const realStart = AgencySession.prototype.start;
    let open = () => undefined as void;
    const gate = new Promise<void>((done) => { open = done; });
    let live: AgencySession | undefined;
    vi.spyOn(AgencySession.prototype, 'start').mockImplementation(async function start(this: AgencySession) {
      live = this;
      await gate;
      return realStart.call(this);
    });
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const booting = startServer(port);
    await vi.waitFor(async () => expect((await fetch(`${url}/api/health`)).status).toBe(200));
    const refused = await fetch(`${url}/api/state`);
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain('démarre encore');
    expect((await fetch(`${url}/api/scenario`, { method: 'POST', body: '{}' })).status).toBe(503); // no run started behind the boot's back
    open();
    const app = await booting;
    expect((await fetch(`${url}/api/state`)).status).toBe(200);
    await live!.shutdown();
    await app.close();
  }, 30_000);

  it('a viewer who came during the boot counts for the pace', async () => {
    const seen: number[] = [];
    vi.spyOn(AgencySession.prototype, 'setWatchers').mockImplementation((n) => { seen.push(n); });
    const realStart = AgencySession.prototype.start;
    let open = () => undefined as void;
    const gate = new Promise<void>((done) => { open = done; });
    let live: AgencySession | undefined;
    vi.spyOn(AgencySession.prototype, 'start').mockImplementation(async function start(this: AgencySession) {
      live = this;
      await gate;
      return realStart.call(this);
    });
    const port = await freePort();
    const booting = startServer(port);
    await vi.waitFor(async () => expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200));
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`);
    open();
    const app = await booting;
    expect(seen).toEqual([1]);
    await stream.body?.cancel();
    await live!.shutdown();
    await app.close();
  }, 30_000);
});

describe('npm run agency', () => {
  const FOREVER = resolve(import.meta.dirname, '..', '..', 'scripts', 'forever.mjs');

  it('stops at once on a busy port: trying again would only bother the agency that has it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agency-forever-'));
    const entry = join(dir, 'child.mjs');
    const count = join(dir, 'count.txt');
    await writeFile(entry, `
      import { appendFileSync } from 'node:fs';
      appendFileSync(${JSON.stringify(count)}, 'x');
      process.exit(${PORT_BUSY_EXIT});
    `);
    const log = join(dir, 'agency.log');
    const child = spawn(process.execPath, [FOREVER, '--entry', entry, '--log', log], { stdio: 'ignore' });
    const code = await new Promise<number | null>((done) => child.on('close', done));
    expect(code).toBe(1);
    expect(await readFile(count, 'utf8')).toBe('x');
    const text = await readFile(log, 'utf8');
    expect(text).toContain('Le port est déjà pris');
    expect(text).not.toContain('nouveau départ');
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('starts the server again after a crash and stops on exit code 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agency-forever-'));
    const entry = join(dir, 'child.mjs');
    const count = join(dir, 'count.txt');
    await writeFile(entry, `
      import { existsSync, readFileSync, writeFileSync } from 'node:fs';
      const n = existsSync(${JSON.stringify(count)}) ? Number(readFileSync(${JSON.stringify(count)}, 'utf8')) + 1 : 1;
      writeFileSync(${JSON.stringify(count)}, String(n));
      console.log('depart ' + n);
      process.exit(n < 2 ? 3 : 0);
    `);
    const log = join(dir, 'agency.log');
    const child = spawn(process.execPath, [FOREVER, '--entry', entry, '--log', log], { stdio: 'ignore' });
    const code = await new Promise<number | null>((done) => child.on('close', done));
    expect(code).toBe(0);
    expect(await readFile(count, 'utf8')).toBe('2');
    const text = await readFile(log, 'utf8');
    expect(text).toContain('depart 1');
    expect(text).toContain('code 3');
    expect(text).toContain('nouveau départ dans 2 s');
    expect(text).toContain('depart 2');
    expect(text).toContain('Agence arrêtée');
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
});
