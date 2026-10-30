/**
 * HTTP entry of the agency (node:http): REST + SSE API, generated run files, built web UI.
 * The HTTP layer only talks to a `SessionLike`, so it can be tested with a fake session.
 */
import { randomInt } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, join, relative } from 'node:path';
import { onActivity, repoRoot } from '../core/index.js';
import type { ApproveResponse, ChatResponse, ControlResponse, MissionResponse, ScenarioConfig, SessionInfo, WorldState } from '../shared.js';
import { isEntryPoint } from './entry.js';
import { config, mindModeLabel } from './env.js';
import {
  applyCors, errorStatus, HttpError, isSafeRelativePath, mimeFor, parseControl, readJsonBody, requireText, safeResolve,
  sanitizeScenario, sendError, sendJson, sendRawJson, type ControlAction, type Speed,
} from './http.js';
import { flushSaves, isValidRunId, runsDir } from './persist.js';
import { SseHub } from './sse.js';

/** Live session state as sent to the UI (CompanySnapshot.session, /api/control). */
export type SessionInfoLike = SessionInfo;

/** What the HTTP layer needs from the live session (implemented by AgencySession). */
export interface SessionLike {
  info(): SessionInfoLike;
  status(): WorldState['status'];
  snapshotJson(god: boolean): string;
  liveSnapshotJson?(god: boolean): string;
  tickJson(): string;
  control(action: ControlAction, speed?: Speed): Promise<SessionInfoLike>;
  newRun(partial: Partial<ScenarioConfig>): Promise<unknown>;
  loadRun(runId: string): Promise<unknown>;
  mission(text: string, agentId?: string): Promise<string>;
  missionState?(id: string): Pick<MissionResponse, 'status' | 'message'>;
  chat(agentId: string, text: string): Promise<string>;
  approve(taskId: string, approved: boolean): Promise<void>;
  brainList(): Promise<unknown[]>;
  brainNote(path: string): Promise<unknown | null>;
  brainGraph(): Promise<unknown>;
  listRuns(): Promise<unknown[]>;
}

export interface AgencyServerOptions {
  session: SessionLike;
  runsRoot?: string;
  webDist?: string;
  sse?: ConstructorParameters<typeof SseHub>[1];
}

export interface AgencyServer {
  server: Server;
  hub: SseHub;
  close(): Promise<void>;
}

const RUN_PREFIX = '/runs/';

/** Raw path of the request (not dot-segment-normalised, so traversal attempts stay visible). */
function rawPath(req: IncomingMessage): string {
  const url = req.url ?? '/';
  const q = url.search(/[?#]/);
  return q >= 0 ? url.slice(0, q) : url;
}

function controlMessage(action: ControlAction, info: SessionInfoLike): string {
  switch (action) {
    case 'play': return `L'agence travaille (vitesse ×${info.speed}).`;
    case 'pause': return "L'agence est en pause.";
    case 'step': return 'Un créneau de travail a été joué.';
    case 'day': return "L'agence avance jusqu'au matin suivant.";
  }
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, cache: string): boolean {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    size = st.size;
  } catch {
    return false;
  }
  const type = mimeFor(file);
  const headers: Record<string, string | number> = {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  };
  if (type === 'application/pdf') headers['Content-Disposition'] = `inline; filename="${basename(file).replace(/"/g, '')}"`;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

/** Shown on / when the UI has not been built (dev mode: Vite serves it on :5173). */
export function devLandingPage(port: number): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel Agency — serveur</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1b1530;color:#f4ecff;font:16px/1.6 system-ui,sans-serif}
  main{max-width:560px;padding:32px;border:4px solid #7c5cff;background:#251d42;box-shadow:8px 8px 0 #0d0a19}
  h1{margin:0 0 8px;font-size:22px;letter-spacing:.5px} code{background:#120e22;padding:2px 6px;color:#ffd166}
  a{color:#7ee0ff} small{color:#b7a9d9}
</style></head>
<body><main>
  <h1>Pixel Agency tourne</h1>
  <p>Le serveur de l'agence est en ligne sur le port <code>${port}</code>, mais l'interface n'est pas encore construite.</p>
  <p>En développement, lance <code>npm run dev</code> à la racine du dépôt puis ouvre
  <a href="http://localhost:5173">http://localhost:5173</a>.</p>
  <p>Pour servir l'interface depuis ce serveur : <code>npm run build</code>, puis recharge cette page.</p>
  <small>API : <a href="/api/state">/api/state</a> · flux en direct : <code>/api/stream</code> · runs : <a href="/api/runs">/api/runs</a></small>
</main></body></html>`;
}

export function createAgencyServer(opts: AgencyServerOptions): AgencyServer {
  const { session } = opts;
  const runsRoot = opts.runsRoot ?? runsDir();
  const webDist = opts.webDist ?? join(repoRoot(), 'web', 'dist');
  const hub = new SseHub(session, opts.sse);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (path.startsWith('/api/') || path === '/api') {
      const isGet = method === 'GET' || method === 'HEAD';
      const isPost = method === 'POST';
      const god = url.searchParams.get('god') === '1' || url.searchParams.get('god') === 'true';
      switch (path) {
        case '/api/health':
          if (!isGet) break;
          return sendJson(res, 200, { ok: true });
        case '/api/state':
          if (!isGet) break;
          return sendRawJson(res, 200, session.snapshotJson(god));
        case '/api/stream':
          if (method !== 'GET') break;
          hub.attach(req, res, god);
          return;
        case '/api/control': {
          if (!isPost) break;
          const { action, speed } = parseControl(await readJsonBody(req));
          const info = await session.control(action, speed);
          hub.snapshotSoon(true);
          const body: ControlResponse = { ok: true, status: session.status(), speed: info.speed, playing: info.playing, message: controlMessage(action, info), session: info };
          return sendJson(res, 200, body);
        }
        case '/api/scenario': {
          if (!isPost) break;
          const partial = sanitizeScenario(await readJsonBody(req));
          if (partial.seed === undefined) partial.seed = randomInt(1, 2 ** 31 - 1);
          await session.newRun(partial);
          hub.snapshotSoon(true);
          return sendRawJson(res, 200, session.snapshotJson(false));
        }
        case '/api/mission': {
          if (!isPost) break;
          const body = await readJsonBody(req);
          const text = requireText(body.text, 'text', 2000);
          const agentId = typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : undefined;
          const missionId = await session.mission(text, agentId);
          hub.snapshotSoon(true);
          const out: MissionResponse = { ok: true, missionId, ...session.missionState?.(missionId) };
          return sendJson(res, 200, out);
        }
        case '/api/chat': {
          if (!isPost) break;
          const body = await readJsonBody(req);
          const agentId = requireText(body.agentId, 'agentId', 80);
          const text = requireText(body.text, 'text', 2000);
          const reply = await session.chat(agentId, text);
          hub.snapshotSoon(true);
          const out: ChatResponse = { reply };
          return sendJson(res, 200, out);
        }
        case '/api/approve': {
          if (!isPost) break;
          const body = await readJsonBody(req);
          const taskId = requireText(body.taskId, 'taskId', 80);
          if (typeof body.approved !== 'boolean') throw new HttpError(400, 'Le champ « approved » doit être true ou false.');
          await session.approve(taskId, body.approved);
          hub.snapshotSoon(true);
          const answer: ApproveResponse = { ok: true, message: body.approved ? 'Validé : la tâche reprend.' : 'Refusé : la tâche est annulée.' };
          return sendJson(res, 200, answer);
        }
        case '/api/brain':
          if (!isGet) break;
          return sendJson(res, 200, await session.brainList());
        case '/api/brain/note': {
          if (!isGet) break;
          const p = url.searchParams.get('path');
          if (!isSafeRelativePath(p)) throw new HttpError(400, 'Chemin de note invalide.');
          const note = await session.brainNote(p);
          if (!note) throw new HttpError(404, `Note introuvable : ${p}`);
          return sendJson(res, 200, note);
        }
        case '/api/brain/graph':
          if (!isGet) break;
          return sendJson(res, 200, await session.brainGraph());
        case '/api/runs':
          if (!isGet) break;
          return sendJson(res, 200, await session.listRuns());
        case '/api/load': {
          if (!isPost) break;
          const body = await readJsonBody(req);
          if (!isValidRunId(body.runId)) throw new HttpError(400, 'Identifiant de run invalide.');
          await session.loadRun(body.runId);
          hub.snapshotSoon(true);
          return sendRawJson(res, 200, session.snapshotJson(false));
        }
        default:
          throw new HttpError(404, `Route inconnue : ${method} ${path}`);
      }
      throw new HttpError(405, `Méthode ${method} non autorisée sur ${path}.`);
    }

    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, `Méthode ${method} non autorisée.`);
    const raw = rawPath(req);

    // Generated files of a run: /runs/<runId>/<path>
    if (raw.startsWith(RUN_PREFIX)) {
      const rest = raw.slice(RUN_PREFIX.length);
      const slash = rest.indexOf('/');
      const runId = slash >= 0 ? safeDecode(rest.slice(0, slash)) : null;
      const filePart = slash >= 0 ? rest.slice(slash + 1) : '';
      if (!runId || !isValidRunId(runId) || !filePart) throw new HttpError(404, 'Fichier introuvable.');
      const base = join(runsRoot, runId);
      const file = safeResolve(base, filePart);
      if (!file) throw new HttpError(403, 'Chemin refusé.');
      // world.json holds the hidden market truth: never served.
      if (/^world\.json/i.test(relative(base, file).replace(/\\/g, '/'))) throw new HttpError(403, 'Fichier réservé au serveur.');
      if (!serveFile(req, res, file, 'no-cache')) throw new HttpError(404, 'Fichier introuvable.');
      return;
    }

    // Built UI (web/dist) with SPA fallback.
    const index = join(webDist, 'index.html');
    if (existsSync(index)) {
      const rel = raw === '/' ? 'index.html' : raw;
      const file = safeResolve(webDist, rel);
      if (file && serveFile(req, res, file, extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600')) return;
      const last = raw.split('/').pop() ?? '';
      if (!file || !extname(last)) {
        if (serveFile(req, res, index, 'no-cache')) return;
      }
      throw new HttpError(404, 'Fichier introuvable.');
    }
    if (raw === '/' || raw === '/index.html' || !extname(raw)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(method === 'HEAD' ? undefined : devLandingPage((server.address() as AddressInfo | null)?.port ?? config.port));
      return;
    }
    throw new HttpError(404, 'Fichier introuvable.');
  }

  const server = createServer((req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    route(req, res).catch((err: unknown) => {
      const status = errorStatus(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (status < 500) return sendError(res, status, msg);
      console.error(`[api] ${req.method} ${req.url} :`, err);
      sendError(res, 500, `Erreur interne du serveur : ${msg}`);
    }).catch(() => {
      try { res.destroy(); } catch { /* socket already gone */ }
    });
  });
  server.on('clientError', (_err, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ }
  });

  return {
    server,
    hub,
    close: () => new Promise<void>((resolveClose) => {
      hub.close();
      server.close(() => resolveClose());
      server.closeAllConnections?.();
    }),
  };
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Placeholder used when the agency itself could not start: the API answers 503 with the reason. */
export function unavailableSession(reason: string): SessionLike {
  const fail = (): never => { throw new HttpError(503, `L'agence n'a pas pu démarrer : ${reason}`); };
  return {
    info: () => ({ runId: '', playing: false, speed: 1, mindMode: 'heuristic' }),
    status: () => 'paused',
    snapshotJson: fail,
    tickJson: fail,
    control: async () => fail(),
    newRun: async () => fail(),
    loadRun: async () => fail(),
    mission: async () => fail(),
    chat: async () => fail(),
    approve: async () => fail(),
    brainList: async () => fail(),
    brainNote: async () => fail(),
    brainGraph: async () => fail(),
    listRuns: async () => fail(),
  };
}

let guardsInstalled = false;
function installCrashGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on('unhandledRejection', (reason) => console.error('[agence] promesse rejetée non gérée :', reason));
  process.on('uncaughtException', (err) => console.error('[agence] exception non gérée (le serveur continue) :', err));
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (err: NodeJS.ErrnoException) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolveListen(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

/** Entry point: boots the session (most recent run, or a new one), the HTTP server and the SSE bridge. */
export async function startServer(port = config.port): Promise<AgencyServer> {
  installCrashGuards();
  let session: SessionLike;
  let shutdownSession: () => Promise<void> = async () => { await flushSaves(); };
  let bindEvents: (hub: SseHub) => void = () => undefined;
  let degraded = false;
  try {
    const { AgencySession } = await import('./session.js');
    const live = new AgencySession();
    await live.start();
    session = {
      info: () => live.info(),
      status: () => live.world.status,
      snapshotJson: (god) => live.snapshotJson(god),
      liveSnapshotJson: (god) => live.liveSnapshotJson(god),
      tickJson: () => live.tickJson(),
      control: (a, s) => live.control(a, s),
      newRun: (p) => live.newRun(p),
      loadRun: (id) => live.loadRun(id),
      mission: (t, a) => live.mission(t, a),
      missionState: (id) => live.missionState(id),
      chat: (a, t) => live.chat(a, t),
      approve: (t, ok) => live.approve(t, ok),
      brainList: () => live.brainList(),
      brainNote: (p) => live.brainNote(p),
      brainGraph: () => live.brainGraph(),
      listRuns: () => live.listRuns(),
    };
    shutdownSession = () => live.shutdown();
    bindEvents = (hub) => {
      live.on('tick', () => hub.tick());
      live.on('run', () => hub.snapshotSoon(true));
      live.on('state', () => hub.snapshotSoon());
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[agence] démarrage de l'agence impossible :", err);
    session = unavailableSession(reason);
    degraded = true;
  }

  const app = createAgencyServer({ session });
  onActivity((a) => app.hub.pushActivity(a));
  bindEvents(app.hub);

  try {
    await listen(app.server, port);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(code === 'EADDRINUSE'
      ? `Le port ${port} est déjà utilisé : arrête l'autre serveur ou change PORT dans .env.`
      : `Impossible d'écouter sur le port ${port} : ${(err as Error).message}`);
    await shutdownSession().catch(() => undefined);
    process.exit(1);
  }

  const info = session.info();
  const runLabel = info.runId ? ` · run ${info.runId}` : '';
  console.log(degraded
    ? `Pixel Agency : serveur en ligne sur http://localhost:${port}, mais l'agence n'a pas pu démarrer (voir l'erreur ci-dessus) · cerveau : ${mindModeLabel(config.mindMode)}`
    : `Pixel Agency en ligne sur http://localhost:${port} · cerveau : ${mindModeLabel(info.mindMode)}${runLabel}${info.playing ? ` · l'agence travaille (×${info.speed})` : ''}`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) process.exit(0);
    stopping = true;
    console.log(`\n${signal} reçu : sauvegarde du run et arrêt du serveur…`);
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    await shutdownSession().catch((e) => console.error('[agence] sauvegarde finale :', e));
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
  return app;
}

if (isEntryPoint(import.meta.url)) void startServer();
