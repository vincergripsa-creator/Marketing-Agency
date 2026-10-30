import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from '../core/index.js';
import type { LedgerType, RunInfo, WorldState } from '../shared.js';

/** Saved run summary (shared with the UI: GET /api/runs). */
export type { RunInfo };

export interface SaveOptions {
  /** Runs root (default <repo>/runs). */
  dir?: string;
  /** Accurate cash/profit from the sim's financeSnapshot; falls back to a ledger estimate. */
  finance?: { cash: number; profit: number };
}

const WORLD_FILE = 'world.json';
const META_FILE = 'meta.json';
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

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
const INFLOWS: ReadonlySet<LedgerType> = new Set<LedgerType>(['capital', 'revenue']);

/**
 * Cash/profit from the ledger alone (no sim dependency). Handles both conventions:
 * signed amounts (costs negative) or magnitudes (costs positive, sign given by type).
 */
export function estimateCashProfit(world: Pick<WorldState, 'ledger'>): { cash: number; profit: number; capital: number } {
  const ledger = Array.isArray(world.ledger) ? world.ledger : [];
  const signed = ledger.some((e) => e.amount < 0);
  let cash = 0;
  let capital = 0;
  for (const e of ledger) {
    const amount = Number.isFinite(e.amount) ? e.amount : 0;
    const v = signed ? amount : INFLOWS.has(e.type) ? amount : -Math.abs(amount);
    cash += v;
    if (e.type === 'capital') capital += v;
  }
  return { cash: r2(cash), profit: r2(cash - capital), capital: r2(capital) };
}

export function runInfoOf(world: WorldState, mtime: string, finance?: { cash: number; profit: number }): RunInfo {
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

/** Atomic write: tmp file in the same folder + rename. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  tmpCounter += 1;
  const tmp = `${file}.tmp-${process.pid}-${tmpCounter}`;
  await writeFile(tmp, data, 'utf8');
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Writes runs/<runId>/world.json (+ a small meta.json used by listRuns). Returns the world file path. */
export function saveWorld(world: WorldState, opts: SaveOptions = {}): Promise<string> {
  const dir = opts.dir ?? runsDir();
  if (!isValidRunId(world.runId)) return Promise.reject(new Error(`Identifiant de run invalide : ${String(world.runId)}`));
  const root = join(dir, world.runId);
  const file = join(root, WORLD_FILE);
  // Serialise synchronously so the saved state is the one at call time.
  const json = JSON.stringify(world);
  const meta = JSON.stringify(runInfoOf(world, new Date().toISOString(), opts.finance), null, 2);
  const prev = chains.get(world.runId) ?? Promise.resolve();
  const job = prev.catch(() => undefined).then(async () => {
    await mkdir(root, { recursive: true });
    await writeFileAtomic(file, json);
    await writeFileAtomic(join(root, META_FILE), meta);
    return file;
  });
  chains.set(world.runId, job);
  void job.finally(() => { if (chains.get(world.runId) === job) chains.delete(world.runId); }).catch(() => undefined);
  return job;
}

interface PendingSave { timer: NodeJS.Timeout; world: WorldState; opts: SaveOptions }
const pending = new Map<string, PendingSave>();

/** Debounced save: many calls within `delayMs` produce one write. */
export function scheduleSave(world: WorldState, delayMs = 1500, opts: SaveOptions = {}): void {
  const existing = pending.get(world.runId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(world.runId);
    saveWorld(world, opts).catch((err) => console.error(`[sauvegarde] échec pour ${world.runId} :`, (err as Error).message));
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
    jobs.push(saveWorld(p.world, p.opts));
  }
  jobs.push(...chains.values());
  await Promise.allSettled(jobs);
}

export function worldFile(runId: string, dir = runsDir()): string {
  return join(dir, runId, WORLD_FILE);
}

export function runExists(runId: string, dir = runsDir()): boolean {
  return isValidRunId(runId) && existsSync(worldFile(runId, dir));
}

function looksLikeWorld(v: unknown): v is WorldState {
  if (!v || typeof v !== 'object') return false;
  const w = v as Partial<WorldState>;
  return typeof w.runId === 'string' && typeof w.day === 'number' && !!w.company && !!w.market && !!w.scenario && Array.isArray(w.ledger);
}

/** Loads runs/<runId>/world.json; null when missing or unreadable. */
export async function loadWorld(runId: string, opts: { dir?: string } = {}): Promise<WorldState | null> {
  if (!isValidRunId(runId)) return null;
  try {
    const raw = await readFile(worldFile(runId, opts.dir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeWorld(parsed)) return null;
    if (!Array.isArray(parsed.activity)) parsed.activity = [];
    parsed.runId = runId;
    return parsed;
  } catch {
    return null;
  }
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
    const wf = join(dir, name, WORLD_FILE);
    let mtimeMs: number;
    try {
      const st = await stat(wf);
      if (!st.isFile()) continue;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
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
