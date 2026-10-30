/** Server-sent events hub: snapshots after each tick, throttled activity batches, heartbeats. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Activity } from '../shared.js';

export interface SnapshotSource {
  snapshotJson(god: boolean): string;
  tickJson(): string;
}

interface Client { res: ServerResponse; god: boolean; blocked: boolean; stale: boolean }

export interface SseOptions {
  activityThrottleMs?: number;
  heartbeatMs?: number;
  snapshotMinIntervalMs?: number;
  maxBufferedActivity?: number;
}

/** One SSE message (default "message" event; the StreamEvent `type` is inside the JSON). */
export function sseFrame(json: string): string {
  return `data: ${json}\n\n`;
}

export class SseHub {
  private readonly clients = new Set<Client>();
  private activity: Activity[] = [];
  private activityTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private lastSnapshotAt = 0;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly opts: Required<SseOptions>;
  private readonly source: SnapshotSource;

  constructor(source: SnapshotSource, opts: SseOptions = {}) {
    this.source = source;
    this.opts = { activityThrottleMs: 250, heartbeatMs: 15_000, snapshotMinIntervalMs: 200, maxBufferedActivity: 300, ...opts };
    this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n', true), this.opts.heartbeatMs);
    this.heartbeat.unref?.();
  }

  get size(): number {
    return this.clients.size;
  }

  attach(req: IncomingMessage, res: ServerResponse, god = false): void {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client: Client = { res, god, blocked: false, stale: false };
    this.clients.add(client);
    const drop = () => { this.clients.delete(client); };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
    res.on('drain', () => {
      client.blocked = false;
      // It missed updates while blocked: resync it with a fresh snapshot.
      if (client.stale) {
        client.stale = false;
        this.sendSnapshotTo(client);
      }
    });
    this.write(client, 'retry: 3000\n\n');
    this.sendSnapshotTo(client);
  }

  /** Called by the core activity bus; flushed as one batch every `activityThrottleMs`. */
  pushActivity(a: Activity): void {
    if (!this.clients.size) return;
    this.activity.push(a);
    if (this.activity.length > this.opts.maxBufferedActivity) this.activity.splice(0, this.activity.length - this.opts.maxBufferedActivity);
    if (!this.activityTimer) {
      this.activityTimer = setTimeout(() => this.flushActivity(), this.opts.activityThrottleMs);
      this.activityTimer.unref?.();
    }
  }

  flushActivity(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = null;
    if (!this.activity.length) return;
    const batch = this.activity;
    this.activity = [];
    if (!this.clients.size) return;
    this.broadcastRaw(sseFrame(JSON.stringify({ type: 'activity', activity: batch })));
  }

  /** After each tick: a light 'tick' event right away, then a (coalesced) full snapshot. */
  tick(): void {
    if (!this.clients.size) return;
    try {
      this.broadcastRaw(sseFrame(this.source.tickJson()));
    } catch (err) {
      console.error('[sse] tick :', (err as Error).message);
    }
    this.snapshotSoon();
  }

  /** Coalesces snapshot broadcasts to at most one per `snapshotMinIntervalMs`. */
  snapshotSoon(immediate = false): void {
    if (!this.clients.size) return;
    const wait = immediate ? 0 : Math.max(0, this.opts.snapshotMinIntervalMs - (Date.now() - this.lastSnapshotAt));
    if (this.snapshotTimer) {
      if (!immediate) return;
      clearTimeout(this.snapshotTimer);
    }
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.broadcastSnapshot();
    }, wait);
    this.snapshotTimer.unref?.();
  }

  broadcastSnapshot(): void {
    this.lastSnapshotAt = Date.now();
    this.flushActivity();
    const cache = new Map<boolean, string>();
    for (const c of this.clients) {
      if (c.blocked) {
        c.stale = true;
        continue;
      }
      let frame = cache.get(c.god);
      if (frame === undefined) {
        try {
          frame = sseFrame(`{"type":"snapshot","snapshot":${this.source.snapshotJson(c.god)}}`);
        } catch (err) {
          console.error('[sse] snapshot :', (err as Error).message);
          return;
        }
        cache.set(c.god, frame);
      }
      this.write(c, frame);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    for (const c of this.clients) {
      try { c.res.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }

  private sendSnapshotTo(client: Client): void {
    try {
      this.write(client, sseFrame(`{"type":"snapshot","snapshot":${this.source.snapshotJson(client.god)}}`));
    } catch (err) {
      // No run mounted yet (startup): the next tick will deliver it.
      this.write(client, `: ${String((err as Error).message).replace(/\n/g, ' ')}\n\n`);
    }
  }

  private broadcastRaw(frame: string, evenIfBlocked = false): void {
    for (const c of this.clients) {
      if (c.blocked && !evenIfBlocked) {
        c.stale = true;
        continue;
      }
      this.write(c, frame);
    }
  }

  private write(c: Client, frame: string): void {
    if (c.res.writableEnded || c.res.destroyed) {
      this.clients.delete(c);
      return;
    }
    try {
      if (!c.res.write(frame)) c.blocked = true;
    } catch {
      this.clients.delete(c);
    }
  }
}
