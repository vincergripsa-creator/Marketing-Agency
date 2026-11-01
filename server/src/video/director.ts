/**
 * The render queue, outside the world (video §9). It reads a world and never writes one, so a run with every video on disk
 * equals a run with none (video D2). One job at a time, in a child process (D11): the tick loop only ever pays for a queue.
 * `runs/<id>/video/manifest.json` is its memory: files never enter the world, the API layer merges them (D27).
 */
import { fork } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { constants as osConstants, setPriority } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from '../api/persist.js';
import type { RunPaths } from '../contracts.js';
import { launchableCreatives } from '../runtime/acquisition.js';
import { taskChannel } from '../runtime/tasks.js';
import { channelOf, type AdCreative, type AdRatio, type CreativeVideo, type QaSummary, type VideoFile, type VideoIndex, type VideoStatus, type WorldState } from '../shared.js';
import { approvedOn } from '../sim/channels.js';
import { detectCaps, type VideoCaps } from './caps.js';
import { probeFile, QA } from './qa.js';
import { buildRenderSpec, renderKey } from './spec.js';
import type { VideoRatio } from './stage.js';
import type { RenderJob, RenderResult } from './worker.js';

export type VideoMode = 'off' | 'ondemand' | 'auto';

/** What earns a render unasked: 30 s of a machine, so only what spends money or waits for the founder (video §9, scale §15). */
export const WORTHY = { minImpressions: 1000, minQuality: 70, maxQueued: 3 } as const;
export const DEFAULT_MAX_DISK_MB = 1200;

export const VIDEO_DIR = 'video';
export const SPEC_FILE = 'spec.json';
/** Written by the worker once QA has passed: a master without it is a render that died, never a video. */
export const RESULT_FILE = 'result.json';
const MANIFEST_FILE = 'manifest.json';

export const JOB_TIMEOUT_MS = 600_000;
const MAX_ATTEMPTS = 2;
const STOP_WAIT_MS = 4000;
const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));

const REASON = {
  off: 'Rendu vidéo coupé sur ce serveur',
  notFound: 'Pub introuvable',
  noCut: "Cette pub n'a pas de montage",
  noMedia: "Une annonce texte n'a pas de vidéo",
  evicted: 'Retirée du disque : à regénérer à la demande',
  lost: 'Fichier disparu : à regénérer à la demande',
  crashed: "Le rendu s'est arrêté avant la fin",
  timeout: 'Rendu trop long : arrêté',
} as const;

/** What the machine says when a server runs with the video off: nothing was looked for. */
export const OFF_CAPS: VideoCaps = { level: 'storyboard_only', reason: REASON.off, ffmpeg: null, voice: null, canvas: false, pages: false };

// ───────────────────────────── who gets rendered ─────────────────────────────

/** What the founder has to decide on: the ads of a launch waiting for his yes, so he can watch before he clicks. */
function awaitingFounder(world: Readonly<WorldState>): AdCreative[] {
  const { tasks, pendingApprovals } = world.company;
  return pendingApprovals.flatMap((id) => {
    const task = tasks.find((t) => t.id === id);
    const productId = task?.input.productId;
    if (task?.kind !== 'launch_campaign' || task.status !== 'awaiting_founder' || typeof productId !== 'string') return [];
    return launchableCreatives(world as WorldState, productId, taskChannel(task)).slice(0, WORTHY.maxQueued);
  });
}

/** The whole life of each creative: market.adStats keeps the last days, the rest is in the retired totals. */
function impressionsOf(world: Readonly<WorldState>): Map<string, number> {
  const shown = new Map(Object.entries(world.market.retiredAdTotals ?? {}).map(([id, t]) => [id, t.impressions]));
  for (const row of world.market.adStats) shown.set(row.creativeId, (shown.get(row.creativeId) ?? 0) + row.impressions);
  return shown;
}

/** Approved where it runs, in an active campaign, shown enough, good enough. Best shown first. */
function runningWell(world: Readonly<WorldState>): AdCreative[] {
  const shown = impressionsOf(world);
  const views = (c: AdCreative): number => shown.get(c.id) ?? 0;
  const channels = new Map<string, ReturnType<typeof channelOf>[]>();
  for (const k of world.company.campaigns) {
    if (k.status !== 'active') continue;
    for (const id of k.creativeIds) channels.set(id, [...channels.get(id) ?? [], channelOf(k)]);
  }
  return world.company.creatives
    .filter((c) => channels.get(c.id)?.some((ch) => approvedOn(c, ch)) && views(c) >= WORTHY.minImpressions && (c.quality?.overall ?? 0) >= WORTHY.minQuality)
    .sort((a, b) => views(b) - views(a) || a.id.localeCompare(b.id));
}

const stageOf = (c: AdCreative): AdRatio => c.ratio ?? '9:16';
const hasMedia = (c: AdCreative): boolean => c.format !== 'search_text' && stageOf(c) !== 'text';
/** A pin has no editor: `buildRenderSpec` gives it a one-slide plan. */
const hasPlan = (c: AdCreative): boolean => Boolean(c.cut) || c.format === 'static_image';

/**
 * What to render next, at most three. Pure. `skip` is the director's memory, which a pure read of the world cannot have:
 * without it the three best would answer for ever and the fourth would never get its file.
 */
export function selectWorthy(world: Readonly<WorldState>, skip: (creativeId: string, ratio: AdRatio) => boolean = () => false): { creativeId: string; ratio: AdRatio }[] {
  const out: { creativeId: string; ratio: AdRatio }[] = [];
  for (const c of [...awaitingFounder(world), ...runningWell(world)]) {
    if (out.length >= WORTHY.maxQueued) break;
    if (!hasPlan(c) || !hasMedia(c) || out.some((o) => o.creativeId === c.id) || skip(c.id, stageOf(c))) continue;
    out.push({ creativeId: c.id, ratio: stageOf(c) });
  }
  return out;
}

// ───────────────────────────── the child process ─────────────────────────────

export interface RenderHandle { result: Promise<RenderResult>; cancel(): void }
export type RenderRunner = (job: RenderJob) => RenderHandle;

const crash = (reason: string): RenderResult => ({ ok: false, retry: true, reason, video: null, bytes: 0, poster: null, captions: null, cards: [], voice: null, qa: null });

/** `execArgv` carries the TypeScript loader from the parent. A worker thread would die with the simulation on a native crash. */
export function forkRender(execArgv: string[] = process.execArgv, timeoutMs = JOB_TIMEOUT_MS, priority: number = osConstants.priority.PRIORITY_BELOW_NORMAL): RenderRunner {
  return (job) => {
    const child = fork(WORKER, [], { execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    if (child.pid) {
      try { setPriority(child.pid, priority); } catch { /* it only runs a little more eagerly */ }
    }
    const result = new Promise<RenderResult>((resolve) => {
      let answer: RenderResult | null = null;
      let timedOut = false;
      let log = '';
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      const finish = (r: RenderResult) => { clearTimeout(timer); resolve(r); };
      child.stderr?.on('data', (d: Buffer) => { log = (log + d.toString()).slice(-800); });
      child.once('message', (m) => { answer = m as RenderResult; });
      child.once('error', (e) => { console.warn(`[video] worker : ${e.message}`); finish(crash(REASON.crashed)); });
      child.once('exit', (code) => {
        if (!answer && !timedOut && log.trim()) console.warn(`[video] worker sorti avec ${code} : ${log.trim()}`);
        finish(answer ?? crash(timedOut ? REASON.timeout : REASON.crashed));
      });
    });
    child.send(job, (err) => { if (err) child.kill(); });
    return { result, cancel: () => { child.kill(); } };
  };
}

// ───────────────────────────── the queue ─────────────────────────────

/** One row of the manifest: a creative on one stage. A creative's `CreativeVideo` merges its rows. */
export interface RenderRecord {
  creativeId: string;
  ratio: VideoRatio;
  key: string;
  dir: string;                 // run-relative job folder
  status: VideoStatus;
  reason: string | null;
  file: VideoFile | null;
  bytes: number;               // master and cards: what counts against the disk cap
  poster: string | null;
  captions: string | null;
  cards: string[];
  voice: string | null;
  qa: QaSummary | null;
  /** QA was cut on both attempts: nobody judged this file, so it stays on disk and the next sync asks again. */
  unjudged?: boolean;
}

interface Manifest { v: 1; renders: RenderRecord[] }
interface Plan { key: string; spec: string }
interface QueuedJob extends Plan { slot: string; attempts: number }

export interface DirectorOptions {
  paths: RunPaths;
  mode: VideoMode;
  caps: VideoCaps;
  maxDiskMb: number;
  onChange(id: string, v: CreativeVideo): void;
  /** Who renders. Absent: the real child process. */
  render?: RenderRunner;
  /** Seconds of a file for the light QA of a reload, null when it cannot be read. */
  probe?: (path: string) => number | null;
  /** Stage width of every job: the tests render small. */
  width?: number;
}

const slotOf = (creativeId: string, ratio: VideoRatio): string => `${creativeId}|${ratio}`;
const STATUS_RANK: readonly VideoStatus[] = ['rendering', 'queued', 'ready', 'evicted', 'failed', 'unavailable'];
const refused = (reason: string): CreativeVideo => ({ status: 'unavailable', reason, videos: [], poster: null, captions: null, cards: [], voice: null, qa: null });

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export class VideoDirector {
  private readonly opts: DirectorOptions;
  private readonly render: RenderRunner;
  private readonly renders = new Map<string, RenderRecord>();
  private readonly queue: QueuedJob[] = [];
  private shown = new Map<string, number>();
  private active: { cancel(): void; done: Promise<void> } | null = null;
  private stopped = false;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(opts: DirectorOptions) {
    this.opts = opts;
    this.render = opts.render ?? forkRender();
    this.reread();
  }

  /** Called after each save. Reads only, and never waits for a render: at most it starts one. */
  sync(world: Readonly<WorldState>): void {
    if (this.stopped || this.opts.mode === 'off') return;
    this.shown = impressionsOf(world);
    if (this.opts.mode === 'auto' && this.opts.caps.level !== 'storyboard_only') {
      const room = WORTHY.maxQueued - this.queue.length;
      const next = selectWorthy(world, (id, ratio) => this.answered(world, id, ratio as VideoRatio));
      for (const { creativeId, ratio } of next.slice(0, Math.max(0, room))) {
        const plan = this.planOf(world, creativeId, ratio as VideoRatio);
        if (plan) this.enqueue(plan, creativeId, ratio as VideoRatio, false);
      }
    }
    this.pump();
  }

  /** The founder asked: his job goes first. Never renders what is already ready. */
  request(world: Readonly<WorldState>, creativeId: string, ratio?: AdRatio): CreativeVideo {
    const creative = world.company.creatives.find((c) => c.id === creativeId);
    const stage = ratio ?? (creative ? stageOf(creative) : '9:16');
    const reason = this.refusal(creative, stage);
    if (reason !== null) return this.rows(creativeId).some((r) => r.status === 'ready') ? this.view(creativeId) : refused(reason);
    const plan = this.planOf(world, creativeId, stage as VideoRatio);
    if (!plan) return refused(REASON.noCut);
    this.enqueue(plan, creativeId, stage as VideoRatio, true);
    this.pump();
    return this.view(creativeId);
  }

  index(): VideoIndex {
    const items: Record<string, CreativeVideo> = {};
    for (const r of this.renders.values()) items[r.creativeId] ??= this.view(r.creativeId);
    return { level: this.opts.caps.level, reason: this.opts.caps.reason, items };
  }

  /** Scale's `dropFiles`: the creative is archived, nothing of it stays on disk. */
  async retireCreativeFiles(creativeId: string): Promise<void> {
    const rows = this.rows(creativeId);
    if (!rows.length) return;
    for (const r of rows) this.renders.delete(slotOf(r.creativeId, r.ratio));
    await Promise.all(rows.map((r) => this.remove(r.dir)));
    this.saveManifest();
    await this.writes;
  }

  /** A run switch or a shutdown: what was rendering goes back in the queue of the next mount. */
  async stop(): Promise<void> {
    this.stopped = true;
    const active = this.active;
    if (active) {
      active.cancel();
      await Promise.race([active.done, new Promise((r) => { setTimeout(r, STOP_WAIT_MS).unref?.(); })]);
    }
    for (const r of this.renders.values()) if (r.status === 'rendering') r.status = 'queued';
    if (this.renders.size) this.saveManifest(); // a run that rendered nothing has no video folder
    await this.writes;
  }

  // ── reading ──

  private rows(creativeId: string): RenderRecord[] {
    return [...this.renders.values()].filter((r) => r.creativeId === creativeId);
  }

  private view(creativeId: string): CreativeVideo {
    const rows = this.rows(creativeId);
    const lead = STATUS_RANK.flatMap((s) => rows.filter((r) => r.status === s))[0];
    if (!lead) return refused(REASON.notFound);
    const serving = rows.filter((r) => r.status === 'ready');
    const first = serving[0];
    return {
      status: lead.status,
      reason: lead.reason,
      videos: serving.flatMap((r) => (r.file ? [r.file] : [])),
      poster: rows.find((r) => r.poster)?.poster ?? null,
      captions: first?.captions ?? null,
      cards: serving.flatMap((r) => r.cards),
      voice: first?.voice ?? null,
      qa: (first ?? lead).qa,
    };
  }

  private refusal(creative: AdCreative | undefined, ratio: AdRatio): string | null {
    if (this.opts.mode === 'off') return REASON.off;
    if (this.opts.caps.level === 'storyboard_only') return this.opts.caps.reason ?? REASON.off;
    if (!creative) return REASON.notFound;
    if (!hasMedia(creative) || ratio === 'text') return REASON.noMedia;
    return hasPlan(creative) ? null : REASON.noCut;
  }

  /** What the worker will read, copied now: the world moves on while the job waits. Null: the world no longer holds it all. */
  private planOf(world: Readonly<WorldState>, creativeId: string, ratio: VideoRatio): Plan | null {
    try {
      const spec = buildRenderSpec(world, creativeId, ratio, this.opts.caps.voice);
      return { key: renderKey(spec), spec: JSON.stringify(spec) };
    } catch {
      return null;
    }
  }

  /** The current plan of this creative has had its render, whatever came of it: only the founder asks again. */
  private answered(world: Readonly<WorldState>, creativeId: string, ratio: VideoRatio): boolean {
    const row = this.renders.get(slotOf(creativeId, ratio));
    if (!row) return false;
    const plan = this.planOf(world, creativeId, ratio);
    return !plan || (row.key === plan.key && !row.unjudged);
  }

  // ── the queue ──

  private enqueue({ key, spec }: Plan, creativeId: string, ratio: VideoRatio, urgent: boolean): void {
    const slot = slotOf(creativeId, ratio);
    const old = this.renders.get(slot);
    if (old?.key === key && old.status === 'ready') return;
    if (old?.key === key && (old.status === 'queued' || old.status === 'rendering')) {
      const at = this.queue.findIndex((j) => j.slot === slot && j.key === key);
      if (urgent && at > 0) this.queue.unshift(...this.queue.splice(at, 1));
      return;
    }
    // A rework: the old cut is not this ad any more, and neither is its file.
    if (old && old.key !== key) void this.remove(old.dir);
    const row: RenderRecord = {
      creativeId, ratio, key, dir: `${VIDEO_DIR}/${creativeId}/${key.slice(0, 8)}`,
      status: 'queued', reason: null, file: null, bytes: 0, poster: old?.key === key ? old.poster : null, captions: null, cards: [], voice: null, qa: null,
    };
    this.renders.set(slot, row);
    const kept = this.finished(row);
    if (kept) {
      this.fill(row, kept);
    } else {
      this.queue[urgent ? 'unshift' : 'push']({ slot, key, spec, attempts: 0 });
    }
    this.changed(row);
  }

  private pump(): void {
    if (this.stopped || this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    const row = this.renders.get(job.slot);
    // Retired or reworked while it waited: its row has moved on.
    if (!row || row.key !== job.key) {
      this.pump();
      return;
    }
    row.status = 'rendering';
    this.changed(row);
    const active = { cancel: () => undefined as void, done: Promise.resolve() };
    this.active = active;
    active.done = this.run(job, row, active).catch((err: Error) => console.warn(`[video] ${row.creativeId} : ${err.message}`)).then(() => {
      this.active = null;
      this.pump();
    });
  }

  private async run(job: QueuedJob, row: RenderRecord, active: { cancel(): void }): Promise<void> {
    let result: RenderResult;
    try {
      const dir = join(this.opts.paths.root, row.dir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, SPEC_FILE), job.spec);
      if (this.stopped) return;
      const handle = this.render({ dir, root: this.opts.paths.root, ffmpeg: this.opts.caps.ffmpeg ?? '', pages: this.opts.caps.pages, width: this.opts.width });
      active.cancel = handle.cancel;
      result = await handle.result;
    } catch (err) {
      console.warn(`[video] ${row.creativeId} : ${(err as Error).message}`);
      result = crash(REASON.crashed);
    }
    if (this.stopped) return;
    await this.settle(job, row, result);
  }

  private async settle(job: QueuedJob, row: RenderRecord, r: RenderResult): Promise<void> {
    // Retired or reworked while it rendered: nobody wants this file.
    if (this.renders.get(job.slot) !== row) {
      await this.remove(row.dir);
      return;
    }
    if (!r.ok && r.retry && job.attempts + 1 < MAX_ATTEMPTS) {
      job.attempts += 1;
      row.status = 'queued';
      this.queue.unshift(job);
      this.changed(row);
      return;
    }
    if (r.ok) {
      this.fill(row, r);
      await this.enforceDisk(row);
    } else if (r.retry && r.qa) {
      // Only a verdict deletes a master: a QA cut twice says nothing of the film, and the button brings it back as an evicted one does.
      Object.assign(row, { status: 'evicted', reason: r.reason, file: null, bytes: 0, captions: null, cards: [], qa: null, unjudged: true });
    } else {
      // A failed job leaves nothing to serve.
      await this.remove(row.dir);
      Object.assign(row, { status: 'failed', reason: r.reason, file: null, bytes: 0, poster: null, captions: null, cards: [], qa: r.qa });
    }
    this.changed(row);
  }

  private fill(row: RenderRecord, r: RenderResult): void {
    Object.assign(row, { status: 'ready', reason: null, file: r.video, bytes: r.bytes, poster: r.poster, captions: r.captions, cards: r.cards, voice: r.voice, qa: r.qa });
  }

  /** Lowest impressions first, never the file that just landed: on a launch it has none yet, and the founder is about to watch it. */
  private async enforceDisk(fresh: RenderRecord): Promise<void> {
    const cap = this.opts.maxDiskMb * 1e6;
    const ready = [...this.renders.values()].filter((r) => r.status === 'ready');
    let used = ready.reduce((sum, r) => sum + r.bytes, 0);
    const views = (r: RenderRecord): number => this.shown.get(r.creativeId) ?? 0;
    for (const victim of ready.filter((r) => r !== fresh).sort((a, b) => views(a) - views(b))) {
      if (used <= cap) break;
      used -= victim.bytes;
      await this.evict(victim);
    }
  }

  /** The poster stays: the tile keeps its picture, and the button brings the file back. */
  private async evict(row: RenderRecord): Promise<void> {
    const files = [row.file?.path, row.captions, ...row.cards, `${row.dir}/${RESULT_FILE}`].filter((f): f is string => Boolean(f) && f !== row.poster);
    await Promise.all(files.map((f) => this.remove(f)));
    Object.assign(row, { status: 'evicted', reason: REASON.evicted, file: null, bytes: 0, captions: null, cards: [], qa: null });
    this.changed(row);
  }

  /** A file someone is watching may refuse on Windows: it stops being served all the same. */
  private async remove(path: string): Promise<void> {
    await rm(join(this.opts.paths.root, path), { recursive: true, force: true, maxRetries: 3 }).catch((err: Error) => console.warn(`[video] ${path} : ${err.message}`));
  }

  private changed(row: RenderRecord): void {
    this.saveManifest();
    if (!this.stopped) this.opts.onChange(row.creativeId, this.view(row.creativeId));
  }

  // ── the manifest ──

  private manifestPath(): string {
    return join(this.opts.paths.root, VIDEO_DIR, MANIFEST_FILE);
  }

  /** Written whole, at each change, one write behind the other. */
  private saveManifest(): void {
    const manifest: Manifest = { v: 1, renders: [...this.renders.values()] };
    const json = JSON.stringify(manifest);
    this.writes = this.writes.catch(() => undefined).then(async () => {
      await mkdir(join(this.opts.paths.root, VIDEO_DIR), { recursive: true });
      await writeFileAtomic(this.manifestPath(), json);
    }).catch((err: Error) => console.warn(`[video] manifest : ${err.message}`));
  }

  /** The render of this row, finished and whole on disk. */
  private finished(row: Pick<RenderRecord, 'dir'>): RenderResult | null {
    let r: RenderResult;
    try {
      r = JSON.parse(readFileSync(join(this.opts.paths.root, row.dir, RESULT_FILE), 'utf8')) as RenderResult;
    } catch {
      return null;
    }
    return r.ok && this.lightQa(r) ? r : null;
  }

  /** Size and duration: enough for a file that passed the full QA before the crash. */
  private lightQa(r: RenderResult): boolean {
    const root = this.opts.paths.root;
    if (r.cards.length && r.cards.some((c) => !sizeOf(join(root, c)))) return false;
    if (!r.video) return r.cards.length > 0;
    const file = join(root, r.video.path);
    if (sizeOf(file) !== r.video.bytes) return false;
    const ffmpeg = this.opts.caps.ffmpeg;
    const probe = this.opts.probe ?? (ffmpeg ? (path: string) => probeFile(path, ffmpeg).durationSec : null);
    if (!probe) return true;
    const sec = probe(file);
    return sec !== null && Math.abs(sec - r.video.durationSec) <= QA.durationTolSec;
  }

  /** Manifest reread at mount. Rendering goes back to queued, and a key already on disk is ready. Nothing starts here: `sync` does. */
  private reread(): void {
    let saved: Manifest;
    try {
      saved = JSON.parse(readFileSync(this.manifestPath(), 'utf8')) as Manifest;
    } catch {
      return;
    }
    const root = this.opts.paths.root;
    for (const row of saved.renders ?? []) {
      const slot = slotOf(row.creativeId, row.ratio);
      this.renders.set(slot, row);
      if (row.status === 'ready' && !this.stillThere(row)) {
        Object.assign(row, { status: 'evicted', reason: REASON.lost, file: null, bytes: 0, cards: [], captions: null, qa: null });
      }
      if (row.status !== 'rendering' && row.status !== 'queued') continue;
      const kept = this.finished(row);
      if (kept) {
        this.fill(row, kept);
        continue;
      }
      row.status = 'queued';
      try {
        this.queue.push({ slot, key: row.key, spec: readFileSync(join(root, row.dir, SPEC_FILE), 'utf8'), attempts: 0 });
      } catch {
        this.renders.delete(slot); // no spec: the next sync asks again from the world
      }
    }
  }

  private stillThere(row: RenderRecord): boolean {
    const root = this.opts.paths.root;
    if (row.file && sizeOf(join(root, row.file.path)) !== row.file.bytes) return false;
    return row.cards.every((c) => sizeOf(join(root, c)));
  }
}

// ───────────────────────────── opening one ─────────────────────────────

/** `off` under vitest whatever the environment says: `api.test.ts` mounts a real session, `auto` would fork render workers inside the tests. */
export function videoModeOf(env: Record<string, string | undefined> = process.env): VideoMode {
  if (env.VITEST) return 'off';
  const asked = env.VIDEO_MODE?.trim().toLowerCase();
  return asked === 'off' || asked === 'ondemand' ? asked : 'auto';
}

export function videoDiskCapOf(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.VIDEO_MAX_DISK_MB);
  return Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_DISK_MB;
}

let detected: Promise<VideoCaps> | null = null;

/** The director of one mounted run. `detectCaps` runs once, at the first mount, and only when something may render. */
export async function openDirector(paths: RunPaths, onChange: DirectorOptions['onChange']): Promise<VideoDirector> {
  const mode = videoModeOf();
  const caps = mode === 'off' ? OFF_CAPS : await (detected ??= detectCaps());
  return new VideoDirector({ paths, mode, caps, maxDiskMb: videoDiskCapOf(), onChange });
}
