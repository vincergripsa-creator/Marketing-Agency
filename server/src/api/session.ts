/**
 * The live session: one mounted run (world + Company + engine + brain) driven by a ticker.
 * Every world-advancing operation (tick, day, run switch) is serialised through one lock;
 * founder actions (mission, chat, approval) only wait for run switches.
 */
import { EventEmitter } from 'node:events';
import { emit, round2, runPaths } from '../core/index.js';
import { createBrainVault } from '../learning/index.js';
import { createContentEngine } from '../minds/index.js';
import { Company, createWorld, defaultScenario } from '../runtime/index.js';
import { logDecision } from '../runtime/digest.js';
import { LEAN_ORG } from '../runtime/org/constants.js';
import { minRunCash } from '../runtime/org/payroll.js';
import type { ArchiveBatch, BrainNote, BrainVault, CompanyApi, ContentEngine, RunPaths, StepResult, UsageEvent } from '../contracts.js';
import type { AdCreative, AdRatio, CreativeVideo, LiveAgent, MissionResponse, RunInfo, ScenarioConfig, SessionInfo, VideoIndex, WorldState } from '../shared.js';
import { TICKS_PER_DAY } from '../shared.js';
import type { VideoDirector } from '../video/index.js';
import { runArchive } from './archive.js';
import { config, type ConfigMindMode } from './env.js';
import { errorStatus, HttpError, type ControlAction, type Speed } from './http.js';
import {
  closeSessionRecord, flushSaves, isValidRunId, listRuns, loadWorldSafe, newRunId, openSessionRecord, readCurrentRun, runsDir, saveCheckpoint, saveWorld,
  scheduleSave, writeCurrentRun, type SafeLoad, type SessionRecord,
} from './persist.js';
import { liveSnapshotJson, safeFinance, snapshotJson } from './snapshot.js';
import { LIVE_LIMITS } from './trim.js';

export interface MountedRun {
  world: WorldState;
  company: CompanyApi;
  engine: ContentEngine;
  brain: BrainVault;
  paths: RunPaths;
  /**
   * Re-applies cumulative usage to world.mind: what a resumed run had already spent + this session's engine.
   * (The runtime also syncs world.mind and books the 'compute' ledger lines itself, from engine.usage().)
   */
  syncMind(): void;
}

export interface MountOptions {
  /** Overrides the env mind mode (CLI --mind). */
  mindMode?: ConfigMindMode;
  onUsage?: (u: UsageEvent) => void;
  /** Once a batch of compaction is on disk. */
  onArchive?: (batch: ArchiveBatch) => Promise<void>;
}

/** Only 'finished' stops the agency: a bankrupt company keeps working in survival mode and may recover. */
export function isTerminal(status: WorldState['status']): boolean {
  return status === 'finished';
}

export function resolveMindMode(scenarioMode: ScenarioConfig['mindMode'], envMode: ConfigMindMode): ConfigMindMode {
  return scenarioMode === 'auto' ? envMode : scenarioMode;
}

const EMPTY_MIND: WorldState['mind'] = { mode: 'heuristic', calls: 0, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 };

/** Wires a world to its engine, brain vault and Company. Shared by the server session and the CLI. */
export async function mountWorld(world: WorldState, opts: MountOptions = {}): Promise<MountedRun> {
  const paths = runPaths(world.runId);
  const scenario = world.scenario;
  const prev = { ...EMPTY_MIND, ...(world.mind ?? {}) };
  world.mind = prev;
  const base = { calls: prev.calls || 0, inputTokens: prev.inputTokens || 0, outputTokens: prev.outputTokens || 0, costEur: prev.costEur || 0, fallbacks: prev.fallbacks || 0 };
  let ready = false;

  const syncMind = () => {
    if (!ready) return;
    let u: ReturnType<ContentEngine['usage']>;
    try { u = engine.usage(); } catch { return; }
    // world.mind may have been replaced by the runtime: always write the current object.
    world.mind = {
      mode: engine.mode,
      calls: base.calls + u.calls,
      inputTokens: base.inputTokens + u.inputTokens,
      outputTokens: base.outputTokens + u.outputTokens,
      costEur: round2(base.costEur + u.costEur),
      fallbacks: base.fallbacks + u.fallbacks,
    };
  };

  const mode = opts.mindMode ?? resolveMindMode(scenario.mindMode, config.mindMode);
  const engine: ContentEngine = createContentEngine({
    mode,
    apiKey: config.apiKey,
    // A resumed run keeps its cap: only what is left of the budget is available.
    maxComputeEur: Math.max(0, (scenario.maxComputeEur ?? config.maxComputeEur) - base.costEur),
    models: config.models,
    seed: scenario.seed,
    onUsage: (u: UsageEvent) => {
      syncMind();
      opts.onUsage?.(u);
    },
  });
  ready = true;
  world.mind.mode = engine.mode;

  const brain = createBrainVault(paths);
  await brain.init();
  const sink = runArchive(paths.root);
  const archive = async (batch: ArchiveBatch) => {
    await sink(batch);
    await opts.onArchive?.(batch);
  };
  const company: CompanyApi = new Company(world, { paths, engine, brain, archive });
  syncMind();
  return { world, company, engine, brain, paths, syncMind };
}

/** The live session state sent to the UI is the shared SessionInfo (every optional field is filled here). */
export type { SessionInfo };
export type LiveSessionInfo = Required<SessionInfo>;

type SessionEventName = 'tick' | 'run' | 'state';

/** What the session asks of whoever renders a run's videos. */
export type VideoDirectorLike = Pick<VideoDirector, 'sync' | 'request' | 'index' | 'stop'> & Partial<Pick<VideoDirector, 'retireCreativeFiles'>>;
export type VideoListener = (creativeId: string, video: CreativeVideo) => void;

export interface SessionOptions {
  /** Who renders the videos of a mounted run. Absent: the real director, which reads VIDEO_MODE. */
  director?: (paths: RunPaths, onChange: VideoListener) => VideoDirectorLike | Promise<VideoDirectorLike>;
}

const BASE_INTERVAL_MS = 2000;
/** With nobody watching for this long, a week away is a simulated year: at ×1 it would be 69 of them (scale D2). */
const AWAY_AFTER_MS = 300_000;
const WEEK_MS = 604_800_000;
const AWAY_DAYS_PER_WEEK = 365;
/** From 3 and from 6 consecutive errors. */
const BACKOFF_MS = [30_000, 300_000] as const;
/** Failures on one tick before the clock moves on without it. */
const SKIP_AFTER = 8;
const RUN_FINISHED = 'Ce run est terminé (horizon atteint) : lance une nouvelle simulation.';
const NO_DIRECTOR = 'Rendu vidéo indisponible sur ce serveur';
/** D52: the stream carries the videos of what it shows, no more. GET /api/state and GET /api/videos keep them all. */
const LIVE_VIDEOS = 30;

/** One tick of the away pace. AGENCY_AWAY_DAYS_PER_WEEK overrides the simulated year per real week. */
function awayTickMs(): number {
  const days = Number(process.env.AGENCY_AWAY_DAYS_PER_WEEK);
  return Math.round(WEEK_MS / ((Number.isFinite(days) && days > 0 ? days : AWAY_DAYS_PER_WEEK) * TICKS_PER_DAY));
}

/** Up to LIVE_VIDEOS of the creatives the live view keeps: those of a running campaign first, then the latest. */
export function liveVideos(world: WorldState, items: Record<string, CreativeVideo>): Record<string, CreativeVideo> {
  const { creatives, campaigns } = world.company;
  const running = new Set(campaigns.filter((k) => k.status === 'active').flatMap((k) => k.creativeIds));
  const start = Math.max(0, creatives.length - LIVE_LIMITS.creatives);
  const kept = creatives.filter((c, i) => items[c.id] && (i >= start || running.has(c.id)));
  const picked = [...kept.filter((c) => running.has(c.id)).reverse(), ...kept.filter((c) => !running.has(c.id)).reverse()].slice(0, LIVE_VIDEOS);
  return Object.fromEntries(picked.map((c) => [c.id, items[c.id]!]));
}

export class AgencySession {
  private run: MountedRun | null = null;
  private director: VideoDirectorLike | null = null;
  private readonly options: SessionOptions;
  private _playing = false;
  private _speed: Speed = 1;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  /** Bumped whenever the ticker loop is stopped/restarted: a stale loop exits after its in-flight tick. */
  private loopToken = 0;
  private loopRunning = false;
  /** Bumped on run switch: queued ticks of the previous run are dropped. */
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private switching: Promise<void> = Promise.resolve();
  private errors = 0;
  /** Failures in a row on one (day, tick), and that tick. */
  private sameTick = 0;
  private failedAt = '';
  private backoffMs: number | null = null;
  private lastError: string | null = null;
  private watchers = 0;
  private lastWatchedAt = Date.now();
  private readonly awayTickMs = awayTickMs();
  private readonly events = new EventEmitter();

  constructor(options: SessionOptions = {}) {
    this.options = options;
    this.events.setMaxListeners(100);
  }

  get world(): WorldState {
    return this.mounted().world;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): Speed {
    return this._speed;
  }

  get paths(): RunPaths {
    return this.mounted().paths;
  }

  on(event: SessionEventName, cb: () => void): () => void {
    this.events.on(event, cb);
    return () => { this.events.off(event, cb); };
  }

  /** A video changed status. */
  onVideo(cb: VideoListener): () => void {
    this.events.on('video', cb);
    return () => { this.events.off('video', cb); };
  }

  private mounted(): MountedRun {
    if (!this.run) throw new HttpError(503, "L'agence démarre encore : réessaie dans un instant.");
    return this.run;
  }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.catch(() => undefined).then(fn);
    this.queue = job.catch(() => undefined);
    return job;
  }

  info(): LiveSessionInfo {
    return {
      runId: this.run?.world.runId ?? '',
      playing: this._playing,
      speed: this._speed,
      intervalMs: Math.round(this.tickMs()),
      busy: this.busy,
      mindMode: this.run?.engine.mode ?? 'heuristic',
      status: this.run?.world.status ?? null,
      day: this.run?.world.day ?? 0,
      tick: this.run?.world.tick ?? 0,
      lastError: this.lastError,
      minStartingCash: minRunCash({ org: LEAN_ORG }),
      pace: this.pace(),
      watchers: this.watchers,
      backoffMs: this.backoffMs,
    };
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /**
   * Opens the run the app last played, even finished, so that a founder's history stays in one run: the end banner offers
   * to go on. Without one, the most recent unfinished run, or a new one. It plays at once: the agency works alone.
   */
  async start(): Promise<void> {
    const current = await readCurrentRun();
    if (current && await this.resume(current)) return;
    for (const r of await listRuns()) {
      if (r.status !== 'finished' && await this.resume(r.runId, true)) return;
    }
    await this.newRun({}, true);
  }

  private async resume(runId: string, skipFinished = false): Promise<boolean> {
    const loaded = await loadWorldSafe(runId);
    if (!loaded || (skipFinished && isTerminal(loaded.world.status))) return false;
    try {
      await this.switchRun(() => loaded.world, true, loaded);
      return true;
    } catch (err) {
      console.error(`[session] impossible de reprendre ${runId} :`, (err as Error).message);
      return false;
    }
  }

  async newRun(partial: Partial<ScenarioConfig> = {}, play = true): Promise<WorldState> {
    return this.switchRun(() => {
      const scenario = defaultScenario({ maxComputeEur: config.maxComputeEur, openEnded: true, ...partial });
      return createWorld(scenario, newRunId(runsDir()));
    }, play);
  }

  async loadRun(runId: string): Promise<WorldState> {
    if (!isValidRunId(runId)) throw new HttpError(400, 'Identifiant de run invalide.');
    const loaded = await loadWorldSafe(runId);
    if (!loaded) throw new HttpError(404, `Run introuvable : ${runId}`);
    return this.switchRun(() => loaded.world, this._playing || !this.run, loaded);
  }

  private async switchRun(make: () => WorldState | Promise<WorldState>, play: boolean, loaded?: SafeLoad): Promise<WorldState> {
    this.generation += 1;
    this.stopLoop();
    const wasPlaying = this._playing;
    this._playing = false;
    const job = this.lock(async () => {
      const previous = this.run?.world;
      if (previous) {
        if (previous.status === 'running') previous.status = 'paused';
        await this.saveNow();
      }
      const world = await make();
      const mounted = await mountWorld(world, { onArchive: (batch) => this.retireVideos(batch) });
      if (world.status === 'running') world.status = 'paused';
      await this.closeDirector();
      this.run = mounted;
      this.errors = 0;
      this.sameTick = 0;
      this.backoffMs = null;
      this.lastError = null;
      this.director = await this.openDirector(mounted);
      const recovered = loaded && loaded.from !== 'world' ? { from: loaded.from, lostTicks: loaded.lostTicks ?? 0 } : undefined;
      if (recovered) recordRecovery(world, recovered);
      // Before the save below, which would hide when the disk last heard from a crashed stay.
      await keepBooks(async () => {
        if (previous) await closeSessionRecord(previous.runId, previous.day);
        await openSessionRecord(world.runId, world.day, recovered);
      });
      await this.saveNow();
      await keepBooks(() => writeCurrentRun(world.runId));
      return world;
    });
    this.switching = job.then(() => undefined, () => undefined);
    try {
      const world = await job;
      this.events.emit('run');
      if (play && !isTerminal(world.status)) this.play();
      return world;
    } catch (err) {
      // The previous run stays mounted: resume it as it was.
      if (wasPlaying && this.run && !isTerminal(this.run.world.status)) this.play();
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    this.generation += 1;
    this.stopLoop();
    this._playing = false;
    await this.lock(async () => {
      const world = this.run?.world;
      if (world && world.status === 'running') world.status = 'paused';
      await this.saveNow();
      if (world) await keepBooks(() => closeSessionRecord(world.runId, world.day));
      await this.closeDirector();
    }).catch(() => undefined);
    await flushSaves();
  }

  /** What an uncaught exception still saves: behind the tick in flight, so never half of it. */
  saveAfterCrash(): Promise<void> {
    return this.lock(() => this.saveNow());
  }

  /** The end banner's « Continuer sans fin »: the same run goes on, and no horizon ends it any more. */
  async extendRun(): Promise<LiveSessionInfo> {
    await this.switching;
    const { world } = this.mounted();
    await this.lock(async () => {
      world.scenario.openEnded = true;
      if (isTerminal(world.status)) world.status = 'paused';
      safeEmit(world, "Le fondateur prolonge l'agence : elle continue sans fin.");
      await this.saveNow();
    });
    this.play();
    return this.info();
  }

  /** Wired from SseHub.onClients. The last viewer leaving starts the five minutes, a viewer ends them. */
  setWatchers(n: number): void {
    const wasAway = this.pace() === 'away';
    if (n > 0 || this.watchers > 0) this.lastWatchedAt = Date.now();
    this.watchers = n;
    // The founder is back: not at the end of a 138 s wait. An incident's wait stays.
    if (wasAway && n > 0 && this._playing && this.timer && this.backoffMs === null) this.startLoop(Math.min(250, BASE_INTERVAL_MS / this._speed));
    this.events.emit('state');
  }

  private pace(): 'live' | 'away' {
    return this.watchers === 0 && Date.now() - this.lastWatchedAt >= AWAY_AFTER_MS ? 'away' : 'live';
  }

  private tickMs(): number {
    return this.pace() === 'away' ? this.awayTickMs : BASE_INTERVAL_MS / this._speed;
  }

  /** Dynamic import: a CLI run or a bench never loads video/. A director that cannot open costs the videos, never the run. */
  private async openDirector(run: MountedRun): Promise<VideoDirectorLike | null> {
    const onChange: VideoListener = (id, video) => { this.events.emit('video', id, video); };
    try {
      if (this.options.director) return await this.options.director(run.paths, onChange);
      const { openDirector } = await import('../video/index.js');
      return await openDirector(run.paths, onChange);
    } catch (err) {
      console.error(`[video] ${run.world.runId} :`, (err as Error).message);
      return null;
    }
  }

  private async closeDirector(): Promise<void> {
    const director = this.director;
    this.director = null;
    await director?.stop().catch((err: Error) => console.error('[video] arrêt :', err.message));
  }

  /** The videos of a creative that compaction archived leave the disk with it. They cost disk space, never the tick. */
  private async retireVideos(batch: ArchiveBatch): Promise<void> {
    for (const row of batch.rows.creatives ?? []) {
      await this.director?.retireCreativeFiles?.((row as AdCreative).id).catch((err: Error) => console.error('[video] retrait :', err.message));
    }
  }

  // ───────────────────────────── ticker ─────────────────────────────

  play(speed?: Speed): void {
    const run = this.mounted();
    if (speed) this._speed = speed;
    this.assertNotFinished(run);
    this._playing = true;
    if (run.world.status === 'paused') run.world.status = 'running';
    if (!this.loopRunning) this.startLoop(120);
    else if (this.timer) this.startLoop(Math.min(250, BASE_INTERVAL_MS / this._speed)); // waiting → apply new speed now
    this.events.emit('state');
  }

  /** A finished run stays readable, but nothing happens in it any more: a refusal, not a « Compris » that nobody will honour. */
  private assertNotFinished(run: MountedRun): void {
    if (isTerminal(run.world.status)) throw new HttpError(409, RUN_FINISHED);
  }

  pause(): void {
    this._playing = false;
    this.stopLoop();
    const run = this.run;
    if (!run) return;
    // No tick in flight: reflect it right away (otherwise the tick's epilogue does it).
    if (!this.busy && run.world.status === 'running') run.world.status = 'paused';
    // After any in-flight tick: status + save.
    void this.lock(async () => {
      if (this.run !== run || this._playing) return;
      if (run.world.status === 'running') run.world.status = 'paused';
      await this.saveNow();
      this.events.emit('state');
    });
    this.events.emit('state');
  }

  setSpeed(speed: Speed): void {
    this._speed = speed;
    if (this._playing && this.timer) this.startLoop(Math.min(250, BASE_INTERVAL_MS / speed));
    this.events.emit('state');
  }

  private startLoop(delayMs: number): void {
    this.stopLoop();
    const token = this.loopToken;
    this.loopRunning = true;
    this.timer = setTimeout(() => { void this.loopTick(token); }, Math.max(0, delayMs));
  }

  private stopLoop(): void {
    this.loopToken += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.loopRunning = false;
  }

  /** One ticker iteration: tick, then schedule the next one a tick of the pace after this one started, or after an incident's wait. */
  private async loopTick(token: number): Promise<void> {
    if (token !== this.loopToken) return;
    this.timer = null;
    if (!this._playing || !this.run) {
      this.loopRunning = false;
      return;
    }
    const t0 = performance.now();
    await this.step().catch((err: unknown) => console.error('[tick] la boucle continue :', err)); // only the founder stops it
    if (token !== this.loopToken) return; // superseded by pause / restart / run switch
    const run = this.run;
    if (!this._playing || !run || isTerminal(run.world.status)) {
      this.loopRunning = false;
      if (this._playing) {
        this._playing = false;
        this.events.emit('state');
      }
      return;
    }
    const delay = Math.max(30, this.backoffMs ?? 0, this.tickMs() - (performance.now() - t0));
    this.timer = setTimeout(() => { void this.loopTick(token); }, delay);
  }

  /** One tick, never overlapping another. Errors are contained (logged + feed line). */
  step(): Promise<StepResult | null> {
    const gen = this.generation;
    return this.lock(async () => {
      if (gen !== this.generation || !this.run) return null;
      return this.stepUnlocked(this.run);
    });
  }

  private async stepUnlocked(run: MountedRun): Promise<StepResult | null> {
    const w = run.world;
    if (isTerminal(w.status)) return null;
    const dayBefore = w.day;
    const statusBefore = w.status;
    const at = `${w.day}:${w.tick}`;
    if (w.status === 'paused') w.status = 'running';
    this.busy = true;
    try {
      const res = await run.company.step();
      this.errors = 0;
      this.sameTick = 0;
      this.backoffMs = null;
      this.lastError = null;
      run.syncMind();
      if (!this._playing && w.status === 'running') w.status = 'paused';
      // The goal is saved the tick it falls, not every tick after: an open-ended run lives past it, and world.prev.json must stay a day old.
      if (res.phase === 'evening' || w.day !== dayBefore || isTerminal(w.status) || (w.status === 'goal_reached' && statusBefore !== 'goal_reached')) await this.saveNow();
      if (res.phase === 'evening' && dayBefore % 7 === 0) await this.checkpoint(w);
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      console.error(`[tick] incident au jour ${w.day}, tick ${w.tick} :`, err);
      safeEmit(w, `Incident technique pendant le travail (${msg.slice(0, 120)}). L'agence réessaie au prochain créneau.`);
      await this.afterError(run, at, msg);
      if (!this._playing && w.status === 'running') w.status = 'paused';
      return null;
    } finally {
      this.busy = false;
      this.events.emit('tick');
    }
  }

  /** Errors never stop the agency, only the founder does: they wait, then the clock moves on without the tick (scale D4). */
  private async afterError(run: MountedRun, at: string, msg: string): Promise<void> {
    this.errors += 1;
    this.sameTick = at === this.failedAt ? this.sameTick + 1 : 1;
    this.failedAt = at;
    this.backoffMs = this.errors >= 6 ? BACKOFF_MS[1] : this.errors >= 3 ? BACKOFF_MS[0] : null;
    if (this.sameTick < SKIP_AFTER) return;
    try {
      run.company.skipTick(msg);
    } catch (err) {
      console.error(`[tick] impossible de sauter le créneau ${at} :`, err);
      return;
    }
    this.errors = 0;
    this.sameTick = 0;
    this.backoffMs = null;
    await this.saveNow();
  }

  private async checkpoint(world: WorldState): Promise<void> {
    try {
      await saveCheckpoint(world);
    } catch (err) {
      console.error(`[sauvegarde] point de contrôle de ${world.runId} :`, (err as Error).message);
    }
  }

  /** Runs ticks until the next morning (day rollover), at most one full day. */
  async runDay(): Promise<void> {
    const gen = this.generation;
    const startDay = this.world.day;
    for (let i = 0; i < TICKS_PER_DAY + 1; i++) {
      if (gen !== this.generation) return;
      const res = await this.step();
      const run = this.run;
      if (!res || !run || gen !== this.generation) return;
      if (run.world.day !== startDay || isTerminal(run.world.status)) return;
    }
  }

  async control(action: ControlAction, speed?: Speed): Promise<LiveSessionInfo> {
    const run = this.mounted();
    if (action === 'step' || action === 'day') this.assertNotFinished(run);
    switch (action) {
      case 'play':
        this.play(speed);
        break;
      case 'pause':
        if (speed) this._speed = speed;
        this.pause();
        break;
      case 'step':
        this.pause();
        if (speed) this._speed = speed;
        await this.step();
        break;
      case 'day':
        this.pause();
        if (speed) this._speed = speed;
        void this.runDay().catch((err) => console.error('[session] journée interrompue :', err));
        break;
    }
    return this.info();
  }

  private async saveNow(): Promise<void> {
    const run = this.run;
    if (!run) return;
    try {
      await saveWorld(run.world, { finance: () => safeFinance(run.world) });
    } catch (err) {
      console.error(`[sauvegarde] ${run.world.runId} :`, (err as Error).message);
    }
    // Reads only and never awaits a render: the tick loop pays for a look at the queue.
    try {
      this.director?.sync(run.world);
    } catch (err) {
      console.error(`[video] ${run.world.runId} :`, (err as Error).message);
    }
  }

  /** Like every other save, behind the tick in flight: on its own timer it lands at any await inside a tick. */
  private saveSoon(): void {
    const run = this.run;
    if (run) scheduleSave(run.world, 2000, { finance: () => safeFinance(run.world), through: (save) => this.lock(save) });
  }

  /** The founder's « vu », up to twice a minute. A playing run's evening save carries it: its own save would leave world.prev.json seconds old. */
  saveSeen(): void {
    if (!this._playing) this.saveSoon();
  }

  private touch(): void {
    this.saveSoon();
    this.events.emit('state');
  }

  // ───────────────────────────── founder actions ─────────────────────────────

  hasAgent(agentId: string): boolean {
    return this.resolveAgent(agentId) !== null;
  }

  /** Agent id from an id or a first name (case/accent-insensitive: « Léo », « leo », « LEO »), or null. */
  resolveAgent(agentId: string): string | null {
    const agents = this.world.company.agents;
    if (agents.some((a) => a.id === agentId)) return agentId;
    const key = foldName(agentId);
    if (!key) return null;
    return agents.find((a) => foldName(a.id) === key || foldName(a.name) === key)?.id ?? null;
  }

  hasTask(taskId: string): boolean {
    return this.world.company.tasks.some((t) => t.id === taskId);
  }

  async mission(text: string, agentId?: string): Promise<string> {
    await this.switching;
    const run = this.mounted();
    this.assertNotFinished(run);
    const target = agentId ? this.resolveAgent(agentId) : null;
    if (agentId && !target) throw new HttpError(404, `Agent inconnu : ${agentId}`);
    const id = await run.company.giveMission(text, target ?? undefined);
    this.touch();
    return id;
  }

  /** The founder's answer to a mission: its status and what the company said about it. */
  missionState(id: string): Pick<MissionResponse, 'status' | 'message'> {
    const m = this.world.company.missions.find((x) => x.id === id);
    return { status: m?.status, ...(m?.outcome ? { message: m.outcome } : {}) };
  }

  async chat(agentId: string, text: string): Promise<string> {
    await this.switching;
    const run = this.mounted();
    const target = this.resolveAgent(agentId);
    if (!target) throw new HttpError(404, `Agent inconnu : ${agentId}`);
    let reply: string;
    try {
      reply = await run.company.chat(target, text);
    } catch (err) {
      const status = errorStatus(err);
      if (status < 500) throw new HttpError(status, err instanceof Error ? err.message : String(err));
      throw err;
    }
    run.syncMind();
    this.touch();
    return reply;
  }

  async approve(taskId: string, approved: boolean): Promise<void> {
    await this.switching;
    const run = this.mounted();
    if (!this.hasTask(taskId)) throw new HttpError(404, `Tâche inconnue : ${taskId}`);
    this.assertNotFinished(run);
    run.company.approve(taskId, approved);
    this.touch();
  }

  /** The founder wants to see this ad: his render goes first. */
  async requestVideo(creativeId: string, ratio?: AdRatio): Promise<CreativeVideo> {
    await this.switching;
    const run = this.mounted();
    if (!run.world.company.creatives.some((c) => c.id === creativeId)) throw new HttpError(404, `Pub inconnue : ${creativeId}`);
    if (!this.director) throw new HttpError(503, NO_DIRECTOR);
    return this.director.request(run.world, creativeId, ratio);
  }

  // ───────────────────────────── reads ─────────────────────────────

  videoIndex(): VideoIndex {
    return this.director?.index() ?? { level: 'storyboard_only', reason: NO_DIRECTOR, items: {} };
  }

  snapshotJson(god = false): string {
    const run = this.mounted();
    return snapshotJson(run.world, god, { session: this.info(), videos: this.videoIndex().items });
  }

  /** The snapshot of the live stream: lighter than the one of GET /api/state (see LIVE_LIMITS). */
  liveSnapshotJson(god = false): string {
    const run = this.mounted();
    return liveSnapshotJson(run.world, god, { session: this.info(), videos: liveVideos(run.world, this.videoIndex().items) });
  }

  tickJson(): string {
    const w = this.world;
    const agents: LiveAgent[] = w.company.agents.map(({ id, status, place, currentTaskId, energy, bubble }) => ({ id, status, place, currentTaskId, energy, bubble }));
    return JSON.stringify({ type: 'tick', day: w.day, tick: w.tick, phase: w.phase, finance: safeFinance(w), agents });
  }

  async brainList(): Promise<Omit<BrainNote, 'body'>[]> {
    const notes = await this.mounted().brain.list();
    return notes.map(({ body: _b, ...meta }) => meta);
  }

  brainNote(path: string): Promise<BrainNote | null> {
    return this.mounted().brain.read(path);
  }

  brainGraph(): ReturnType<BrainVault['graph']> {
    return this.mounted().brain.graph();
  }

  /** Saved runs (most recent first) + UI aliases (name, updatedAt) and the current-run flag. */
  async listRuns(): Promise<(RunInfo & Required<Pick<RunInfo, 'name' | 'updatedAt' | 'current'>>)[]> {
    const current = this.run?.world.runId;
    return (await listRuns()).map((r) => ({ ...r, name: r.scenarioName || r.companyName, updatedAt: r.mtime, current: r.runId === current }));
  }
}

function foldName(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function safeEmit(world: WorldState, text: string): void {
  try {
    emit(world, { agentId: null, kind: 'event', text });
  } catch {
    /* never let the feed break error handling */
  }
}

/** A save could not be read and an older one took over: the founder hears it, the digest keeps it. */
function recordRecovery(world: WorldState, { from, lostTicks }: NonNullable<SessionRecord['recovered']>): void {
  const source = from === 'prev' ? 'la sauvegarde précédente' : 'le dernier point de contrôle';
  const text = `Sauvegarde illisible : reprise depuis ${source}, au jour ${world.day}`;
  logDecision(world, { kind: 'incident', who: 'system', text, why: `${lostTicks} créneau(x) de travail à refaire` });
  safeEmit(world, `${text} (${lostTicks} créneau(x) à refaire).`);
}

/** The session log and runs/current.json are bookkeeping: they must never cost a run. */
async function keepBooks(job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (err) {
    console.error('[session] journal :', (err as Error).message);
  }
}
