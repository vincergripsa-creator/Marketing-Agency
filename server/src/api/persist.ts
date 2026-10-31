import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { repoRoot, summarizeLedger } from '../core/index.js';
import type { HookStyle, Product, RunInfo, WorldState } from '../shared.js';
import { TICKS_PER_DAY } from '../shared.js';
import { HOOK_STYLES } from '../minds/playbook.js';
import { versionSince } from '../runtime/acquisition.js';
import { doneOutputs } from '../runtime/ctx.js';
import { fromBuyer } from '../runtime/metrics.js';
import { CANDIDATES } from '../runtime/org/catalog.js';
import { LEGACY_ORG } from '../runtime/org/constants.js';

/** Saved run summary (shared with the UI: GET /api/runs). */
export type { RunInfo };

export interface SaveOptions {
  /** Runs root (default <repo>/runs). */
  dir?: string;
  /**
   * Cash/profit from the sim's financeSnapshot; falls back to the shared ledger summary. A function is read when
   * the save serialises the world, so a debounced save never pairs a newer world with older figures.
   */
  finance?: SavedFinance | (() => SavedFinance);
  /** What a debounced save goes through: a session's lock, so it lands behind the tick in flight and never holds half of it. */
  through?: <T>(save: () => Promise<T>) => Promise<T>;
}

export interface SavedFinance { cash: number; profit: number }

/**
 * One stay of the agency in a run, in runs/<id>/session.log.json: outside the world, so replay stays pure. No `stopAt`: the
 * stay in progress. `clean: false` with one: a crash, closed at the next boot on the last save the disk saw. `recovered`: its
 * save could not be read.
 */
export interface SessionRecord {
  startAt: string; stopAt?: string; clean: boolean; day: number;
  recovered?: { from: 'prev' | 'checkpoint'; lostTicks: number };
}

/** A save, and how far it had to fall back to find one. */
export interface SafeLoad { world: WorldState; from: 'world' | 'prev' | 'checkpoint'; lostTicks?: number }

const WORLD_FILE = 'world.json';
const PREV_FILE = 'world.prev.json';
/** Where an unreadable world.json goes, or the next save would rotate it over the good world.prev.json. */
const BAD_FILE = 'world.bad.json';
const META_FILE = 'meta.json';
const CURRENT_FILE = 'current.json';
const SESSION_LOG = 'session.log.json';
const CHECKPOINTS = 'checkpoints';
const CHECKPOINT_RE = /^day-(\d+)\.json\.gz$/;
const CHECKPOINT = { weekly: 4, monthDays: 30, max: 12 };
const SESSION_LOG_MAX = 500;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export function runsDir(): string {
  return join(repoRoot(), 'runs');
}

export function isValidRunId(id: unknown): id is string {
  return typeof id === 'string' && RUN_ID_RE.test(id) && !id.includes('..');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'run-YYYYMMDD-HHMMSS' (local time). */
export function makeRunId(date = new Date()): string {
  return `run-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** makeRunId, suffixed (-2, -3…) when a run folder with that id already exists. */
export function newRunId(dir = runsDir(), date = new Date()): string {
  const base = makeRunId(date);
  let id = base;
  for (let i = 2; existsSync(join(dir, id)); i++) id = `${base}-${i}`;
  return id;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cash/profit from the ledger alone: the same summary as the sim (holds move cash, never profit). */
export function estimateCashProfit(world: Pick<WorldState, 'ledger'> & { day?: number }): { cash: number; profit: number; capital: number } {
  const { cash, profit, capital } = summarizeLedger(Array.isArray(world.ledger) ? world.ledger : [], world.day ?? 0);
  return { cash, profit, capital };
}

export function runInfoOf(world: WorldState, mtime: string, finance?: SavedFinance): RunInfo {
  const f = finance ?? estimateCashProfit(world);
  return {
    runId: world.runId,
    companyName: world.scenario?.companyName ?? world.company?.name ?? 'Pixel Agency',
    scenarioName: world.scenario?.name ?? '',
    difficulty: world.scenario?.difficulty ?? 'normal',
    day: world.day ?? 1,
    status: world.status ?? 'paused',
    cash: r2(f.cash),
    profit: r2(f.profit),
    createdAt: world.createdAt ?? mtime,
    mtime,
  };
}

// Saves of the same run are chained so two writes never race on the same files.
const chains = new Map<string, Promise<unknown>>();
let tmpCounter = 0;

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Windows: the target may be briefly locked by a reader (antivirus, another process).
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && attempt < 5) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
        await copyFile(from, to);
        await unlink(from).catch(() => undefined);
        return;
      }
      throw err;
    }
  }
}

/** Losing the previous save must never cost the new one. */
async function keepPrevious(file: string, prev: string): Promise<void> {
  try {
    await renameWithRetry(file, prev);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[sauvegarde] ${prev} :`, (err as Error).message);
  }
}

/** Atomic write: tmp file in the same folder + rename. With `prev`, what `file` held moves there first. */
export async function writeFileAtomic(file: string, data: string | Uint8Array, prev?: string): Promise<void> {
  tmpCounter += 1;
  const tmp = `${file}.tmp-${process.pid}-${tmpCounter}`;
  await writeFile(tmp, data, 'utf8');
  try {
    if (prev) await keepPrevious(file, prev);
    await renameWithRetry(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Writes runs/<runId>/world.json, keeps the save before it as world.prev.json (+ a small meta.json used by listRuns). Returns the world file path. */
export function saveWorld(world: WorldState, opts: SaveOptions = {}): Promise<string> {
  const dir = opts.dir ?? runsDir();
  if (!isValidRunId(world.runId)) return Promise.reject(new Error(`Identifiant de run invalide : ${String(world.runId)}`));
  const root = join(dir, world.runId);
  const file = join(root, WORLD_FILE);
  // Serialise synchronously so the saved state is the one at call time.
  const json = JSON.stringify(world);
  const finance = typeof opts.finance === 'function' ? opts.finance() : opts.finance;
  const meta = JSON.stringify({ ...runInfoOf(world, new Date().toISOString(), finance), tick: world.tick }, null, 2);
  const prev = chains.get(world.runId) ?? Promise.resolve();
  const job = prev.catch(() => undefined).then(async () => {
    await mkdir(root, { recursive: true });
    await writeFileAtomic(file, json, join(root, PREV_FILE));
    await writeFileAtomic(join(root, META_FILE), meta);
    return file;
  });
  chains.set(world.runId, job);
  void job.finally(() => { if (chains.get(world.runId) === job) chains.delete(world.runId); }).catch(() => undefined);
  return job;
}

interface PendingSave { timer: NodeJS.Timeout; world: WorldState; opts: SaveOptions }
const pending = new Map<string, PendingSave>();

const pendingWrite = (world: WorldState, opts: SaveOptions): Promise<unknown> =>
  (opts.through ? opts.through(() => saveWorld(world, opts)) : saveWorld(world, opts));

/** Debounced save: many calls within `delayMs` produce one write. */
export function scheduleSave(world: WorldState, delayMs = 1500, opts: SaveOptions = {}): void {
  const existing = pending.get(world.runId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(world.runId);
    pendingWrite(world, opts).catch((err) => console.error(`[sauvegarde] échec pour ${world.runId} :`, (err as Error).message));
  }, Math.max(0, delayMs));
  timer.unref?.();
  pending.set(world.runId, { timer, world, opts });
}

/** Runs pending debounced saves now and waits for every in-flight write. */
export async function flushSaves(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [runId, p] of pending) {
    clearTimeout(p.timer);
    pending.delete(runId);
    jobs.push(pendingWrite(p.world, p.opts));
  }
  jobs.push(...chains.values());
  await Promise.allSettled(jobs);
}

export function worldFile(runId: string, dir = runsDir()): string {
  return join(dir, runId, WORLD_FILE);
}

/** A crash between the two renames of a save leaves only world.prev.json: that run still exists. */
export function runExists(runId: string, dir = runsDir()): boolean {
  return isValidRunId(runId) && (existsSync(worldFile(runId, dir)) || existsSync(join(dir, runId, PREV_FILE)));
}

function looksLikeWorld(v: unknown): v is WorldState {
  if (!v || typeof v !== 'object') return false;
  const w = v as Partial<WorldState>;
  return typeof w.runId === 'string' && typeof w.day === 'number' && !!w.company && !!w.market && !!w.scenario && Array.isArray(w.ledger);
}

/** A save worth resuming from. JSON writes NaN as null, so a sum alone would not see it. */
function isValidSave(v: unknown): v is WorldState {
  return looksLikeWorld(v) && v.ledger.every((e) => Number.isFinite(e.amount));
}

/** What compaction will ask of a product once its old tasks are gone (scale §7.2): read from them while they are all here. */
function backfillProduct(w: WorldState, p: Product): void {
  if (p.launchedDay != null) p.versionDay ??= versionSince(w, p);
  p.stats.ratingSum ??= p.stats.reviews.reduce((s, r) => s + r.rating, 0);
  p.stats.ratingCount ??= p.stats.reviews.length;
  p.hooks ??= doneOutputs(w, 'write_ad_hooks', p.id).reverse()
    .flatMap((o) => (Array.isArray(o.hooks) ? o.hooks as { hook?: unknown; hookStyle?: unknown }[] : []))
    .filter((h): h is { hook: string; hookStyle: HookStyle } => typeof h?.hook === 'string' && HOOK_STYLES.includes(h.hookStyle as HookStyle))
    .map(({ hook, hookStyle }) => ({ hook, hookStyle }))
    .slice(0, 60);
  const feedback: NonNullable<Product['feedback']> = [];
  for (const t of w.company.tasks) {
    if (t.kind !== 'reply_inbox' || t.status !== 'done') continue;
    const replies = Array.isArray(t.output?.replies) ? t.output.replies as Record<string, unknown>[] : [];
    for (const r of replies) {
      const quality = r.detected === 'plainte_qualite';
      if (r.productId !== p.id || !(quality || typeof r.complaint === 'string') || !fromBuyer(w, r.messageId, p.id)) continue;
      feedback.push({ day: t.dayDone ?? t.dayCreated, text: typeof r.complaint === 'string' ? r.complaint : '', quality });
    }
  }
  p.feedback ??= feedback.slice(-30);
}

/**
 * Brings a save from before V1 up to version 2, once (§2.8). Every scenario field gets the value its absence meant, so the
 * run goes on as it was. What a pillar owns (`company.org`, `company.growth`…) is filled by its `mount`.
 */
export function migrateWorld(w: WorldState): WorldState {
  const goal = w.market.events.find((e) => e.kind === 'goal_reached');
  if (goal) w.company.goalReachedDay ??= goal.day; // version 2 saves too: the field came after them
  if (w.version >= 2) return w;
  const s = w.scenario;
  s.org ??= { ...LEGACY_ORG };
  s.talent ??= 'off';
  s.channelControl ??= 'tiktok_only';
  s.videoModel ??= 'off';
  s.visualModel ??= 'off';
  s.scaling ??= false;
  s.openEnded ??= false;
  for (const a of w.company.agents) {
    const def = CANDIDATES[a.id];
    if (def) {
      a.roleId ??= def.roleId;
      a.gender ??= def.gender;
      a.founder ??= def.founder;
    }
    a.hatKinds ??= [];
    a.hatDepts ??= [];
    a.hiredDay ??= 0;
    a.rampUntilDay ??= 0;
    a.notice ??= null;
  }
  for (const p of w.company.products) backfillProduct(w, p);
  w.version = 2;
  return w;
}

async function readSave(file: string, runId: string): Promise<WorldState | null> {
  try {
    const raw = await readFile(file);
    const text = file.endsWith('.gz') ? await gunzipAsync(raw) : raw;
    const parsed: unknown = JSON.parse(text.toString('utf8'));
    if (!isValidSave(parsed)) return null;
    if (!Array.isArray(parsed.activity)) parsed.activity = [];
    parsed.runId = runId;
    return migrateWorld(parsed);
  } catch {
    return null;
  }
}

/** Loads runs/<runId>/world.json; null when missing or unreadable. */
export async function loadWorld(runId: string, opts: { dir?: string } = {}): Promise<WorldState | null> {
  if (!isValidRunId(runId)) return null;
  return readSave(worldFile(runId, opts.dir), runId);
}

async function checkpointDays(folder: string): Promise<number[]> {
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.flatMap((n) => { const m = CHECKPOINT_RE.exec(n); return m ? [Number(m[1])] : []; }).sort((a, b) => b - a);
}

const checkpointFile = (day: number) => `day-${String(day).padStart(4, '0')}.json.gz`;

/** The days worth keeping, newest first: the last 4 weeks, then one per 30 days, 12 files at most. */
export function keptCheckpoints(days: readonly number[]): number[] {
  const newest = [...days].sort((a, b) => b - a);
  const kept = newest.slice(0, CHECKPOINT.weekly);
  const months = new Set<number>();
  for (const day of newest.slice(CHECKPOINT.weekly)) {
    const month = Math.floor(day / CHECKPOINT.monthDays);
    if (months.has(month)) continue;
    months.add(month);
    kept.push(day);
  }
  return kept.slice(0, CHECKPOINT.max);
}

/** runs/<runId>/checkpoints/day-0007.json.gz, for the day that just closed. The world is read now: a later tick never lands in it. */
export async function saveCheckpoint(world: WorldState, dir = runsDir()): Promise<void> {
  const folder = join(dir, world.runId, CHECKPOINTS);
  const closed = world.tick === 0 ? world.day - 1 : world.day;
  const gz = await gzipAsync(JSON.stringify(world));
  await mkdir(folder, { recursive: true });
  await writeFileAtomic(join(folder, checkpointFile(closed)), gz);
  const days = await checkpointDays(folder);
  const kept = new Set(keptCheckpoints(days));
  await Promise.all(days.filter((d) => !kept.has(d)).map((d) => unlink(join(folder, checkpointFile(d))).catch(() => undefined)));
}

/** Ticks between what meta.json last saw and this older save. */
async function ticksLost(root: string, world: WorldState): Promise<number> {
  try {
    const meta = JSON.parse(await readFile(join(root, META_FILE), 'utf8')) as { day?: unknown; tick?: unknown };
    const day = Number(meta.day);
    const tick = Number(meta.tick ?? 0);
    if (!Number.isFinite(day) || !Number.isFinite(tick)) return 0;
    return Math.max(0, (day - world.day) * TICKS_PER_DAY + tick - world.tick);
  } catch {
    return 0;
  }
}

/**
 * world.json, then world.prev.json, then the checkpoints from the newest. Null only when none of them can be read: the
 * agency must not start a new run over a life it could still resume.
 */
export async function loadWorldSafe(runId: string, opts: { dir?: string } = {}): Promise<SafeLoad | null> {
  if (!isValidRunId(runId)) return null;
  const root = join(opts.dir ?? runsDir(), runId);
  const world = await readSave(join(root, WORLD_FILE), runId);
  if (world) return { world, from: 'world' };
  const folder = join(root, CHECKPOINTS);
  const older: [string, 'prev' | 'checkpoint'][] = [
    [join(root, PREV_FILE), 'prev'],
    ...(await checkpointDays(folder)).map((d): [string, 'checkpoint'] => [join(folder, checkpointFile(d)), 'checkpoint']),
  ];
  for (const [file, from] of older) {
    const found = await readSave(file, runId);
    if (!found) continue;
    await renameWithRetry(join(root, WORLD_FILE), join(root, BAD_FILE)).catch(() => undefined);
    return { world: found, from, lostTicks: await ticksLost(root, found) };
  }
  return null;
}

/** The run the app last played. */
export async function readCurrentRun(dir = runsDir()): Promise<string | null> {
  try {
    const { runId } = JSON.parse(await readFile(join(dir, CURRENT_FILE), 'utf8')) as { runId?: unknown };
    return isValidRunId(runId) ? runId : null;
  } catch {
    return null;
  }
}

export async function writeCurrentRun(runId: string, dir = runsDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(join(dir, CURRENT_FILE), JSON.stringify({ runId }));
}

export async function readSessionLog(runId: string, dir = runsDir()): Promise<SessionRecord[]> {
  try {
    const log: unknown = JSON.parse(await readFile(join(dir, runId, SESSION_LOG), 'utf8'));
    return Array.isArray(log) ? log as SessionRecord[] : [];
  } catch {
    return [];
  }
}

async function writeSessionLog(runId: string, log: SessionRecord[], dir: string): Promise<void> {
  await mkdir(join(dir, runId), { recursive: true });
  await writeFileAtomic(join(dir, runId, SESSION_LOG), JSON.stringify(log.slice(-SESSION_LOG_MAX), null, 1));
}

/**
 * The app opens a run. A record left without `stopAt` means the last stay ended in a crash: it closes as such, at the last
 * save the disk saw.
 */
export async function openSessionRecord(runId: string, day: number, recovered?: SessionRecord['recovered'], dir = runsDir()): Promise<void> {
  const log = await readSessionLog(runId, dir);
  const last = log.at(-1);
  if (last && !last.stopAt) {
    const saved = await stat(join(dir, runId, META_FILE)).catch(() => null);
    Object.assign(last, { stopAt: (saved?.mtime ?? new Date()).toISOString(), clean: false, day });
  }
  log.push({ startAt: new Date().toISOString(), clean: false, day, ...(recovered ? { recovered } : {}) });
  await writeSessionLog(runId, log, dir);
}

/** The app leaves a run on purpose. */
export async function closeSessionRecord(runId: string, day: number, dir = runsDir()): Promise<void> {
  const log = await readSessionLog(runId, dir);
  const last = log.at(-1);
  if (!last || last.stopAt) return;
  Object.assign(last, { stopAt: new Date().toISOString(), clean: true, day });
  await writeSessionLog(runId, log, dir);
}

async function savedAtMs(root: string): Promise<number | null> {
  for (const name of [WORLD_FILE, PREV_FILE]) {
    try {
      const st = await stat(join(root, name));
      if (st.isFile()) return st.mtimeMs;
    } catch { /* next */ }
  }
  return null;
}

/** Saved runs, most recently saved first. */
export async function listRuns(opts: { dir?: string } = {}): Promise<RunInfo[]> {
  const dir = opts.dir ?? runsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const runs: (RunInfo & { mtimeMs: number })[] = [];
  for (const name of entries) {
    if (!isValidRunId(name)) continue;
    const mtimeMs = await savedAtMs(join(dir, name));
    if (mtimeMs === null) continue;
    const mtime = new Date(mtimeMs).toISOString();
    let info: RunInfo | null = null;
    try {
      const meta = JSON.parse(await readFile(join(dir, name, META_FILE), 'utf8')) as Partial<RunInfo>;
      if (meta && meta.runId === name && typeof meta.day === 'number') {
        info = {
          runId: name,
          companyName: String(meta.companyName ?? 'Pixel Agency'),
          scenarioName: String(meta.scenarioName ?? ''),
          difficulty: String(meta.difficulty ?? 'normal'),
          day: meta.day,
          status: (meta.status ?? 'paused') as RunInfo['status'],
          cash: Number(meta.cash ?? 0),
          profit: Number(meta.profit ?? 0),
          createdAt: String(meta.createdAt ?? mtime),
          mtime,
        };
      }
    } catch {
      info = null;
    }
    if (!info) {
      const world = await loadWorld(name, { dir });
      if (!world) continue;
      info = runInfoOf(world, mtime);
    }
    runs.push({ ...info, mtimeMs });
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs || b.runId.localeCompare(a.runId));
  return runs.map(({ mtimeMs: _m, ...r }) => r);
}
