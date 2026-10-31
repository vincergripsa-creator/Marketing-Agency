/** Small, pure HTTP helpers (unit-tested): path safety, mime types, JSON bodies, input sanitising. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Difficulty, OrgConfig, ScenarioConfig, Speed, TalentMode } from '../shared.js';
import { LEAN_ORG } from '../runtime/org/constants.js';
import { minRunCash } from '../runtime/org/payroll.js';
import { FEES, MIN_BUDGET_DAYS } from '../sim/balance.js';

export type { Speed };

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Resolves `requested` (URL path, possibly %-encoded) inside `base`.
 * Returns null for anything that escapes `base`: `..`, absolute paths, drive letters, NUL bytes, bad encoding.
 */
export function safeResolve(base: string, requested: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || /^[A-Za-z]:/.test(rel) || isAbsolute(rel)) return null;
  if (rel.split('/').some((seg) => seg === '..')) return null;
  const root = resolve(base);
  const full = resolve(root, rel);
  const back = relative(root, full);
  if (!back || back.startsWith('..') || isAbsolute(back)) return null;
  if (!full.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return full;
}

/** What a run folder holds of the hidden truth: saves and checkpoints are whole worlds, the archive keeps customers with their archetype (D51). */
const SERVER_ONLY = /^(world[^/]*\.json|checkpoints\/|archive\/)/i;

/** `rel`: a path inside a run folder. */
export function isServerOnlyFile(rel: string): boolean {
  return SERVER_ONLY.test(rel.replace(/\\/g, '/'));
}

/** Relative note path accepted by the brain endpoints ("lecons/ads.md"). */
export function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 300 || p.includes('\0')) return false;
  const n = p.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return false;
  return !n.split('/').some((seg) => seg === '..');
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:\d{1,5})?$/i;

export function isLocalOrigin(origin: string | undefined): origin is string {
  return typeof origin === 'string' && LOCAL_ORIGIN.test(origin);
}

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!isLocalOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  sendRawJson(res, status, JSON.stringify(body));
}

export function sendRawJson(res: ServerResponse, status: number, json: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * HTTP status of an error thrown below the HTTP layer: HttpError, or any error carrying a numeric 4xx
 * `status` / `statusCode` (e.g. the runtime's « Agent inconnu » → 404). Everything else is a 500.
 */
export function errorStatus(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; statusCode?: unknown };
    const s = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : NaN;
    if (Number.isInteger(s) && s >= 400 && s < 500) return s;
  }
  return 500;
}

export const MAX_BODY_BYTES = 1_000_000;

/** Reads a JSON object body. Empty body → {}. Throws HttpError 413 / 400. */
export function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      reject(new HttpError(413, `Corps de requête trop volumineux (max ${Math.round(limit / 1000)} Ko).`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, `Corps de requête trop volumineux (max ${Math.round(limit / 1000)} Ko).`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (!failed) reject(new HttpError(400, `Lecture du corps impossible : ${err.message}`));
      failed = true;
    });
    req.on('end', () => {
      if (failed) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolveBody({});
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'Le corps JSON doit être un objet.'));
          return;
        }
        resolveBody(parsed as Record<string, unknown>);
      } catch {
        reject(new HttpError(400, 'Corps JSON invalide.'));
      }
    });
  });
}

// ───────────────────────────── input validation ─────────────────────────────

export const SPEEDS: readonly Speed[] = [1, 2, 4, 8];
export type ControlAction = 'play' | 'pause' | 'step' | 'day';

export function parseControl(body: Record<string, unknown>): { action: ControlAction; speed?: Speed } {
  const action = body.action;
  if (action !== 'play' && action !== 'pause' && action !== 'step' && action !== 'day') {
    throw new HttpError(400, "Action inconnue : attendu 'play', 'pause', 'step' ou 'day'.");
  }
  if (body.speed === undefined || body.speed === null) return { action };
  const speed = Number(body.speed);
  if (!SPEEDS.includes(speed as Speed)) throw new HttpError(400, 'Vitesse invalide : attendu 1, 2, 4 ou 8.');
  return { action, speed: speed as Speed };
}

export function requireText(v: unknown, field: string, max = 4000): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `Le champ « ${field} » est obligatoire.`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `Le champ « ${field} » est trop long (max ${max} caractères).`);
  return t;
}

const DIFFICULTIES: readonly Difficulty[] = ['facile', 'normal', 'cauchemar'];

function num(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

/** Why a starting budget cannot open a company (French, for the founder), or null when it can. A new run is lean unless told otherwise. */
export function budgetRefusal(cash: number, org: OrgConfig = LEAN_ORG): string | null {
  const min = minRunCash({ org });
  if (cash >= min) return null;
  const setup = Math.round(FEES.setupCost);
  const running = org.payroll ? 'frais fixes et de salaires' : 'frais fixes';
  return `Budget de départ trop bas : il faut au moins ${min} € (${setup} € de frais de démarrage et ${min - setup} € de ${running} pour ${MIN_BUDGET_DAYS} jours). Avec moins, l'agence ne tiendrait pas son premier mois.`;
}

/** The team a body asks for: what it leaves out stays as on a new lean run. */
function sanitizeOrg(v: unknown): OrgConfig | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const org: OrgConfig = { ...LEAN_ORG };
  if (o.team === 'lean' || o.team === 'legacy31') org.team = o.team;
  if (typeof o.autoHire === 'boolean') org.autoHire = o.autoHire;
  if (typeof o.payroll === 'boolean') org.payroll = o.payroll;
  return org;
}

const TALENT_MODES: readonly TalentMode[] = ['off', 'flat', 'league'];

/** Keeps only valid, clamped ScenarioConfig fields from an untrusted body; an unusable budget is refused (400). `control` is for benchmarks: it never gets through. */
export function sanitizeScenario(body: Record<string, unknown>): Partial<ScenarioConfig> {
  const out: Partial<ScenarioConfig> = {};
  const org = sanitizeOrg(body.org);
  if (org) out.org = org;
  if (TALENT_MODES.includes(body.talent as TalentMode)) out.talent = body.talent as TalentMode;
  if (typeof body.openEnded === 'boolean') out.openEnded = body.openEnded;
  const name = str(body.name, 80);
  if (name) out.name = name;
  const companyName = str(body.companyName, 60);
  if (companyName) out.companyName = companyName;
  const seed = num(body.seed, 0, 2 ** 31 - 1);
  if (seed !== undefined) out.seed = Math.floor(seed);
  const cash = num(body.startingCash, 0, 1_000_000);
  if (cash !== undefined) {
    const refusal = budgetRefusal(cash, org);
    if (refusal) throw new HttpError(400, refusal);
    out.startingCash = Math.round(cash * 100) / 100;
  }
  const horizon = num(body.horizonDays, 7, 730);
  if (horizon !== undefined) out.horizonDays = Math.round(horizon);
  if (DIFFICULTIES.includes(body.difficulty as Difficulty)) out.difficulty = body.difficulty as Difficulty;
  if (body.mindMode === 'auto' || body.mindMode === 'heuristic' || body.mindMode === 'claude') out.mindMode = body.mindMode;
  if (typeof body.founderApproval === 'boolean') out.founderApproval = body.founderApproval;
  if (typeof body.chargeCompute === 'boolean') out.chargeCompute = body.chargeCompute;
  const maxCompute = num(body.maxComputeEur, 0, 500);
  if (maxCompute !== undefined) out.maxComputeEur = Math.round(maxCompute * 100) / 100;
  if (body.goal && typeof body.goal === 'object' && !Array.isArray(body.goal)) {
    const g = body.goal as Record<string, unknown>;
    const targetProfit = num(g.targetProfit, 0, 10_000_000);
    const byDay = num(g.byDay, 1, 730);
    if (targetProfit !== undefined && byDay !== undefined) out.goal = { targetProfit, byDay: Math.round(byDay) };
  }
  return out;
}
