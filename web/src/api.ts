// Typed client for the agency server (see server/src/contracts.ts, "api/" section).
import type {
  Activity, AgentId, CompanySnapshot, DayPhase, FinanceSnapshot, LiveAgent, Mission, ScenarioConfig, SessionInfo, StreamEvent,
} from '../../shared/types';

// ───────────────────────────── Response shapes ─────────────────────────────

/** Mirrors BrainNote from server/src/contracts.ts (the web never imports server code). */
export interface BrainNote { path: string; title: string; tags: string[]; body: string; links: string[]; updatedDay: number }
export type BrainNoteMeta = Omit<BrainNote, 'body'> & { body?: string };
export interface BrainGraph { nodes: { id: string; title: string; group: string }[]; edges: { from: string; to: string }[] }

export type Speed = 1 | 2 | 4 | 8;
export type ControlAction = 'play' | 'pause' | 'step' | 'day';
export interface ControlRequest { action: ControlAction; speed?: Speed }
/** session = live loop state after the command (ControlResponse.session), the source of truth for the HUD. */
export interface ControlResult { ok: boolean; status?: string; speed?: Speed; playing?: boolean; message?: string; session?: SessionInfo }

/** status + message = where the mission stands right after the company read it (message: Mission.outcome). */
export interface MissionResult { ok: boolean; missionId: string | null; status?: Mission['status']; message?: string }
export interface ApproveResult { ok: boolean; message?: string }

/** GET /api/runs — the server decides the exact fields; everything but runId is optional. */
export interface RunSummary {
  runId: string;
  name?: string;
  companyName?: string;
  difficulty?: string;
  day?: number;
  status?: string;
  cash?: number;
  profit?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** agents = what moved during the tick: the full snapshot only comes about once per second. */
export interface TickInfo { day: number; tick: number; phase: DayPhase; finance: FinanceSnapshot; agents?: LiveAgent[] }

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ───────────────────────────── Low level ─────────────────────────────

const DEFAULT_TIMEOUT = 10_000;

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const msg = isObj(data) && typeof data.error === 'string' ? data.error
        : isObj(data) && typeof data.message === 'string' ? data.message
        : `Erreur serveur (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    // Vite answers unknown routes with index.html when the proxy target is down: treat as unreachable.
    if (typeof data === 'string' && data.trimStart().startsWith('<')) throw new ApiError('Serveur injoignable', 502);
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') throw new ApiError('Le serveur ne répond pas (délai dépassé)', 408);
    throw new ApiError('Serveur injoignable', 0);
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeoutMs });

function asSnapshot(data: unknown): CompanySnapshot {
  if (isObj(data) && typeof data.runId === 'string' && isObj(data.company)) return data as unknown as CompanySnapshot;
  if (isObj(data) && isObj(data.snapshot)) return asSnapshot(data.snapshot);
  if (isObj(data) && isObj(data.state)) return asSnapshot(data.state);
  throw new ApiError('Réponse inattendue du serveur (instantané manquant)', 500);
}

/** Accepts a SessionInfo-looking object (runId + playing + speed), else undefined. */
export function asSession(v: unknown): SessionInfo | undefined {
  if (!isObj(v) || typeof v.runId !== 'string' || typeof v.playing !== 'boolean') return undefined;
  if (typeof v.speed !== 'number' || ![1, 2, 4, 8].includes(v.speed)) return undefined;
  return v as unknown as SessionInfo;
}

function okFlag(data: unknown): boolean {
  return !(isObj(data) && data.ok === false);
}

// ───────────────────────────── Endpoints ─────────────────────────────

export const api = {
  /** GET /api/state (god = adds hidden market truth). */
  async state(god = false): Promise<CompanySnapshot> {
    return asSnapshot(await request<unknown>(god ? '/api/state?god=1' : '/api/state', { timeoutMs: 6000 }));
  },

  /** POST /api/control */
  async control(body: ControlRequest): Promise<ControlResult> {
    // step/day run whole ticks server-side (slow with Claude): allow a long wait
    const data = await post<unknown>('/api/control', body, body.action === 'day' || body.action === 'step' ? 180_000 : 15_000);
    const o = isObj(data) ? data : {};
    return {
      ok: okFlag(data),
      status: typeof o.status === 'string' ? o.status : undefined,
      speed: typeof o.speed === 'number' && [1, 2, 4, 8].includes(o.speed) ? (o.speed as Speed) : undefined,
      playing: typeof o.playing === 'boolean' ? o.playing : undefined,
      message: typeof o.message === 'string' ? o.message : undefined,
      session: asSession(o.session),
    };
  },

  /** POST /api/scenario — starts a new run. */
  async scenario(config: Partial<ScenarioConfig>): Promise<CompanySnapshot> {
    return asSnapshot(await post<unknown>('/api/scenario', config, 30_000));
  },

  /** POST /api/mission */
  async mission(text: string, agentId?: AgentId): Promise<MissionResult> {
    const data = await post<unknown>('/api/mission', agentId ? { text, agentId } : { text }, 30_000);
    const o = isObj(data) ? data : {};
    const id = typeof o.missionId === 'string' ? o.missionId : typeof o.id === 'string' ? o.id : typeof data === 'string' ? data : null;
    const status = o.status === 'open' || o.status === 'done' || o.status === 'failed' ? o.status : undefined;
    return { ok: okFlag(data), missionId: id, status, message: typeof o.message === 'string' ? o.message : undefined };
  },

  /** POST /api/chat → the agent's answer (French). Claude answers can be slow. */
  async chat(agentId: AgentId, text: string): Promise<string> {
    const data = await post<unknown>('/api/chat', { agentId, text }, 90_000);
    if (typeof data === 'string') return data;
    if (isObj(data) && typeof data.reply === 'string') return data.reply;
    if (isObj(data) && typeof data.text === 'string') return data.text;
    throw new ApiError('Réponse vide de l\'agent', 500);
  },

  /** POST /api/approve (founderApproval mode). */
  async approve(taskId: string, approved: boolean): Promise<ApproveResult> {
    const data = await post<unknown>('/api/approve', { taskId, approved });
    return { ok: okFlag(data), message: isObj(data) && typeof data.message === 'string' ? data.message : undefined };
  },

  /** GET /api/brain → notes without body. */
  async brainList(): Promise<BrainNoteMeta[]> {
    const data = await request<unknown>('/api/brain');
    const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.notes) ? data.notes : [];
    return arr.filter((n): n is BrainNoteMeta => isObj(n) && typeof n.path === 'string').map((n) => ({
      ...n,
      title: n.title || basename(n.path),
      tags: Array.isArray(n.tags) ? n.tags : [],
      links: Array.isArray(n.links) ? n.links : [],
      updatedDay: typeof n.updatedDay === 'number' ? n.updatedDay : 0,
    }));
  },

  /** GET /api/brain/note?path=… */
  async brainNote(path: string): Promise<BrainNote> {
    const data = await request<unknown>(`/api/brain/note?path=${encodeURIComponent(path)}`);
    const n = isObj(data) && isObj(data.note) ? data.note : data;
    if (!isObj(n) || typeof n.body !== 'string') throw new ApiError('Note introuvable', 404);
    return {
      path: typeof n.path === 'string' ? n.path : path,
      title: typeof n.title === 'string' ? n.title : basename(path),
      tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
      body: n.body,
      links: Array.isArray(n.links) ? (n.links as string[]) : [],
      updatedDay: typeof n.updatedDay === 'number' ? n.updatedDay : 0,
    };
  },

  /** GET /api/brain/graph */
  async brainGraph(): Promise<BrainGraph> {
    const data = await request<unknown>('/api/brain/graph');
    const o = isObj(data) ? data : {};
    return {
      nodes: Array.isArray(o.nodes) ? (o.nodes as BrainGraph['nodes']).filter((n) => n && typeof n.id === 'string') : [],
      edges: Array.isArray(o.edges) ? (o.edges as BrainGraph['edges']).filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string') : [],
    };
  },

  /** GET /api/runs */
  async runs(): Promise<RunSummary[]> {
    const data = await request<unknown>('/api/runs');
    const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.runs) ? data.runs : [];
    return arr
      .map((r): RunSummary | null => {
        if (typeof r === 'string') return { runId: r };
        if (isObj(r) && typeof (r.runId ?? r.id) === 'string') return { ...(r as Partial<RunSummary>), runId: String(r.runId ?? r.id) };
        return null;
      })
      .filter((r): r is RunSummary => r !== null);
  },

  /** POST /api/load { runId } */
  async load(runId: string): Promise<CompanySnapshot> {
    return asSnapshot(await post<unknown>('/api/load', { runId }, 30_000));
  },
};

function runRelative(runId: string, path: string): string {
  const p = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `runs/${runId}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** Generated file of a run, served by the API at /runs/<runId>/<path>. */
export function fileUrl(runId: string, path: string | null | undefined): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `/runs/${encodeURIComponent(runId)}/${runRelative(runId, path).split('/').map(encodeURIComponent).join('/')}`;
}

/** Vault path of a run file that is a brain note (« brain/journal/jour-001.md » → « journal/jour-001.md »), else null. */
export function brainNotePath(runId: string, path: string | null | undefined): string | null {
  if (!path) return null;
  const m = /^brain\/(.+\.md)$/i.exec(runRelative(runId, path));
  return m ? m[1]! : null;
}

export function basename(path: string): string {
  const last = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return last.replace(/\.md$/i, '');
}

// ───────────────────────────── Live stream (SSE) ─────────────────────────────

export interface StreamHandlers {
  onSnapshot(snapshot: CompanySnapshot): void;
  onActivity(batch: Activity[]): void;
  onTick?(tick: TickInfo): void;
  /** 'open' on (re)connection, 'reconnecting' while the link is down. */
  onStatus?(status: 'open' | 'reconnecting', reconnected: boolean): void;
}

/** Opens GET /api/stream with exponential-backoff auto-reconnect. Returns a closer. */
export function openStream(handlers: StreamHandlers): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retries = 0;
  let everOpened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dispatch = (raw: string, name: string | null) => {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return; }
    const ev = data as Partial<StreamEvent> & Json;
    const type = typeof ev.type === 'string' ? ev.type : name;
    if (type === 'snapshot') {
      const snap = isObj(ev.snapshot) ? ev.snapshot : ev;
      if (isObj(snap) && typeof snap.runId === 'string' && isObj(snap.company)) handlers.onSnapshot(snap as unknown as CompanySnapshot);
    } else if (type === 'activity') {
      const list = Array.isArray(data) ? data : Array.isArray(ev.activity) ? ev.activity : isObj(ev.activity) ? [ev.activity] : isObj(ev) && typeof ev.id === 'string' ? [ev] : [];
      const valid = (list as unknown[]).filter((a): a is Activity => isObj(a) && typeof a.id === 'string' && typeof a.text === 'string');
      if (valid.length) handlers.onActivity(valid);
    } else if (type === 'tick') {
      if (typeof ev.day === 'number' && typeof ev.tick === 'number' && isObj(ev.finance)) {
        handlers.onTick?.({ day: ev.day, tick: ev.tick, phase: ev.phase as DayPhase, finance: ev.finance as unknown as FinanceSnapshot, agents: Array.isArray(ev.agents) ? ev.agents as LiveAgent[] : undefined });
      }
    }
  };

  const connect = () => {
    if (closed) return;
    const source = new EventSource('/api/stream');
    es = source;
    source.onopen = () => {
      handlers.onStatus?.('open', everOpened);
      everOpened = true;
      retries = 0;
    };
    source.onmessage = (e) => dispatch(e.data, null);
    for (const name of ['snapshot', 'activity', 'tick'] as const) {
      source.addEventListener(name, (e) => dispatch((e as MessageEvent<string>).data, name));
    }
    source.onerror = () => {
      source.close();
      if (es === source) es = null;
      if (closed) return;
      handlers.onStatus?.('reconnecting', everOpened);
      const delay = Math.min(10_000, 800 * 2 ** retries);
      retries += 1;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
    es = null;
  };
}
