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
import type { BrainNote, BrainVault, CompanyApi, ContentEngine, RunPaths, StepResult, UsageEvent } from '../contracts.js';
import type { RunInfo, ScenarioConfig, SessionInfo, WorldState } from '../shared.js';
import { TICKS_PER_DAY } from '../shared.js';
import { config, type ConfigMindMode } from './env.js';
import { errorStatus, HttpError, type ControlAction, type Speed } from './http.js';
import { flushSaves, isValidRunId, listRuns, loadWorld, newRunId, runsDir, saveWorld, scheduleSave } from './persist.js';
import { safeFinance, snapshotJson } from './snapshot.js';

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
  const company: CompanyApi = new Company(world, { paths, engine, brain });
  syncMind();
  return { world, company, engine, brain, paths, syncMind };
}

/** The live session state sent to the UI is the shared SessionInfo (every optional field is filled here). */
export type { SessionInfo };
export type LiveSessionInfo = Required<SessionInfo>;

type SessionEventName = 'tick' | 'run' | 'state';

const BASE_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class AgencySession {
  private run: MountedRun | null = null;
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
  private lastError: string | null = null;
  private readonly events = new EventEmitter();

  constructor() {
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
      intervalMs: Math.round(BASE_INTERVAL_MS / this._speed),
      busy: this.busy,
      mindMode: this.run?.engine.mode ?? 'heuristic',
      status: this.run?.world.status ?? null,
      day: this.run?.world.day ?? 0,
      tick: this.run?.world.tick ?? 0,
      lastError: this.lastError,
    };
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /**
   * Resumes the most recent unfinished run (or creates the default one) and starts playing at speed 1:
   * the agency works alone. Finished runs stay available through /api/runs + /api/load.
   */
  async start(): Promise<void> {
    const runs = await listRuns();
    for (const r of runs) {
      if (r.status === 'finished') continue;
      const world = await loadWorld(r.runId);
      if (!world || isTerminal(world.status)) continue;
      try {
        await this.switchRun(() => world, true);
        return;
      } catch (err) {
        console.error(`[session] impossible de reprendre ${r.runId} :`, (err as Error).message);
      }
    }
    await this.newRun({}, true);
  }

  async newRun(partial: Partial<ScenarioConfig> = {}, play = true): Promise<WorldState> {
    return this.switchRun(() => {
      const scenario = defaultScenario({ maxComputeEur: config.maxComputeEur, ...partial });
      return createWorld(scenario, newRunId(runsDir()));
    }, play);
  }

  async loadRun(runId: string): Promise<WorldState> {
    if (!isValidRunId(runId)) throw new HttpError(400, 'Identifiant de run invalide.');
    const world = await loadWorld(runId);
    if (!world) throw new HttpError(404, `Run introuvable : ${runId}`);
    return this.switchRun(() => world, this._playing || !this.run);
  }

  private async switchRun(make: () => WorldState | Promise<WorldState>, play: boolean): Promise<WorldState> {
    this.generation += 1;
    this.stopLoop();
    const wasPlaying = this._playing;
    this._playing = false;
    const job = this.lock(async () => {
      if (this.run) {
        if (this.run.world.status === 'running') this.run.world.status = 'paused';
        await this.saveNow();
      }
      const world = await make();
      const mounted = await mountWorld(world);
      if (world.status === 'running') world.status = 'paused';
      this.run = mounted;
      this.errors = 0;
      this.lastError = null;
      await this.saveNow();
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
      if (this.run && this.run.world.status === 'running') this.run.world.status = 'paused';
      await this.saveNow();
    }).catch(() => undefined);
    await flushSaves();
  }

  // ───────────────────────────── ticker ─────────────────────────────

  play(speed?: Speed): void {
    const run = this.mounted();
    if (speed) this._speed = speed;
    if (isTerminal(run.world.status)) {
      throw new HttpError(409, 'Ce run est terminé (horizon atteint) : lance une nouvelle simulation.');
    }
    this._playing = true;
    if (run.world.status === 'paused') run.world.status = 'running';
    if (!this.loopRunning) this.startLoop(120);
    else if (this.timer) this.startLoop(Math.min(250, BASE_INTERVAL_MS / this._speed)); // waiting → apply new speed now
    this.events.emit('state');
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

  /** One ticker iteration: tick, then schedule the next one 2000/speed ms after this one started. */
  private async loopTick(token: number): Promise<void> {
    if (token !== this.loopToken) return;
    this.timer = null;
    if (!this._playing || !this.run) {
      this.loopRunning = false;
      return;
    }
    const t0 = performance.now();
    await this.step();
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
    const interval = BASE_INTERVAL_MS / this._speed;
    const delay = Math.max(30, interval - (performance.now() - t0));
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
    if (w.status === 'paused') w.status = 'running';
    this.busy = true;
    try {
      const res = await run.company.step();
      this.errors = 0;
      this.lastError = null;
      run.syncMind();
      if (!this._playing && w.status === 'running') w.status = 'paused';
      if (res.phase === 'evening' || w.day !== dayBefore || isTerminal(w.status) || w.status === 'goal_reached') await this.saveNow();
      return res;
    } catch (err) {
      this.errors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      console.error(`[tick] incident au jour ${w.day}, tick ${w.tick} :`, err);
      safeEmit(w, `Incident technique pendant le travail (${msg.slice(0, 120)}). L'agence réessaie au prochain créneau.`);
      if (this.errors >= MAX_CONSECUTIVE_ERRORS) {
        this._playing = false;
        this.stopLoop();
        safeEmit(w, `${MAX_CONSECUTIVE_ERRORS} incidents d'affilée : l'agence se met en pause. Relance la lecture quand tu veux.`);
        this.events.emit('state');
      }
      if (!this._playing && w.status === 'running') w.status = 'paused';
      return null;
    } finally {
      this.busy = false;
      this.events.emit('tick');
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
    this.mounted();
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
      const f = safeFinance(run.world);
      await saveWorld(run.world, { finance: { cash: f.cash, profit: f.profit } });
    } catch (err) {
      console.error(`[sauvegarde] ${run.world.runId} :`, (err as Error).message);
    }
  }

  private touch(): void {
    if (this.run) scheduleSave(this.run.world, 2000);
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
    const target = agentId ? this.resolveAgent(agentId) : null;
    if (agentId && !target) throw new HttpError(404, `Agent inconnu : ${agentId}`);
    const id = await run.company.giveMission(text, target ?? undefined);
    this.touch();
    return id;
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
    run.company.approve(taskId, approved);
    this.touch();
  }

  // ───────────────────────────── reads ─────────────────────────────

  snapshotJson(god = false): string {
    const run = this.mounted();
    return snapshotJson(run.world, god, { session: this.info() });
  }

  tickJson(): string {
    const w = this.world;
    return JSON.stringify({ type: 'tick', day: w.day, tick: w.tick, phase: w.phase, finance: safeFinance(w) });
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
